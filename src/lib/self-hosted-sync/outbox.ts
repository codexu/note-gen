import { invoke } from '@tauri-apps/api/core'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { filterSyncData } from '@/config/sync-exclusions'
import { normalizeTagBoolean } from '@/lib/tag-sync'
import { encryptJson, loadWorkspaceKey, objectAssociatedData, structuredObjectId } from './crypto'
import type { SyncObjectKind, WorkspaceType } from './protocol'
import { base64UrlByteLength, uploadAsset, removeAssetUploadStaging } from './blob'
import { SelfHostedApiError } from './client'
import { isSelfHostedAuthenticationError } from './profile'
import { isDomainEnabled, isPersonalSyncKindEnabled } from './domains'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { withSelfHostedPrepareLock } from './prepare-lock'
import { preparePersonalAssetsUpload } from './personal-assets'
import { hasMarkdownCollaboration, persistedMarkdownMatches } from './markdown-state'

interface PendingChange {
  id: number
  domain: string
  localKey: string
  operation: 'upsert' | 'delete'
  reason: string
  deterministicImport: number
  attemptCount: number
}

export { isDomainEnabled } from './domains'

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

export async function enqueueCanvasSnapshot(canvasId: string, operation: 'upsert' | 'delete' = 'upsert', options: { onlyIfMissing?: boolean } = {}) {
  const database = await getDb()
  const workspaceId = await activeAccountDataWorkspaceId()
  if (!workspaceId) return null
  if (options.onlyIfMissing) {
    const accepted = await database.select<Array<{ found: number }>>(
      `select 1 as found from self_hosted_object_mappings m
       join self_hosted_revisions r on r.workspace_id=m.workspace_id and r.object_id=m.object_id
       where m.workspace_id=$1 and m.kind='canvas' and m.local_identity=$2 and m.deleted_at is null limit 1`,
      [workspaceId, `canvas:${canvasId}`],
    )
    if (accepted.length) return workspaceId
  }
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

export const STRUCTURED_DOMAINS: Record<string, { table: string; keyColumn: string; kind: SyncObjectKind }> = {
  tag: { table: 'tags', keyColumn: 'id', kind: 'tag' },
  mark: { table: 'marks', keyColumn: 'sourceId', kind: 'mark' },
  conversation: { table: 'conversations', keyColumn: 'syncId', kind: 'conversation' },
  message: { table: 'chats', keyColumn: 'syncId', kind: 'message' },
  memory: { table: 'memories', keyColumn: 'id', kind: 'memory' },
  canvas: { table: 'canvases', keyColumn: 'id', kind: 'canvas' },
}

/** Numeric database keys are device-local. Reuse an owned mapping, but never
 * claim a deterministic import ID already mapped to a different local row. */
export async function resolveStructuredObjectId(workspaceId: string, domain: string, localKey: string) {
  if (domain === 'mark') {
    const { assertMarkIdentityUnambiguous } = await import('./references')
    await assertMarkIdentityUnambiguous(localKey)
  }
  const database = await getDb()
  const localIdentity = `${domain}:${localKey}`
  const existing = await database.select<Array<{ objectId: string }>>(
    'select object_id as objectId from self_hosted_object_mappings where workspace_id = $1 and local_identity = $2 limit 1',
    [workspaceId, localIdentity],
  )
  if (existing[0]) return existing[0].objectId
  let identityKey = localKey
  if (domain === 'tag') {
    const tags = await database.select<Array<{ isLocked: unknown; stableId: string | null }>>(
      `select t.isLocked, identity.stable_id as stableId from tags t
       left join self_hosted_tag_identities identity on identity.local_tag_id = t.id
       where t.id = $1 limit 1`,
      [localKey],
    )
    // Keep released mappings and the common default tag's import identity.
    // Independent non-default tags use a persistent global identity, even when
    // two offline devices allocate the same SQLite integer primary key.
    if (tags[0] && normalizeTagBoolean(tags[0].isLocked) !== true) {
      if (!tags[0].stableId) throw new Error('self_hosted_tag_identity_missing')
      identityKey = `global:${tags[0].stableId}`
    }
  }
  let candidate = await structuredObjectId(workspaceId, domain, identityKey)
  let deviceId: string | undefined
  for (let attempt = 0; attempt < 16; attempt++) {
    const owners = await database.select<Array<{ localIdentity: string }>>(
      'select local_identity as localIdentity from self_hosted_object_mappings where workspace_id = $1 and object_id = $2 limit 1',
      [workspaceId, candidate],
    )
    if (!owners[0] || owners[0].localIdentity === localIdentity) return candidate
    deviceId ??= await (await Store.load('store.json')).get<string>('selfHostedDeviceId')
    if (!deviceId) throw new Error('自托管设备身份不可用，请重新授权')
    candidate = await structuredObjectId(workspaceId, domain, JSON.stringify({ localKey: identityKey, deviceId, attempt }))
  }
  throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
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
  return withSelfHostedPrepareLock(workspaceId, () => materializeOutboxRaw(
    workspaceId, workspaceType, localRoot, maxCommands, profileId, syncEpoch, keyVersion, maxObjectBytes,
  ))
}

async function materializeOutboxRaw(
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
  const attachmentsEnabled = workspaceType === 'library' || domainToggles.attachments !== false
  if (workspaceType === 'account-data' && attachmentsEnabled) {
    await database.execute(
      `update self_hosted_local_changes set last_error_code = null, next_attempt_at = 0,
         attempt_count = 0, updated_at = $1
       where state = 'pending' and last_error_code = 'attachments_paused'
         and (workspace_id = $2 or workspace_id is null)`,
      [Date.now(), workspaceId],
    )
  }
  const allowedDomains = workspaceType === 'library'
    ? ['file', 'asset', 'folder']
    : [...Object.keys(STRUCTURED_DOMAINS), 'setting'].filter(domain => (
        isDomainEnabled(domain, domainToggles)
      ))
  if (allowedDomains.length === 0) return { errors: [] as string[], hasMore: false }
  const allowedDeleteDomains = workspaceType === 'library' ? allowedDomains
    : allowedDomains.filter(domain => isPersonalSyncKindEnabled(domain, domainToggles, true))
  const pending = await database.select<PendingChange[]>(
    `select c.id, c.domain, c.local_key as localKey, c.operation, c.reason, c.attempt_count as attemptCount,
       case when exists (
         select 1 from self_hosted_local_changes imported
         where imported.domain = c.domain and imported.local_key = c.local_key
           and imported.reason like '%-import'
           and coalesce(imported.workspace_id, '') = coalesce(c.workspace_id, '')
       ) then 1 else 0 end as deterministicImport
     from self_hosted_local_changes c
     where c.state = 'pending'
       and c.next_attempt_at <= $5
       and ($7 = 1 or coalesce(c.last_error_code, '') <> 'attachments_paused' or c.operation = 'delete')
       and (c.operation <> 'delete' or c.domain in (select value from json_each($6)))
       and ((c.workspace_id = $1) or (c.workspace_id is null and $2 = 'account-data'))
       and c.domain in (select value from json_each($4))
       and c.id = (
         select max(latest.id) from self_hosted_local_changes latest
         where latest.state = 'pending' and latest.domain = c.domain and latest.local_key = c.local_key
           and coalesce(latest.workspace_id, '') = coalesce(c.workspace_id, '')
       )
     order by
       c.attempt_count,
       case when $2 = 'library' and c.operation = 'delete' and c.domain = 'folder' then 2
            when $2 = 'library' and c.domain = 'folder' then 0
            when $2 = 'library' then 1 else 0 end,
       case when $2 = 'library' and c.domain = 'folder'
         then (case when c.operation = 'delete' then -1 else 1 end)
           * (length(c.local_key) - length(replace(c.local_key, '/', '')))
         else 0 end,
       c.id
     limit $3`,
    [workspaceId, workspaceType, maxCommands, JSON.stringify(allowedDomains), Date.now(), JSON.stringify(allowedDeleteDomains), attachmentsEnabled ? 1 : 0]
  )
  const workspaceKey = await loadWorkspaceKey(workspaceId, keyVersion)
  const pendingPathMoves = workspaceType === 'library'
    && (await (await Store.load('store.json')).get<string>('primaryBackupMethod')) === 'selfHosted'
    && workspaceId === await activeLibraryWorkspaceId()
    ? await (await import('@/lib/sync/workspace-path-moves')).getPendingWorkspacePathMoves()
    : []
  let processedChanges = 0
  for (const change of pending) {
    if (workspaceType === 'library' && !['file', 'asset', 'folder'].includes(change.domain)) continue
    if (workspaceType === 'account-data' && ['file', 'asset', 'folder'].includes(change.domain)) continue
    if (workspaceType === 'account-data' && !isDomainEnabled(change.domain, domainToggles)) continue
    if (workspaceType === 'account-data'
      && !isPersonalSyncKindEnabled(change.domain, domainToggles, change.operation === 'delete')) continue
    // A path move copies an accepted remote snapshot. Uploading a local edit
    // first would create the destination or change the frozen base revision.
    // The dedicated encrypted path-move commands bypass this materializer.
    if (pendingPathMoves.some(move => [move.source, move.target].some(root => (
      change.localKey === root || change.localKey.startsWith(`${root}/`)
      || (change.domain === 'folder' && root.startsWith(`${change.localKey}/`))
    )))) continue
    if ((change.domain === 'file' || change.domain === 'asset') && !localRoot) continue
    const sourceIds = await database.select<Array<{ id: number }>>(
      `select id from self_hosted_local_changes
       where state = 'pending' and domain = $1 and local_key = $2
         and ((workspace_id = $3) or (workspace_id is null and $4 = 'account-data'))
       order by id`,
      [change.domain, change.localKey, workspaceId, workspaceType]
    )
    if (sourceIds.length === 0) continue
    processedChanges++
    try {
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
      if (workspaceType === 'account-data') {
        const blocked = await database.select<Array<{ found: number }>>(
          `select 1 as found from self_hosted_outbox where workspace_id=$1 and state='blocked'
           and coalesce(json_extract(payload,'$.objectId'), json_extract(payload,'$.objectResolution.objectId'),
             json_extract(payload,'$.resolution.objectId'))=$2 limit 1`,
          [workspaceId, mapping.objectId],
        )
        if (blocked.length) {
          // Keep newer local edits pending behind the preserved conflict;
          // do not freeze more commands against the same rejected base.
          processedChanges--
          continue
        }
      }
      const commandId = crypto.randomUUID()
      const aad = objectAssociatedData(workspaceId, mapping.objectId, kind)
      let command: Record<string, unknown>
      let collaborativeSnapshot = false
      let stagingId: string | undefined
      const personalStagingIds: string[] = []
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
        stagingId = blob?.stagingId
        let payload = change.domain === 'file'
          ? await filePayload(localRoot!, change.localKey)
          : change.domain === 'folder'
            ? { version: 1, domain: 'folder', relativePath: change.localKey }
          : blob
            ? { version: 1, domain: 'asset', relativePath: change.localKey, ...assetMetadata(blob) }
            : await structuredPayload(workspaceId, change.domain, change.localKey)
        if (!payload) {
          await markChanges(sourceIds.map(item => item.id), 'superseded')
          continue
        }
        if (change.domain === 'file' && mapping.revision && 'content' in payload && typeof payload.content === 'string') {
          collaborativeSnapshot = await persistedMarkdownMatches(workspaceId, mapping.objectId, payload.content)
            .catch(error => {
              console.warn('[self-hosted-sync] Unable to verify collaborative snapshot coverage', error)
              return false
            })
          if (!collaborativeSnapshot && hasMarkdownCollaboration(workspaceId, mapping.objectId)) {
            // The editor's CRDT persistence and its debounced file save can
            // briefly describe different instants. Keep the source pending
            // until they agree instead of publishing an unrelated snapshot.
            processedChanges--
            continue
          }
        }
        let personalBlobRefs: string[] = []
        if (profileId && syncEpoch && (change.domain === 'mark' || change.domain === 'message')) {
          const prepared = await preparePersonalAssetsUpload({ profileId, workspaceId, syncEpoch,
            objectId: mapping.objectId, keyVersion, payload, enabled: domainToggles.attachments !== false })
          if (prepared.deferred) {
            // Pausing this owner is progress: exclude it before the next
            // batch limit, so unrelated enabled domains can be prepared.
            await database.execute(
              `update self_hosted_local_changes set last_error_code = 'attachments_paused',
                 next_attempt_at = 0, attempt_count = 0, updated_at = $1
               where state = 'pending' and id in (select value from json_each($2))`,
              [Date.now(), JSON.stringify(sourceIds.map(item => item.id))],
            )
            continue
          }
          payload = prepared.payload
          personalBlobRefs = prepared.blobRefs
          personalStagingIds.push(...prepared.stagingIds)
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
          stagingId = blob.stagingId
          payload = {
            version: 1,
            domain: 'file',
            relativePath: change.localKey,
            ...assetMetadata(blob),
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
          blobRefs: blob ? [blob.blobId] : personalBlobRefs,
          keyVersion,
          ciphertext: encrypted.packedCiphertext,
          ciphertextHash: encrypted.packedCiphertextHash,
        }
      }
      const now = Date.now()
      const statements: RecordStatement[] = [{
        sql: `insert into self_hosted_outbox(
           command_id, workspace_id, source_change_ids, command_type, payload,
           state, created_at, updated_at
         ) values ($1, $2, $3, $4, $5, 'pending', $6, $6)`,
        values: [commandId, workspaceId, JSON.stringify(sourceIds.map(item => item.id)), String(command.type), JSON.stringify(command), now],
      }]
      if (collaborativeSnapshot) statements.push({
        sql: `update self_hosted_local_changes set reason='workspace:collaborative-snapshot'
          where id in (select value from json_each($1)) and state='pending'`,
        values: [JSON.stringify(sourceIds.map(item => item.id))],
      })
      if (command.type === 'upsert-object' && Array.isArray(command.blobRefs) && command.blobRefs.length > 0) {
        statements.push({
          sql: `update self_hosted_object_mappings set blob_refs = $1, updated_at = $2
           where workspace_id = $3 and object_id = $4`,
          values: [JSON.stringify(command.blobRefs), now, workspaceId, mapping.objectId],
        })
      }
      statements.push({
        sql: `update self_hosted_local_changes set state = 'queued', updated_at = $1,
            last_error_code = null, next_attempt_at = 0, attempt_count = 0
          where state = 'pending' and id in (select value from json_each($2))`,
        values: [now, JSON.stringify(sourceIds.map(item => item.id))],
      })
      await executeRecordTransaction(statements)
      if (stagingId) {
        await removeAssetUploadStaging(stagingId).catch(error => {
          console.warn('[self-hosted-sync] Unable to clean queued asset staging', error)
        })
      }
      for (const id of personalStagingIds) await removeAssetUploadStaging(id).catch(error => {
        console.warn('[self-hosted-sync] Unable to clean queued personal asset staging', error)
      })
    } catch (error) {
      if (isSelfHostedAuthenticationError(error)) throw error
      const code = materializationErrorCode(error)
      const nextAttemptAt = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** Math.min(change.attemptCount, 6))
      for (const source of sourceIds) {
        await database.execute(
          `update self_hosted_local_changes set attempt_count = attempt_count + 1,
             next_attempt_at = $1, last_error_code = $2, updated_at = $3
           where id = $4 and state = 'pending'`,
          [nextAttemptAt, code, Date.now(), source.id],
        )
      }
      console.warn('[self-hosted-sync] Local change preparation deferred', {
        workspaceId, domain: change.domain, localKey: change.localKey, code,
      })
    }
  }
  const failures = await database.select<Array<{ code: string }>>(
    `select distinct last_error_code as code from self_hosted_local_changes
     where state = 'pending' and last_error_code is not null and last_error_code <> 'attachments_paused'
       and (workspace_id = $1 or (workspace_id is null and $2 = 'account-data'))
       and domain in (select value from json_each($3))`,
    [workspaceId, workspaceType, JSON.stringify(allowedDomains)],
  )
  return { errors: failures.map(failure => failure.code), hasMore: pending.length >= maxCommands && processedChanges > 0 }
}

