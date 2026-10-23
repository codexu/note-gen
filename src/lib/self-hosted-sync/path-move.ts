import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { executeRecordTransaction, getDb, type RecordStatement } from '@/db'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'
import { authenticatedClient } from './profile'
import { decryptPackedJson, encryptJson, loadWorkspaceKey, objectAssociatedData } from './crypto'
import { getSelfHostedSyncRuntime } from './runtime'
import type { SyncBootstrapPage } from './protocol'
import { withSelfHostedPrepareLock } from './prepare-lock'

class ExistingUploadPending extends Error {
  constructor() { super('自托管已有文件上传尚未完成，重命名待办已保留') }
}

type PathKind = 'note' | 'asset' | 'folder'

interface Binding {
  workspaceId: string
  profileId: string
  localRoot: string
  syncEpoch: string | null
  accessMode: string
  serverUrl: string
  instanceId: string | null
  accountId: string | null
}

interface Mapping {
  objectId: string
  kind: string
  relativePath: string | null
  updatedAt: number
}

export interface SelfHostedPathMoveSnapshot {
  provider: 'selfHosted'
  context: string
  operationId: string
  syncEpoch: string
  source: string
  target: string
  enqueued?: boolean
  entries: Array<{
    objectId: string
    kind: PathKind
    source: string | null
    target: string
    targetCasefold: string
    contentHash: string | null
    blobRefs: string[]
    commandId: string
    /** Already encrypted with the existing object's associated data. */
    command: string
  }>
}

interface PathMoveOptions {
  expected?: unknown
  rememberSource: (snapshot: SelfHostedPathMoveSnapshot) => Promise<void>
  assertCurrent: () => Promise<boolean>
}

const within = (root: string, path: string) => root === path || path.startsWith(`${root}/`)
const validPath = (path: string) => Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
  && path.split('/').every(part => part && part !== '.' && part !== '..')
const domain = (kind: PathKind) => kind === 'note' ? 'file' : kind
const identity = (binding: Binding) => JSON.stringify([
  binding.workspaceId, binding.profileId, binding.localRoot, binding.serverUrl,
  binding.instanceId, binding.accountId,
])

async function activeBinding(): Promise<Binding | null> {
  const settings = await Store.load('store.json')
  if (await settings.get<string>('primaryBackupMethod') !== 'selfHosted') return null
  const workspace = await getWorkspacePath()
  const localRoot = workspace.isCustom ? workspace.path : await getDefaultArticleAbsolutePath('')
  const rows = await (await getDb()).select<Binding[]>(
    `select b.workspace_id as workspaceId, b.profile_id as profileId, b.local_root as localRoot,
       b.sync_epoch as syncEpoch, b.access_mode as accessMode, p.server_url as serverUrl,
       p.instance_id as instanceId, p.account_id as accountId
     from self_hosted_workspace_bindings b join self_hosted_sync_profiles p on p.id = b.profile_id
     where b.workspace_type = 'library' and b.local_root = $1
       and b.binding_state = 'bound' limit 1`,
    [localRoot],
  )
  return rows[0] || null
}

/** The journal contains endpoint/account identifiers, never credentials. */
export async function getSelfHostedPathMoveIdentity(): Promise<string | null> {
  const binding = await activeBinding()
  return binding ? identity(binding) : null
}

