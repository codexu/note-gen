import { Store } from '@tauri-apps/plugin-store'
import { getPathMoveConfiguration, type PathMoveProvider } from './path-move-configuration'
export { getWebDAVPathMoveIdentity } from './path-move-configuration'

import { normalizeRemoteVersion } from './remote-content-cache'
import { getCurrentSyncContext } from './sync-context'
import { syncStaleError } from './sync-stale-error'

type MetadataValue = string | number
type MetadataStoreName = 'syncedFileShas' | 'lastSyncTimes' | 'lastRestoreTimes'

interface MetadataSnapshot {
  source: Record<string, MetadataValue>
  target: Record<string, MetadataValue>
}

interface MetadataContext {
  workspaceKey: string
  repo: string
  provider?: PathMoveProvider
  owner?: string
  identity?: string
}

export interface PathMoveMetadata {
  version: 1
  source: string
  target: string
  /** Keep the application's existing metadata namespace. The additional
   * account identity guards replay without placing credentials in the journal. */
  context: MetadataContext
  stores: Record<MetadataStoreName, MetadataSnapshot>
}

export interface PathMoveRemoteVersion {
  source: string
  target: string
  /** Follow later child moves independently of the containing directory. */
  localTarget?: string
  sourceVersion: string
  targetVersion: string
  sourceHash: string
  targetHash: string
}

const METADATA_STORES: MetadataStoreName[] = ['syncedFileShas', 'lastSyncTimes', 'lastRestoreTimes']

function validPath(path: string): boolean {
  return Boolean(path) && !path.includes('\\') && !/^[a-z]:/i.test(path)
    && path.split('/').every(part => part && !part.startsWith('.'))
}

function includesPath(root: string, path: string): boolean {
  return root === path || path.startsWith(`${root}/`)
}

function metadataKey(context: MetadataContext, path: string): string {
  return JSON.stringify([context.workspaceKey, context.provider || 'github', context.repo, path])
}

function scopedPath(key: string, context: MetadataContext): string | null {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) && parts.length === 4
      && parts[0] === context.workspaceKey && parts[1] === (context.provider || 'github') && parts[2] === context.repo
      && typeof parts[3] === 'string' && validPath(parts[3]) ? parts[3] : null
  } catch {
    return null
  }
}

function readValues(value: unknown, name: MetadataStoreName): Record<string, MetadataValue> {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`同步元数据无效：${name}`)
  // Validate only this move's namespace; leave unrelated legacy values intact.
  return { ...value as Record<string, MetadataValue> }
}

/** Match getLocalRecordedSha/getFileSyncStatus, including legacy default paths. */
function captureValues(
  values: Record<string, MetadataValue>, context: MetadataContext, root: string, name: MetadataStoreName,
): Record<string, MetadataValue> {
  const result: Record<string, MetadataValue> = Object.create(null)
  const add = (path: string, value: MetadataValue) => {
    if (name === 'syncedFileShas' ? typeof value !== 'string'
      : typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`同步元数据无效：${path}`)
    result[path] = value
  }
  if (context.workspaceKey === '__default__') {
    for (const [key, value] of Object.entries(values)) {
      if (validPath(key) && includesPath(root, key)) add(key, value)
    }
  }
  for (const [key, value] of Object.entries(values)) {
    const path = scopedPath(key, context)
    if (path && includesPath(root, path)) add(path, value)
  }
  return result
}

function sameValues(a: Record<string, MetadataValue>, b: Record<string, MetadataValue>): boolean {
  return Object.keys(a).length === Object.keys(b).length
    && Object.entries(a).every(([key, value]) => Object.prototype.hasOwnProperty.call(b, key) && b[key] === value)
}

function validateMetadata(metadata: PathMoveMetadata): void {
  const context = metadata?.context
  if (!metadata || metadata.version !== 1
    || typeof metadata.source !== 'string' || typeof metadata.target !== 'string'
    || !validPath(metadata.source) || !validPath(metadata.target)
    || includesPath(metadata.source, metadata.target) || includesPath(metadata.target, metadata.source)
    || !context || typeof context.workspaceKey !== 'string' || !context.workspaceKey
    || typeof context.repo !== 'string' || !metadata.stores
    || (context.provider !== undefined && context.provider !== 'github'
      ? !['gitee', 'gitlab', 'gitea', 's3', 'webdav', 'cloudFolder', 'selfHosted'].includes(context.provider)
        || typeof context.identity !== 'string' || !context.identity
      : (context.provider !== undefined && context.provider !== 'github')
        || !context.repo || typeof context.owner !== 'string' || !context.owner)) {
    throw new Error('路径迁移元数据无效')
  }
  for (const name of METADATA_STORES) {
    const snapshot = metadata.stores[name]
    if (!snapshot || typeof snapshot !== 'object') throw new Error('路径迁移元数据无效')
    for (const side of ['source', 'target'] as const) {
      const values = snapshot[side]
      if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('路径迁移元数据无效')
      for (const [path, value] of Object.entries(values)) {
        if (!validPath(path) || !includesPath(metadata[side], path)
          || (name === 'syncedFileShas' ? typeof value !== 'string'
            : typeof value !== 'number' || !Number.isFinite(value))) throw new Error('路径迁移元数据无效')
      }
    }
  }
}

