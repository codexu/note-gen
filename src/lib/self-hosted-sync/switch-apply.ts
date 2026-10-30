import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { exists, readDir, readFile } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { shouldExcludeFromSync } from '@/config/sync-exclusions'
import { markEditorPathMutation, prepareActiveEditorPathMutationDurably, runEditorPathWriteTransaction } from '@/lib/editor-deactivation'
import emitter from '@/lib/emitter'
import { syncStaleError } from '@/lib/sync/sync-stale-error'
import { normalizeSettingsSnapshot } from '@/lib/sync/settings-snapshot'
import { normalizeTagBoolean } from '@/lib/tag-sync'
import { ensureWorkspaceDirectory } from '@/lib/managed-workspace'
import type { SwitchOperationProgress } from '@/lib/sync/platform-switch-plan'
import { bytesToBase64Url, downloadAsset, hashBytes } from './blob'
import { authenticatedClient } from './profile'
import type { SyncBootstrapPage } from './protocol'
import { applyStructuredPayload } from './structured'
import { applyConversationTombstones } from './snapshot'
import { normalizeStructuredReferences } from './references'
import { applyPersonalAssetDownloads, preparePersonalAssetDownloads, type PreparedPersonalAsset } from './personal-assets'

export interface SelfHostedReplacementObject {
  object: SyncBootstrapPage['objects'][number]
  payload: Record<string, unknown>
  bytes?: Uint8Array
}

export interface SelfHostedReplacementWorkspace {
  workspaceId: string
  workspaceType: 'library' | 'account-data'
  localRoot: string | null
  sequence: string
  objects: SelfHostedReplacementObject[]
}

interface ReplacementInput {
  profileId: string
  syncEpoch: string
  workspaces: SelfHostedReplacementWorkspace[]
  localFiles: Array<{ workspaceId: string; relativePath: string; hash: string }>
  enabledDomains: string[]
  attachmentsEnabled: boolean
  beforeApply?: () => Promise<void>
  assertActive: () => void
  onProgress: (progress: SwitchOperationProgress) => void
}

const aliases: Record<string, string> = {
  tags: 'tag', marks: 'mark', messages: 'message', conversations: 'conversation', memories: 'memory', settings: 'setting',
}
const structuredTables: Record<string, string> = {
  tag: 'tags', mark: 'marks', message: 'chats', conversation: 'conversations', memory: 'memories', canvas: 'canvases',
}

