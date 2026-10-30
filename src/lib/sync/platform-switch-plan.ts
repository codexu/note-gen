import { normalizeSettingsSnapshot } from './settings-snapshot'
import { openSwitchJournal, readSwitchJournal, assertSwitchBackupPath, type SwitchJournalOperation } from './platform-switch-journal'
import { acquireActiveSwitchBackup } from './platform-switch-backup-retention'
import type { RemoteWriteCondition } from './write-condition'
import { openRemoteContentCache, normalizeRemoteVersion, gitBlobVersion } from './remote-content-cache'
import { parseSyncJson, syncDataError } from './remote-file'
import { syncStaleError, withSyncStaleContext, type SyncStaleDetails } from './sync-stale-error'
import { BaseDirectory, exists, mkdir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { markEditorPathMutation, prepareActiveEditorPathMutationDurably } from '@/lib/editor-deactivation'
import { filterSyncData, shouldExcludeFromSync } from '@/config/sync-exclusions'
import { getFilePathOptions } from '@/lib/workspace'
import { normalizeTagSnapshot, remapRemoteProtectedTags, projectConversationTagsForRemote, invalidateLocalTagSyncIdentity } from '@/lib/tag-sync'
import { recordTagIds } from '@/lib/record-tags'
import { validateRecordSnapshot } from '@/db/record-snapshot'
import type { Mark } from '@/db/marks'
import type { Tag } from '@/db/tags'
import type { CanvasProject } from '@/types/canvas'
import type { SyncPlatform, CloudFolderConfig } from '@/types/sync'
import { supportsCloudFolderWorkspace } from './cloud-folder'
import {
  downloadRemoteBytes, downloadRemoteBytesWithVersion, getRemoteFileMetadata, uploadRemoteBytes, deleteRemoteFile, getRemoteContentType,
  listLocalLibraryFiles, listRemoteLibraryFiles, saveLocalBytes,
  type RemoteRepositoryScope, type RemoteLibraryFile,
} from './remote-library'
import {
  CANVAS_SYNC_PATH, LEGACY_CANVAS_SYNC_PATH, normalizeRemoteCanvasProject,
  parseCanvasSyncIndex, projectToSyncValue,
} from './canvas-sync'
import {
  CONVERSATION_SYNC_INDEX_PATH, LEGACY_CHATS_SYNC_PATH, getPlatformSwitchConversationItems,
  getMessageImageReferences, legacyChatsToItems, parseConversationSyncIndex,
  parseConversationSyncItem, replacePlatformSwitchConversations, acceptPlatformSwitchConversationVersions, acceptPlatformSwitchConversationTagIds, getConversationSyncTagIds, getConversationSyncTagIdentity, type ConversationSyncItem,
} from './conversation-sync'
import { getMarkLocalAssetPaths } from './record-assets'
import { acceptPlatformSwitchTargetData, completePlatformSwitchData, parseAutoDataSyncMeta, parseMemorySyncData, type AutoDataSyncDomain } from './auto-data-sync-queue'
import type { ConversationSyncTombstone } from '@/db/conversation-sync-state'

export type SwitchStrategy = 'merge' | 'local' | 'remote'
export type SwitchResolution = 'local' | 'remote' | 'both'
export type SwitchModule = 'notes' | 'assets' | 'records' | 'tags' | 'canvases' | 'conversations' | 'settings' | 'memories' | 'dataAssets'
const moduleIds: SwitchModule[] = ['notes', 'assets', 'records', 'tags', 'canvases', 'conversations', 'settings', 'memories', 'dataAssets']
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface SnapshotEntry {
  id: string
  label: string
  hash: string
  size: number
  value?: unknown
  file?: { path: string; scope: RemoteRepositoryScope; source: 'workspace' | 'appData' | 'remote'; localPath?: string }
  backup?: string
  cachedContent?: string
  deleted?: boolean
  side?: 'local' | 'remote'
  remoteVersion?: string
  unindexedPath?: string
}
type Snapshot = Record<SwitchModule, SnapshotEntry[]>
export interface SwitchModuleSummary {
  id: SwitchModule
  local: number
  remote: number
  same: number
  localOnly: number
  remoteOnly: number
  conflicts: number
  localBytes: number
  remoteBytes: number
  localMessages: number
  remoteMessages: number
}
export interface SwitchConflict {
  id: string
  module: SwitchModule
  label: string
  local: string
  remote: string
  allowBoth: boolean
}
type RemoteInventoryEntry = RemoteLibraryFile & { scope: RemoteRepositoryScope }

export interface PlatformSwitchPlan {
  platform: SyncPlatform
  target: string
  targetLabel: string
  workspace: string
  local: Snapshot
  remote: Snapshot
  modules: SwitchModuleSummary[]
  conflicts: SwitchConflict[]
  remoteEmpty: boolean
  remoteFiles: number
  remoteInventory: RemoteInventoryEntry[]
  readSummary: { cachedFiles: number; downloadedFiles: number }
  emptyRemoteFiles: string[]
  unavailableModules: SwitchModule[]
  remoteDataFiles: SnapshotEntry[]
  available: SwitchModule[]
  backupPath?: string
  scanCachePath: string
  conversationTombstones: ConversationSyncTombstone[]
  localConversationTombstones: ConversationSyncTombstone[]
  canvasPurged: Array<{ id: string; purgedAt: number }>
  remoteTagIdMap?: Record<string, number>
  excludeSensitiveConfig?: boolean
}
export interface SwitchOperationProgress {
  phase: 'list' | 'scan' | 'compare' | 'validate' | 'backup' | 'apply' | 'verify' | 'start'
  source?: 'local' | 'remote'
  kind?: 'directory' | 'file' | 'module' | 'item'
  activeFiles?: string[]
  fileSize?: number
  processedBytes?: number
  totalBytes?: number
  cachedFiles?: number
  downloadedFiles?: number
  documentProgress?: { current: string; total: string }
  startupTask?: 'refresh' | 'workspace' | 'recover' | 'connect' | 'scanFiles' | 'scanData' | 'prepare' | 'push' | 'pull' | 'apply' | 'bootstrap' | 'save'
  module?: SwitchModule
  path?: string
  current: number
  total: number
}
type OnProgress = (progress: SwitchOperationProgress) => void

function scopedStalePath(path: string, scope?: RemoteRepositoryScope) {
  return scope ? `${scope} / ${path}` : path
}
function diagnosticVersion(version: string | undefined) {
  return normalizeRemoteVersion(version) ?? undefined
}
async function withSwitchStaleContext<T>(task: () => Promise<T>, context: SyncStaleDetails): Promise<T> {
  try { return await task() }
  catch (error) { throw withSyncStaleContext(error, context, true) }
}
function entryDifference(
  expected: SnapshotEntry[], actual: SnapshotEntry[], context: Pick<SyncStaleDetails, 'stage' | 'source'>,
  module?: SwitchModule,
): SyncStaleDetails | undefined {
  const before = new Map(expected.map(entry => [entry.id, entry]))
  const after = new Map(actual.map(entry => [entry.id, entry]))
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(id), current = after.get(id)
    if (old && current && old.hash === current.hash) continue
    const entry = old || current!
    return {
      ...context, path: entry.file ? scopedStalePath(id, entry.file.scope) : module ? `${module} / ${id}` : id,
      check: old && current ? 'content' : 'inventory',
      expected: { sha: old?.hash, size: old?.size, exists: Boolean(old) },
      actual: { sha: current?.hash, size: current?.size, exists: Boolean(current) },
    }
  }
}
function inventoryDifference(
  expected: RemoteInventoryEntry[], actual: RemoteInventoryEntry[], stage: SyncStaleDetails['stage'],
  pathsOnly = false,
): SyncStaleDetails | undefined {
  const key = (entry: RemoteInventoryEntry) => `${entry.scope}:${entry.path}`
  const before = new Map(expected.map(entry => [key(entry), entry]))
  const after = new Map(actual.map(entry => [key(entry), entry]))
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(id), current = after.get(id)
    const versionChanged = old && current && (normalizeRemoteVersion(old.sha) || old.sha) !== (normalizeRemoteVersion(current.sha) || current.sha)
    if (old && current && (pathsOnly || (!versionChanged && (old.size ?? null) === (current.size ?? null)))) continue
    const entry = old || current!
    return {
      stage, source: 'remote', path: scopedStalePath(entry.path, entry.scope),
      check: !old || !current ? 'inventory' : versionChanged ? 'version' : 'size',
      expected: { sha: diagnosticVersion(old?.sha), size: old?.size, exists: Boolean(old) },
      actual: { sha: diagnosticVersion(current?.sha), size: current?.size, exists: Boolean(current) },
    }
  }
}

// Limit read-only work to four workers. Drain every active request before an
// error escapes, so cleanup cannot race with a worker still writing its cache.
async function mapSwitchEntries<T, R>(
  items: readonly T[], describe: (item: T) => Pick<SwitchOperationProgress, 'path' | 'module' | 'source' | 'fileSize'>,
  task: (item: T, index: number) => Promise<R>, onProgress: OnProgress,
  phase: SwitchOperationProgress['phase'] = 'scan',
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  const contexts = items.map(describe)
  const totalBytes = contexts.every(context => context.fileSize !== undefined) ? contexts.reduce((sum, context) => sum + context.fileSize!, 0) : undefined
  const budget = 32 * 1024 * 1024
  let reservedBytes = 0, processedBytes = 0
  const waiting = new Set<() => void>()
  const active = new Map<number, string>()
  let next = 0, completed = 0, failed = false
  let failure: unknown
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++
      const context = contexts[index]
      const cost = Math.min(budget, Math.max(1, context.fileSize ?? 1024 * 1024))
      while (!failed && reservedBytes + cost > budget) await new Promise<void>(resolve => waiting.add(resolve))
      if (failed) return
      reservedBytes += cost
      active.set(index, context.path || '')
      const report = () => onProgress({ phase, kind: 'file', ...context, activeFiles: [...active.values()].filter(Boolean), current: completed, total: items.length, processedBytes, totalBytes })
      try { report(); results[index] = await task(items[index], index); completed++; processedBytes += context.fileSize || 0 }
      catch (error) {
        if (!failed) failure = withSyncStaleContext(error, {
          stage: phase === 'backup' || phase === 'apply' || phase === 'verify' || phase === 'validate' ? phase : 'scan',
          path: context.path, source: context.source, expected: { size: context.fileSize },
        }, true)
        failed = true
      }
      finally {
        active.delete(index)
        reservedBytes -= cost
        for (const resume of waiting) resume()
        waiting.clear()
        if (!failed) {
          try { report() } catch (error) { failure = error; failed = true }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker))
  if (failed) throw failure
  return results
}