async function assertContext(store: Store, metadata: PathMoveMetadata): Promise<void> {
  const current = await getCurrentSyncContext()
  const context = metadata.context
  const provider = context.provider || 'github'
  if (current.provider !== provider || current.workspaceKey !== context.workspaceKey || current.repo !== context.repo
    || await store.get('platformSwitchRecovery')) throw syncStaleError({ stage: 'apply', check: 'configuration' })
  if (context.provider !== undefined && context.provider !== 'github') {
    const configuration = await getPathMoveConfiguration()
    if (!configuration || configuration.provider !== context.provider || configuration.identity !== context.identity) {
      throw syncStaleError({ stage: 'apply', check: 'configuration' })
    }
  } else if (await store.get<string>('githubUsername') !== context.owner) {
    throw syncStaleError({ stage: 'apply', check: 'configuration' })
  }
}

/** Capture before moving locally. Never accept a newly observed remote version. */
export async function capturePathMoveMetadata(source: string, target: string): Promise<PathMoveMetadata> {
  if (!validPath(source) || !validPath(target) || includesPath(source, target) || includesPath(target, source)) {
    throw new Error('路径迁移元数据的路径无效')
  }
  const store = await Store.load('store.json')
  const current = await getCurrentSyncContext()
  const configuration = await getPathMoveConfiguration()
  if (!configuration) throw syncStaleError({ stage: 'apply', check: 'configuration' })
  const context: MetadataContext = configuration.provider === 'github'
    ? { provider: 'github', workspaceKey: current.workspaceKey, repo: current.repo, owner: configuration.owner! }
    : { provider: configuration.provider, workspaceKey: current.workspaceKey, repo: current.repo, identity: configuration.identity }

  const metadata: PathMoveMetadata = {
    version: 1, source, target, context,
    stores: {
      syncedFileShas: { source: {}, target: {} },
      lastSyncTimes: { source: {}, target: {} },
      lastRestoreTimes: { source: {}, target: {} },
    },
  }
  for (const name of METADATA_STORES) {
    const values = readValues(await store.get(name), name)
    metadata.stores[name] = {
      source: captureValues(values, context, source, name),
      target: captureValues(values, context, target, name),
    }
  }
  await assertContext(store, metadata)
  return metadata
}

async function updateProviderCache(store: Store, metadata: PathMoveMetadata, accepted: Record<string, MetadataValue>): Promise<void> {
  const { default: useSyncStore } = await import('@/stores/sync')
  await assertContext(store, metadata)
  const state = useSyncStore.getState()
  const etags = { ...(metadata.context.provider === 's3' ? state.s3FileEtags : state.webdavFileEtags) }
  for (const path of Object.keys(etags)) {
    if (includesPath(metadata.source, path) || includesPath(metadata.target, path)) delete etags[path]
  }
  for (const [path, version] of Object.entries(accepted)) {
    if (typeof version === 'string' && version) etags[path] = version
  }
  if (metadata.context.provider === 's3') state.setS3FileEtags(etags)
  else state.setWebDAVFileEtags(etags)
}