function readSnapshot(value: unknown, context: string, source: string, target: string): SelfHostedPathMoveSnapshot {
  if (!value || typeof value !== 'object') throw new Error('自托管重命名记录无效')
  const item = value as SelfHostedPathMoveSnapshot
  if (item.provider !== 'selfHosted' || item.context !== context || item.source !== source || item.target !== target
    || typeof item.operationId !== 'string' || !item.operationId || typeof item.syncEpoch !== 'string' || !item.syncEpoch
    || (item.enqueued !== undefined && typeof item.enqueued !== 'boolean')
    || !Array.isArray(item.entries) || !item.entries.length || item.entries.length > 100_000) {
    throw new Error('自托管重命名记录无效')
  }
  const objects = new Set<string>()
  const paths = new Set<string>()
  const commands = new Set<string>()
  for (const entry of item.entries) {
    if (!entry || !['note', 'asset', 'folder'].includes(entry.kind)
      || typeof entry.objectId !== 'string' || !entry.objectId || objects.has(entry.objectId)
      || typeof entry.commandId !== 'string' || !entry.commandId || commands.has(entry.commandId)
      || typeof entry.target !== 'string' || !validPath(entry.target)
      || typeof entry.targetCasefold !== 'string' || !entry.targetCasefold || paths.has(entry.targetCasefold)
      || (entry.source !== null && (typeof entry.source !== 'string' || !within(source, entry.source)
        || entry.target !== `${target}${entry.source.slice(source.length)}`))
      || (entry.source === null && (entry.kind !== 'folder'
        || (!within(target, entry.target) && !target.startsWith(`${entry.target}/`))))
      || (entry.contentHash !== null && typeof entry.contentHash !== 'string')
      || !Array.isArray(entry.blobRefs) || entry.blobRefs.some(ref => typeof ref !== 'string')
      || typeof entry.command !== 'string') throw new Error('自托管重命名对象记录无效')
    const command = JSON.parse(entry.command) as Record<string, unknown>
    if (command.type !== 'upsert-object' || command.objectId !== entry.objectId || command.kind !== entry.kind
      || command.commandId !== entry.commandId || typeof command.ciphertext !== 'string'
      || typeof command.ciphertextHash !== 'string' || typeof command.keyVersion !== 'number'
      || !Number.isSafeInteger(command.keyVersion) || command.keyVersion < 1
      || (command.baseRevision !== null && typeof command.baseRevision !== 'string')) {
      throw new Error('自托管重命名命令记录无效')
    }
    objects.add(entry.objectId)
    paths.add(entry.targetCasefold)
    commands.add(entry.commandId)
  }
  return structuredClone(item)
}

/** Rename encrypted remote snapshots through the durable native outbox. Keep
 * object identities and blob references, including files absent on this Mac.
 * Local unsent edits are uploaded normally after the rename journal completes. */