function materializationErrorCode(error: unknown) {
  if (error instanceof SelfHostedApiError) return error.body.code.slice(0, 120)
  return (error instanceof Error ? error.message : String(error)).slice(0, 120) || 'local_change_preparation_failed'
}

function assetMetadata(blob: Awaited<ReturnType<typeof uploadAsset>>) {
  return {
    blobId: blob.blobId, plaintextHash: blob.plaintextHash,
    size: blob.size, associatedData: blob.associatedData,
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
  const rejected = await database.select<Array<{ commandId: string; sourceChangeIds: string; errorCode: string }>>(
    `select command_id as commandId, source_change_ids as sourceChangeIds, last_error_code as errorCode
     from self_hosted_outbox
     where workspace_id = $1 and state = 'failed'
       and last_error_code in ('object_too_large', 'object_parent_invalid', 'folder_not_empty')`,
    [workspaceId]
  )
  for (const row of rejected) {
    for (const id of JSON.parse(row.sourceChangeIds) as number[]) {
      await database.execute(
        `update self_hosted_local_changes set state = 'pending', updated_at = $1,
           attempt_count = attempt_count + 1, next_attempt_at = $3, last_error_code = $4 where id = $2`,
        [Date.now(), id, Date.now() + 60_000, row.errorCode]
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
  } catch (error) {
    if (isMissingPathError(error)) return false
    throw error
  }
}

function isMissingPathError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('No such file or directory') || message.includes('(os error 2)')
}

export async function structuredPayload(
  workspaceId: string,
  domain: string,
  localKey: string,
  readOnly = false,
): Promise<Record<string, unknown> | null> {
  if (domain === 'setting') {
    const store = await Store.load('store.json')
    const entries = Object.fromEntries(await store.entries()) as Record<string, unknown>
    const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
    const { getMemoryPolicy } = await import('@/db/memory-policy')
    const profiles = await (await getDb()).select<Array<{ toggles: string }>>(
      `select p.domain_toggles as toggles from self_hosted_workspace_bindings b
       join self_hosted_sync_profiles p on p.id = b.profile_id where b.workspace_id = $1 limit 1`,
      [workspaceId],
    )
    const toggles = JSON.parse(profiles[0]?.toggles ?? '{}') as Record<string, boolean>
    return {
      version: 1,
      domain,
      localKey,
      value: filterSyncData(entries, { excludeSensitiveConfig }),
      ...(toggles.memories !== false ? { memoryPolicy: await getMemoryPolicy() } : {}),
    }
  }
  const config = STRUCTURED_DOMAINS[domain]
  if (!config) return null
  if (domain === 'mark') {
    const { assertMarkIdentityUnambiguous } = await import('./references')
    await assertMarkIdentityUnambiguous(localKey)
  }
  const database = await getDb()
  let rows = await database.select<Array<Record<string, unknown>>>(
    `select * from ${config.table} where ${config.keyColumn} = $1 limit 1`,
    [localKey]
  )
  if (rows.length === 0 && domain === 'mark') {
    rows = await database.select<Array<Record<string, unknown>>>(
      'select * from marks where cast(id as text) = $1 and sourceId is null limit 1',
      [localKey]
    )
  }
  const row = rows[0]
  if (!row) return null
  const referenceId = async (domain: string, key: string, kind: SyncObjectKind) => {
    if (!readOnly) return (await ensureObjectMapping(workspaceId, domain, key, kind)).objectId
    return resolveStructuredObjectId(workspaceId, domain, key)
  }
  const references: Record<string, string> = {}
  if (domain === 'mark' && typeof row.id === 'number') {
    // Normalize only the wire copy: both review and upload use the same
    // object identity while the legacy local row/mapping keep their own key.
    if (!row.sourceId) row.sourceId = await resolveStructuredObjectId(workspaceId, 'mark', localKey)
    const { getMarkById } = await import('@/db/marks')
    const mark = await getMarkById(row.id)
    if (mark?.tagIds) {
      row.tagIds = mark.tagIds
      row.tagUpdatedAt = mark.tagUpdatedAt ?? 0
      for (const tagId of mark.tagIds) {
        references[`tag:${tagId}`] = await referenceId('tag', String(tagId), 'tag')
      }
    }
  }
  if ((domain === 'mark' || domain === 'note' || domain === 'message') && row.tagId != null
    && !(domain === 'message' && row.tagId === 0)) {
    references.tag = await referenceId('tag', String(row.tagId), 'tag')
  }
  if (domain === 'message' && row.conversationId != null) {
    const conversations = await database.select<Array<{ syncId: string }>>(
      'select syncId from conversations where id = $1 limit 1',
      [row.conversationId]
    )
    if (conversations[0]?.syncId) {
      references.conversation = await referenceId('conversation', conversations[0].syncId, 'conversation')
    }
  }
  if (domain === 'canvas' && typeof row.content === 'string') {
    const { addCanvasRecordObjectIds, canvasRecordIds } = await import('./references')
    for (const id of canvasRecordIds(row.content)) {
      const marks = await database.select<Array<{ sourceId: string | null }>>('select sourceId from marks where id = $1 limit 1', [id])
      if (!marks[0]) throw new Error('SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING')
      const objectId = await referenceId('mark', marks[0].sourceId || String(id), 'mark')
      references[`record:${id}`] = objectId
      references[`record-object:${objectId}`] = objectId
    }
    row.content = await addCanvasRecordObjectIds(workspaceId, row.content, references)
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
  if (domain === 'mark') {
    const { assertMarkIdentityUnambiguous } = await import('./references')
    await assertMarkIdentityUnambiguous(localKey)
  }
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
  let objectId = existing?.objectId ?? (stablePersonalIdentity
    ? await resolveStructuredObjectId(workspaceId, domain, normalizedLocalKey)
    : canUseDeterministicImport ? await invoke<string>('self_hosted_import_object_id', {
        workspaceId,
        relativePath: `${domain}/${normalizedLocalKey}`,
      })
    : crypto.randomUUID())
  if (!existing && portable && canUseDeterministicImport) {
    const owners = await database.select<Array<{
      objectId: string
      kind: SyncObjectKind
      blobRefs: string
      localIdentity: string
      relativePath: string | null
      pathCasefold: string | null
      deletedAt: number | null
    }>>(
      `select object_id as objectId, kind, blob_refs as blobRefs,
         local_identity as localIdentity, relative_path as relativePath,
         path_casefold as pathCasefold, deleted_at as deletedAt
       from self_hosted_object_mappings where workspace_id = $1 and object_id = $2 limit 1`,
      [workspaceId, objectId],
    )
    const owner = owners[0]
    if (owner && owner.kind === kind && owner.localIdentity === localIdentity && owner.deletedAt === null) {
      existing = owner
    } else if (owner) {
      // Retired and renamed objects keep their original IDs for delayed events.
      // Reimporting the old path must create a new object instead of claiming it.
      objectId = crypto.randomUUID()
    }
  }
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

export function ensureLibraryObjectMapping(
  workspaceId: string,
  domain: 'file' | 'asset' | 'folder',
  relativePath: string,
  options: { deterministicImport?: boolean; assertActive?: () => void } = {},
) {
  return withSelfHostedPrepareLock(workspaceId, async () => {
    options.assertActive?.()
    const mapping = await ensureObjectMapping(
      workspaceId, domain, relativePath, domain === 'file' ? 'note' : domain,
      options.deterministicImport,
    )
    options.assertActive?.()
    return mapping
  })
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
      `update self_hosted_local_changes set state = $1, updated_at = $2,
         last_error_code = null, next_attempt_at = 0, attempt_count = 0 where id = $3`,
      [state, Date.now(), id]
    )
  }
}