export async function disposePlatformSwitchPlan(plan: Pick<PlatformSwitchPlan, 'scanCachePath'>) {
  if (!/^sync-platform-scans\/[a-f0-9-]+$/.test(plan.scanCachePath)) return
  try { await remove(plan.scanCachePath, { baseDir: BaseDirectory.AppData, recursive: true }) }
  catch (error) { console.warn('Failed to remove temporary sync scan cache', error) }
}
const blank = (): Snapshot => ({
  notes: [],
  assets: [],
  records: [],
  tags: [],
  canvases: [],
  conversations: [],
  settings: [],
  memories: [],
  dataAssets: [],
})
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid sync data')
  return value as Record<string, unknown>
}
export function stableSyncValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSyncValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSyncValue((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
async function hash(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}
async function downloadVersionedSnapshot(file: RemoteLibraryFile, scope: RemoteRepositoryScope, platform: SyncPlatform, stage: SyncStaleDetails['stage'] = 'scan') {
  const downloaded = await withSwitchStaleContext(() => downloadRemoteBytesWithVersion(file.path, scope, platform), {
    stage, source: 'remote', path: scopedStalePath(file.path, scope),
    expected: { sha: diagnosticVersion(file.sha), size: file.size, exists: true },
  })
  if (['github', 'gitee', 'gitlab', 'gitea'].includes(platform)) {
    const version = await gitBlobVersion(downloaded.content, file.sha.length === 64 ? 64 : 40)
    if (downloaded.version && normalizeRemoteVersion(downloaded.version) !== version) throw syncStaleError({
      stage, source: 'remote', path: scopedStalePath(file.path, scope), check: 'version',
      expected: { sha: diagnosticVersion(downloaded.version), size: file.size, exists: true },
      actual: { sha: version, size: downloaded.content.length, exists: true },
    })
    return { content: downloaded.content, version }
  }
  return downloaded
}

async function assertRemoteEntryUnchanged(entry: SnapshotEntry, platform: SyncPlatform) {
  const context: SyncStaleDetails = {
    stage: 'apply', source: 'remote', path: scopedStalePath(entry.id, entry.file!.scope),
    expected: { sha: diagnosticVersion(entry.remoteVersion), size: entry.size, exists: true },
  }
  const metadata = await withSwitchStaleContext(() => getRemoteFileMetadata(entry.id, entry.file!.scope, platform), context)
  if (!metadata || (metadata.size !== undefined && metadata.size !== entry.size)) throw syncStaleError({
    ...context, check: metadata ? 'size' : 'inventory',
    actual: { sha: diagnosticVersion(metadata?.version), size: metadata?.size, exists: Boolean(metadata) },
  })
  const expected = normalizeRemoteVersion(entry.remoteVersion)
  const actual = normalizeRemoteVersion(metadata.version)
  if (expected && actual) {
    if (expected !== actual) throw syncStaleError({ ...context, check: 'version', actual: { sha: diagnosticVersion(metadata.version), size: metadata.size, exists: true } })
    return
  }
  // Weak/missing validators cannot prove byte identity.
  const bytes = await withSwitchStaleContext(() => downloadRemoteBytes(entry.id, entry.file!.scope, platform), context)
  const actualHash = await hash(bytes)
  if (actualHash !== entry.hash) throw syncStaleError({
    ...context, check: 'content', expected: { sha: entry.hash, size: entry.size, exists: true },
    actual: { sha: actualHash, size: bytes.length, exists: true },
  })
}

function safePath(path: string) {
  if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '..' || part === '.') || /^[A-Za-z]:/.test(path)) throw new Error(`Unsafe sync path: ${path}`)
  return path
}
async function valueEntry(id: string, label: string, value: unknown): Promise<SnapshotEntry> {
  const serialized = JSON.stringify(value)
  const normalized: unknown = serialized === undefined ? null : JSON.parse(serialized)
  const bytes = encoder.encode(stableSyncValue(normalized))
  return { id, label, value: normalized, hash: await hash(bytes), size: bytes.length }
}
function markEntry(mark: Mark) {
  const sourceId = mark.sourceId || `legacy-record-${mark.id}-${mark.createdAt || 0}`
  return valueEntry(sourceId, mark.desc || mark.content?.slice(0, 80) || String(mark.id), {
    // Only fields persisted by marks/record_tag_metadata participate in a
    // snapshot. Older remote payloads can contain transport-only fields such
    // as syncId, which SQLite does not store and cannot round-trip.
    id: mark.id, tagId: mark.tagId, type: mark.type, sourceId,
    content: mark.content ?? null, desc: mark.desc ?? null, url: mark.url ?? '',
    deleted: mark.deleted ?? 0, createdAt: mark.createdAt ?? null,
    tagIds: recordTagIds(mark), tagUpdatedAt: mark.tagUpdatedAt ?? 0,
  })
}
function tagEntry(tag: Tag) {
  const normalized = normalizeTagSnapshot([tag])[0]
  const value = { id: normalized.id, name: normalized.name, isLocked: normalized.isLocked ?? false, isPin: normalized.isPin ?? false, sortOrder: normalized.sortOrder ?? 0 }
  return valueEntry(String(normalized.id), normalized.name, value)
}
function conversationEntry(item: ConversationSyncItem) {
  const normalized = parseConversationSyncItem(JSON.stringify(item))
  if (!normalized) throw syncDataError('INVALID_SCHEMA', `${CONVERSATION_SYNC_INDEX_PATH}: ${item.syncId}`)
  return valueEntry(normalized.syncId, `${normalized.title} (${normalized.messages.length})`, normalized)
}
async function settingsEntries(values: Record<string, unknown>, excludeSensitiveConfig = true) {
  const settings = (await import('@/stores/setting')).default
  let normalized: Record<string, unknown>
  try { normalized = normalizeSettingsSnapshot(values, Object.fromEntries(Object.entries(settings.getInitialState())), { excludeSensitiveConfig }) }
  catch { throw syncDataError('INVALID_SCHEMA', '.data/settings.json') }
  return Promise.all(Object.entries(normalized).map(([key, value]) => valueEntry(key, key, value)))
}
async function fileEntry(file: NonNullable<SnapshotEntry['file']>, platform?: SyncPlatform): Promise<SnapshotEntry> {
  safePath(file.path)
  if (file.localPath) safePath(file.localPath)
  const entry = { id: file.path, label: file.path, file, hash: '', size: 0 }
  const bytes = await readEntry(entry, platform)
  return { ...entry, hash: await hash(bytes), size: bytes.length }
}
async function readEntry(entry: SnapshotEntry, platform?: SyncPlatform) {
  if (entry.backup) return readFile(entry.backup, { baseDir: BaseDirectory.AppData })
  if (!entry.file) return encoder.encode(JSON.stringify(entry.value))
  if (entry.cachedContent && entry.file.source === 'remote') return readFile(entry.cachedContent, { baseDir: BaseDirectory.AppData })
  const file = entry.file
  if (file.source === 'remote') return downloadRemoteBytes(file.path, file.scope, platform)
  if (file.source === 'appData') return readFile(file.localPath || file.path, { baseDir: BaseDirectory.AppData })
  const options = await getFilePathOptions(file.path)
  return options.baseDir ? readFile(options.path, { baseDir: options.baseDir }) : readFile(options.path)
}
export async function targetIdentity(platform: SyncPlatform) {
  const store = await Store.load('store.json')
  if (platform === 'selfHosted') {
    const database = await import('@/db').then(module => module.getDb())
    const profiles = await database.select<Array<{ id: string; serverUrl: string; instanceId: string | null; accountId: string | null }>>(
      'select id, server_url as serverUrl, instance_id as instanceId, account_id as accountId from self_hosted_sync_profiles order by id',
    )
    return JSON.stringify([platform, profiles])
  }
  if (['github', 'gitee', 'gitlab', 'gitea'].includes(platform)) {
    const { getDataSyncRepoName, getSyncRepoName } = await import('./repo-utils')
    const git = platform as 'github' | 'gitee' | 'gitlab' | 'gitea'
    const workspaceRepo = await getSyncRepoName(git)
    const dataRepo = await getDataSyncRepoName(git)
    return JSON.stringify([platform, await store.get(`${platform}Username`), workspaceRepo, dataRepo,
      await store.get(`${platform}CustomUrl`), await store.get(`${platform}InstanceType`),
      await store.get(`${platform}Branch`), await store.get(`gitlab_${workspaceRepo}_project_id`), await store.get(`gitlab_${dataRepo}_project_id`),
    ])
  }
  // Include credentials only in the in-memory guard, never in the backup manifest or UI.
  return JSON.stringify([platform, await store.get(`${platform}SyncConfig`)])
}
async function targetLabel(platform: SyncPlatform) {
  const store = await Store.load('store.json')
  if (['github', 'gitee', 'gitlab', 'gitea'].includes(platform)) {
    const { getSyncRepoName, getDataSyncRepoName } = await import('./repo-utils')
    const git = platform as 'github' | 'gitee' | 'gitlab' | 'gitea'
    return `${await store.get<string>(`${platform}Username`) || ''}/${await getSyncRepoName(git)} · .data: ${await getDataSyncRepoName(git)}`
  }
  const config = await store.get<Record<string, unknown>>(`${platform}SyncConfig`) || {}
  let address = String(config.url || config.endpoint || config.path || '')
  if (/^https?:\/\//i.test(address)) { const url = new URL(address); address = `${url.origin}${url.pathname}` }
  return [address, config.bucket, config.pathPrefix].filter(Boolean).join(' / ')
}
async function collectLocal(onProgress: OnProgress, includeFiles = true, requested?: SwitchModule[], excludeSensitiveConfig = true): Promise<Snapshot> {
  const result = blank()
  const store = await Store.load('store.json')
  const files = includeFiles ? await listLocalLibraryFiles({ includeStaticAssets: true }) : []
  const entries = await mapSwitchEntries(files, file => ({ source: 'local', module: /\.md$/i.test(file.path) ? 'notes' : 'assets', path: file.path }),
    file => fileEntry({ path: file.path, scope: 'workspace', source: 'workspace' }), onProgress)
  for (const entry of entries) result[/\.md$/i.test(entry.id) ? 'notes' : 'assets'].push(entry)
  const state = (await import('@/stores/setting')).default.getState()
  const includeRecords = requested ? requested.some(id => ['records', 'canvases'].includes(id)) : state.autoRecordSyncEnabled
  const includeTags = includeRecords || (requested ? requested.some(id => ['tags', 'conversations'].includes(id)) : state.autoConversationSyncEnabled)
  if (includeTags) result.tags = await Promise.all((await import('@/db/tags').then(module => module.getTags())).map(tagEntry))
  if (includeRecords) {
    onProgress({ phase: 'scan', source: 'local', kind: 'module', module: 'records', current: 0, total: 0 })
    const { getAllMarks } = await import('@/db/marks')
    const { getCanvasProjects } = await import('@/db/canvases')
    const marks = await getAllMarks()
    result.records = await Promise.all(marks.map(markEntry))
    result.canvases = await Promise.all((await getCanvasProjects({ includeDeleted: true })).map(project => valueEntry(project.id, project.title, projectToSyncValue(project))))
    const paths = new Set(marks.flatMap(getMarkLocalAssetPaths))
    if (includeFiles) result.dataAssets.push(...await mapSwitchEntries([...paths], path => ({ source: 'local', module: 'dataAssets', path }),
      path => fileEntry({ path: `.data/assets/records/${safePath(path)}`, localPath: path, scope: 'data', source: 'appData' }), onProgress))
  }
  if (requested ? requested.some(id => ['settings', 'memories'].includes(id)) : state.autoSettingsSyncEnabled) {
    onProgress({ phase: 'scan', source: 'local', kind: 'module', module: 'settings', current: 0, total: 0 })
    await import('@/stores/setting').then(module => module.flushChangedSyncableSettingsPersist())
    result.settings = await settingsEntries(Object.fromEntries(await store.entries()), excludeSensitiveConfig)
    const { getMemorySyncData } = await import('@/db/memories')
    const data = await getMemorySyncData()
    result.memories = await Promise.all(data.memories.map(memory => valueEntry(memory.id, memory.content.slice(0, 80), memory)))
    result.memories.push(await valueEntry('__policy__', 'policy', data.policy))
  }
  if (requested ? requested.includes('conversations') : state.autoConversationSyncEnabled) {
    onProgress({ phase: 'scan', source: 'local', kind: 'module', module: 'conversations', current: 0, total: 0 })
    const items = await getPlatformSwitchConversationItems()
    result.conversations = await Promise.all(items.map(conversationEntry))
    const paths = new Set(items.flatMap(item => item.messages.flatMap(getMessageImageReferences)))
    if (includeFiles) result.dataAssets.push(...await mapSwitchEntries([...paths], path => ({ source: 'local', module: 'dataAssets', path }),
      path => fileEntry({ path: `.data/assets/conversations/${path.split('/').pop()}`, localPath: path, scope: 'data', source: 'appData' }), onProgress))
  }
  return result
}

async function collectRemote(platform: SyncPlatform, onProgress: OnProgress, scanCachePath: string, identity: string, local: Snapshot, reuse?: PlatformSwitchPlan, excludeSensitiveConfig = true) {
  const result = blank()
  let remoteTagIdMap: Record<string, number> = {}
  const workspaceFiles = await withSwitchStaleContext(() => listRemoteLibraryFiles({ platform, includeStaticAssets: true, onListProgress: (path, files) => onProgress({ phase: 'list', source: 'remote', kind: 'directory', path, current: files, total: 0 }) }), { stage: 'scan', source: 'remote', path: 'workspace', check: 'inventory' })
  const dataFiles = await withSwitchStaleContext(() => listRemoteLibraryFiles({ platform, scope: 'data', onListProgress: (path, files) => onProgress({ phase: 'list', source: 'remote', kind: 'directory', path, current: files, total: 0 }) }), { stage: 'scan', source: 'remote', path: 'data', check: 'inventory' })
  const contentCache = await openRemoteContentCache(identity)
  contentCache.reconcileInventory('workspace', workspaceFiles)
  contentCache.reconcileInventory('data', dataFiles)
  const inventory: RemoteInventoryEntry[] = [
    ...workspaceFiles.map(file => ({ ...file, scope: 'workspace' as const })),
    ...dataFiles.map(file => ({ ...file, scope: 'data' as const })),
  ]
  let cachedFiles = 0, downloadedFiles = 0
  const report: OnProgress = value => onProgress({ ...value, cachedFiles, downloadedFiles })
  const readRemote = async (file: RemoteLibraryFile, scope: RemoteRepositoryScope) => {
    const result = await withSwitchStaleContext(() => contentCache.read(scope, safePath(file.path), file.sha, file.size,
      () => downloadVersionedSnapshot(file, scope, platform)), {
      stage: 'scan', source: 'remote', path: scopedStalePath(file.path, scope),
      expected: { sha: diagnosticVersion(file.sha), size: file.size, exists: true },
    })
    if (result.reused) cachedFiles++; else downloadedFiles++
    return result
  }
  try {
    const byPath = new Map(dataFiles.map(file => [safePath(file.path), file]))
    const previousFiles = new Map<string, SnapshotEntry>(reuse ? moduleIds.flatMap(id => reuse.remote[id]).filter(entry => entry.file).map((entry): [string, SnapshotEntry] => [`${entry.file!.scope}:${entry.id}`, entry]) : [])
    const sameVersion = (entry: SnapshotEntry | undefined, file: RemoteLibraryFile | undefined) => Boolean(entry && file && normalizeRemoteVersion(file.sha) && entry.remoteVersion === normalizeRemoteVersion(file.sha) && (file.size === undefined || entry.size === file.size))
    const remoteFile = async (file: RemoteLibraryFile, scope: RemoteRepositoryScope) => {
      const old = previousFiles.get(`${scope}:${file.path}`)
      if (sameVersion(old, file)) { cachedFiles++; return { ...old!, backup: undefined } }
      const loaded = await readRemote(file, scope)
      const bytes = loaded.bytes
      const cachedContent = `${scanCachePath}/${await hash(encoder.encode(`${scope}:${file.path}`))}.bin`
      await writeFile(cachedContent, bytes, { baseDir: BaseDirectory.AppData })
      return { id: file.path, label: file.path, hash: loaded.hash, size: bytes.length, file: { path: file.path, scope, source: 'remote' as const }, remoteVersion: loaded.version, cachedContent }
    }
    const rawFiles = new Map<string, SnapshotEntry>()
    const emptyRemoteFiles: string[] = []
    const unavailableModules: SwitchModule[] = []
    const jsonValues = new Map<string, unknown>()
    const json = async (path: string, notify = true): Promise<unknown | null> => {
      if (!byPath.has(path)) return null
      if (jsonValues.has(path)) return jsonValues.get(path) ?? null
      const old = reuse?.remoteDataFiles.find(entry => entry.id === path)
      if (reuse?.emptyRemoteFiles.includes(path) && old?.size === 0 && sameVersion(old, byPath.get(path))) {
        cachedFiles++
        rawFiles.set(path, { ...old!, backup: undefined })
        emptyRemoteFiles.push(path)
        unavailableModules.push(path === '.data/marks.json' ? 'records' : 'tags')
        jsonValues.set(path, null)
        return null
      }
      if (old?.value && sameVersion(old, byPath.get(path))) {
        cachedFiles++
        rawFiles.set(path, { ...old, backup: undefined }); jsonValues.set(path, old.value)
        return old.value
      }
      if (notify) report({ phase: 'scan', source: 'remote', kind: 'file', path, current: rawFiles.size, total: dataFiles.length })
      const loaded = await readRemote(byPath.get(path)!, 'data')
      const bytes = loaded.bytes
      const cachedContent = `${scanCachePath}/${await hash(encoder.encode(`data:${path}`))}.bin`
      await writeFile(cachedContent, bytes, { baseDir: BaseDirectory.AppData })
      const snapshot: SnapshotEntry = { cachedContent, id: path, label: path, hash: loaded.hash, size: bytes.length, remoteVersion: loaded.version, file: { path, scope: 'data', source: 'remote' } }
      rawFiles.set(path, snapshot)
      if (notify) report({ phase: 'scan', source: 'remote', kind: 'file', path, current: rawFiles.size, total: dataFiles.length })
      // Old releases allowed zero-byte record/tag placeholders. Treat them as an
      // unavailable snapshot, never as authoritative empty data for replacement.
      const listed = byPath.get(path)!
      // GitLab trees omit sizes. A matching Git blob ID still proves these
      // bytes are a genuine empty file, rather than a truncated response.
      const verifiedEmpty = bytes.length === 0 && (listed.size === 0
        || (listed.size === undefined && ['github', 'gitee', 'gitlab', 'gitea'].includes(platform)
          && normalizeRemoteVersion(listed.sha) === await gitBlobVersion(bytes, listed.sha.length === 64 ? 64 : 40)))
      if (verifiedEmpty && (path === '.data/marks.json' || path === '.data/tags.json')) {
        emptyRemoteFiles.push(path)
        unavailableModules.push(path === '.data/marks.json' ? 'records' : 'tags')
        jsonValues.set(path, null)
        return null
      }
      const text = decoder.decode(bytes).replace(/^\uFEFF/, '')
      const array = path === '.data/marks.json' || path === '.data/tags.json' || path === LEGACY_CANVAS_SYNC_PATH || path === LEGACY_CHATS_SYNC_PATH
      const value = parseSyncJson<unknown>(text, `${platform} / ${path}`, array ? 'array' : 'object')
      if (path === '.data/meta.json' && !parseAutoDataSyncMeta(text)) throw syncDataError('INVALID_SCHEMA', `${platform} / ${path}`)
      rawFiles.set(path, { ...snapshot, value })
      jsonValues.set(path, value)
      return value
    }
    const collectUnindexedItems = async (
      module: 'canvases' | 'conversations', directory: string, deleted: Set<string>,
      parse: (value: unknown, path: string, id: string) => Promise<SnapshotEntry>,
    ) => {
      // An interrupted publish can leave an item without its index entry.
      // Capture every existing canonical destination before preview/backup,
      // rather than treating an unreferenced file as a create-only write.
      const candidates = new Map<string, string>([...local[module], ...result[module]].map(entry => [`${directory}/${safePath(entry.id)}.json`, entry.id]))
      const files = dataFiles.filter(file => candidates.has(file.path))
      const recovered = await mapSwitchEntries(files, file => ({ source: 'remote', module, path: file.path, fileSize: file.size }), async (file): Promise<SnapshotEntry | undefined> => {
        const id = candidates.get(file.path)!
        if (deleted.has(id)) {
          // A failed deletion can also leave an item behind. Preserve its bytes
          // for an explicitly chosen replacement, without undoing the deletion.
          if (!rawFiles.has(file.path)) rawFiles.set(file.path, await remoteFile(file, 'data'))
          return undefined
        }
        // Validate even an already-read path: a noncanonical index entry may
        // reference this destination while naming a different logical object.
        const entry = await parse(await json(file.path, false), file.path, id)
        const indexed = result[module].find(item => item.id === id)
        if (indexed && indexed.hash !== entry.hash) {
          // There are two different remote versions in addition to the local
          // version. The existing two-way conflict UI cannot choose safely.
          throw syncStaleError({
            stage: 'scan', source: 'remote', path: scopedStalePath(file.path, 'data'), check: 'unindexed',
            expected: { sha: indexed.hash, size: indexed.size, exists: true },
            actual: { sha: entry.hash, size: entry.size, exists: true },
          })
        }
        return indexed ? undefined : { ...entry, unindexedPath: file.path }
      }, report)
      // Only potential destinations are considered. Unrelated unreferenced
      // files remain untouched rather than becoming active data automatically.
      result[module].push(...recovered.filter((entry): entry is SnapshotEntry => entry !== undefined))
    }
    const workspaceEntries = await mapSwitchEntries(workspaceFiles, file => ({ source: 'remote', module: /\.md$/i.test(file.path) ? 'notes' : 'assets', path: file.path, fileSize: file.size }),
      file => remoteFile(file, 'workspace'), report)
    for (const entry of workspaceEntries) result[/\.md$/i.test(entry.id) ? 'notes' : 'assets'].push(entry)
    const state = (await import('@/stores/setting')).default.getState()
    if (state.autoRecordSyncEnabled || state.autoConversationSyncEnabled) {
      let tags: Tag[]
      try { tags = normalizeTagSnapshot(await json('.data/tags.json') || []) }
      catch (error) {
        if (error instanceof Error && error.message.startsWith('SYNC_DATA_')) throw error
        throw syncDataError('INVALID_SCHEMA', `${platform} / .data/tags.json`)
      }
      // SQLite keeps this device's default tags immutable. Translate remote
      // IDs and all their references together instead of requiring providers
      // to have allocated identical numeric IDs for those defaults.
      const localTags = local.tags.map(entry => entry.value) as Tag[]
      const reconciled = remapRemoteProtectedTags(tags, localTags, reuse?.remoteTagIdMap || await getConversationSyncTagIds(platform), await getConversationSyncTagIdentity(platform))
      remoteTagIdMap = reconciled.ids
      // Conversation-only imports add dependencies without deleting labels used
      // by local records outside the selected synchronization scope.
      const dependencies = state.autoRecordSyncEnabled ? reconciled.tags : [...new Map([
        ...reconciled.tags.map(tag => [tag.id, tag] as const), ...localTags.map(tag => [tag.id, tag] as const),
      ]).values()]
      result.tags = await Promise.all(dependencies.map(tagEntry))
    }
    if (state.autoRecordSyncEnabled) {
      const marks = await json('.data/marks.json') || []
      try { validateRecordSnapshot(marks) }
      catch { throw syncDataError('INVALID_SCHEMA', `${platform} / .data/marks.json`) }
      if (marks.some(mark => recordTagIds(mark).some(id => remoteTagIdMap[String(id)] === undefined))) throw new Error('SYNC_SWITCH_MISSING_REFERENCE')
      result.records = await Promise.all(marks.map(mark => markEntry({ ...mark,
        tagId: remoteTagIdMap[String(mark.tagId)] ?? mark.tagId,
        tagIds: mark.tagIds?.map(id => remoteTagIdMap[String(id)] ?? id),
      })))
      const indexValue = await json(CANVAS_SYNC_PATH)
      const index = indexValue ? parseCanvasSyncIndex(JSON.stringify(indexValue)) : null
      if (indexValue && !index) throw syncDataError('INVALID_SCHEMA', `${platform} / ${CANVAS_SYNC_PATH}`)
      const legacy = index ? [] : await json(LEGACY_CANVAS_SYNC_PATH) || []
      if (!Array.isArray(legacy)) throw new Error('Invalid legacy canvases')
      const projects: CanvasProject[] = []
      for (const value of index ? await mapSwitchEntries(index.canvases, entry => ({ source: 'remote', module: 'canvases', path: entry.path, fileSize: byPath.get(entry.path)?.size }), async entry => {
        if (!entry.path.startsWith('.data/canvases/items/')) throw new Error('Invalid canvas item path')
        const data = await json(entry.path, false)
        if (!data || record(data).id !== entry.id) throw new Error(`Missing canvas: ${entry.path}`)
        return data
      }, report) : legacy) {
        const project = normalizeRemoteCanvasProject(value)
        if (!project) throw syncDataError('INVALID_SCHEMA', `${platform} / ${CANVAS_SYNC_PATH}`)
        projects.push(project)
      }
      result.canvases = await Promise.all(projects.map(project => valueEntry(project.id, project.title, projectToSyncValue(project))))
      await collectUnindexedItems('canvases', '.data/canvases/items', new Set(index?.purged.map(entry => entry.id)), async (value, path, id) => {
        const project = normalizeRemoteCanvasProject(value)
        if (!project || project.id !== id) throw syncDataError('INVALID_SCHEMA', `${platform} / ${path}`)
        return valueEntry(project.id, project.title, projectToSyncValue(project))
      })
    }
    if (state.autoSettingsSyncEnabled) {
      result.settings = await settingsEntries(record(await json('.data/settings.json') || {}), excludeSensitiveConfig)
      const value = await json('.data/memories.json')
      const data = value ? parseMemorySyncData(JSON.stringify(value)) : null
      if (value && !data) throw syncDataError('INVALID_SCHEMA', `${platform} / .data/memories.json`)
      if (data) {
        result.memories = await Promise.all(data.memories.map(memory => valueEntry(memory.id, memory.content.slice(0, 80), memory)))
      }
      const policy = data?.policy || await import('@/db/memory-policy').then(module => module.getMemoryPolicy())
      result.memories.push(await valueEntry('__policy__', 'policy', policy))
    }
    const indexValue = state.autoConversationSyncEnabled ? await json(CONVERSATION_SYNC_INDEX_PATH) : null
    const index = indexValue ? parseConversationSyncIndex(JSON.stringify(indexValue)) : null
    if (indexValue && !index) throw syncDataError('INVALID_SCHEMA', `${platform} / ${CONVERSATION_SYNC_INDEX_PATH}`)
    if (state.autoConversationSyncEnabled) {
      const items = index ? await mapSwitchEntries(index.conversations, entry => ({ source: 'remote', module: 'conversations', path: entry.path, fileSize: byPath.get(entry.path)?.size }), async entry => {
        if (!entry.path.startsWith('.data/conversations/items/')) throw new Error('Invalid conversation item path')
        const item = parseConversationSyncItem(JSON.stringify(await json(entry.path, false)))
        if (!item || item.syncId !== entry.syncId) throw new Error(`Missing conversation: ${entry.path}`)
        return item
      }, report) : byPath.has(LEGACY_CHATS_SYNC_PATH) ? legacyChatsToItems(JSON.stringify(await json(LEGACY_CHATS_SYNC_PATH))) : []
      result.conversations = await Promise.all(items.map(conversationEntry))
      await collectUnindexedItems('conversations', '.data/conversations/items', new Set(index?.deleted.filter(entry => entry.entityType === 'conversation').map(entry => entry.syncId)), async (value, path, id) => {
        const item = parseConversationSyncItem(JSON.stringify(value))
        if (!item || item.syncId !== id) throw syncDataError('INVALID_SCHEMA', `${platform} / ${path}`)
        return conversationEntry(item)
      })
      result.conversations = await Promise.all(result.conversations.map(async entry => {
        const item = entry.value as ConversationSyncItem
        if (item.messages.some(message => message.tagId != null && message.tagId !== 0
          && remoteTagIdMap[String(message.tagId)] === undefined)) throw new Error('SYNC_SWITCH_MISSING_REFERENCE')
        return { ...entry, ...await conversationEntry({ ...item, messages: item.messages.map(message => ({ ...message,
          tagId: message.tagId === undefined ? undefined : remoteTagIdMap[String(message.tagId)] ?? message.tagId,
        })) }) }
      }))
      if (!state.autoRecordSyncEnabled) {
        const needed = new Set([...local.tags.map(entry => Number(entry.id)), ...result.conversations.flatMap(entry =>
          (entry.value as ConversationSyncItem).messages.flatMap(message => message.tagId ? [message.tagId] : []))])
        result.tags = result.tags.filter(entry => needed.has(Number(entry.id)))
      }
    }
    const assets = dataFiles.filter(file => (state.autoRecordSyncEnabled && file.path.startsWith('.data/assets/records/')) || (state.autoConversationSyncEnabled && file.path.startsWith('.data/assets/conversations/')))
    result.dataAssets = await mapSwitchEntries(assets, file => ({ source: 'remote', module: 'dataAssets', path: file.path, fileSize: file.size }), file => remoteFile(file, 'data'), report)
    const canvasIndex = state.autoRecordSyncEnabled ? await json(CANVAS_SYNC_PATH) : null
    if (byPath.has('.data/meta.json')) await json('.data/meta.json')
    return { snapshot: result, inventory, files: workspaceFiles.length + dataFiles.length, readSummary: { cachedFiles, downloadedFiles }, rawFiles: [...rawFiles.values()], emptyRemoteFiles, unavailableModules, tombstones: index?.deleted || [], purged: canvasIndex ? parseCanvasSyncIndex(JSON.stringify(canvasIndex))?.purged || [] : [], remoteTagIdMap }
  } finally { await contentCache.commit() }
}

function checkUnique(snapshot: Snapshot) {
  for (const id of moduleIds) {
    if (new Set(snapshot[id].map(entry => entry.id)).size !== snapshot[id].length) throw new Error(`Duplicate sync identities: ${id}`)
  }
}
function summary(local: SnapshotEntry[], remote: SnapshotEntry[], id: SwitchModule): SwitchModuleSummary {
  const left = new Map(local.map(entry => [entry.id, entry]))
  const right = new Map(remote.map(entry => [entry.id, entry]))
  return { id, local: local.length, remote: remote.length,
    same: local.filter(entry => right.get(entry.id)?.hash === entry.hash).length,
    localOnly: local.filter(entry => !right.has(entry.id)).length,
    remoteOnly: remote.filter(entry => !left.has(entry.id)).length,
    conflicts: local.filter(entry => right.has(entry.id) && right.get(entry.id)?.hash !== entry.hash).length,
    localBytes: local.reduce((n, entry) => n + entry.size, 0), remoteBytes: remote.reduce((n, entry) => n + entry.size, 0),
    localMessages: id === 'conversations' ? local.reduce((n, entry) => n + (entry.deleted ? 0 : (entry.value as ConversationSyncItem).messages.length), 0) : 0,
    remoteMessages: id === 'conversations' ? remote.reduce((n, entry) => n + (entry.deleted ? 0 : (entry.value as ConversationSyncItem).messages.length), 0) : 0,
  }
}
async function preview(entry: SnapshotEntry, platform: SyncPlatform) {
  if (entry.file) {
    const metadata = `${entry.file.path}\n${entry.size} bytes\nSHA-256: ${entry.hash}`
    if (/\.md$/i.test(entry.file.path)) return `${metadata}\n\n${decoder.decode(await readEntry(entry, platform))}`
    return metadata
  }
  return `${entry.unindexedPath ? `${entry.unindexedPath}\n\n` : ''}${JSON.stringify(entry.value, null, 2)}`
}
export async function inspectPlatformSwitchPlan(platform: SyncPlatform, onProgress: OnProgress, reuse?: PlatformSwitchPlan): Promise<PlatformSwitchPlan> {
  const chat = (await import('@/stores/chat')).default.getState()
  if (chat.loading || chat.agentState.isRunning) throw new Error('SYNC_SWITCH_CHAT_BUSY')
  const store = await Store.load('store.json')
  const target = await targetIdentity(platform)
  const label = await targetLabel(platform)
  const workspace = await store.get<string>('workspacePath') || ''
  const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
  const scanCachePath = reuse?.scanCachePath || `sync-platform-scans/${crypto.randomUUID()}`
  await mkdir(scanCachePath, { baseDir: BaseDirectory.AppData, recursive: true })
  try {
    const local = await collectLocal(onProgress, true, undefined, excludeSensitiveConfig)
    const remote = await collectRemote(platform, onProgress, scanCachePath, JSON.stringify([target, workspace]), local, reuse, excludeSensitiveConfig)
    const localConversationTombstones = await import('@/db/conversation-sync-state').then(module => module.getConversationSyncTombstones())
    // Deletions are compared explicitly, rather than resurrecting deleted objects as "unique" content.
    for (const tombstone of remote.tombstones.filter(item => item.entityType === 'conversation')) {
      if (!remote.snapshot.conversations.some(entry => entry.id === tombstone.syncId)) remote.snapshot.conversations.push({ ...await valueEntry(tombstone.syncId, `${tombstone.syncId} (deleted)`, tombstone), deleted: true })
    }
    for (const tombstone of localConversationTombstones.filter(item => item.entityType === 'conversation')) {
      if (!local.conversations.some(entry => entry.id === tombstone.syncId)) local.conversations.push({ ...await valueEntry(tombstone.syncId, `${tombstone.syncId} (deleted)`, tombstone), deleted: true })
    }
    for (const purge of remote.purged) {
      if (!remote.snapshot.canvases.some(entry => entry.id === purge.id)) remote.snapshot.canvases.push({ ...await valueEntry(purge.id, `${purge.id} (deleted)`, purge), deleted: true })
    }
    const state = (await import('@/stores/setting')).default.getState()
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    const workspaceSupported = platform !== 'cloudFolder' || Boolean(config && supportsCloudFolderWorkspace(config))
    const available: SwitchModule[] = workspaceSupported ? ['notes', 'assets'] : []
    if (state.autoRecordSyncEnabled || state.autoConversationSyncEnabled) available.push('tags')
    if (state.autoRecordSyncEnabled) available.push('records', 'canvases')
    if (state.autoConversationSyncEnabled) available.push('conversations')
    if (state.autoRecordSyncEnabled || state.autoConversationSyncEnabled) available.push('dataAssets')
    if (state.autoSettingsSyncEnabled) available.push('settings', 'memories')
    if (!workspaceSupported) {
      local.notes = []; local.assets = []
    }
    checkUnique(local); checkUnique(remote.snapshot)
    for (const id of moduleIds) {
      local[id].forEach(entry => { entry.side = 'local' })
      remote.snapshot[id].forEach(entry => { entry.side = 'remote' })
    }
    onProgress({ phase: 'compare', kind: 'module', current: 0, total: moduleIds.length })
    const conflicts: SwitchConflict[] = reuse ? reuse.conflicts : []
    for (const [moduleIndex, moduleId] of (reuse ? [] : moduleIds).entries()) {
      onProgress({ phase: 'compare', kind: 'module', module: moduleId, current: moduleIndex, total: moduleIds.length })
      const right = new Map(remote.snapshot[moduleId].map(entry => [entry.id, entry]))
      for (const entry of local[moduleId]) {
        const other = right.get(entry.id)
        if (other && other.hash !== entry.hash) conflicts.push({ id: `${moduleId}:${entry.id}`, module: moduleId, label: entry.label, local: await preview(entry, platform), remote: await preview(other, platform), allowBoth: !entry.deleted && !other.deleted && (moduleId === 'notes' || moduleId === 'canvases' || moduleId === 'conversations') })
      }
    }
    return { platform, target, targetLabel: label, workspace, scanCachePath, local, remote: remote.snapshot,
      modules: available.map(id => summary(local[id], remote.snapshot[id], id)), conflicts, available,
      remoteEmpty: remote.files === 0, remoteFiles: remote.files, remoteInventory: remote.inventory, readSummary: remote.readSummary, remoteDataFiles: remote.rawFiles,
      emptyRemoteFiles: remote.emptyRemoteFiles, unavailableModules: remote.unavailableModules,
      conversationTombstones: remote.tombstones, localConversationTombstones, canvasPurged: remote.purged, remoteTagIdMap: remote.remoteTagIdMap, excludeSensitiveConfig,
    }
  } catch (error) {
    if (!reuse) await disposePlatformSwitchPlan({ scanCachePath })
    throw error
  }
}

export function platformSwitchImpact(plan: PlatformSwitchPlan, strategy: SwitchStrategy, selected: SwitchModule[], resolutions: Record<string, SwitchResolution>) {
  const n = plan.modules.filter(row => selected.includes(row.id)).reduce((sum, row) => ({ localOnly: sum.localOnly + row.localOnly, remoteOnly: sum.remoteOnly + row.remoteOnly, conflicts: sum.conflicts + row.conflicts }), { localOnly: 0, remoteOnly: 0, conflicts: 0 })
  let localReplace = 0, remoteReplace = 0, both = 0
  for (const conflict of plan.conflicts.filter(item => selected.includes(item.module))) {
    if (resolutions[conflict.id] === 'local') remoteReplace++
    if (resolutions[conflict.id] === 'remote') localReplace++
    if (resolutions[conflict.id] === 'both') both++
  }
  return {
    localAdd: strategy === 'local' ? 0 : n.remoteOnly + (strategy === 'merge' ? both : 0),
    remoteAdd: strategy === 'remote' ? 0 : n.localOnly + (strategy === 'merge' ? both : 0),
    localReplace: strategy === 'remote' ? n.conflicts : strategy === 'merge' ? localReplace : 0,
    remoteReplace: strategy === 'local' ? n.conflicts : strategy === 'merge' ? remoteReplace : 0,
    localRemove: strategy === 'remote' ? n.localOnly : 0, remoteRemove: strategy === 'local' ? n.remoteOnly : 0,
  }
}

function resolveSnapshot(plan: PlatformSwitchPlan, strategy: SwitchStrategy, selected: SwitchModule[], resolutions: Record<string, SwitchResolution>): Snapshot {
  const result = blank()
  for (const moduleId of selected) {
    if (strategy !== 'merge') { result[moduleId] = [...(strategy === 'local' ? plan.local[moduleId] : plan.remote[moduleId])].filter(entry => !entry.deleted); continue }
    const entries = new Map(plan.local[moduleId].map(entry => [entry.id, entry]))
    for (const remote of plan.remote[moduleId]) {
      const local = entries.get(remote.id)
      if (!local) { entries.set(remote.id, remote); continue }
      if (local.hash === remote.hash) continue
      const resolution = resolutions[`${moduleId}:${remote.id}`]
      if (!resolution) throw new Error('Resolve all conflicts before switching')
      if (resolution === 'remote') entries.set(remote.id, remote)
      if (resolution === 'both') {
        if (!['notes', 'canvases', 'conversations'].includes(moduleId)) throw new Error('This module requires one value')
        const id = crypto.randomUUID()
        const copy = structuredClone(remote)
        if (copy.file) {
          const path = remote.id.replace(/(\.[^/.]+)?$/, ` (remote-${id.slice(0, 8)})$1`)
          copy.id = path
          // The source remains the original path; the entry ID is its destination.
        } else {
          const value = record(copy.value)
          if (moduleId === 'conversations') {
            value.syncId = id
            const item = value as unknown as ConversationSyncItem
            item.messages = item.messages.map(message => ({ ...message, syncId: crypto.randomUUID() }))
            item.messageTombstones = []; item.compaction = null
          } else value.id = id
          value.title = `${String(value.title)} (remote)`
          copy.id = id
        }
        entries.set(copy.id, copy)
      }
    }
    result[moduleId] = [...entries.values()].filter(entry => !entry.deleted)
  }
  return result
}

function inventoryFingerprint(files: RemoteInventoryEntry[]) {
  return stableSyncValue(files.map(file => [file.scope, file.path, normalizeRemoteVersion(file.sha) || file.sha, file.size ?? null])
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))))
}