/** Apply an already reviewed server snapshot without sending any local data. */
export async function replaceSelfHostedLocalSnapshot(input: ReplacementInput) {
  const enabled = new Set(input.enabledDomains.map(domain => aliases[domain] ?? domain))
  if ((enabled.has('mark') || enabled.has('message')) && !enabled.has('tag')
    || enabled.has('message') && !enabled.has('conversation')) {
    throw new Error('SELF_HOSTED_SWITCH_DEPENDENCY_REQUIRED')
  }
  for (const workspace of input.workspaces) {
    if (workspace.workspaceType === 'account-data') workspace.objects = applyConversationTombstones(normalizeStructuredReferences(workspace.objects))
  }
  const personalAssets: PreparedPersonalAsset[] = []
  // Fetch and authenticate all binary content before changing local files or rows.
  for (const workspace of input.workspaces) {
    const livePaths = new Map<string, string>()
    for (const entry of workspace.objects) {
      input.assertActive()
      if (workspace.workspaceType === 'account-data' && entry.object.deletedAt === null) {
        personalAssets.push(...await preparePersonalAssetDownloads({ profileId: input.profileId, workspaceId: workspace.workspaceId,
          payload: entry.payload, enabled: input.attachmentsEnabled, overwrite: true }))
      }
      if (workspace.workspaceType !== 'library' || !['file', 'asset', 'folder'].includes(String(entry.payload.domain))) continue
      const path = await portable(String(entry.payload.relativePath ?? ''))
      if (entry.object.deletedAt !== null) continue
      if (livePaths.has(path.caseFolded)) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      livePaths.set(path.caseFolded, String(entry.payload.domain))
      if (entry.payload.domain === 'folder') continue
      if (typeof entry.payload.content === 'string') entry.bytes = new TextEncoder().encode(entry.payload.content)
      else if (!entry.bytes && typeof entry.payload.blobId === 'string') {
        const downloaded = await downloadAsset({
          profileId: input.profileId, workspaceId: workspace.workspaceId,
          blobId: entry.payload.blobId, relativePath: String(entry.payload.relativePath),
          keyVersion: entry.object.keyVersion,
          associatedData: typeof entry.payload.associatedData === 'string' ? entry.payload.associatedData : undefined,
        })
        if (entry.payload.plaintextHash && downloaded.hash !== entry.payload.plaintextHash) throw new Error('blob_plaintext_hash_mismatch')
        entry.bytes = downloaded.bytes
      }
      if (!entry.bytes) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
    }
    for (const path of livePaths.keys()) {
      const segments = path.split('/')
      for (let length = 1; length < segments.length; length++) {
        const parent = livePaths.get(segments.slice(0, length).join('/'))
        if (parent && parent !== 'folder') throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      }
    }
  }
  await validateDependencies(input, enabled)
  const settingsSnapshots = new Map<string, Record<string, unknown>>()
  if (enabled.has('setting')) {
    for (const workspace of input.workspaces.filter(workspace => workspace.workspaceType === 'account-data')) {
      const settings = workspace.objects.filter(entry => entry.object.deletedAt === null && entry.payload.domain === 'setting')
      if (settings.length > 1) throw new Error('SELF_HOSTED_PREVIEW_DUPLICATE_IDENTITY')
      settingsSnapshots.set(workspace.workspaceId, await normalizedSettings(settings[0]?.payload.value))
    }
  }
  for (const workspace of input.workspaces) {
    if (workspace.workspaceType === 'library' && workspace.localRoot) await validateLocalFiles(input, workspace)
  }
  await input.beforeApply?.()
  input.assertActive()
  await applyPersonalAssetDownloads(personalAssets, input.assertActive)
  for (const workspace of input.workspaces) {
    const database = await getDb()
    const domains = workspace.workspaceType === 'library' ? ['file', 'asset', 'folder'] : [...enabled]
    const kinds = workspace.workspaceType === 'library' ? ['note', 'asset', 'folder'] : [...enabled]
    const oldObjects = await database.select<Array<{ objectId: string }>>(`select object_id as objectId from self_hosted_object_mappings
      where workspace_id = $1 and kind in (select value from json_each($2))`, [workspace.workspaceId, JSON.stringify(kinds)])
    const baselineIds = JSON.stringify([...new Set([...oldObjects.map(entry => entry.objectId), ...workspace.objects.map(entry => entry.object.objectId)])])
    const values = [workspace.workspaceId, JSON.stringify(domains), Date.now()]
    await executeRecordTransaction([
      { sql: `update self_hosted_local_changes set state = 'superseded', updated_at = $3
          where (workspace_id = $1 or (workspace_id is null and $4 = 'account-data'))
            and domain in (select value from json_each($2)) and state in ('pending', 'queued')`,
        values: [...values, workspace.workspaceType] },
      { sql: 'delete from self_hosted_yjs_updates where workspace_id = $1 and object_id in (select value from json_each($2))',
        values: [workspace.workspaceId, baselineIds] },
      { sql: 'delete from self_hosted_revisions where workspace_id = $1 and object_id in (select value from json_each($2))',
        values: [workspace.workspaceId, baselineIds] },
      { sql: 'delete from self_hosted_remote_objects where workspace_id = $1 and kind in (select value from json_each($2))',
        values: [workspace.workspaceId, JSON.stringify(kinds)] },
      { sql: `update self_hosted_outbox set state = 'superseded', last_error_code = 'platform-switch-remote', updated_at = $3
          where workspace_id = $1 and (coalesce(json_extract(payload, '$.kind'), json_extract(payload, '$.objectResolution.kind'), json_extract(payload, '$.resolution.kind')) in (select value from json_each($2))
            or $4 = 'library'
            or json_extract(payload, '$.conflictId') in (select id from self_hosted_conflicts where workspace_id = $1 and object_id in (select value from json_each($5))))
            and state in ('pending', 'retry', 'blocked', 'failed')`,
        values: [...values, workspace.workspaceType, baselineIds] },
    ])
    if (workspace.workspaceType === 'library' && workspace.localRoot) await replaceLibrary(input, workspace)
    else if (workspace.workspaceType === 'account-data') await replacePersonal(input, workspace, enabled, settingsSnapshots.get(workspace.workspaceId))
    input.assertActive()
    // No older event, rejected command or collaborative cache may replay over the chosen snapshot.
    await executeRecordTransaction([
      { sql: 'delete from self_hosted_inbox where workspace_id = $1', values: [workspace.workspaceId] },
      { sql: `delete from self_hosted_yjs_updates where workspace_id = $1 and ($2 = 'library'
          or object_id in (select object_id from self_hosted_object_mappings where workspace_id = $1
            and substr(local_identity, 1, instr(local_identity, ':') - 1) in (select value from json_each($3)))
          or object_id in (select value from json_each($4)))`,
        values: [workspace.workspaceId, workspace.workspaceType, JSON.stringify([...enabled]),
          JSON.stringify(workspace.objects.filter(entry => enabled.has(String(entry.payload.domain))).map(entry => entry.object.objectId))] },
      { sql: `insert into self_hosted_cursors(workspace_id, pulled_sequence, applied_sequence, acknowledged_sequence, updated_at)
          values ($1, $2, $2, $2, $3) on conflict(workspace_id) do update set pulled_sequence = excluded.pulled_sequence,
          applied_sequence = excluded.applied_sequence, acknowledged_sequence = excluded.acknowledged_sequence, updated_at = excluded.updated_at`,
        values: [workspace.workspaceId, workspace.sequence, Date.now()] },
      { sql: `update self_hosted_workspace_bindings set binding_state = 'bound', sync_epoch = $2, updated_at = $3 where workspace_id = $1`,
        values: [workspace.workspaceId, input.syncEpoch, Date.now()] },
    ])
    for (const entry of workspace.objects) {
      if (workspace.workspaceType === 'account-data' && !enabled.has(String(entry.payload.domain))) continue
      await recordBaseline(workspace, entry)
    }
    const { client } = await authenticatedClient(input.profileId)
    await client.acknowledge(workspace.workspaceId, workspace.sequence, input.syncEpoch)
  }
}

