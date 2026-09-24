import { invoke } from '@tauri-apps/api/core'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { getDb } from '@/db'
import { filterSyncData } from '@/config/sync-exclusions'
import { encryptJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import type { SyncObjectKind, WorkspaceType } from './protocol'
import { base64UrlByteLength, uploadAsset } from './blob'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'

interface PendingChange {
  id: number
  domain: string
  localKey: string
  operation: 'upsert' | 'delete'
  reason: string
  deterministicImport: number
}

interface ObjectMapping {
  objectId: string
  revision: string | null
  blobRefs: string[]
  documentSequence: string
}

export async function enqueueFileSnapshot(
  relativePath: string,
  operation: 'upsert' | 'delete' = 'upsert',
  workspaceId?: string,
  identityMode: 'import' | 'new' = 'new',
) {
  const database = await getDb()
  const resolvedWorkspaceId = workspaceId ?? await activeLibraryWorkspaceId()
  if (!resolvedWorkspaceId) return
  const now = Date.now()
  if (await hasUnsentChange(database, resolvedWorkspaceId, 'file', relativePath, operation)) return
  if (operation === 'upsert' && await fileSnapshotMatchesMapping(
    database, resolvedWorkspaceId, relativePath,
  )) return
  if (operation === 'upsert') {
    await enqueueParentFolderChanges(database, resolvedWorkspaceId, relativePath, now, identityMode)
  }
  await database.execute(
    `insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, created_at, updated_at)
     values ($1, 'file', $2, $3, $4, $5, $5)`,
    [resolvedWorkspaceId, relativePath, operation, `workspace:file-${identityMode}`, now]
  )
}

async function fileSnapshotMatchesMapping(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  relativePath: string,
) {
  const rows = await database.select<Array<{ localRoot: string; contentHash: string }>>(
    `select b.local_root as localRoot, m.content_hash as contentHash
     from self_hosted_workspace_bindings b
     join self_hosted_object_mappings m on m.workspace_id = b.workspace_id
     where b.workspace_id = $1 and b.binding_state = 'bound'
       and m.relative_path = $2 and m.kind = 'note' and m.deleted_at is null
       and b.local_root is not null and m.content_hash is not null
     limit 1`,
    [workspaceId, relativePath],
  )
  const current = rows[0]
  if (!current) return false
  try {
    const content = await readTextFile(await join(current.localRoot, relativePath))
    const hash = await invoke<string>('self_hosted_sha256', { value: content })
    return hash === current.contentHash
  } catch {
    return false
  }
}

export async function enqueueAssetSnapshot(
  relativePath: string,
  operation: 'upsert' | 'delete' = 'upsert',
  workspaceId?: string,
  identityMode: 'import' | 'new' = 'new',
) {
  const database = await getDb()
  const resolvedWorkspaceId = workspaceId ?? await activeLibraryWorkspaceId()
  if (!resolvedWorkspaceId) return
  const now = Date.now()
  if (await hasUnsentChange(database, resolvedWorkspaceId, 'asset', relativePath, operation)) return
  if (operation === 'upsert') {
    await enqueueParentFolderChanges(database, resolvedWorkspaceId, relativePath, now, identityMode)
  }
  await database.execute(
    `insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, created_at, updated_at)
     values ($1, 'asset', $2, $3, $4, $5, $5)`,
    [resolvedWorkspaceId, relativePath, operation, `workspace:asset-${identityMode}`, now]
  )
}

export async function enqueueFolderSnapshot(
  relativePath: string,
  operation: 'upsert' | 'delete' = 'upsert',
  workspaceId?: string,
  identityMode: 'import' | 'new' = 'new',
) {
  const resolvedWorkspaceId = workspaceId ?? await activeLibraryWorkspaceId()
  if (!resolvedWorkspaceId) return
  const database = await getDb()
  const now = Date.now()
  if (await hasUnsentChange(database, resolvedWorkspaceId, 'folder', relativePath, operation)) return
  await database.execute(
    `insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, created_at, updated_at)
     values ($1, 'folder', $2, $3, $4, $5, $5)`,
    [resolvedWorkspaceId, relativePath, operation, `workspace:folder-${identityMode}`, now]
  )
}

async function hasUnsentChange(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  domain: string,
  localKey: string,
  operation: 'upsert' | 'delete',
) {
  const rows = await database.select<Array<{ id: number }>>(
    `select id from self_hosted_local_changes
     where workspace_id = $1 and domain = $2 and local_key = $3
       and operation = $4 and state in ('pending', 'queued')
     limit 1`,
    [workspaceId, domain, localKey, operation]
  )
  return rows.length > 0
}

export async function enqueuePathMove(oldPath: string, newPath: string) {
  const workspaceId = await activeLibraryWorkspaceId()
  if (!workspaceId) return
  const database = await getDb()
  const mappings = await database.select<Array<{
    objectId: string
    kind: 'folder' | 'note' | 'asset'
    relativePath: string
  }>>(
    `select object_id as objectId, kind, relative_path as relativePath
     from self_hosted_object_mappings where workspace_id = $1 and deleted_at is null
       and relative_path is not null
     order by length(relative_path)`,
    [workspaceId]
  )
  const now = Date.now()
  for (const mapping of mappings.filter(mapping => (
    mapping.relativePath === oldPath || mapping.relativePath.startsWith(`${oldPath}/`)
  ))) {
    const relativePath = mapping.relativePath === oldPath
      ? newPath
      : `${newPath}${mapping.relativePath.slice(oldPath.length)}`
    const portable = await invoke<{ normalized: string; caseFolded: string }>(
      'self_hosted_portable_path', { relativePath },
    )
    const domain = mapping.kind === 'note' ? 'file' : mapping.kind
    await database.execute(
      `update self_hosted_object_mappings set local_identity = $1, relative_path = $2,
         path_casefold = $3, updated_at = $4 where workspace_id = $5 and object_id = $6`,
      [`${domain}:${portable.normalized}`, portable.normalized, portable.caseFolded, now, workspaceId, mapping.objectId]
    )
    await database.execute(
      `insert into self_hosted_local_changes(
         workspace_id, domain, local_key, operation, reason, created_at, updated_at
       ) values ($1, $2, $3, 'upsert', 'workspace:path-moved', $4, $4)`,
      [workspaceId, domain, portable.normalized, now]
    )
  }
}

export async function enqueueCanvasSnapshot(canvasId: string, operation: 'upsert' | 'delete' = 'upsert') {
  const database = await getDb()
  const workspaceId = await activeAccountDataWorkspaceId()
  if (!workspaceId) return null
  const now = Date.now()
  await database.execute(
    `insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, created_at, updated_at)
     values ($1, 'canvas', $2, $3, 'canvas:changed', $4, $4)`,
    [workspaceId, canvasId, operation, now]
  )
  return workspaceId
}

async function activeAccountDataWorkspaceId() {
  const database = await getDb()
  const bindings = await database.select<Array<{ workspaceId: string }>>(
    `select b.workspace_id as workspaceId
     from self_hosted_workspace_bindings b
     join self_hosted_sync_profiles p on p.id = b.profile_id and p.state = 'connected'
     where b.workspace_type = 'account-data' and b.binding_state = 'bound'
     order by b.updated_at desc limit 1`
  )
  return bindings[0]?.workspaceId ?? null
}

async function activeLibraryWorkspaceId() {
  const workspace = await getWorkspacePath()
  const localRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
  const database = await getDb()
  const bindings = await database.select<Array<{ workspaceId: string }>>(
    `select workspace_id as workspaceId from self_hosted_workspace_bindings
     where workspace_type = 'library' and local_root = $1 and binding_state = 'bound' limit 1`,
    [localRoot]
  )
  return bindings[0]?.workspaceId ?? null
}

async function enqueueParentFolderChanges(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  relativePath: string,
  now: number,
  identityMode: 'import' | 'new',
) {
  const segments = relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  for (let count = 1; count < segments.length; count++) {
    const relativePath = segments.slice(0, count).join('/')
    const existing = await database.select<Array<{ objectId: string }>>(
      `select object_id as objectId from self_hosted_object_mappings
       where workspace_id = $1 and kind = 'folder' and relative_path = $2
         and deleted_at is null limit 1`,
      [workspaceId, relativePath],
    )
    if (existing.length > 0) continue
    await database.execute(
      `insert into self_hosted_local_changes(workspace_id, domain, local_key, operation, reason, created_at, updated_at)
       values ($1, 'folder', $2, 'upsert', $3, $4, $4)`,
      [workspaceId, relativePath, `workspace:folder-${identityMode}`, now]
    )
  }
}

const STRUCTURED_DOMAINS: Record<string, { table: string; keyColumn: string; kind: SyncObjectKind }> = {
  tag: { table: 'tags', keyColumn: 'id', kind: 'tag' },
  mark: { table: 'marks', keyColumn: 'sourceId', kind: 'mark' },
  conversation: { table: 'conversations', keyColumn: 'syncId', kind: 'conversation' },
  message: { table: 'chats', keyColumn: 'syncId', kind: 'message' },
  memory: { table: 'memories', keyColumn: 'id', kind: 'memory' },
  canvas: { table: 'canvases', keyColumn: 'id', kind: 'canvas' },
}

export async function materializeOutbox(
  workspaceId: string,
  workspaceType: WorkspaceType,
  localRoot: string | null,
  maxCommands: number,
  profileId?: string,
  syncEpoch?: string,
  keyVersion = 1,
  maxObjectBytes = Number.MAX_SAFE_INTEGER,
) {
  const database = await getDb()
  await recoverSupersededMappingCommands(database, workspaceId)
  await recoverRejectedLibraryChanges(database, workspaceId)
  await recoverOrphanedQueuedChanges(database, workspaceId, workspaceType)
  const toggleRows = await database.select<Array<{ domainToggles: string }>>(
    `select p.domain_toggles as domainToggles
     from self_hosted_workspace_bindings b join self_hosted_sync_profiles p on p.id = b.profile_id
     where b.workspace_id = $1 limit 1`,
    [workspaceId]
  )
  const domainToggles = JSON.parse(toggleRows[0]?.domainToggles ?? '{}') as Record<string, boolean>
  const allowedDomains = workspaceType === 'library'
    ? ['file', 'asset', 'folder']
    : [...Object.keys(STRUCTURED_DOMAINS), 'setting'].filter(domain => (
        isDomainEnabled(domain, domainToggles)
      ))
  if (allowedDomains.length === 0) return
  const pending = await database.select<PendingChange[]>(
    `select c.id, c.domain, c.local_key as localKey, c.operation, c.reason,
       case when exists (
         select 1 from self_hosted_local_changes imported
         where imported.domain = c.domain and imported.local_key = c.local_key
           and imported.reason like '%-import'
           and coalesce(imported.workspace_id, '') = coalesce(c.workspace_id, '')
       ) then 1 else 0 end as deterministicImport
     from self_hosted_local_changes c
     where c.state = 'pending'
       and ((c.workspace_id = $1) or (c.workspace_id is null and $2 = 'account-data'))
       and c.domain in (select value from json_each($4))
       and c.id = (
         select max(latest.id) from self_hosted_local_changes latest
         where latest.state = 'pending' and latest.domain = c.domain and latest.local_key = c.local_key
           and coalesce(latest.workspace_id, '') = coalesce(c.workspace_id, '')
       )
     order by
       case when $2 = 'library' and c.operation = 'delete' and c.domain = 'folder' then 2
            when $2 = 'library' and c.domain = 'folder' then 0
            when $2 = 'library' then 1 else 0 end,
       case when $2 = 'library' and c.domain = 'folder'
         then (case when c.operation = 'delete' then -1 else 1 end)
           * (length(c.local_key) - length(replace(c.local_key, '/', '')))
         else 0 end,
       c.id
     limit $3`,
    [workspaceId, workspaceType, maxCommands, JSON.stringify(allowedDomains)]
  )
  const workspaceKey = await loadWorkspaceKey(workspaceId, keyVersion)
  for (const change of pending) {
    if (workspaceType === 'library' && !['file', 'asset', 'folder'].includes(change.domain)) continue
    if (workspaceType === 'account-data' && ['file', 'asset', 'folder'].includes(change.domain)) continue
    if (workspaceType === 'account-data' && !isDomainEnabled(change.domain, domainToggles)) continue
    if ((change.domain === 'file' || change.domain === 'asset') && !localRoot) continue
    const sourceIds = await database.select<Array<{ id: number }>>(
      `select id from self_hosted_local_changes
       where state = 'pending' and domain = $1 and local_key = $2
         and ((workspace_id = $3) or (workspace_id is null and $4 = 'account-data'))
       order by id`,
      [change.domain, change.localKey, workspaceId, workspaceType]
    )
    if (sourceIds.length === 0) continue
    if (
      workspaceType === 'library'
      && change.operation === 'upsert'
      && localRoot
      && !await librarySourceExists(localRoot, change.localKey)
    ) {
      await markChanges(sourceIds.map(item => item.id), 'superseded')
      console.info('[Self-hosted sync] Skipped stale library upsert because its local source no longer exists', {
        workspaceId,
        domain: change.domain,
        localKey: change.localKey,
      })
      continue
    }
    const kind = change.domain === 'file' ? 'note'
      : change.domain === 'asset' ? 'asset'
        : change.domain === 'folder' ? 'folder'
        : STRUCTURED_DOMAINS[change.domain]?.kind ?? 'setting'
    const mapping = await ensureObjectMapping(
      workspaceId, change.domain, change.localKey, kind, change.deterministicImport === 1,
    )
    const commandId = crypto.randomUUID()
    const aad = objectAssociatedData(workspaceId, mapping.objectId, kind)
    let command: Record<string, unknown>
    if (change.operation === 'delete') {
      if (!mapping.revision) {
        await markChanges(sourceIds.map(item => item.id), 'superseded')
        await database.execute(
          `update self_hosted_object_mappings set deleted_at = $1, updated_at = $1
           where workspace_id = $2 and object_id = $3`,
          [Date.now(), workspaceId, mapping.objectId]
        )
        continue
      }
      const encrypted = await encryptJson(workspaceKey, {
        version: 1, domain: change.domain, relativePath: change.localKey, deleted: true,
      }, aad)
      command = {
        commandId,
        type: 'delete-object',
        objectId: mapping.objectId,
        kind,
        parentObjectId: null,
        nameCiphertext: null,
        baseRevision: mapping.revision,
        expectedDocumentSequence: mapping.documentSequence,
        blobRefs: mapping.blobRefs,
        conflictId: crypto.randomUUID(),
        conflictCiphertext: encrypted.packedCiphertext,
        conflictCiphertextHash: encrypted.packedCiphertextHash,
        keyVersion,
        ciphertext: encrypted.packedCiphertext,
        ciphertextHash: encrypted.packedCiphertextHash,
      }
    } else {
      let blob = change.domain === 'asset' && profileId && syncEpoch
        ? await uploadAsset({
            profileId,
            workspaceId,
            syncEpoch,
            localRoot: localRoot!,
            relativePath: change.localKey,
            keyVersion,
          })
        : null
      let payload = change.domain === 'file'
        ? await filePayload(localRoot!, change.localKey)
        : change.domain === 'folder'
          ? { version: 1, domain: 'folder', relativePath: change.localKey }
        : blob
          ? { version: 1, domain: 'asset', relativePath: change.localKey, ...blob }
          : await structuredPayload(workspaceId, change.domain, change.localKey)
      if (!payload) {
        await markChanges(sourceIds.map(item => item.id), 'superseded')
        continue
      }
      let encrypted = await encryptJson(workspaceKey, payload, aad)
      if (
        change.domain === 'file'
        && base64UrlByteLength(encrypted.packedCiphertext) > maxObjectBytes
        && profileId
        && syncEpoch
      ) {
        blob = await uploadAsset({
          profileId,
          workspaceId,
          syncEpoch,
          localRoot: localRoot!,
          relativePath: change.localKey,
          keyVersion,
        })
        payload = {
          version: 1,
          domain: 'file',
          relativePath: change.localKey,
          ...blob,
        }
        encrypted = await encryptJson(workspaceKey, payload, aad)
      }
      const parentObjectId = ['file', 'asset', 'folder'].includes(change.domain)
        ? await parentFolderObjectId(workspaceId, change.localKey)
        : null
      command = {
        commandId,
        type: 'upsert-object',
        objectId: mapping.objectId,
        kind,
        parentObjectId,
        nameCiphertext: null,
        nameBlindIndex: null,
        baseRevision: mapping.revision,
        blobRefs: blob ? [blob.blobId] : [],
        keyVersion,
        ciphertext: encrypted.packedCiphertext,
        ciphertextHash: encrypted.packedCiphertextHash,
      }
    }
    const now = Date.now()
    await database.execute(
      `insert into self_hosted_outbox(
         command_id, workspace_id, source_change_ids, command_type, payload,
         state, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
      [commandId, workspaceId, JSON.stringify(sourceIds.map(item => item.id)), String(command.type), JSON.stringify(command), now]
    )
    if (command.type === 'upsert-object' && Array.isArray(command.blobRefs) && command.blobRefs.length > 0) {
      await database.execute(
        `update self_hosted_object_mappings set blob_refs = $1, updated_at = $2
         where workspace_id = $3 and object_id = $4`,
        [JSON.stringify(command.blobRefs), Date.now(), workspaceId, mapping.objectId]
      )
    }
    await markChanges(sourceIds.map(item => item.id), 'queued')
  }
}

async function recoverSupersededMappingCommands(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
) {
  const commands = await database.select<Array<{
    commandId: string
    sourceChangeIds: string
  }>>(
    `select o.command_id as commandId, o.source_change_ids as sourceChangeIds
     from self_hosted_outbox o
     join self_hosted_object_mappings mapping
       on mapping.workspace_id = o.workspace_id
      and mapping.object_id = json_extract(o.payload, '$.objectId')
     where o.workspace_id = $1 and o.state in ('pending', 'retry', 'blocked')
       and mapping.local_identity like 'superseded:%'`,
    [workspaceId],
  )
  for (const command of commands) {
    const sourceIds = JSON.parse(command.sourceChangeIds) as number[]
    const requeueSources = sourceIds.length > 0
    await database.execute(
      `update self_hosted_outbox set state = 'superseded', next_attempt_at = 0,
         last_error_code = $1, updated_at = $2 where command_id = $3`,
      [
        requeueSources ? 'mapping_superseded_requeue' : 'mapping_superseded',
        Date.now(),
        command.commandId,
      ],
    )
    for (const sourceId of sourceIds) {
      await database.execute(
        `update self_hosted_local_changes set state = 'pending', updated_at = $1
         where id = $2 and state = 'queued'`,
        [Date.now(), sourceId],
      )
    }
  }
}

async function recoverRejectedLibraryChanges(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
) {
  const rejected = await database.select<Array<{ commandId: string; sourceChangeIds: string }>>(
    `select command_id as commandId, source_change_ids as sourceChangeIds
     from self_hosted_outbox
     where workspace_id = $1 and state = 'failed'
       and last_error_code in ('object_too_large', 'object_parent_invalid', 'folder_not_empty')`,
    [workspaceId]
  )
  for (const row of rejected) {
    for (const id of JSON.parse(row.sourceChangeIds) as number[]) {
      await database.execute(
        "update self_hosted_local_changes set state = 'pending', updated_at = $1 where id = $2",
        [Date.now(), id]
      )
    }
    await database.execute('delete from self_hosted_outbox where command_id = $1', [row.commandId])
  }
}

async function recoverOrphanedQueuedChanges(
  database: Awaited<ReturnType<typeof getDb>>,
  workspaceId: string,
  workspaceType: WorkspaceType,
) {
  const now = Date.now()
  await database.execute(
    `update self_hosted_local_changes set state = 'sent', updated_at = $1
     where state = 'queued' and exists (
       select 1 from self_hosted_outbox o, json_each(o.source_change_ids) source
       where o.workspace_id = $2 and o.state = 'sent'
         and cast(source.value as integer) = self_hosted_local_changes.id
     )`,
    [now, workspaceId]
  )
  await database.execute(
    `update self_hosted_local_changes set state = 'pending', updated_at = $1
     where state = 'queued' and exists (
       select 1 from self_hosted_outbox o, json_each(o.source_change_ids) source
       where o.workspace_id = $2 and o.state = 'superseded'
         and o.last_error_code = 'mapping_superseded_requeue'
         and cast(source.value as integer) = self_hosted_local_changes.id
     )`,
    [now, workspaceId]
  )
  await database.execute(
    `update self_hosted_local_changes set state = 'superseded', updated_at = $1
     where state = 'queued' and exists (
       select 1 from self_hosted_outbox o, json_each(o.source_change_ids) source
       where o.workspace_id = $2 and o.state in ('failed', 'superseded')
         and cast(source.value as integer) = self_hosted_local_changes.id
     ) and not exists (
       select 1 from self_hosted_outbox active, json_each(active.source_change_ids) source
       where active.workspace_id = $2 and active.state in ('pending', 'retry', 'blocked')
         and cast(source.value as integer) = self_hosted_local_changes.id
     )`,
    [now, workspaceId]
  )
  await database.execute(
    `update self_hosted_local_changes set state = 'pending', updated_at = $1
     where state = 'queued'
       and (workspace_id = $2 or (workspace_id is null and $3 = 'account-data'))
       and not exists (
       select 1 from self_hosted_outbox o, json_each(o.source_change_ids) source
       where cast(source.value as integer) = self_hosted_local_changes.id
     )`,
    [now, workspaceId, workspaceType]
  )
}

function isDomainEnabled(domain: string, toggles: Record<string, boolean>) {
  const key = ({
    tag: 'tags', mark: 'marks', conversation: 'conversations', message: 'messages',
    memory: 'memories', setting: 'settings', canvas: 'marks',
  } as Record<string, string>)[domain]
  return key ? toggles[key] !== false : true
}

async function filePayload(localRoot: string, relativePath: string) {
  const absolutePath = await join(localRoot, relativePath)
  try {
    return { version: 1, domain: 'file', relativePath, content: await readTextFile(absolutePath) }
  } catch (error) {
    if (!isMissingPathError(error)) throw error
    return null
  }
}

async function librarySourceExists(localRoot: string, relativePath: string) {
  try {
    return await exists(await join(localRoot, relativePath))
  } catch {
    return false
  }
}

function isMissingPathError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('(os error 2)')
}

async function structuredPayload(
  workspaceId: string,
  domain: string,
  localKey: string,
): Promise<Record<string, unknown> | null> {
  if (domain === 'setting') {
    const store = await Store.load('store.json')
    const entries = Object.fromEntries(await store.entries()) as Record<string, unknown>
    const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
    return {
      version: 1,
      domain,
      localKey,
      value: filterSyncData(entries, { excludeSensitiveConfig }),
    }
  }
  const config = STRUCTURED_DOMAINS[domain]
  if (!config) return null
  const database = await getDb()
  let rows = await database.select<Array<Record<string, unknown>>>(
    `select * from ${config.table} where ${config.keyColumn} = $1 limit 1`,
    [localKey]
  )
  if (rows.length === 0 && domain === 'mark') {
    rows = await database.select<Array<Record<string, unknown>>>(
      'select * from marks where cast(id as text) = $1 limit 1',
      [localKey]
    )
  }
  const row = rows[0]
  if (!row) return null
  const references: Record<string, string> = {}
  if (domain === 'mark' && typeof row.id === 'number') {
    const { getMarkById } = await import('@/db/marks')
    const mark = await getMarkById(row.id)
    if (mark?.tagIds) {
      row.tagIds = mark.tagIds
      row.tagUpdatedAt = mark.tagUpdatedAt ?? 0
      for (const tagId of mark.tagIds) {
        references[`tag:${tagId}`] = (await ensureObjectMapping(workspaceId, 'tag', String(tagId), 'tag')).objectId
      }
    }
  }
  if ((domain === 'mark' || domain === 'note' || domain === 'message') && row.tagId != null) {
    references.tag = (await ensureObjectMapping(workspaceId, 'tag', String(row.tagId), 'tag')).objectId
  }
  if (domain === 'message' && row.conversationId != null) {
    const conversations = await database.select<Array<{ syncId: string }>>(
      'select syncId from conversations where id = $1 limit 1',
      [row.conversationId]
    )
    if (conversations[0]?.syncId) {
      references.conversation = (
        await ensureObjectMapping(workspaceId, 'conversation', conversations[0].syncId, 'conversation')
      ).objectId
    }
  }
  return {
    version: 1,
    domain,
    localKey,
    value: sanitizeStructuredRow(domain, row),
    references,
  }
}

function sanitizeStructuredRow(domain: string, row: Record<string, unknown>) {
  const value = { ...row }
  if (domain === 'memory') {
    delete value.embedding
    delete value.embedding_model
    delete value.embedding_dimensions
    delete value.indexing_status
    delete value.access_count
    delete value.last_accessed_at
    delete value.last_recall_reason
  }
  if (domain === 'canvas') {
    delete value.thumbnailPath
    delete value.undoStack
    delete value.redoStack
  }
  if (domain === 'message') {
    delete value.imageAnalyses
    delete value.ragSources
    delete value.ragSourceDetails
    delete value.agentHistory
    delete value.thinking
  }
  return value
}

async function ensureObjectMapping(
  workspaceId: string,
  domain: string,
  localKey: string,
  kind: SyncObjectKind,
  deterministicImport = false,
): Promise<ObjectMapping> {
  const database = await getDb()
  const portable = domain === 'file' || domain === 'asset' || domain === 'folder'
    ? await invoke<{ normalized: string; caseFolded: string }>(
        'self_hosted_portable_path',
        { relativePath: localKey },
      )
    : null
  const normalizedLocalKey = portable?.normalized ?? localKey
  const localIdentity = `${domain}:${normalizedLocalKey}`
  const rows = portable
    ? await database.select<Array<{
        objectId: string
        blobRefs: string
        localIdentity: string
        relativePath: string | null
        pathCasefold: string | null
        deletedAt: number | null
      }>>(
        `select object_id as objectId, blob_refs as blobRefs,
           local_identity as localIdentity, relative_path as relativePath,
           path_casefold as pathCasefold, deleted_at as deletedAt
         from self_hosted_object_mappings
         where workspace_id = $1 and kind = $2 and (
           local_identity = $3
           or (path_casefold = $4 and deleted_at is null)
         )
         order by case when local_identity = $3 then 0 else 1 end
         limit 1`,
        [workspaceId, kind, localIdentity, portable.caseFolded],
      )
    : await database.select<Array<{
        objectId: string
        blobRefs: string
        localIdentity: string
        relativePath: string | null
        pathCasefold: string | null
        deletedAt: number | null
      }>>(
        `select object_id as objectId, blob_refs as blobRefs,
           local_identity as localIdentity, relative_path as relativePath,
           path_casefold as pathCasefold, deleted_at as deletedAt
         from self_hosted_object_mappings
         where workspace_id = $1 and kind = $2 and local_identity = $3 limit 1`,
        [workspaceId, kind, localIdentity],
      )
  let existing: (typeof rows)[number] | undefined = rows[0]
  let canUseDeterministicImport = deterministicImport
  if (portable && existing && existing.deletedAt !== null) {
    await database.execute(
      `update self_hosted_object_mappings
       set local_identity = $1, relative_path = null, path_casefold = null, updated_at = $2
       where workspace_id = $3 and object_id = $4`,
      [
        `superseded:${kind}:${existing.objectId}`,
        Date.now(),
        workspaceId,
        existing.objectId,
      ],
    )
    existing = undefined
    canUseDeterministicImport = false
  }
  if (
    portable
    && existing
    && (
      existing.localIdentity !== localIdentity
      || existing.relativePath !== portable.normalized
      || existing.pathCasefold !== portable.caseFolded
    )
  ) {
    await database.execute(
      `update self_hosted_object_mappings
       set local_identity = $1, relative_path = $2, path_casefold = $3, updated_at = $4
       where workspace_id = $5 and object_id = $6`,
      [
        localIdentity,
        portable.normalized,
        portable.caseFolded,
        Date.now(),
        workspaceId,
        existing.objectId,
      ],
    )
  }
  const stablePersonalIdentity = domain === 'setting' || domain in STRUCTURED_DOMAINS
  const objectId = existing?.objectId ?? (canUseDeterministicImport || stablePersonalIdentity
    ? await invoke<string>('self_hosted_import_object_id', {
        workspaceId,
        relativePath: `${domain}/${normalizedLocalKey}`,
      })
    : crypto.randomUUID())
  if (!existing) {
    await database.execute(
      `insert into self_hosted_object_mappings(
         workspace_id, object_id, kind, local_identity, relative_path, path_casefold, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        workspaceId,
        objectId,
        kind,
        localIdentity,
        portable?.normalized ?? null,
        portable?.caseFolded ?? null,
        Date.now(),
      ]
    )
  }
  const revisions = await database.select<Array<{ revision: string }>>(
    `select revision from self_hosted_revisions
     where workspace_id = $1 and object_id = $2
     order by cast(revision as integer) desc limit 1`,
    [workspaceId, objectId]
  )
  const documents = await database.select<Array<{ sequence: string }>>(
    `select coalesce(max(cast(document_sequence as integer)), 0) as sequence
     from self_hosted_yjs_updates where workspace_id = $1 and object_id = $2`,
    [workspaceId, objectId]
  )
  return {
    objectId,
    revision: revisions[0]?.revision ?? null,
    blobRefs: JSON.parse(existing?.blobRefs ?? '[]') as string[],
    documentSequence: documents[0]?.sequence ?? '0',
  }
}

async function parentFolderObjectId(workspaceId: string, relativePath: string) {
  const segments = relativePath.replaceAll('\\', '/').split('/').filter(Boolean)
  if (segments.length <= 1) return null
  const parent = segments.slice(0, -1).join('/')
  return (await ensureObjectMapping(workspaceId, 'folder', parent, 'folder')).objectId
}

async function markChanges(ids: number[], state: string) {
  const database = await getDb()
  for (const id of ids) {
    await database.execute(
      'update self_hosted_local_changes set state = $1, updated_at = $2 where id = $3',
      [state, Date.now(), id]
    )
  }
}