/** Recheck identities and bytes immediately before writing; stale previews never execute. */
export async function revalidatePlatformSwitchPlan(plan: PlatformSwitchPlan, onProgress: OnProgress) {
  const fresh = await withSwitchStaleContext(() => inspectPlatformSwitchPlan(plan.platform, value => onProgress({ ...value, phase: 'validate' }), plan), { stage: 'validate' })
  const fingerprint = (snapshot: Snapshot) => stableSyncValue(moduleIds.map(id => [id, snapshot[id].map(entry => [entry.id, entry.hash]).sort()]))
  // Keep the same comparisons and order, but identify the first changed entry.
  // Target identities can contain credentials; report only safe config names.
  if (fresh.target !== plan.target) throw syncStaleError({ stage: 'validate', path: 'syncTarget', check: 'configuration' })
  if (fresh.workspace !== plan.workspace) throw syncStaleError({ stage: 'validate', source: 'local', path: 'workspace', check: 'configuration' })
  if (fresh.available.join() !== plan.available.join()) throw syncStaleError({ stage: 'validate', path: 'availableModules', check: 'configuration' })
  if ((fresh.excludeSensitiveConfig !== false) !== (plan.excludeSensitiveConfig !== false)) throw syncStaleError({ stage: 'validate', path: 'excludeSensitiveConfig', check: 'configuration' })
  if (inventoryFingerprint(fresh.remoteInventory) !== inventoryFingerprint(plan.remoteInventory)) {
    throw syncStaleError(inventoryDifference(plan.remoteInventory, fresh.remoteInventory, 'validate') || { stage: 'validate', source: 'remote', check: 'inventory' })
  }
  for (const source of ['local', 'remote'] as const) {
    if (fingerprint(fresh[source]) !== fingerprint(plan[source])) {
      for (const moduleId of moduleIds) {
        const difference = entryDifference(plan[source][moduleId], fresh[source][moduleId], { stage: 'validate', source }, moduleId)
        if (difference) throw syncStaleError(difference)
      }
      throw syncStaleError({ stage: 'validate', source, check: 'content' })
    }
  }
  if (stableSyncValue(fresh.remoteDataFiles.map(entry => [entry.id, entry.hash]).sort()) !== stableSyncValue(plan.remoteDataFiles.map(entry => [entry.id, entry.hash]).sort())) {
    throw syncStaleError(entryDifference(plan.remoteDataFiles, fresh.remoteDataFiles, { stage: 'validate', source: 'remote' }) || { stage: 'validate', source: 'remote', path: 'data', check: 'content' })
  }
}