async function validateDependencies(input: ReplacementInput, enabled: Set<string>) {
  for (const workspace of input.workspaces.filter(workspace => workspace.workspaceType === 'account-data')) {
    const available = new Set(workspace.objects.filter(entry => entry.object.deletedAt === null
      && enabled.has(String(entry.payload.domain))).map(entry => entry.object.objectId))
    for (const entry of workspace.objects) {
      if (entry.object.deletedAt !== null || !enabled.has(String(entry.payload.domain))) continue
      const domain = String(entry.payload.domain)
      const value = record(entry.payload.value)
      const required: Record<string, string[]> = {
        tag: ['name'], mark: ['type'], conversation: ['title'], message: ['role', 'type'],
        memory: ['content', 'category'], canvas: ['title', 'content', 'canvasType'],
      }
      if ((required[domain] ?? []).some(key => typeof value[key] !== 'string')) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      if (domain === 'memory' && !['memory', 'preference'].includes(String(value.category))) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      if (['conversation', 'message', 'canvas'].includes(domain)
        && (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt))) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      if (['conversation', 'canvas'].includes(domain)
        && (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt))) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      if (domain === 'memory' && ['created_at', 'updated_at'].some(key => typeof value[key] !== 'number' || !Number.isFinite(value[key]))) throw new Error('SELF_HOSTED_PREVIEW_CONTENT_REQUIRED')
      const references = record(entry.payload.references)
      if ((domain === 'mark' || domain === 'message') && value.tagId != null
        && !(domain === 'message' && value.tagId === 0)
        && typeof references.tag !== 'string') throw new Error('SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING')
      for (const dependency of Object.values(references)) {
        if (typeof dependency === 'string' && !available.has(dependency)) throw new Error('SELF_HOSTED_SWITCH_REMOTE_DEPENDENCY_MISSING')
      }
    }
  }
}