export async function moveSelfHostedRemotePath(
  source: string, target: string, { expected, rememberSource, assertCurrent }: PathMoveOptions,
): Promise<{ status: 'moved' | 'missing' }> {
  if (!validPath(source) || !validPath(target) || source === target
    || within(source.toLowerCase(), target.toLowerCase()) || within(target.toLowerCase(), source.toLowerCase())) {
    throw new Error('自托管重命名源路径和目标路径无效或互相包含')
  }
  source = (await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: source })).normalized
  target = (await invoke<{ normalized: string }>('self_hosted_portable_path', { relativePath: target })).normalized
  const binding = await activeBinding()
  if (!binding) throw new Error('自托管工作区未绑定或已断开')
  const context = identity(binding)
  const current = async () => {
    if (!await assertCurrent() || await getSelfHostedPathMoveIdentity() !== context
      || await (await Store.load('store.json')).get('platformSwitchRecovery')) {
      throw new Error('自托管同步配置或本地路径已变化，重命名待办已保留')
    }
  }
  await current()
  if (binding.accessMode !== 'read-write' || !binding.syncEpoch) throw new Error('自托管工作区当前不可写')
  const syncEpoch = binding.syncEpoch
  const database = await getDb()
  const { client } = await authenticatedClient(binding.profileId)
  const loadRemote = async () => {
    await current()
    const session = await client.syncSession(binding.workspaceId, '0', syncEpoch)
    if (session.syncEpoch !== syncEpoch || !session.protocol.compatible
      || !session.workspace.capabilities.includes('content.update')) throw new Error('自托管工作区版本或写入权限已变化')
    type Remote = SyncBootstrapPage['objects'][number] & { path: string; casefold: string; payload: Record<string, unknown> }
    const remote: Remote[] = []
    const ids = new Set<string>()
    const paths = new Set<string>()
    const pages = new Set<string>()
    let bootstrapId: string | undefined
    let after: string | undefined
    let sequence: string | undefined
    for (;;) {
      await current()
      const page = await client.bootstrap(binding.workspaceId, session.syncEpoch, bootstrapId, after, 200)
      if (page.syncEpoch !== session.syncEpoch || !page.bootstrapId
        || (bootstrapId && bootstrapId !== page.bootstrapId) || (sequence && sequence !== page.snapshotSequence)) {
        throw new Error('自托管重命名读取到不完整的远端快照')
      }
      bootstrapId = page.bootstrapId
      sequence = page.snapshotSequence
      for (const object of page.objects) {
        if (ids.has(object.objectId) || ids.size >= 100_000) throw new Error('自托管远端快照成员重复或数量过多')
        ids.add(object.objectId)
        if (object.deletedAt || !['note', 'asset', 'folder'].includes(object.kind)) continue
        const key = await loadWorkspaceKey(binding.workspaceId, object.keyVersion)
        const payload = await decryptPackedJson<Record<string, unknown>>(
          key, object.ciphertext, objectAssociatedData(binding.workspaceId, object.objectId, object.kind),
        )
        if (payload.domain !== domain(object.kind as PathKind) || typeof payload.relativePath !== 'string') {
          throw new Error('自托管远端路径载荷无效')
        }
        const portable = await invoke<{ normalized: string; caseFolded: string }>(
          'self_hosted_portable_path', { relativePath: payload.relativePath },
        )
        if (paths.has(portable.caseFolded)) throw new Error('自托管远端路径存在大小写冲突')
        paths.add(portable.caseFolded)
        remote.push({ ...object, path: portable.normalized, casefold: portable.caseFolded, payload })
      }
      if (!page.hasMore) return { remote, keyVersion: Math.max(1, ...session.keyVersions.map(key => key.keyVersion)) }
      if (!page.nextObjectId || pages.has(page.nextObjectId)) throw new Error('自托管远端快照分页无效')
      pages.add(page.nextObjectId)
      after = page.nextObjectId
    }
  }
  let snapshot = expected === undefined ? undefined : readSnapshot(expected, context, source, target)
  const prepareMove = async (): Promise<'missing' | 'moved' | 'queued'> => {
    await current()
    const mappings = await database.select<Mapping[]>(
      `select object_id as objectId, kind, relative_path as relativePath, updated_at as updatedAt
       from self_hosted_object_mappings where workspace_id = $1 and deleted_at is null`,
      [binding.workspaceId],
    )
    const remoteState = await loadRemote()
    const movedIds = new Set([
      ...mappings.filter(row => row.relativePath && within(source, row.relativePath)).map(row => row.objectId),
      ...(snapshot?.entries.map(entry => entry.objectId) || []),
      // The native local-move journal may already have rebased the mappings
      // through several offline moves. Remote object IDs still identify any
      // ordinary upload that was prepared before the shared journal existed.
      ...remoteState.remote.filter(object => within(source, object.path)).map(object => object.objectId),
    ])
    // An already materialized upload has its own command identity and must finish
    // before freezing this rename's base revision. Never rewrite in-flight bytes.
    if (movedIds.size) {
      const outstanding = await database.select<Array<{ objectId: string }>>(
        `select json_extract(payload, '$.objectId') as objectId from self_hosted_outbox
         where workspace_id = $1 and command_type <> 'path-move'
           and state in ('pending', 'retry', 'blocked')`,
        [binding.workspaceId],
      )
      if (outstanding.some(row => movedIds.has(row.objectId))) throw new ExistingUploadPending()
    }
    if (!snapshot) {
      const entries = remoteState.remote.filter(object => within(source, object.path))
      const unrelated = remoteState.remote.filter(object => !within(source, object.path))
      if (unrelated.some(object => within(target.toLowerCase(), object.casefold))) throw new Error('自托管远端目标已存在，未覆盖任何内容')
      if (!entries.length) return 'missing'
      snapshot = {
        provider: 'selfHosted', context, operationId: crypto.randomUUID(), syncEpoch,
        source, target, entries: [],
      }
      const planned = entries.map(object => ({
        object, target: `${target}${object.path.slice(source.length)}`,
      }))
      const folders = new Map(remoteState.remote.filter(object => object.kind === 'folder').map(object => [object.path, object.objectId]))
      for (const entry of planned) if (entry.object.kind === 'folder') folders.set(entry.target, entry.object.objectId)
      const requiredParents = new Set<string>()
      for (const entry of planned) {
        const parts = entry.target.split('/')
        for (let count = 1; count < parts.length; count++) requiredParents.add(parts.slice(0, count).join('/'))
      }
      for (const parent of [...requiredParents].sort((a, b) => a.length - b.length)) {
        if (folders.has(parent)) continue
        const conflict = remoteState.remote.find(object => object.casefold === parent.toLowerCase())
        if (conflict) throw new Error('自托管目标父路径不是目录或存在大小写冲突')
        const local = mappings.find(row => row.relativePath === parent)
        if (local && local.kind !== 'folder') throw new Error('自托管目标父路径的本地映射不是目录')
        folders.set(parent, local?.objectId || crypto.randomUUID())
      }
      const prepare = async (
        objectId: string, kind: PathKind, oldPath: string | null, newPath: string,
        payload: Record<string, unknown>, revision: string | null, keyVersion: number, blobRefs: string[],
      ) => {
        const portable = await invoke<{ normalized: string; caseFolded: string }>('self_hosted_portable_path', { relativePath: newPath })
        const key = await loadWorkspaceKey(binding.workspaceId, keyVersion)
        const encrypted = await encryptJson(key, { ...payload, relativePath: portable.normalized }, objectAssociatedData(binding.workspaceId, objectId, kind))
        const commandId = crypto.randomUUID()
        const parent = newPath.includes('/') ? newPath.slice(0, newPath.lastIndexOf('/')) : ''
        const command = {
          commandId, type: 'upsert-object', objectId, kind, parentObjectId: parent ? folders.get(parent) || null : null,
          nameCiphertext: null, nameBlindIndex: null, baseRevision: revision, blobRefs, keyVersion,
          ciphertext: encrypted.packedCiphertext, ciphertextHash: encrypted.packedCiphertextHash,
        }
        snapshot!.entries.push({
          objectId, kind, source: oldPath, target: portable.normalized, targetCasefold: portable.caseFolded,
          contentHash: typeof payload.plaintextHash === 'string' ? payload.plaintextHash
            : kind === 'note' && typeof payload.content === 'string'
              ? await invoke<string>('self_hosted_sha256', { value: payload.content }) : null,
          blobRefs, commandId, command: JSON.stringify(command),
        })
      }
      for (const parent of [...requiredParents].sort((a, b) => a.length - b.length)) {
        if (remoteState.remote.some(object => object.path === parent)
          || planned.some(entry => entry.target === parent && entry.object.kind === 'folder')) continue
        await prepare(folders.get(parent)!, 'folder', null, parent, { version: 1, domain: 'folder' }, null, remoteState.keyVersion, [])
      }
      for (const entry of planned.sort((a, b) => a.target.length - b.target.length)) {
        const object = entry.object
        await prepare(object.objectId, object.kind as PathKind, object.path, entry.target,
          object.payload, object.currentRevision, object.keyVersion, object.blobRefs)
      }
      await current()
      await rememberSource(structuredClone(snapshot))
    }
    if (snapshot.syncEpoch !== syncEpoch) throw new Error('自托管工作区同步版本已变化，待办已保留')
    const originalIds = new Set(snapshot.entries.filter(entry => entry.source !== null).map(entry => entry.objectId))
    if (remoteState.remote.some(object => within(source, object.path) && !originalIds.has(object.objectId))) {
      throw new Error('自托管旧目录出现新的远端对象，未覆盖或删除新内容，重命名待办已保留')
    }
    const remoteById = () => new Map(remoteState.remote.map(object => [object.objectId, object]))
    const completed = () => {
      const byId = remoteById()
      return !remoteState.remote.some(object => within(source, object.path))
        && snapshot!.entries.every(entry => byId.get(entry.objectId)?.path === entry.target)
    }
    const states = await database.select<Array<{ commandId: string; state: string; lastError: string | null }>>(
      `select command_id as commandId, state, last_error_code as lastError
       from self_hosted_outbox where workspace_id = $1 and command_type = 'path-move'`,
      [binding.workspaceId],
    )
    const done = completed()
    const latestMappings = await database.select<Mapping[]>(
      `select object_id as objectId, kind, relative_path as relativePath, updated_at as updatedAt
       from self_hosted_object_mappings where workspace_id = $1 and deleted_at is null`,
      [binding.workspaceId],
    )
    const statements: RecordStatement[] = [{
      sql: `update self_hosted_workspace_bindings set updated_at = updated_at
        where workspace_id = $1 and profile_id = $2 and local_root = $3 and sync_epoch = $4
          and binding_state = 'bound' and access_mode = 'read-write'
          and exists (select 1 from self_hosted_sync_profiles p where p.id = $2 and p.state = 'connected'
            and p.server_url = $5 and p.account_id is $6 and p.instance_id is $7)`,
      values: [binding.workspaceId, binding.profileId, binding.localRoot, snapshot.syncEpoch, binding.serverUrl, binding.accountId, binding.instanceId],
      expectedRows: 1,
    }]
    for (const entry of snapshot.entries) {
      const mapping = latestMappings.find(row => row.objectId === entry.objectId)
      const collision = latestMappings.find(row => row.objectId !== entry.objectId && row.relativePath?.toLowerCase() === entry.targetCasefold)
      if (collision || (mapping && (mapping.kind !== entry.kind
        || (mapping.relativePath !== entry.source && mapping.relativePath !== entry.target)))) {
        throw new Error('自托管路径映射已变化，未替换其他对象身份')
      }
      if (mapping) {
        statements.push({
          sql: `update self_hosted_object_mappings set local_identity = $1, relative_path = $2,
            path_casefold = $3, updated_at = $4 where workspace_id = $5 and object_id = $6
            and kind = $7 and deleted_at is null and updated_at = $8`,
          values: [`${domain(entry.kind)}:${entry.target}`, entry.target, entry.targetCasefold, Date.now(), binding.workspaceId, entry.objectId, entry.kind, mapping.updatedAt],
          expectedRows: 1,
        })
      } else {
        statements.push({
          sql: `insert into self_hosted_object_mappings(workspace_id, object_id, kind, local_identity,
            relative_path, path_casefold, content_hash, blob_refs, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          values: [binding.workspaceId, entry.objectId, entry.kind, `${domain(entry.kind)}:${entry.target}`,
            entry.target, entry.targetCasefold, entry.contentHash, JSON.stringify(entry.blobRefs), Date.now()],
          expectedRows: 1,
        })
      }
      const command = states.find(row => row.commandId === entry.commandId)
      const alreadyThere = remoteById().get(entry.objectId)?.path === entry.target
      if (!done && !alreadyThere) {
        if (command && ['failed', 'superseded', 'sent'].includes(command.state)) {
          throw new Error(`自托管远端重命名未应用：${command.lastError || '版本冲突，请先处理同步冲突'}`)
        }
        if (!command) statements.push({
          sql: `insert into self_hosted_outbox(command_id, workspace_id, source_change_ids,
            command_type, payload, state, created_at, updated_at) values ($1,$2,'[]','path-move',$3,'pending',$4,$4)`,
          values: [entry.commandId, binding.workspaceId, entry.command, Date.now()], expectedRows: 1,
        })
      } else if (command && ['pending', 'retry', 'blocked'].includes(command.state)) {
        statements.push({
          sql: `update self_hosted_outbox set state = 'sent', updated_at = $1 where command_id = $2`,
          values: [Date.now(), entry.commandId], expectedRows: 1,
        })
      }
    }
    // Keep edits made before/after the local rename queued at their new path.
    statements.push({
      sql: `update self_hosted_local_changes set local_key = $1 || substr(local_key, length($2) + 1), updated_at = $3
        where workspace_id = $4 and domain in ('file','asset','folder') and state in ('pending','queued')
          and (local_key = $2 or substr(local_key,1,length($2)+1) = $2 || '/')`,
      values: [target, source, Date.now(), binding.workspaceId],
    })
    await current()
    await executeRecordTransaction(statements)
    snapshot.enqueued = true
    await rememberSource(structuredClone(snapshot))
    return done ? 'moved' : 'queued'
  }
  let prepared: 'missing' | 'moved' | 'queued'
  for (let attempt = 0; ; attempt++) {
    try {
      prepared = await withSelfHostedPrepareLock(binding.workspaceId, prepareMove)
      break
    } catch (error) {
      if (!(error instanceof ExistingUploadPending) || attempt >= 1) throw error
      // The runtime takes the preparation lock when materializing its outbox.
      // Drain prior commands only after releasing our preparation lock.
      await getSelfHostedSyncRuntime().wake('workspace:path-move-drain')
      await current()
    }
  }
  if (prepared !== 'queued') return { status: prepared }
  await getSelfHostedSyncRuntime().wake('workspace:path-moved')
  await current()
  const after = await loadRemote()
  if (after.remote.some(object => within(source, object.path))) {
    throw new Error('自托管旧目录仍有远端对象或出现新成员，未删除这些内容，重命名待办已保留')
  }
  const byId = new Map(after.remote.map(object => [object.objectId, object]))
  if (!snapshot!.entries.every(entry => byId.get(entry.objectId)?.path === entry.target)) {
    throw new Error('自托管远端重命名尚未完成，已加入持久同步队列')
  }
  return { status: 'moved' }
}