export async function backupPlatformSwitchPlan(plan: PlatformSwitchPlan, onProgress: OnProgress) {
  const path = `sync-platform-backups/${Date.now()}-${crypto.randomUUID()}`
  // The caller holds this lease through execution and recovery persistence,
  // including the window before the new path appears in the recovery marker.
  const release = await acquireActiveSwitchBackup(path)
  try {
    await mkdir(path, { baseDir: BaseDirectory.AppData, recursive: true })
    const files = [...moduleIds.flatMap(id => plan.local[id]), ...moduleIds.flatMap(id => plan.remote[id]), ...plan.remoteDataFiles].filter(entry => entry.file)
    const groups = new Map<string, SnapshotEntry[]>()
    for (const entry of files) groups.set(entry.hash, [...(groups.get(entry.hash) || []), entry])
    await mapSwitchEntries([...groups.values()], entries => ({ path: entries[0].id, fileSize: entries[0].size, source: entries[0].file?.source === 'remote' ? 'remote' : 'local' }), async (entries, index) => {
      const entry = entries[0]
      const context: SyncStaleDetails = { stage: 'backup', source: entry.file?.source === 'remote' ? 'remote' : 'local', path: scopedStalePath(entry.id, entry.file?.scope) }
      const bytes = await withSwitchStaleContext(() => readEntry(entry, plan.platform), context)
      const actualHash = await hash(bytes)
      if (actualHash !== entry.hash) throw syncStaleError({
        ...context, check: 'content', expected: { sha: entry.hash, size: entry.size, exists: true },
        actual: { sha: actualHash, size: bytes.length, exists: true },
      })
      const backup = `${path}/${index}.bin`
      await writeFile(backup, bytes, { baseDir: BaseDirectory.AppData })
      for (const entry of entries) { entry.backup = backup; delete entry.cachedContent }
    }, onProgress, 'backup')
    const { target: _target, scanCachePath: _scanCachePath, ...manifest } = plan
    void _target; void _scanCachePath
    await writeFile(`${path}/manifest.json`, encoder.encode(JSON.stringify({ ...manifest, backupPath: path, version: 1 })), { baseDir: BaseDirectory.AppData })
    await openSwitchJournal(path, plan.workspace)
    plan.backupPath = path
    return release
  } catch (error) {
    try { await remove(path, { baseDir: BaseDirectory.AppData, recursive: true }) }
    catch (cleanupError) { console.warn('Failed to clean incomplete sync backup', cleanupError) }
    await release()
    throw error
  }
}