async function validateLocalFiles(input: ReplacementInput, workspace: SelfHostedReplacementWorkspace) {
  const expected = new Map(input.localFiles.filter(file => file.workspaceId === workspace.workspaceId)
    .map(file => [file.relativePath, file.hash]))
  let count = 0
  async function scan(directory: string, prefix = '') {
    if (!prefix) await ensureWorkspaceDirectory(directory)
    for (const entry of await readDir(directory)) {
      input.assertActive()
      if (entry.isSymlink || excluded(entry.name)) continue
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = await join(directory, entry.name)
      if (entry.isDirectory) await scan(absolute, relativePath)
      else if (entry.isFile) {
        count++
        if (await hashBytes(await readFile(absolute)) !== expected.get(relativePath)) throw stale(relativePath)
      }
    }
  }
  await scan(workspace.localRoot!)
  if (count !== expected.size) throw stale(workspace.localRoot!)
}

async function replaceLibrary(input: ReplacementInput, workspace: SelfHostedReplacementWorkspace) {
  const root = workspace.localRoot!
  await ensureWorkspaceDirectory(root)
  const desired = workspace.objects.filter(entry => entry.object.deletedAt === null
    && ['file', 'asset', 'folder'].includes(String(entry.payload.domain))).sort((left, right) =>
    Number(left.payload.domain !== 'folder') - Number(right.payload.domain !== 'folder')
    || String(left.payload.relativePath).split('/').length - String(right.payload.relativePath).split('/').length)
  const files = desired.filter(entry => entry.payload.domain !== 'folder')
  const paths = new Map<string, SelfHostedReplacementObject>()
  for (const entry of files) paths.set((await portable(String(entry.payload.relativePath))).caseFolded, entry)
  const { default: useArticleStore } = await import('@/stores/article')
  const localFiles = input.localFiles.filter(file => file.workspaceId === workspace.workspaceId)
  const removedPaths = new Set<string>()
  const mutations = [...localFiles.map(file => file.relativePath), ...files.map(entry => String(entry.payload.relativePath))]
  if (!await prepareActiveEditorPathMutationDurably(useArticleStore.getState().activeFilePath, mutations, root)) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
  for (const file of localFiles) {
    input.assertActive()
    const target = paths.get((await portable(file.relativePath)).caseFolded)
    if (target && String(target.payload.relativePath) === file.relativePath) continue
    const accepted = await runEditorPathWriteTransaction(file.relativePath, async ({ hasQueuedSave }) => {
      if (hasQueuedSave()) return false
      await invoke('self_hosted_delete_file', { workspaceId: workspace.workspaceId, objectId: null,
        workspaceRoot: root, relativePath: file.relativePath, expectedHash: file.hash })
      markEditorPathMutation(file.relativePath, root)
      emitter.emit('editor-file-close', { path: file.relativePath })
      return true
    }, root)
    if (!accepted) throw stale(file.relativePath)
    removedPaths.add((await portable(file.relativePath)).normalized)
  }
  // Remove empty old directories, preserving excluded files and symlinks.
  async function prune(directory: string, prefix = '') {
    if (!await exists(directory)) return
    for (const entry of await readDir(directory)) {
      if (!entry.isDirectory || entry.isSymlink || excluded(entry.name)) continue
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = await join(directory, entry.name)
      await prune(absolute, path)
      if ((await readDir(absolute)).length === 0) {
        input.assertActive()
        await invoke('self_hosted_delete_directory', { workspaceId: workspace.workspaceId, objectId: null,
          workspaceRoot: root, relativePath: path, allowNonEmpty: false })
      }
    }
  }
  await prune(root)
  const expected = new Map<string, string>()
  for (const file of localFiles) {
    const path = (await portable(file.relativePath)).normalized
    if (!removedPaths.has(path)) expected.set(path, file.hash)
  }
  for (let index = 0; index < desired.length; index++) {
    input.assertActive()
    const entry = desired[index]
    const path = (await portable(String(entry.payload.relativePath))).normalized
    input.onProgress({ phase: 'apply', source: 'remote', kind: 'file', path, current: index, total: desired.length })
    if (entry.payload.domain === 'folder') {
      await invoke('self_hosted_create_directory', { workspaceId: workspace.workspaceId, objectId: entry.object.objectId, workspaceRoot: root, relativePath: path })
    } else {
      const accepted = await runEditorPathWriteTransaction(path, async ({ hasQueuedSave }) => {
        if (hasQueuedSave()) return false
        const absolute = await join(root, path)
        if (await exists(absolute)) {
          if (await hashBytes(await readFile(absolute)) !== expected.get(path)) throw stale(path)
        } else if (expected.has(path)) throw stale(path)
        await invoke('self_hosted_atomic_write', { workspaceId: workspace.workspaceId, objectId: entry.object.objectId,
          workspaceRoot: root, relativePath: path, contents: bytesToBase64Url(entry.bytes!), expectedHash: await hashBytes(entry.bytes!) })
        markEditorPathMutation(path, root)
        emitter.emit('editor-file-close', { path })
        return true
      }, root)
      if (!accepted) throw stale(path)
    }
  }
  const database = await getDb()
  await database.execute('delete from self_hosted_object_mappings where workspace_id = $1', [workspace.workspaceId])
  for (const entry of workspace.objects) {
    const domain = String(entry.payload.domain)
    if (!['file', 'asset', 'folder'].includes(domain)) continue
    const path = await portable(String(entry.payload.relativePath ?? ''))
    const deleted = entry.object.deletedAt !== null
    await database.execute(`insert into self_hosted_object_mappings(workspace_id, object_id, kind, local_identity,
      relative_path, path_casefold, content_hash, blob_refs, deleted_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [workspace.workspaceId, entry.object.objectId, entry.object.kind,
      deleted ? `superseded:${entry.object.kind}:${entry.object.objectId}` : `${domain}:${path.normalized}`,
      deleted ? null : path.normalized, deleted ? null : path.caseFolded,
      entry.bytes ? await contentHash(entry) : null, JSON.stringify(entry.object.blobRefs),
      entry.object.deletedAt ? Date.parse(entry.object.deletedAt) : null, Date.now()])
  }
}

async function replacePersonal(input: ReplacementInput, workspace: SelfHostedReplacementWorkspace, enabled: Set<string>, settings?: Record<string, unknown>) {
  const database = await getDb()
  const live = workspace.objects.filter(entry => entry.object.deletedAt === null && enabled.has(String(entry.payload.domain)))
  const defaults = await database.select<Array<{ id: number; name: string }>>(
    "select id, name from tags where lower(trim(cast(coalesce(isLocked, 0) as text))) in ('1','true') order by id",
  )
  const previousTagMappings = await database.select<Array<{ objectId: string; localIdentity: string }>>(
    "select object_id as objectId, local_identity as localIdentity from self_hosted_object_mappings where workspace_id = $1 and kind = 'tag' and deleted_at is null",
    [workspace.workspaceId],
  )
  const statements: RecordStatement[] = []
  const optionalTables = new Set((await database.select<Array<{ name: string }>>(
    "select name from sqlite_master where type = 'table' and name in ('conversation_compactions', 'memory_jobs', 'conversation_sync_tombstones')",
  )).map(table => table.name))
  // Keep tags needed by domains outside this switch, and the required default tag.
  const protectedTags = [
    "select id from tags where lower(trim(cast(coalesce(isLocked, 0) as text))) in ('1','true')",
    'select tagId from notes',
    ...(!enabled.has('mark') ? ['select tagId from marks', 'select cast(value as integer) from record_tag_metadata, json_each(tagIds)'] : []),
    ...(!enabled.has('message') ? ['select tagId from chats'] : []),
  ].join(' union ')
  statements.push({ sql: 'update self_hosted_sync_context set suppress_triggers = suppress_triggers + 1 where id = 1', values: [] })
  if (enabled.has('message') && optionalTables.has('conversation_compactions')) {
    statements.push({ sql: 'delete from conversation_compactions', values: [] })
  }
  if (enabled.has('conversation') && optionalTables.has('memory_jobs')) {
    statements.push({ sql: 'delete from memory_jobs where conversation_id in (select id from conversations)', values: [] })
  }
  if (optionalTables.has('conversation_sync_tombstones')) {
    statements.push({ sql: 'delete from conversation_sync_tombstones where entityType in (select value from json_each($1))',
      values: [JSON.stringify([...enabled].filter(domain => domain === 'message' || domain === 'conversation'))] })
  }
  for (const domain of ['message', 'mark', 'canvas', 'memory', 'conversation', 'tag']) {
    if (!enabled.has(domain)) continue
    if (domain === 'tag') statements.push({ sql: `delete from tags where id not in (select id from (${protectedTags}) where id is not null)`, values: [] })
    else if (domain === 'conversation' && !enabled.has('message')) statements.push({ sql: 'delete from conversations where id not in (select conversationId from chats where conversationId is not null)', values: [] })
    else statements.push({ sql: `delete from ${structuredTables[domain]}`, values: [] })
  }
  statements.push({ sql: `delete from self_hosted_object_mappings where workspace_id = $1
    and kind in (select value from json_each($2))`,
    values: [workspace.workspaceId, JSON.stringify([...enabled])] })
  statements.push({ sql: 'update self_hosted_sync_context set suppress_triggers = max(0, suppress_triggers - 1) where id = 1', values: [] })
  input.assertActive()
  await executeRecordTransaction(statements)
  // Reuse each protected tag's identity, including legacy string flags and
  // workspaces with more than one protected tag. Repeated imports must not
  // allocate a new default-tag ID on every switch.
  const claimedDefaults = new Set<number>()
  for (const entry of live.filter(entry => entry.payload.domain === 'tag' && normalizeTagBoolean(record(entry.payload.value).isLocked) === true)) {
    const previous = previousTagMappings.find(mapping => mapping.objectId === entry.object.objectId)
    const previousId = previous?.localIdentity.startsWith('tag:') ? Number(previous.localIdentity.slice(4)) : undefined
    const available = defaults.filter(tag => !claimedDefaults.has(tag.id))
    const target = available.find(tag => tag.id === previousId)
      ?? available.find(tag => tag.name === record(entry.payload.value).name) ?? available[0]
    if (!target) continue
    claimedDefaults.add(target.id)
    await database.execute(`insert into self_hosted_object_mappings(workspace_id, object_id, kind, local_identity, updated_at)
      values ($1, $2, 'tag', $3, $4)`, [workspace.workspaceId, entry.object.objectId, `tag:${target.id}`, Date.now()])
  }
  const priority: Record<string, number> = { tag: 0, conversation: 1, mark: 2, message: 3, canvas: 4, memory: 5, setting: 6 }
  live.sort((left, right) => (priority[String(left.payload.domain)] ?? 7) - (priority[String(right.payload.domain)] ?? 7))
  if (settings) {
    await replaceSettings(settings)
    const setting = live.find(entry => entry.payload.domain === 'setting')
    if (setting) setting.payload = { ...setting.payload, value: settings }
  }
  for (let index = 0; index < live.length; index++) {
    const entry = live[index]
    input.assertActive()
    input.onProgress({ phase: 'apply', source: 'remote', kind: 'module', path: String(entry.payload.localKey ?? entry.object.objectId), current: index, total: live.length })
    await applyStructuredPayload(workspace.workspaceId, entry.object.objectId, entry.object.kind, entry.payload)
  }
  for (const entry of workspace.objects) {
    if (entry.object.deletedAt === null || !enabled.has(String(entry.payload.domain))) continue
    input.assertActive()
    // Remember deleted parents and logically deleted children without claiming
    // a device-local numeric ID or reviving a stale object after the switch.
    await database.execute(`insert into self_hosted_object_mappings(workspace_id, object_id, kind, local_identity, deleted_at, updated_at)
      values ($1,$2,$3,$4,$5,$6) on conflict(workspace_id, object_id) do update set deleted_at=excluded.deleted_at,updated_at=excluded.updated_at`,
    [workspace.workspaceId, entry.object.objectId, entry.object.kind, `superseded:${entry.object.kind}:${entry.object.objectId}`,
      Date.parse(entry.object.deletedAt), Date.now()])
  }
}

async function normalizedSettings(value: unknown) {
  const { default: useSettingStore } = await import('@/stores/setting')
  const defaults = Object.fromEntries(Object.entries(useSettingStore.getInitialState())
    .filter(([, item]) => typeof item !== 'function' && item !== undefined))
  const remote = record(value)
  const excludeSensitiveConfig = await (await Store.load('store.json')).get<boolean>('excludeSensitiveConfig') ?? true
  return { ...defaults, ...remote, ...normalizeSettingsSnapshot(remote, defaults, { excludeSensitiveConfig }) }
}

async function replaceSettings(remote: Record<string, unknown>) {
  const store = await Store.load('store.json')
  const options = { excludeSensitiveConfig: await store.get<boolean>('excludeSensitiveConfig') !== false }
  for (const [key] of await store.entries()) {
    if (!shouldExcludeFromSync(key, options) && !(key in remote)) await store.delete(key)
  }
  for (const [key, value] of Object.entries(remote)) {
    if (!shouldExcludeFromSync(key, options)) await store.set(key, value)
  }
  await store.save()
}

async function recordBaseline(workspace: SelfHostedReplacementWorkspace, entry: SelfHostedReplacementObject) {
  const database = await getDb()
  await database.execute(`insert or replace into self_hosted_revisions(workspace_id, object_id, revision, sequence, content_hash, snapshot, created_at)
    values ($1, $2, $3, $4, $5, $6, $7)`, [workspace.workspaceId, entry.object.objectId, entry.object.currentRevision,
    workspace.sequence, entry.bytes ? await contentHash(entry) : entry.object.ciphertextHash,
    entry.payload.domain === 'file' && entry.bytes ? new TextDecoder().decode(entry.bytes) : null, Date.now()])
  if (workspace.workspaceType === 'account-data' && entry.object.deletedAt === null) await database.execute(`insert or replace into self_hosted_remote_objects(workspace_id, object_id, kind, revision, payload, updated_at)
    values ($1, $2, $3, $4, $5, $6)`, [workspace.workspaceId, entry.object.objectId, entry.object.kind, entry.object.currentRevision, JSON.stringify(entry.payload), Date.now()])
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function portable(relativePath: string) {
  return invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', { relativePath })
}
function contentHash(entry: SelfHostedReplacementObject) {
  return entry.payload.domain === 'file'
    ? invoke<string>('self_hosted_sha256', { value: new TextDecoder().decode(entry.bytes!) })
    : hashBytes(entry.bytes!)
}
function excluded(name: string) { return name === '.notegen' || name === '.DS_Store' || name.endsWith('.tmp') }
function stale(path: string) { return syncStaleError({ stage: 'apply', source: 'local', path, check: 'content' }) }