/** Apply after local success, before uploads. Old GitHub v1 journals remain valid. */
export async function applyPathMoveMetadata(metadata: PathMoveMetadata): Promise<void> {
  validateMetadata(metadata)
  const store = await Store.load('store.json')
  await assertContext(store, metadata)
  const baselines = readValues(await store.get('syncedFileShas'), 'syncedFileShas')
  const snapshot = metadata.stores.syncedFileShas
  // Empty overrides suppress destination legacy entries when there is no baseline.
  const mapped: Record<string, MetadataValue> = { [metadata.target]: '' }
  for (const [path, version] of Object.entries(snapshot.source)) {
    mapped[`${metadata.target}${path.slice(metadata.source.length)}`] = version
  }
  const currentSource = captureValues(baselines, metadata.context, metadata.source, 'syncedFileShas')
  const currentTarget = captureValues(baselines, metadata.context, metadata.target, 'syncedFileShas')
  if ((!sameValues(currentSource, snapshot.source) || !sameValues(currentTarget, snapshot.target))
    && (!sameValues(currentSource, {}) || !sameValues(currentTarget, mapped))) {
    throw new Error('路径迁移期间同步版本发生变化，已保留当前同步元数据')
  }
  for (const name of METADATA_STORES) {
    const values = name === 'syncedFileShas' ? baselines : readValues(await store.get(name), name)
    const before = metadata.stores[name]
    const desired: Record<string, MetadataValue> = name === 'syncedFileShas' ? mapped : Object.create(null)
    if (name !== 'syncedFileShas') {
      for (const [path, time] of Object.entries(before.source)) desired[`${metadata.target}${path.slice(metadata.source.length)}`] = time
    }
    const sourceValues = captureValues(values, metadata.context, metadata.source, name)
    const targetValues = captureValues(values, metadata.context, metadata.target, name)
    if (name !== 'syncedFileShas'
      && (!sameValues(sourceValues, before.source) || !sameValues(targetValues, before.target))) continue
    for (const key of Object.keys(values)) {
      const path = scopedPath(key, metadata.context)
        ?? (metadata.context.workspaceKey === '__default__' && validPath(key) ? key : null)
      if (path && (includesPath(metadata.source, path) || includesPath(metadata.target, path))) delete values[key]
    }
    for (const [path, value] of Object.entries(desired)) values[metadataKey(metadata.context, path)] = value
    await assertContext(store, metadata)
    await store.set(name, values)
  }
  await store.save()
  if (metadata.context.provider === 'webdav' || metadata.context.provider === 's3') await updateProviderCache(store, metadata, mapped)
}

/** MOVE may change an ETag. Rebind only bytes verified unchanged from a version
 * already accepted locally. The final root follows subsequent offline renames. */
export async function rebindPathMoveMetadata(
  metadata: PathMoveMetadata, versions: PathMoveRemoteVersion[], finalTarget = metadata.target,
): Promise<void> {
  validateMetadata(metadata)
  if (!validPath(finalTarget)) throw new Error('路径迁移元数据无效')
  const store = await Store.load('store.json')
  await assertContext(store, metadata)
  const values = readValues(await store.get('syncedFileShas'), 'syncedFileShas')
  const changes: Record<string, string> = Object.create(null)
  const seen = new Set<string>()
  for (const entry of versions) {
    if (!entry || !validPath(entry.source) || !validPath(entry.target)
      || !includesPath(metadata.source, entry.source)
      || entry.target !== `${metadata.target}${entry.source.slice(metadata.source.length)}`
      || (entry.localTarget !== undefined && !validPath(entry.localTarget))
      || typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash)
      || entry.sourceHash !== entry.targetHash || seen.has(entry.source)) throw new Error('远端重命名内容验证无效')
    seen.add(entry.source)
    const captured = metadata.stores.syncedFileShas.source[entry.source]
    const sourceVersion = normalizeRemoteVersion(entry.sourceVersion)
    const targetVersion = normalizeRemoteVersion(entry.targetVersion)
    const target = entry.localTarget ?? `${finalTarget}${entry.source.slice(metadata.source.length)}`
    const key = metadataKey(metadata.context, target)
    const current = Object.prototype.hasOwnProperty.call(values, key) ? values[key]
      : metadata.context.workspaceKey === '__default__' ? values[target] : undefined
    // A remote-only child or an unaccepted remote update never gains authority
    // to overwrite local content merely because the directory was renamed.
    if (typeof captured !== 'string' || !normalizeRemoteVersion(captured)
      || !sourceVersion || !targetVersion || typeof current !== 'string'
      || normalizeRemoteVersion(current) !== sourceVersion) continue
    changes[target] = entry.targetVersion
  }
  if (!Object.keys(changes).length) return
  await assertContext(store, metadata)
  for (const [path, version] of Object.entries(changes)) values[metadataKey(metadata.context, path)] = version
  await store.set('syncedFileShas', values)
  await store.save()
  if (metadata.context.provider === 's3' || metadata.context.provider === 'webdav') {
    const { default: useSyncStore } = await import('@/stores/sync')
    await assertContext(store, metadata)
    const state = useSyncStore.getState()
    if (metadata.context.provider === 's3') state.setS3FileEtags({ ...state.s3FileEtags, ...changes })
    else state.setWebDAVFileEtags({ ...state.webdavFileEtags, ...changes })
  }
}

// Keep the original WebDAV helper name for already-loaded clients.
export const rebindWebDAVPathMoveMetadata = rebindPathMoveMetadata