async function applyLocalData(snapshot: Snapshot, selected: SwitchModule[], tombstones: ConversationSyncTombstone[], excludeSensitiveConfig = true) {
  if (selected.includes('records')) {
    const marks = snapshot.records.map(entry => entry.value) as Mark[]
    const tags = snapshot.tags.map(entry => entry.value) as Tag[]
    validateRecordSnapshot(marks)
    await import('@/db/record-snapshot').then(module => module.replaceRecordSnapshot(marks, normalizeTagSnapshot(tags)))
  } else if (selected.includes('tags')) {
    const { tagSnapshotStatements } = await import('@/db/record-snapshot')
    const { getDb, executeRecordTransaction } = await import('@/db')
    const tags = normalizeTagSnapshot(snapshot.tags.map(entry => entry.value))
    const ids = tags.map(tag => tag.id)
    const db = await getDb()
    const removed = await db.select<Array<{ id: number }>>(`select id from tags where id not in (select value from json_each($1))
      and lower(trim(cast(isLocked as text))) not in ('1','true')`, [JSON.stringify(ids)])
    const removedIds = JSON.stringify(removed.map(tag => tag.id))
    const referenced = await db.select<Array<{ count: number }>>(`select count(*) as count from (
      select id from marks where tagId in (select value from json_each($1)) or exists (
        select 1 from record_tag_metadata metadata, json_each(metadata.tagIds) related
        where metadata.markId = marks.id and related.value in (select value from json_each($1)))
      union all select id from chats where tagId in (select value from json_each($1)))`, [removedIds])
    if (referenced[0]?.count) throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
    // Avoid the tag-deletion trigger for retained labels: even re-inserting an
    // identical tag would first trash records outside this selected scope.
    await executeRecordTransaction([...tagSnapshotStatements(tags, true, false),
      { sql: `delete from tags where id in (select value from json_each($1)) and isLocked = false
          and not exists (select 1 from marks where marks.tagId = tags.id or exists (
            select 1 from record_tag_metadata metadata, json_each(metadata.tagIds) related
            where metadata.markId = marks.id and related.value = tags.id))
          and not exists (select 1 from chats where chats.tagId = tags.id)`, values: [removedIds], expectedRows: removed.length }])
  }
  if (selected.includes('canvases')) {
    const projects = snapshot.canvases.map(entry => normalizeRemoteCanvasProject(entry.value))
    if (projects.some(project => !project)) throw new Error('Invalid canvas snapshot')
    await import('@/db/canvases').then(module => module.replaceAllCanvasProjects(projects.filter((project): project is CanvasProject => project !== null)))
  }
  if (selected.includes('conversations')) await replacePlatformSwitchConversations(snapshot.conversations.map(entry => entry.value) as ConversationSyncItem[], tombstones)
  const store = await Store.load('store.json')
  if (selected.includes('settings')) {
    const all = Object.fromEntries(await store.entries())
    const values = filterSyncData(Object.fromEntries(snapshot.settings.map(entry => [entry.id, entry.value])), { excludeSensitiveConfig })
    for (const key of Object.keys(filterSyncData(all, { excludeSensitiveConfig }))) if (!(key in values)) await store.delete(key)
    for (const [key, value] of Object.entries(values)) await store.set(key, value)
    await store.save()
    await import('@/stores/setting').then(module => module.default.getState().initSettingData({ hydrateOnly: true }))
  }
  if (selected.includes('memories')) {
    const policy = snapshot.memories.find(entry => entry.id === '__policy__')?.value || (await import('@/db/memories').then(module => module.getMemorySyncData())).policy
    const data = { schemaVersion: 1, policy, memories: snapshot.memories.filter(entry => entry.id !== '__policy__').map(entry => entry.value) }
    const parsed = parseMemorySyncData(JSON.stringify(data))
    if (!parsed) throw new Error('Invalid memory snapshot')
    await import('@/db/memories').then(module => module.replaceMemorySyncData(parsed))
  }
}

async function wireFiles(snapshot: Snapshot, selected: SwitchModule[], plan: PlatformSwitchPlan) {
  const files = new Map<string, Uint8Array>()
  const put = (path: string, value: unknown) => files.set(path, encoder.encode(JSON.stringify(value)))
  if (selected.includes('records')) put('.data/marks.json', snapshot.records.map(entry => entry.value))
  const tagProjection = selected.includes('tags')
    ? projectConversationTagsForRemote(snapshot.tags.map(entry => entry.value) as Tag[],
      plan.remoteDataFiles.find(entry => entry.id === '.data/tags.json')?.value as Tag[] || [], plan.remoteTagIdMap || {}, selected.includes('records')) : null
  if (selected.includes('records') && tagProjection) put('.data/marks.json', (snapshot.records.map(entry => entry.value) as Mark[]).map(mark => ({
    ...mark, tagId: tagProjection.localToRemote[String(mark.tagId)],
    tagIds: mark.tagIds?.map(id => tagProjection.localToRemote[String(id)]),
  })))
  if (selected.includes('tags')) put('.data/tags.json', tagProjection?.tags || snapshot.tags.map(entry => entry.value))
  if (selected.includes('settings')) put('.data/settings.json', Object.fromEntries(snapshot.settings.map(entry => [entry.id, entry.value])))
  if (selected.includes('memories')) {
    const policy = snapshot.memories.find(entry => entry.id === '__policy__')?.value || (await import('@/db/memories').then(module => module.getMemorySyncData())).policy
    put('.data/memories.json', { schemaVersion: 1, policy, memories: snapshot.memories.filter(entry => entry.id !== '__policy__').map(entry => entry.value) })
  }
  if (selected.includes('canvases')) {
    const projects = snapshot.canvases.map(entry => record(entry.value))
    for (const project of projects) put(`.data/canvases/items/${safePath(String(project.id))}.json`, project)
    put(CANVAS_SYNC_PATH, { format: 'notegen-canvases-index', version: 1, updatedAt: Date.now(), purged: plan.canvasPurged.filter(entry => !projects.some(project => project.id === entry.id)), canvases: projects.map(({ document: _document, ...project }) => { void _document; return { ...project, path: `.data/canvases/items/${project.id}.json` } }) })
  }
  if (selected.includes('conversations')) {
    const items = (snapshot.conversations.map(entry => entry.value) as ConversationSyncItem[]).map(item => tagProjection ? {
      ...item, messages: item.messages.map(message => ({ ...message,
        tagId: message.tagId == null || message.tagId === 0 ? message.tagId : tagProjection.localToRemote[String(message.tagId)],
      })),
    } : item)
    for (const item of items) put(`.data/conversations/items/${safePath(item.syncId)}.json`, item)
    put(CONVERSATION_SYNC_INDEX_PATH, { format: 'notegen-conversations-index', version: 1, updatedAt: Date.now(), deleted: plan.conversationTombstones.filter(entry => !items.some(item => item.syncId === entry.syncId)), conversations: items.map(item => ({ syncId: item.syncId, syncUpdatedAt: item.syncUpdatedAt, title: item.title, createdAt: item.createdAt, updatedAt: item.updatedAt, messageCount: item.messages.length, isPinned: item.isPinned, path: `.data/conversations/items/${item.syncId}.json` })) })
  }
  for (const [path, bytes] of files) {
    const old = plan.remoteDataFiles.find(entry => entry.id === path)
    if (!old?.value) continue
    const value = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>
    const stripIndexClock = (item: unknown) => {
      if (![CANVAS_SYNC_PATH, CONVERSATION_SYNC_INDEX_PATH].includes(path)) return item
      const { updatedAt: _updatedAt, ...rest } = record(item)
      void _updatedAt
      return rest
    }
    if (stableSyncValue(stripIndexClock(value)) === stableSyncValue(stripIndexClock(old.value))) {
      files.set(path, await readEntry(old, plan.platform))
    }
  }
  return files
}

function switchConversationTombstones(plan: PlatformSwitchPlan, strategy: SwitchStrategy, resolved: Snapshot) {
  const chosen = strategy === 'local' ? plan.localConversationTombstones : strategy === 'remote' ? plan.conversationTombstones : [...plan.localConversationTombstones, ...plan.conversationTombstones]
  const active = new Set(resolved.conversations.flatMap(entry => [entry.id, ...(entry.value as ConversationSyncItem).messages.map(message => message.syncId)]))
  return chosen.filter(entry => !active.has(entry.syncId))
}

export async function preparePlatformSwitchDecision(plan: PlatformSwitchPlan, strategy: SwitchStrategy, selected: SwitchModule[], resolutions: Record<string, SwitchResolution>) {
  if (strategy === 'remote' && plan.unavailableModules.some(module => selected.includes(module))) throw new Error('SYNC_SWITCH_UNAVAILABLE_REMOTE_DATA')
  const resolved = resolveSnapshot(plan, strategy, selected, resolutions)
  if (selected.includes('tags') && !selected.includes('conversations')) {
    // Replacing records must retain labels still used by local conversations
    // whose synchronization was not selected.
    const db = await import('@/db').then(module => module.getDb())
    const referenced = await db.select<Array<{ tagId: number }>>('select distinct tagId from chats where tagId > 0')
    const needed = new Set(referenced.map(message => message.tagId))
    const present = new Set(resolved.tags.map(entry => Number(entry.id)))
    resolved.tags.push(...plan.local.tags.filter(entry => needed.has(Number(entry.id)) && !present.has(Number(entry.id))))
  }
  // Allocate record IDs once, before generating either the local snapshot or wire files.
  if (strategy === 'merge' && selected.includes('records')) {
    const localIds = new Map(plan.local.records.map(entry => [entry.id, (entry.value as Mark).id]))
    const remoteRecords = new Map(plan.remote.records.map(entry => [entry.id, entry.value as Mark]))
    const used = new Set(resolved.records.flatMap(entry => localIds.has(entry.id) ? [localIds.get(entry.id)!] : []))
    const remoteIds = new Map<number, number>()
    let next = [...used].reduce((max, id) => Math.max(max, id), resolved.records.reduce((max, entry) => Math.max(max, (entry.value as Mark).id), 0))
    resolved.records = await Promise.all(resolved.records.map(async entry => {
      const mark = entry.value as Mark
      const id = localIds.get(entry.id) ?? (used.has(mark.id) ? ++next : mark.id)
      used.add(id)
      const remoteMark = remoteRecords.get(entry.id)
      if (remoteMark) remoteIds.set(remoteMark.id, id)
      return valueEntry(entry.id, entry.label, { ...mark, id })
    }))
    const remapReferences = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(remapReferences)
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'recordId' && typeof item === 'number' ? remoteIds.get(item) ?? item : remapReferences(item)]))
    }
    resolved.canvases = await Promise.all(resolved.canvases.map(entry => entry.side === 'remote' ? valueEntry(entry.id, entry.label, remapReferences(entry.value)) : entry))
  }
  for (const moduleId of selected) {
    if (moduleId === 'settings') {
      // A field-by-field merge must still round-trip as one persisted settings
      // snapshot, including aliases/defaults and local-only field exclusions.
      resolved.settings = await settingsEntries(Object.fromEntries(resolved.settings.map(entry => [entry.id, entry.value])), plan.excludeSensitiveConfig !== false)
      continue
    }
    resolved[moduleId] = await Promise.all(resolved[moduleId].map(async entry => {
      if (entry.file) return entry
      const normalized = moduleId === 'conversations' ? await conversationEntry(entry.value as ConversationSyncItem)
        : moduleId === 'records' ? await markEntry(entry.value as Mark)
          : moduleId === 'tags' ? await tagEntry(entry.value as Tag)
            : await valueEntry(entry.id, entry.label, entry.value)
      return { ...entry, ...normalized }
    }))
  }
  // Validate the complete desired state before any side is modified.
  if (selected.includes('records') || selected.includes('conversations')) {
    if (!selected.includes('tags')) throw new Error('SYNC_SWITCH_MISSING_REFERENCE')
    const tags = normalizeTagSnapshot(resolved.tags.map(entry => entry.value))
    const tagIds = new Set(tags.map(tag => tag.id))
    if (selected.includes('conversations')) for (const entry of resolved.conversations) {
      for (const message of (entry.value as ConversationSyncItem).messages) {
        // Zero is the legacy unassigned-message sentinel, never a real tag ID.
        if (message.tagId != null && message.tagId !== 0
          && (!Number.isSafeInteger(message.tagId) || !tagIds.has(message.tagId))) throw new Error('SYNC_SWITCH_MISSING_REFERENCE')
      }
    }
    if (selected.includes('records')) {
      validateRecordSnapshot(resolved.records.map(entry => entry.value))
      for (const entry of resolved.records) {
        const mark = entry.value as Mark
        if (!tagIds.has(mark.tagId) || mark.tagIds?.some(id => !tagIds.has(id))) throw new Error('SYNC_SWITCH_MISSING_REFERENCE')
      }
    }
  }
  if (resolved.conversations.some(entry => !parseConversationSyncItem(JSON.stringify(entry.value)))) throw new Error('Invalid conversation data')
  if (resolved.canvases.some(entry => !normalizeRemoteCanvasProject(entry.value))) throw syncDataError('INVALID_SCHEMA', `${plan.platform} / ${CANVAS_SYNC_PATH}`)
  const messageIds = new Set<string>()
  for (const entry of resolved.conversations) for (const message of (entry.value as ConversationSyncItem).messages) {
    if (messageIds.has(message.syncId)) throw new Error('Duplicate conversation message identities')
    messageIds.add(message.syncId)
  }
  if (selected.includes('memories')) {
    const policy = resolved.memories.find(entry => entry.id === '__policy__')?.value || (await import('@/db/memories').then(module => module.getMemorySyncData())).policy
    if (!parseMemorySyncData(JSON.stringify({ schemaVersion: 1, policy, memories: resolved.memories.filter(entry => entry.id !== '__policy__').map(entry => entry.value) }))) throw new Error('Invalid memory snapshot')
  }
  if (strategy !== 'remote') {
    const touched: SnapshotEntry[] = []
    let creates = false
    for (const moduleId of selected) {
      for (const entry of resolved[moduleId].filter(entry => entry.file)) {
        const old = plan.remote[moduleId].find(old => old.id === entry.id)
        if (old?.hash === entry.hash) continue
        if (old) touched.push(old); else creates = true
      }
      if (strategy === 'local') touched.push(...plan.remote[moduleId].filter(entry => entry.file && !resolved[moduleId].some(item => item.id === entry.id)))
    }
    for (const [path, bytes] of await wireFiles(resolved, selected, { ...plan, conversationTombstones: switchConversationTombstones(plan, strategy, resolved) })) {
      const old = plan.remoteDataFiles.find(entry => entry.id === path)
      const listed = plan.remoteInventory.find(file => file.scope === 'data' && file.path === path)
      if (!old && listed) throw syncStaleError({
        stage: 'validate', source: 'remote', path: scopedStalePath(path, 'data'), check: 'inventory',
        expected: { exists: false }, actual: { sha: diagnosticVersion(listed.sha), size: listed.size, exists: true },
      })
      if (old?.hash === await hash(bytes)) continue
      if (old) touched.push(old); else creates = true
    }
    if (creates || touched.length) {
      if (plan.platform === 'cloudFolder' && (await (await Store.load('store.json')).get<CloudFolderConfig>('cloudFolderSyncConfig'))?.provider !== 'oneDrive') throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
      const meta = plan.remoteDataFiles.find(entry => entry.id === '.data/meta.json')
      if (meta) touched.push(meta)
      if (touched.some(entry => !normalizeRemoteVersion(entry.remoteVersion))) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
    }
  }
  return resolved
}

export async function executePlatformSwitchPlan(plan: PlatformSwitchPlan, strategy: SwitchStrategy, selected: SwitchModule[], resolutions: Record<string, SwitchResolution>, onProgress: OnProgress) {
  const targetPlatform = plan.platform
  if (targetPlatform === 'local' || targetPlatform === 'selfHosted') throw new Error('Unsupported platform switch plan')
  if (!plan.backupPath) throw new Error('A recoverable backup is required')
  if (await targetIdentity(plan.platform) !== plan.target) throw syncStaleError({ stage: 'apply', path: 'syncTarget', check: 'configuration' })
  const resolved = await preparePlatformSwitchDecision(plan, strategy, selected, resolutions)
  const allFiles = selected.flatMap(id => resolved[id].filter(entry => entry.file))
  const tombstones = switchConversationTombstones(plan, strategy, resolved)
  const effectivePlan = { ...plan, conversationTombstones: tombstones }
  const wires = await wireFiles(resolved, selected, effectivePlan)
  const expectedInventory = new Map<string, RemoteInventoryEntry>(plan.remoteInventory.map(file => [`${file.scope}:${file.path}`, file]))
  const remoteWrites = new Set<string>()
  const assertRemoteAbsent = async (path: string, scope: RemoteRepositoryScope) => {
    const context: SyncStaleDetails = { stage: 'apply', source: 'remote', path: scopedStalePath(path, scope), check: 'inventory', expected: { exists: false } }
    const metadata = await withSwitchStaleContext(() => getRemoteFileMetadata(path, scope, plan.platform), context)
    if (metadata) throw syncStaleError({ ...context, actual: { sha: diagnosticVersion(metadata.version), size: metadata.size, exists: true } })
  }
  const recordRemoteWrite = (path: string, scope: RemoteRepositoryScope) => {
    const key = `${scope}:${path}`
    remoteWrites.add(key)
    expectedInventory.set(key, { path, scope, sha: '' })
  }
  const journal = await openSwitchJournal(plan.backupPath, plan.workspace, await readSwitchJournal(plan.backupPath))
  const applyMutation = async <T>(operation: Omit<SwitchJournalOperation, 'id' | 'completed'>, task: () => Promise<T>) => {
    const report = () => onProgress({ phase: 'apply', source: operation.side, path: operation.path, current, total })
    // Cancellation stops between complete journaled units, never inside a
    // database transaction, file replacement or in-flight conditional request.
    report()
    const result = await withSwitchStaleContext(() => journal.run(operation, task), {
      stage: 'apply', source: operation.side, path: scopedStalePath(operation.path, operation.scope),
      expected: operation.action === 'module' ? undefined : { sha: operation.before, exists: operation.before !== undefined },
    })
    report()
    return result
  }
  const conditionFor = (entry: SnapshotEntry | undefined): RemoteWriteCondition => {
    if (!entry) return { version: null }
    const version = normalizeRemoteVersion(entry.remoteVersion)
    if (!version) throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
    return { version }
  }
  const writeRemote = async (path: string, bytes: Uint8Array, scope: RemoteRepositoryScope, old?: SnapshotEntry) => {
    onProgress({ phase: 'apply', source: 'remote', kind: 'file', path, current, total })
    await applyMutation({ side: 'remote', action: 'write', path, scope, before: old?.hash, after: await hash(bytes) },
      () => withSwitchStaleContext(() => uploadRemoteBytes(path, bytes, `Switch sync platform: ${path}`, getRemoteContentType(path), scope, conditionFor(old), targetPlatform), {
        stage: 'apply', source: 'remote', path: scopedStalePath(path, scope), check: 'version',
        expected: { sha: diagnosticVersion(old?.remoteVersion), size: old?.size, exists: Boolean(old) },
      }))
    recordRemoteWrite(path, scope)
  }
  const total = allFiles.length + wires.size
  let current = 0
  // Assets are published before any documents or indexes that reference them.
  for (const entry of [...allFiles].sort((a, b) => Number(/\.md$/i.test(a.id)) - Number(/\.md$/i.test(b.id)))) {
    onProgress({ phase: 'apply', path: entry.id, current: current++, total })
    const scope = entry.file!.scope
    const oldRemote = selected.flatMap(id => plan.remote[id]).find(old => old.id === entry.id && old.file?.scope === scope)
    const oldLocal = selected.flatMap(id => plan.local[id]).find(old => old.id === entry.id && old.file?.scope === scope)
    if (oldRemote?.hash === entry.hash && (strategy === 'local' || oldLocal?.hash === entry.hash)) continue
    if (oldRemote && (strategy === 'remote' || oldRemote.hash === entry.hash)) await assertRemoteEntryUnchanged(oldRemote, plan.platform)
    const bytes = await withSwitchStaleContext(() => readEntry(entry, plan.platform), {
      stage: 'apply', source: entry.file!.source === 'remote' ? 'remote' : 'local', path: scopedStalePath(entry.id, scope),
    })
    if (strategy !== 'remote' && oldRemote?.hash !== entry.hash) {
      if (!oldRemote) await assertRemoteAbsent(entry.id, scope)
      await writeRemote(entry.id, bytes, scope, oldRemote)
    }
    if (strategy !== 'local') {
      if (scope === 'workspace') {
        const article = (await import('@/stores/article')).default.getState()
        if (!await prepareActiveEditorPathMutationDurably(article.activeFilePath, [entry.id])) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
        const original = plan.local.notes.concat(plan.local.assets).find(old => old.id === entry.id)
        if (original) {
          const currentBytes = await readEntry({ ...original, backup: undefined })
          const currentHash = await hash(currentBytes)
          if (currentHash !== original.hash) throw syncStaleError({
            stage: 'apply', source: 'local', path: scopedStalePath(entry.id, scope), check: 'content',
            expected: { sha: original.hash, size: original.size, exists: true },
            actual: { sha: currentHash, size: currentBytes.length, exists: true },
          })
        }
        if (!original) {
          const options = await getFilePathOptions(entry.id)
          if (options.baseDir ? await exists(options.path, { baseDir: options.baseDir }) : await exists(options.path)) throw syncStaleError({
            stage: 'apply', source: 'local', path: scopedStalePath(entry.id, scope), check: 'inventory', expected: { exists: false }, actual: { exists: true },
          })
        }
        markEditorPathMutation(entry.id)
        await applyMutation({ side: 'local', action: 'write', path: entry.id, scope, before: original?.hash, after: entry.hash }, () => saveLocalBytes(entry.id, bytes, { platform: targetPlatform }))
        markEditorPathMutation(entry.id)
        if (/\.md$/i.test(entry.id)) emitter.emit('sync-content-updated', { path: entry.id, content: decoder.decode(bytes) })
      }
      else {
        const path = entry.file!.localPath || (entry.id.startsWith('.data/assets/records/') ? entry.id.slice('.data/assets/records/'.length) : `conversation-assets/${entry.id.split('/').pop()}`)
        safePath(path)
        if (await exists(path, { baseDir: BaseDirectory.AppData })) {
          const old = plan.local.dataAssets.find(item => item.id === entry.id)
          const currentBytes = await readFile(path, { baseDir: BaseDirectory.AppData })
          const currentHash = await hash(currentBytes)
          if (currentHash !== (old?.hash || entry.hash)) throw syncStaleError({
            stage: 'apply', source: 'local', path: scopedStalePath(path, scope), check: 'content',
            expected: { sha: old?.hash || entry.hash, size: (old || entry).size, exists: true },
            actual: { sha: currentHash, size: currentBytes.length, exists: true },
          })
        }
        await mkdir(path.split('/').slice(0, -1).join('/'), { baseDir: BaseDirectory.AppData, recursive: true })
        const old = plan.local.dataAssets.find(item => item.id === entry.id)
        await applyMutation({ side: 'local', action: 'write', path, scope, before: old?.hash, after: entry.hash }, () => writeFile(path, bytes, { baseDir: BaseDirectory.AppData }))
      }
    }
  }
  if (strategy !== 'local') {
    const localModules = selected.filter(id => !['notes', 'assets', 'dataAssets'].includes(id)
      && (id !== 'tags' || !selected.includes('records')))
      .sort((a, b) => (a === 'tags' ? 0 : a === 'records' ? 1 : 2) - (b === 'tags' ? 0 : b === 'records' ? 1 : 2))
    for (const [moduleIndex, moduleId] of localModules.entries()) {
      const group: SwitchModule[] = moduleId === 'records' ? ['records', 'tags'] : [moduleId]
      const snapshotHash = (snapshot: Snapshot) => stableSyncValue(group.map(id => [id, snapshot[id].filter(entry => !entry.deleted).map(entry => [entry.id, entry.hash]).sort()]))
      if (snapshotHash(plan.local) === snapshotHash(resolved)) continue
      onProgress({ phase: 'apply', source: 'local', kind: 'module', module: moduleId, current: moduleIndex, total: localModules.length })
      // Recheck the local domain immediately before replacing it.
      const local = await collectLocal(() => {}, false, group, plan.excludeSensitiveConfig !== false)
      if (snapshotHash(local) !== snapshotHash(plan.local)) {
        const difference = group.map(id => entryDifference(plan.local[id].filter(entry => !entry.deleted), local[id].filter(entry => !entry.deleted), { stage: 'apply', source: 'local' }, id)).find(item => item !== undefined)
        throw syncStaleError(difference || { stage: 'apply', source: 'local', path: moduleId, check: 'content' })
      }
      await applyMutation({ side: 'local', action: 'module', path: moduleId, before: snapshotHash(plan.local), after: snapshotHash(resolved) },
        () => applyLocalData(resolved, group, tombstones, plan.excludeSensitiveConfig !== false))
    }
  }
  if (strategy !== 'remote') for (const [path, bytes] of wires) {
    onProgress({ phase: 'apply', path, current: current++, total })
    const old = plan.remoteDataFiles.find(entry => entry.id === path)
    if (!old || old.hash !== await hash(bytes)) {
      if (!old) await assertRemoteAbsent(path, 'data')
      await writeRemote(path, bytes, 'data', old)
    }
  }
  // One-sided modes mirror the selected workspace scope. Every removed byte is backed up.
  if (strategy !== 'merge') {
    const destination = strategy === 'local' ? plan.remote : plan.local
    for (const moduleId of selected) for (const entry of destination[moduleId]) {
      if (!entry.file || resolved[moduleId].some(item => item.id === entry.id)) continue
      if (strategy === 'local') {
        await applyMutation({ side: 'remote', action: 'delete', path: entry.id, scope: entry.file.scope, before: entry.hash }, async () => {
          if (!await withSwitchStaleContext(() => deleteRemoteFile(entry.id, entry.file!.scope, conditionFor(entry), targetPlatform), {
            stage: 'apply', source: 'remote', path: scopedStalePath(entry.id, entry.file!.scope), check: 'version',
            expected: { sha: diagnosticVersion(entry.remoteVersion), size: entry.size, exists: true },
          })) throw new Error(`Failed to remove remote file: ${entry.id}`)
        })
        expectedInventory.delete(`${entry.file.scope}:${entry.id}`)
        remoteWrites.add(`${entry.file.scope}:${entry.id}`)
      } else if (entry.file.scope === 'workspace') {
        const article = (await import('@/stores/article')).default.getState()
        if (!await prepareActiveEditorPathMutationDurably(article.activeFilePath, [entry.id])) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
        const currentBytes = await readEntry({ ...entry, backup: undefined })
        const currentHash = await hash(currentBytes)
        if (currentHash !== entry.hash) throw syncStaleError({
          stage: 'apply', source: 'local', path: scopedStalePath(entry.id, entry.file.scope), check: 'content',
          expected: { sha: entry.hash, size: entry.size, exists: true },
          actual: { sha: currentHash, size: currentBytes.length, exists: true },
        })
        const options = await getFilePathOptions(entry.id)
        markEditorPathMutation(entry.id)
        await applyMutation({ side: 'local', action: 'delete', path: entry.id, scope: 'workspace', before: entry.hash }, async () => {
          if (options.baseDir) await remove(options.path, { baseDir: options.baseDir }); else await remove(options.path)
        })
        await article.cleanTabsByDeletedFile(entry.id)
      }
      // Orphaned AppData assets are retained locally for recovery, outside the active snapshot.
    }
  }
  const domains: AutoDataSyncDomain[] = []
  if (selected.includes('records')) domains.push('records')
  if (selected.includes('settings')) domains.push('settings')
  if (selected.includes('conversations')) domains.push('conversations')
  const changedDomains = domains.filter(domain => [...remoteWrites].some(key => {
    if (!key.startsWith('data:')) return false
    const path = key.slice('data:'.length)
    if (domain === 'records') return path === '.data/marks.json' || path === '.data/tags.json' || path.startsWith('.data/canvases/') || path.startsWith('.data/assets/records/')
    if (domain === 'settings') return path === '.data/settings.json' || path === '.data/memories.json'
    return path.startsWith('.data/conversations/') || path.startsWith('.data/assets/conversations/')
  }))
  if (strategy !== 'remote' && changedDomains.length) await completePlatformSwitchData(changedDomains, async content => {
    const path = '.data/meta.json'
    const bytes = encoder.encode(content)
    await writeRemote(path, bytes, 'data', plan.remoteDataFiles.find(entry => entry.id === path))
    wires.set(path, bytes)
  }, targetPlatform)
  const reportInventory = (path: string, files: number) => onProgress({ phase: 'verify', source: 'remote', kind: 'directory', path, current: files, total: 0 })
  onProgress({ phase: 'verify', source: 'remote', kind: 'directory', current: 0, total: 0 })
  const workspaceInventory = await withSwitchStaleContext(() => listRemoteLibraryFiles({ platform: plan.platform, includeStaticAssets: true, onListProgress: reportInventory }), { stage: 'verify', source: 'remote', path: 'workspace', check: 'inventory' })
  const dataInventory = await withSwitchStaleContext(() => listRemoteLibraryFiles({ platform: plan.platform, scope: 'data', onListProgress: reportInventory }), { stage: 'verify', source: 'remote', path: 'data', check: 'inventory' })
  const currentRemote = new Map<string, RemoteLibraryFile>([
    ...workspaceInventory.map(file => [`workspace:${file.path}`, file] as const),
    ...dataInventory.map(file => [`data:${file.path}`, file] as const),
  ])
  // Compare path sets, not counts: a concurrent addition plus deletion is still
  // a change. Account for our own writes/deletes before comparing versions.
  if (currentRemote.size !== expectedInventory.size) throw syncStaleError(inventoryDifference([...expectedInventory.values()], [
    ...workspaceInventory.map(file => ({ ...file, scope: 'workspace' as const })),
    ...dataInventory.map(file => ({ ...file, scope: 'data' as const })),
  ], 'verify', true) || { stage: 'verify', source: 'remote', check: 'inventory' })
  for (const [key, expected] of expectedInventory) {
    const actual = currentRemote.get(key)
    const context: SyncStaleDetails = {
      stage: 'verify', source: 'remote', path: scopedStalePath(expected.path, expected.scope),
      expected: { sha: diagnosticVersion(expected.sha), size: expected.size, exists: true },
      actual: { sha: diagnosticVersion(actual?.sha), size: actual?.size, exists: Boolean(actual) },
    }
    if (!actual) throw syncStaleError({ ...context, check: 'inventory' })
    if (!remoteWrites.has(key) && ((normalizeRemoteVersion(actual.sha) || actual.sha) !== (normalizeRemoteVersion(expected.sha) || expected.sha)
      || actual.size !== expected.size)) throw syncStaleError({
      ...context, check: (normalizeRemoteVersion(actual.sha) || actual.sha) !== (normalizeRemoteVersion(expected.sha) || expected.sha) ? 'version' : 'size',
    })
  }
  const originalRemote = new Map<string, SnapshotEntry>([
    ...selected.flatMap(id => plan.remote[id]).filter(entry => entry.file).map(entry => [`${entry.file!.scope}:${entry.id}`, entry] as const),
    ...plan.remoteDataFiles.map(entry => [`data:${entry.id}`, entry] as const),
  ])
  const verifiedCache = await openRemoteContentCache(JSON.stringify([plan.target, plan.workspace]))
  verifiedCache.reconcileInventory('workspace', workspaceInventory)
  verifiedCache.reconcileInventory('data', dataInventory)
  let cachedFiles = 0, downloadedFiles = 0
  const verificationProgress: OnProgress = value => onProgress({ ...value, cachedFiles, downloadedFiles })
  const verifyRemote = async (path: string, scope: RemoteRepositoryScope, expectedHash: string, expectedSize?: number) => {
    const metadata = currentRemote.get(`${scope}:${path}`)
    if (!metadata) throw syncStaleError({
      stage: 'verify', source: 'remote', path: scopedStalePath(path, scope), check: 'inventory',
      expected: { sha: expectedHash, size: expectedSize, exists: true }, actual: { exists: false },
    })
    const previous = originalRemote.get(`${scope}:${path}`)
    const version = normalizeRemoteVersion(metadata.sha)
    if (previous?.hash === expectedHash && version && previous.remoteVersion === version
      && (metadata.size === undefined || metadata.size === previous.size)) {
      cachedFiles++
      return
    }
    const loaded = await withSwitchStaleContext(() => verifiedCache.read(scope, path, metadata.sha, metadata.size,
      () => downloadVersionedSnapshot(metadata, scope, plan.platform, 'verify')), {
      stage: 'verify', source: 'remote', path: scopedStalePath(path, scope),
      expected: { sha: diagnosticVersion(metadata.sha), size: metadata.size, exists: true },
    })
    if (loaded.reused) cachedFiles++; else downloadedFiles++
    if (loaded.hash !== expectedHash) throw syncStaleError({
      stage: 'verify', source: 'remote', path: scopedStalePath(path, scope), check: 'content',
      expected: { sha: expectedHash, size: expectedSize, exists: true },
      actual: { sha: loaded.hash, size: loaded.bytes.length, exists: true },
    })
  }
  try {
    await mapSwitchEntries(allFiles, entry => ({ source: 'remote', path: entry.id, fileSize: entry.size }), async entry => {
      await verifyRemote(entry.id, entry.file!.scope, entry.hash, entry.size)
      if (strategy !== 'local') {
        const localFile = { ...entry, backup: undefined, file: { ...entry.file!, path: entry.id, source: entry.file!.scope === 'workspace' ? 'workspace' as const : 'appData' as const, localPath: entry.file!.scope === 'data' ? entry.file!.localPath || (entry.id.startsWith('.data/assets/records/') ? entry.id.slice('.data/assets/records/'.length) : `conversation-assets/${entry.id.split('/').pop()}`) : undefined } }
        const bytes = await readEntry(localFile)
        const actualHash = await hash(bytes)
        if (actualHash !== entry.hash) throw syncStaleError({
          stage: 'verify', source: 'local', path: scopedStalePath(entry.id, entry.file!.scope), check: 'content',
          expected: { sha: entry.hash, size: entry.size, exists: true },
          actual: { sha: actualHash, size: bytes.length, exists: true },
        })
      }
    }, verificationProgress, 'verify')
    if (strategy !== 'remote') await mapSwitchEntries([...wires], ([path, bytes]) => ({ source: 'remote', path, fileSize: bytes.length }), async ([path, bytes]) => {
      await verifyRemote(path, 'data', await hash(bytes), bytes.length)
    }, verificationProgress, 'verify')
  } finally { await verifiedCache.commit() }
  if (strategy !== 'merge') {
    const actual = strategy === 'local' ? workspaceInventory : await listLocalLibraryFiles({ includeStaticAssets: true })
    const expected = new Set(allFiles.filter(entry => entry.file!.scope === 'workspace').map(entry => entry.id))
    if (actual.some(file => selected.includes(/\.md$/i.test(file.path) ? 'notes' : 'assets') && !expected.has(file.path))) {
      const extra = actual.find(file => selected.includes(/\.md$/i.test(file.path) ? 'notes' : 'assets') && !expected.has(file.path))!
      throw syncStaleError({
        stage: 'verify', source: strategy === 'local' ? 'remote' : 'local', path: scopedStalePath(extra.path, 'workspace'), check: 'inventory',
        expected: { exists: false }, actual: { exists: true },
      })
    }
  }
  // Verify persisted structured content as well as transferred bytes.
  const actualLocal = await collectLocal(value => onProgress({ ...value, phase: 'verify' }), false, selected, plan.excludeSensitiveConfig !== false)
  for (const moduleId of selected.filter(id => !['notes', 'assets', 'dataAssets'].includes(id))) {
    onProgress({ phase: 'verify', source: 'local', kind: 'module', module: moduleId, current: selected.indexOf(moduleId), total: selected.length })
    const normalize = async (entries: SnapshotEntry[]) => {
      // Compare persistence semantics at the verification boundary as well as
      // during collection. A snapshot retained across hot reloads, or produced
      // by a legacy reader, may still hash SQL nulls that JSON omitted.
      return moduleId === 'conversations'
        ? await Promise.all(entries.map(entry => conversationEntry(entry.value as ConversationSyncItem)))
        : moduleId === 'settings'
          ? await settingsEntries(Object.fromEntries(entries.map(entry => [entry.id, entry.value])), plan.excludeSensitiveConfig !== false)
          : entries
    }
    const expected = await normalize(strategy === 'local' ? plan.local[moduleId].filter(entry => !entry.deleted) : resolved[moduleId])
    const actual = await normalize(actualLocal[moduleId])
    const values = (entries: SnapshotEntry[]) => stableSyncValue(entries.map(entry => [entry.id, entry.hash]).sort())
    if (values(expected) !== values(actual)) {
      const details = moduleId === 'settings' ? (() => {
        const expectedFields = new Map(expected.map(entry => [entry.id, entry.hash]))
        const actualFields = new Map(actual.map(entry => [entry.id, entry.hash]))
        return [...new Set([...expectedFields.keys(), ...actualFields.keys()])]
          .filter(key => !shouldExcludeFromSync(key, { excludeSensitiveConfig: plan.excludeSensitiveConfig !== false }) && expectedFields.get(key) !== actualFields.get(key))
          .sort().slice(0, 5).join(', ')
      })() : ''
      // Report field names only; settings values can contain private content.
      throw new Error(`SYNC_SWITCH_LOCAL_VERIFY: ${moduleId}${details ? ` / ${details}` : ''}`)
    }
  }
  const inventory = new Map(workspaceInventory.map(file => [file.path, file.sha]))
  const { getSyncMetadataKey } = await import('./sync-context')
  const { setLocalRecordedSha } = await import('./auto-sync')
  const { updateFileSyncTime } = await import('./conflict-resolution')
  for (const entry of allFiles.filter(item => item.file!.scope === 'workspace')) {
    onProgress({ phase: 'verify', source: 'local', kind: 'file', path: entry.id, current, total })
    const sha = inventory.get(entry.id)
    const key = await getSyncMetadataKey(entry.id, targetPlatform)
    if (sha) await setLocalRecordedSha(entry.id, sha, key)
    await updateFileSyncTime(entry.id, key)
  }
  await acceptPlatformSwitchTargetData(domains, targetPlatform)
  if (selected.includes('tags')) {
    const remoteTags = plan.remoteDataFiles.find(entry => entry.id === '.data/tags.json')?.value as Tag[] || []
    const localTags = resolved.tags.map(entry => entry.value) as Tag[]
    const projection = projectConversationTagsForRemote(localTags, remoteTags, plan.remoteTagIdMap || {}, selected.includes('records'))
    await acceptPlatformSwitchConversationTagIds(strategy === 'remote' ? plan.remoteTagIdMap || {} : projection.ids,
      targetPlatform, strategy === 'remote' ? remoteTags : projection.tags, localTags)
  }
  if (selected.includes('conversations')) await acceptPlatformSwitchConversationVersions(resolved.conversations.map(entry => entry.value) as ConversationSyncItem[], targetPlatform)
  onProgress({ phase: 'verify', source: 'local', current: total, total })
  await journal.status('verified')
  // Refresh only local views; a view failure must not invalidate verified data.
  const views = await Promise.allSettled([
    import('@/stores/article').then(module => module.default.getState().loadFileTree({ skipRemoteSync: true })),
    ...(selected.includes('tags') ? [import('@/stores/tag').then(module => module.default.getState().fetchTags())] : []),
    ...(selected.includes('records') ? [
      import('@/stores/mark').then(async module => { await module.default.getState().fetchMarks(); await module.default.getState().fetchAllMarks() }),
      import('@/stores/canvas').then(module => module.default.getState().loadProjects()),
    ] : []),
    ...(selected.includes('memories') ? [import('@/stores/memories').then(async module => {
      await module.default.getState().loadMemories(); await module.default.getState().loadStats(); await module.default.getState().loadPolicy()
    })] : []),
  ])
  for (const result of views) if (result.status === 'rejected') console.warn('Sync view refresh failed', result.reason)

}

/** Restore only this attempt's local mutations. Remote data is never rolled back.
 * A newer edit on either a file or a domain blocks restoration instead of losing it. */
export async function restorePlatformSwitchBackup(path: string, onProgress: OnProgress) {
  assertSwitchBackupPath(path)
  const chat = (await import('@/stores/chat')).default.getState()
  if (chat.loading || chat.agentState.isRunning) throw new Error('SYNC_SWITCH_CHAT_BUSY')
  const journalData = await readSwitchJournal(path)
  const workspace = (await import('@/stores/setting')).default.getState().workspacePath
  if (journalData.workspace !== workspace) throw syncStaleError({ stage: 'restore', source: 'local', path: 'workspace', check: 'configuration' })
  const manifest = JSON.parse(decoder.decode(await readFile(`${path}/manifest.json`, { baseDir: BaseDirectory.AppData }))) as PlatformSwitchPlan & { version: number }
  if (manifest.version !== 1 || manifest.workspace !== workspace || !manifest.local
    || moduleIds.some(id => !Array.isArray(manifest.local[id]))) throw new Error('Invalid sync recovery manifest')
  if (journalData.status === 'restored') return
  const operations = journalData.operations.filter(op => op.side === 'local')
  const originalFiles = moduleIds.flatMap(id => manifest.local[id]).filter(entry => entry.file)
  const originalFile = (op: typeof operations[number]) => originalFiles.find(entry => entry.file!.scope === op.scope
    && (op.scope === 'workspace' ? entry.id : entry.file!.localPath || entry.file!.path) === op.path)
  const fileHash = async (op: typeof operations[number]) => {
    safePath(op.path)
    const options = op.scope === 'data' ? { path: op.path, baseDir: BaseDirectory.AppData } : await getFilePathOptions(op.path)
    if (!(options.baseDir ? await exists(options.path, { baseDir: options.baseDir }) : await exists(options.path))) return undefined
    return hash(options.baseDir ? await readFile(options.path, { baseDir: options.baseDir }) : await readFile(options.path))
  }
  const domainFingerprint = (snapshot: Snapshot, module: SwitchModule) => {
    const group: SwitchModule[] = module === 'records' ? ['records', 'tags'] : [module]
    return stableSyncValue(group.map(id => [id, snapshot[id].filter(entry => !entry.deleted).map(entry => [entry.id, entry.hash]).sort()]))
  }
  const comparableFingerprint = (op: typeof operations[number], fingerprint: string | undefined) => {
    if (op.action !== 'module' || op.path !== 'settings') return fingerprint
    // Older journals included editor navigation in settings. Verify their raw
    // integrity first, then compare only fields we can actually restore today.
    // Retain every syncable field's original hash, including the after-version
    // check, so new preference edits still block recovery.
    const groups: unknown = JSON.parse(fingerprint || 'null')
    if (!Array.isArray(groups) || groups.length !== 1 || !Array.isArray(groups[0])
      || groups[0].length !== 2 || groups[0][0] !== 'settings' || !Array.isArray(groups[0][1])) throw new Error('Invalid recovery settings fingerprint')
    const entries: Array<[string, string]> = []
    const keys = new Set<string>()
    for (const entry of groups[0][1]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
        || typeof entry[1] !== 'string' || !/^[a-f0-9]{64}$/.test(entry[1]) || keys.has(entry[0])) throw new Error('Invalid recovery settings fingerprint')
      keys.add(entry[0])
      if (!shouldExcludeFromSync(entry[0], { excludeSensitiveConfig: manifest.excludeSensitiveConfig !== false })) entries.push([entry[0], entry[1]])
    }
    return stableSyncValue([['settings', entries.sort()]])
  }
  // Validate all backups and all current destinations before the first restore.
  // Repeat destination checks before each individual mutation as well.
  const check = async (op: typeof operations[number]) => {
    if (op.action === 'module') {
      const chat = (await import('@/stores/chat')).default.getState()
      if (chat.loading || chat.agentState.isRunning) throw new Error('SYNC_SWITCH_CHAT_BUSY')
      if (!moduleIds.includes(op.path as SwitchModule)) throw new Error('Invalid recovery domain')
      const moduleId = op.path as SwitchModule
      if (domainFingerprint(manifest.local, moduleId) !== op.before) throw new Error('Invalid recovery domain baseline')
      for (const entry of (moduleId === 'records' ? [...manifest.local.records, ...manifest.local.tags] : manifest.local[moduleId])) {
        if (await hash(encoder.encode(stableSyncValue(entry.value))) !== entry.hash) throw new Error('Damaged sync recovery manifest')
      }
      const current = domainFingerprint(await collectLocal(() => {}, false, op.path === 'records' ? ['records', 'tags'] : [op.path as SwitchModule], manifest.excludeSensitiveConfig !== false), op.path as SwitchModule)
      const before = comparableFingerprint(op, op.before)
      const after = comparableFingerprint(op, op.after)
      if (current !== before && current !== after) throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
      return current
    }
    if (!op.scope) throw new Error('Invalid recovery file scope')
    const original = originalFile(op)
    if (original?.hash !== op.before) throw new Error('Invalid recovery file baseline')
    if (original) {
      if (!original.backup?.startsWith(`${path}/`) || !/^\d+\.bin$/.test(original.backup.slice(path.length + 1))) throw new Error('Invalid recovery file backup')
      if (await hash(await readEntry(original)) !== original.hash) throw new Error('Damaged sync recovery backup')
    }
    const current = await fileHash(op)
    if (current !== op.before && current !== op.after) throw new Error('SYNC_SWITCH_RECOVERY_CHANGED')
    return current
  }
  const recoveryContext = (op: typeof operations[number]): SyncStaleDetails => ({
    stage: 'restore', source: 'local', path: scopedStalePath(op.path, op.scope),
    expected: op.action === 'module' ? undefined : { sha: op.before, size: originalFile(op)?.size, exists: op.before !== undefined },
  })
  for (const op of operations) await withSwitchStaleContext(() => check(op), recoveryContext(op))
  const journal = await openSwitchJournal(path, workspace, journalData)
  await journal.status('restoring')
  const activePath = (await import('@/stores/article')).default.getState().activeFilePath
  if (!await prepareActiveEditorPathMutationDurably(activePath, operations.filter(op => op.scope === 'workspace').map(op => op.path))) throw new Error('SYNC_SWITCH_EDITOR_BUSY')
  for (const [index, op] of [...operations].reverse().entries()) {
    onProgress({ phase: 'apply', source: 'local', path: op.path, current: index, total: operations.length })
    if (await withSwitchStaleContext(() => check(op), recoveryContext(op)) === comparableFingerprint(op, op.before)) continue // Also makes interrupted restoration resumable.
    if (op.action === 'module') {
      const moduleId = op.path as SwitchModule
      if (moduleId === 'records' || moduleId === 'tags') {
        const tags = await import('@/db/tags').then(module => module.getTags())
        const names = new Map((manifest.local.tags.map(entry => entry.value) as Tag[]).map(tag => [tag.id, tag.name]))
        await invalidateLocalTagSyncIdentity(tags.filter(tag => names.get(tag.id) !== tag.name).map(tag => tag.id))
      }
      await withSwitchStaleContext(() => applyLocalData(manifest.local, moduleId === 'records' ? ['records', 'tags'] : [moduleId], manifest.localConversationTombstones, manifest.excludeSensitiveConfig !== false), recoveryContext(op))
    } else {
      const original = originalFile(op)
      if (original) {
        const bytes = await readEntry(original)
        if (op.scope === 'workspace') {
          markEditorPathMutation(op.path)
          await withSwitchStaleContext(() => saveLocalBytes(op.path, bytes), recoveryContext(op))
          if (/\.md$/i.test(op.path)) emitter.emit('sync-content-updated', { path: op.path, content: decoder.decode(bytes) })
        } else await writeFile(op.path, bytes, { baseDir: BaseDirectory.AppData })
      } else {
        const options = op.scope === 'data' ? { path: op.path, baseDir: BaseDirectory.AppData } : await getFilePathOptions(op.path)
        markEditorPathMutation(op.path)
        if (options.baseDir) await remove(options.path, { baseDir: options.baseDir }); else await remove(options.path)
        if (op.scope === 'workspace') await (await import('@/stores/article')).default.getState().cleanTabsByDeletedFile(op.path)
      }
    }
    const actual = await withSwitchStaleContext(() => check(op), recoveryContext(op))
    if (actual !== comparableFingerprint(op, op.before)) throw syncStaleError({
      ...recoveryContext(op), check: 'content',
      actual: op.action === 'module' ? undefined : { sha: actual, exists: actual !== undefined },
    })
  }
  await journal.status('restored')
}
