'use client'

import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { decodeBase64ToString, getRemoteFileContent } from '@/lib/sync/remote-file'
import type { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import type { Mark } from '@/db/marks'
import type { Tag } from '@/db/tags'
import { mergeRecordTags, preserveLegacyRecordTags, recordTagIds } from '@/lib/record-tags'
import { normalizeTagBoolean } from '@/lib/tag-sync'
import { downloadRecordAssets, uploadRecordAssets } from '@/lib/sync/record-assets'
import { recordSyncTiming } from '@/lib/sync/sync-timing'
import { filterSyncData } from '@/config/sync-exclusions'
import type { CanvasProject } from '@/types/canvas'
import type { MemorySyncData, MemorySyncRecord } from '@/db/memories'
import { getDataSyncRepoName } from '@/lib/sync/repo-utils'
import {
  CANVAS_SYNC_ITEMS_DIRECTORY,
  CANVAS_SYNC_PATH,
  LEGACY_CANVAS_SYNC_PATH,
  downloadCanvases,
  parseCanvasSyncIndex,
  uploadCanvases,
} from '@/lib/sync/canvas-sync'
import {
  CONVERSATION_SYNC_DIRECTORY,
  CONVERSATION_SYNC_INDEX_PATH,
  downloadConversations,
  getLocalConversationSyncFingerprint,
  getRemoteConversationSyncFingerprint,
  hasRemoteConversationSyncData,
  uploadConversations,
} from '@/lib/sync/conversation-sync'
import useSettingStore from '@/stores/setting'

export type AutoDataSyncDomain = 'records' | 'settings' | 'conversations'
type AutoDataSyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'
export type AutoDataSyncPhase =
  | 'idle'
  | 'checking_remote'
  | 'queued'
  | 'uploading'
  | 'downloading'
  | 'failed'
  | 'conflict'
  | 'waiting_provider'

export interface AutoDataSyncState {
  isSyncing: boolean
  phase: AutoDataSyncPhase
  currentDomain: AutoDataSyncDomain | null
  pendingCount: number
  lastError: string | null
  lastCompletedAt: number | null
  lastFailedAt: number | null
  syncMode: 'auto' | 'manual' | null
  status: 'idle' | 'queued' | 'syncing' | 'failed' | 'conflict' | 'waiting_provider'
  affectedDomains: AutoDataSyncDomain[]
}

interface AutoDataSyncTask {
  id: string
  seq: number
  domain: AutoDataSyncDomain
  reason: string
  createdAt: number
  retryCount: number
  readyAt?: number
  mode: 'auto' | 'manual'
}

interface AutoDataSyncRemoteMeta {
  updatedAtMs: number
  updatedAt: string | null
  deviceId: string | null
  provider: string | null
  domains: AutoDataSyncDomain[]
  lastUploadedDomains: AutoDataSyncDomain[]
  domainStates: Partial<Record<AutoDataSyncDomain, AutoDataSyncRemoteDomainState>>
  hasExplicitDomainStates: boolean
}

interface AutoDataSyncRemoteDomainState {
  updatedAtMs: number
  updatedAt: string | null
  deviceId: string | null
}

type AutoDataSyncListener = (state: AutoDataSyncState) => void
type AutoDataSyncRemoteApplyDecision = 'safe' | 'conflict' | 'unavailable'
type AutoDataSyncDomainFingerprints = Partial<Record<AutoDataSyncDomain, string>>
interface AutoDataSyncContentFingerprints {
  local: string
  remote: string
}
type AutoDataSyncUploadGuardDecision =
  | { action: 'upload' }
  | { action: 'pull'; domains: AutoDataSyncDomain[]; remoteMeta: AutoDataSyncRemoteMeta }
  | { action: 'merge'; domains: AutoDataSyncDomain[] }
type RemoteFileEntry = {
  name?: string
  path?: string
  type?: string
  sha?: string
}
interface AutoDataSyncRecordSnapshot {
  schemaVersion: 1
  createdAt: string
  createdAtMs: number
  reason: string
  tags: Tag[]
  marks: Mark[]
  canvases: CanvasProject[]
  memoryData?: MemorySyncData
}
export interface AutoDataSyncDownloadOptions {
  allowRemoteEmptyRecords?: boolean
  domains?: AutoDataSyncDomain[]
}
export interface AutoDataSyncUploadOptions {
  domains?: AutoDataSyncDomain[]
}
interface AutoDataSyncGlobalRuntimeState {
  ownerId: string | null
  remoteMetaCheckTimer: ReturnType<typeof setTimeout> | null
}
type AutoDataSyncGlobalScope = typeof globalThis & {
  __noteGenAutoDataSyncRuntimeState?: AutoDataSyncGlobalRuntimeState
}

const DEFAULT_AUTO_DATA_SYNC_DELAY = 1_000
const AUTO_DATA_SYNC_META_CHECK_INTERVALS = [10_000, 30_000, 60_000, 5 * 60_000] as const
const AUTO_DATA_SYNC_META_CACHE_TTL = 5_000
const CONVERSATION_SYNC_BUSY_WAIT_TIMEOUT = 30_000
const MAX_RETRY_COUNT = 3
const AUTO_DATA_SYNC_META_PATH = '.data/meta.json'
const AUTO_DATA_SYNC_TAGS_PATH = '.data/tags.json'
const AUTO_DATA_SYNC_MARKS_PATH = '.data/marks.json'
const AUTO_DATA_SYNC_MEMORIES_PATH = '.data/memories.json'
const AUTO_DATA_SYNC_SETTINGS_PATH = '.data/settings.json'
const AUTO_DATA_SYNC_DOMAINS: AutoDataSyncDomain[] = ['records', 'settings', 'conversations']
const AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY = 'autoDataSyncDirtyDomains'
const AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY = 'autoDataSyncLastLocalUploadMetaUpdatedAtMs'
const AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY = 'autoDataSyncLastAppliedRemoteMetaUpdatedAtMs'
const AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_KEY = 'autoDataSyncLastLocalUploadMeta'
const AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_KEY = 'autoDataSyncLastAppliedRemoteMeta'
const AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY = 'autoDataSyncRecordSnapshots'
const AUTO_DATA_SYNC_BASELINE_FINGERPRINTS_KEY = 'autoDataSyncBaselineFingerprints'
const AUTO_DATA_SYNC_MEMORY_SETTINGS_MIGRATED_KEY = 'autoDataSyncMemorySettingsMigrated'
const AUTO_DATA_SYNC_REMOTE_RECORD_ERASE_MESSAGE = 'Remote records are empty while local records exist. Automatic pull was blocked to avoid data loss.'
const MAX_AUTO_DATA_SYNC_RECORD_SNAPSHOTS = 5
const AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

let seq = 0
let queue: AutoDataSyncTask[] = []
let processing = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let providerRetryTimer: ReturnType<typeof setTimeout> | null = null
let taskRetryTimer: ReturnType<typeof setTimeout> | null = null
let remoteMetaCheckTimer: ReturnType<typeof setTimeout> | null = null
const selfHostedWakeTimers = new Map<AutoDataSyncDomain, ReturnType<typeof setTimeout>>()
let remoteMetaCheckIntervalIndex = 0
let remoteMetaVisibilityListenerAttached = false
const remoteMetaCache = new Map<string, {
  value: AutoDataSyncRemoteMeta | null
  cachedAt: number
}>()
const remoteMetaRequests = new Map<string, Promise<AutoDataSyncRemoteMeta | null>>()
let applyingRemote = false
let applyingRemoteDepth = 0
let repositoryChangePauseDepth = 0
const failedTasks: Partial<Record<AutoDataSyncDomain, AutoDataSyncTask>> = {}
const failedTaskErrors: Partial<Record<AutoDataSyncDomain, string>> = {}
let runtimeInitialized = false
const pendingDirtyWrites = new Set<Promise<void>>()
let dirtyWriteQueue: Promise<void> = Promise.resolve()

let state: AutoDataSyncState = {
  isSyncing: false,
  phase: 'idle',
  currentDomain: null,
  pendingCount: 0,
  lastError: null,
  lastCompletedAt: null,
  lastFailedAt: null,
  syncMode: null,
  status: 'idle',
  affectedDomains: [],
}

const listeners = new Set<AutoDataSyncListener>()

async function getAutoDataSyncStateKey(baseKey: string) {
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const repo = provider === 'cloudFolder'
    ? (await store.get<CloudFolderConfig>('cloudFolderSyncConfig'))?.path || ''
    : provider === 's3' || provider === 'webdav'
      ? ''
      : await getDataSyncRepoName(provider)
  return `${baseKey}:${JSON.stringify([provider, repo])}`
}

async function getAutoDataSyncStateValue<T>(store: Store, baseKey: string) {
  const scopedValue = await store.get<T>(await getAutoDataSyncStateKey(baseKey))
  if (scopedValue !== undefined && scopedValue !== null) return scopedValue

  return await store.get<T>(baseKey)
}

async function needsMemorySettingsMigration(store: Store): Promise<boolean> {
  const enabledDomains = await getEnabledAutoDataSyncDomains()
  return enabledDomains.includes('settings')
    && await store.get<boolean>(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_MEMORY_SETTINGS_MIGRATED_KEY)) !== true
}

function getGlobalAutoDataSyncRuntimeState() {
  const globalScope = globalThis as AutoDataSyncGlobalScope

  if (!globalScope.__noteGenAutoDataSyncRuntimeState) {
    globalScope.__noteGenAutoDataSyncRuntimeState = {
      ownerId: null,
      remoteMetaCheckTimer: null,
    }
  }

  return globalScope.__noteGenAutoDataSyncRuntimeState
}

interface TagMergeResult {
  tags: Tag[]
  remoteTagIdMap: Map<number, number>
}

function mergeTags(localTags: Tag[], remoteTags: Tag[]): TagMergeResult {
  const tags = [...localTags]
  const remoteTagIdMap = new Map<number, number>()
  const usedIds = new Set(tags.map(tag => tag.id))
  const nameToId = new Map(tags.map(tag => [tag.name, tag.id]))
  let maxId = Math.max(0, ...tags.map(tag => tag.id))

  function nextId() {
    do {
      maxId += 1
    } while (usedIds.has(maxId))
    usedIds.add(maxId)
    return maxId
  }

  for (const remoteTag of remoteTags) {
    const existingIndex = tags.findIndex(tag => tag.id === remoteTag.id)
    if (existingIndex === -1) {
      const sameNameId = nameToId.get(remoteTag.name)
      if (sameNameId !== undefined) {
        remoteTagIdMap.set(remoteTag.id, sameNameId)
        continue
      }

      tags.push(remoteTag)
      usedIds.add(remoteTag.id)
      nameToId.set(remoteTag.name, remoteTag.id)
      remoteTagIdMap.set(remoteTag.id, remoteTag.id)
      maxId = Math.max(maxId, remoteTag.id)
      continue
    }

    const existingTag = tags[existingIndex]
    if (existingTag.name === remoteTag.name || existingTag.isLocked || remoteTag.isLocked) {
      tags[existingIndex] = {
        ...existingTag,
        ...remoteTag,
        id: existingTag.id,
      }
      nameToId.set(tags[existingIndex].name, existingTag.id)
      remoteTagIdMap.set(remoteTag.id, existingTag.id)
      continue
    }

    const sameNameId = nameToId.get(remoteTag.name)
    if (sameNameId !== undefined) {
      remoteTagIdMap.set(remoteTag.id, sameNameId)
      continue
    }

    const newId = nextId()
    tags.push({
      ...remoteTag,
      id: newId,
    })
    nameToId.set(remoteTag.name, newId)
    remoteTagIdMap.set(remoteTag.id, newId)
  }

  return { tags, remoteTagIdMap }
}

function marksShareCoreIdentity(left: Mark, right: Mark): boolean {
  return (left.sourceId || '') === (right.sourceId || '') &&
    left.tagId === right.tagId &&
    left.type === right.type &&
    (left.content || '') === (right.content || '') &&
    (left.desc || '') === (right.desc || '') &&
    (left.url || '') === (right.url || '')
}

function getMarkExactKey(mark: Mark): string {
  return JSON.stringify([
    mark.tagId,
    recordTagIds(mark),
    mark.tagUpdatedAt || 0,
    mark.type,
    mark.content || '',
    mark.desc || '',
    mark.url || '',
    mark.sourceId || '',
    mark.deleted,
    mark.createdAt,
  ])
}

function getMarkSyncKey(mark: Mark): string {
  return JSON.stringify([
    mark.id,
    mark.tagId,
    recordTagIds(mark),
    mark.tagUpdatedAt || 0,
    mark.type,
    mark.content || '',
    mark.desc || '',
    mark.url || '',
    mark.sourceId || '',
    Number(mark.deleted) || 0,
    mark.createdAt,
  ])
}

function getTagSyncKey(tag: Tag): string {
  return JSON.stringify([
    tag.id,
    tag.name,
    normalizeTagBoolean(tag.isLocked) ?? false,
    normalizeTagBoolean(tag.isPin) ?? false,
    Number(tag.sortOrder) || 0,
  ])
}

function getMemorySyncKey(memory: MemorySyncRecord): string {
  return stableSerialize(memory)
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

function mergeMarksById(
  localMarks: Mark[],
  remoteMarks: Mark[],
  remoteTagIdMap: Map<number, number>
): Mark[] {
  const merged = new Map<number, Mark>()
  const exactKeyToId = new Map<string, number>()
  const sourceIdToId = new Map<string, number>()
  let maxId = Math.max(0, ...localMarks.map(mark => mark.id))

  for (const mark of localMarks) {
    merged.set(mark.id, mark)
    exactKeyToId.set(getMarkExactKey(mark), mark.id)
    if (mark.sourceId) sourceIdToId.set(mark.sourceId, mark.id)
  }

  for (const remoteMark of remoteMarks) {
    const normalizedRemoteMark = {
      ...remoteMark,
      tagId: remoteTagIdMap.get(remoteMark.tagId) ?? remoteMark.tagId,
      tagIds: Array.isArray(remoteMark.tagIds)
        ? Array.from(new Set(remoteMark.tagIds.map(tagId => remoteTagIdMap.get(tagId) ?? tagId)))
        : undefined,
    }
    const sourceDuplicateId = normalizedRemoteMark.sourceId
      ? sourceIdToId.get(normalizedRemoteMark.sourceId)
      : undefined
    if (sourceDuplicateId !== undefined) {
      const existingSourceMark = merged.get(sourceDuplicateId)
      if (existingSourceMark) {
        const content = normalizedRemoteMark.createdAt >= existingSourceMark.createdAt
          ? { ...normalizedRemoteMark, id: sourceDuplicateId }
          : existingSourceMark
        const nextMark = mergeRecordTags(existingSourceMark, normalizedRemoteMark, content)
        merged.set(sourceDuplicateId, nextMark)
        exactKeyToId.set(getMarkExactKey(nextMark), sourceDuplicateId)
        continue
      }
    }
    const exactDuplicateId = exactKeyToId.get(getMarkExactKey(normalizedRemoteMark))
    if (exactDuplicateId !== undefined) {
      continue
    }

    const localMark = merged.get(normalizedRemoteMark.id)

    if (!localMark) {
      merged.set(normalizedRemoteMark.id, normalizedRemoteMark)
      exactKeyToId.set(getMarkExactKey(normalizedRemoteMark), normalizedRemoteMark.id)
      if (normalizedRemoteMark.sourceId) sourceIdToId.set(normalizedRemoteMark.sourceId, normalizedRemoteMark.id)
      maxId = Math.max(maxId, normalizedRemoteMark.id)
      continue
    }

    if (marksShareCoreIdentity(localMark, normalizedRemoteMark)) {
      const content = normalizedRemoteMark.createdAt >= localMark.createdAt ? normalizedRemoteMark : localMark
      const nextMark = mergeRecordTags(localMark, normalizedRemoteMark, content)
      merged.set(localMark.id, nextMark)
      exactKeyToId.set(getMarkExactKey(nextMark), localMark.id)
      continue
    }

    maxId += 1
    const remappedRemoteMark = {
      ...normalizedRemoteMark,
      id: maxId,
    }
    merged.set(maxId, remappedRemoteMark)
    exactKeyToId.set(getMarkExactKey(remappedRemoteMark), maxId)
    if (remappedRemoteMark.sourceId) sourceIdToId.set(remappedRemoteMark.sourceId, maxId)
  }

  return Array.from(merged.values())
}

function debugAutoDataSync(message: string, details?: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...details, message }
  if (details && Object.prototype.hasOwnProperty.call(details, 'message')) {
    payload.error = details.message
  }
  console.info('[AutoDataSync]', JSON.stringify(payload))
}

function getAutoDataSyncErrorMessage(error: unknown, fallback: string): string {
  const redact = (value: string) => value.replace(/([?&]access_token=)[^&\s]+/gi, '$1[redacted]')
  if (error instanceof Error) return redact(error.message)
  if (typeof error === 'string' && error.trim()) return redact(error)
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    if (typeof value.message === 'string' && value.message.trim()) return redact(value.message)
    const details = [value.code, value.status]
      .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    return details.length > 0 ? `${fallback} (${details.join(', ')})` : fallback
  }
  return fallback
}

function updateState(next: Partial<AutoDataSyncState>) {
  const affectedDomains = next.affectedDomains
    ?? (next.currentDomain ? [next.currentDomain] : undefined)
    ?? (next.phase === 'idle' ? [] : state.affectedDomains)
  state = {
    ...state,
    ...next,
    affectedDomains,
    pendingCount: queue.length,
  }

  emitter.emit('auto-data-sync-state-changed', state)
  listeners.forEach((listener) => listener(state))
}

function clearFailedAutoDataSyncTasks() {
  delete failedTasks.records
  delete failedTasks.settings
  delete failedTasks.conversations
  delete failedTaskErrors.records
  delete failedTaskErrors.settings
  delete failedTaskErrors.conversations
}

function clearFailedAutoDataSyncDomains(domains: AutoDataSyncDomain[]) {
  for (const domain of domains) {
    delete failedTasks[domain]
    delete failedTaskErrors[domain]
  }
}

export function getAutoDataSyncState(): AutoDataSyncState {
  return { ...state }
}

export function subscribeAutoDataSyncState(listener: AutoDataSyncListener): () => void {
  listeners.add(listener)
  listener(getAutoDataSyncState())

  return () => {
    listeners.delete(listener)
  }
}

export function setAutoDataSyncApplyingRemote(value: boolean) {
  applyingRemoteDepth = value
    ? applyingRemoteDepth + 1
    : Math.max(0, applyingRemoteDepth - 1)
  applyingRemote = applyingRemoteDepth > 0
}

export function isAutoDataSyncApplyingRemote(): boolean {
  return applyingRemote
}

export function enqueueAutoDataSync(domain: AutoDataSyncDomain, reason = 'change', mode: 'auto' | 'manual' = 'auto') {
  if (applyingRemote || repositoryChangePauseDepth > 0) {
    debugAutoDataSync('skip enqueue while applying remote data', { domain, reason, mode })
    return
  }

  if (useSettingStore.getState().primaryBackupMethod === 'selfHosted') {
    const wakeSelfHosted = async () => {
      if (domain === 'settings' && !reason.startsWith('memory:')) {
        const { enqueueSelfHostedSettingChange } = await import('@/db/self-hosted-sync')
        await enqueueSelfHostedSettingChange(reason)
      }
      const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
      void getSelfHostedSyncRuntime().wake(`data:${domain}`)
    }
    if (domain === 'records' && mode === 'auto') {
      const previousTimer = selfHostedWakeTimers.get(domain)
      if (previousTimer) clearTimeout(previousTimer)
      selfHostedWakeTimers.set(domain, setTimeout(() => {
        selfHostedWakeTimers.delete(domain)
        void wakeSelfHosted()
      }, 250))
    } else {
      void wakeSelfHosted()
    }
    return
  }

  delete failedTasks[domain]
  delete failedTaskErrors[domain]
  const lastTask = queue[queue.length - 1]
  if (lastTask?.domain === domain) {
    trackAutoDataSyncDirtyWrite(domain)
    debugAutoDataSync('merge queued task', {
      domain,
      reason,
      mode,
      pendingCount: queue.length,
    })
    lastTask.reason = reason
    lastTask.createdAt = Date.now()
    lastTask.mode = mode
    lastTask.readyAt = undefined
    lastTask.retryCount = 0
    scheduleProcess()
    updateState({
      status: processing ? 'syncing' : 'queued',
      phase: processing ? 'uploading' : 'queued',
      lastError: null,
    })
    return
  }

  queue.push({
    id: `${Date.now()}-${++seq}`,
    seq,
    domain,
    reason,
    createdAt: Date.now(),
    retryCount: 0,
    mode,
  })
  trackAutoDataSyncDirtyWrite(domain)

  updateState({
    status: processing ? 'syncing' : 'queued',
    phase: processing ? 'uploading' : 'queued',
    lastError: null,
  })
  debugAutoDataSync('enqueue task', {
    domain,
    reason,
    mode,
    pendingCount: queue.length,
  })
  scheduleProcess()
}

export function enqueueAllAutoDataSync(reason = 'manual-sync', mode: 'auto' | 'manual' = 'manual') {
  enqueueAutoDataSync('records', reason, mode)
  enqueueAutoDataSync('settings', reason, mode)
  enqueueAutoDataSync('conversations', reason, mode)
}

export async function flushAutoDataSyncNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  await processQueue()
}

function cancelPendingAutoDataSyncUpload(reason: string, domains?: AutoDataSyncDomain[]) {
  const pendingCount = queue.length
  const hadDebounceTimer = Boolean(debounceTimer)

  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (taskRetryTimer) {
    clearTimeout(taskRetryTimer)
    taskRetryTimer = null
  }

  queue = domains?.length
    ? queue.filter(task => !domains.includes(task.domain))
    : []
  if (queue.length > 0) {
    void scheduleProcess()
  }

  if (pendingCount > 0 || hadDebounceTimer) {
    debugAutoDataSync('pending upload queue cancelled', {
      reason,
      pendingCount,
      hadDebounceTimer,
    })
    updateState({
      pendingCount: 0,
      status: state.isSyncing ? state.status : queue.length > 0 ? 'queued' : 'idle',
      phase: state.isSyncing ? state.phase : queue.length > 0 ? 'queued' : 'idle',
    })
  }
}

export async function prepareAutoDataSyncForRepositoryChange() {
  repositoryChangePauseDepth += 1
  if (providerRetryTimer) {
    clearTimeout(providerRetryTimer)
    providerRetryTimer = null
  }
  await Promise.all(Array.from(pendingDirtyWrites))
  cancelPendingAutoDataSyncUpload('data-repository-change')
  while (processing) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

export function finishAutoDataSyncRepositoryChange() {
  repositoryChangePauseDepth = Math.max(0, repositoryChangePauseDepth - 1)
  clearFailedAutoDataSyncTasks()
  updateState({
    isSyncing: false,
    phase: 'idle',
    currentDomain: null,
    pendingCount: 0,
    lastError: null,
    lastCompletedAt: null,
    lastFailedAt: null,
    syncMode: null,
    status: 'idle',
  })
  void (async () => {
    const store = await Store.load('store.json')
    if (await store.get<string>('primaryBackupMethod') === 'selfHosted') return
    if (!await isAutoDataSyncProviderConfigured()) {
      scheduleProviderRetry()
      return
    }

    // A repository has its own independent baseline. Existing local data may
    // be clean relative to the previous repository but still be absent from
    // the new one, so every enabled domain must participate in the first
    // reconciliation for the new target.
    const enabledDomains = await getEnabledAutoDataSyncDomains()
    await markAutoDataSyncDomainsDirty(enabledDomains)
    startPeriodicAutoDataSyncMetaCheck()
    await checkRemoteAutoDataSync('startup', { uploadDirtyDomains: true, force: true })
  })()
}

function trackAutoDataSyncDirtyWrite(domain: AutoDataSyncDomain) {
  const operation = markAutoDataSyncDirty(domain)
  pendingDirtyWrites.add(operation)
  void operation.finally(() => pendingDirtyWrites.delete(operation))
}

export async function uploadAutoDataSyncNow(options: AutoDataSyncUploadOptions = {}): Promise<void> {
  debugAutoDataSync('manual upload requested')

  if (!await isAutoDataSyncProviderConfigured()) {
    updateState({
      isSyncing: false,
      phase: 'waiting_provider',
      currentDomain: null,
      syncMode: null,
      status: 'waiting_provider',
      lastError: null,
    })
    throw new Error('Sync provider is not configured')
  }

  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const enabledDomains = await getEnabledAutoDataSyncDomains()
  let requestedDomains = options.domains?.length
    ? Array.from(new Set(options.domains))
    : enabledDomains
  if (
    requestedDomains.includes('records')
    && await shouldPullRemoteRecordsBeforeUpload(store, provider, 'manual-upload')
  ) {
    debugAutoDataSync('manual upload converted to remote pull because local records are empty', {
      provider,
    })
    const downloaded = await downloadAutoDataSyncNow('manual', null, { domains: ['records'] })
    if (!downloaded) {
      throw new Error(state.lastError || 'Failed to download records and settings')
    }
    requestedDomains = requestedDomains.filter(domain => domain !== 'records')
    if (requestedDomains.length === 0) return
  }

  const dirtyDomains = (await getAutoDataSyncDirtyDomains(store))
    .filter(domain => requestedDomains.includes(domain))
  const remoteMeta = await downloadAutoDataSyncMeta(store, provider)

  if (dirtyDomains.length === 0 && remoteMeta) {
    const remoteNewerDomains = await getRemoteNewerDomains(store, remoteMeta, requestedDomains)
    if (remoteNewerDomains.length > 0) {
      const downloaded = await downloadAutoDataSyncNow('manual', remoteMeta, {
        domains: remoteNewerDomains,
      })
      if (!downloaded) {
        throw new Error(state.lastError || 'Failed to download records and settings')
      }
      return
    }

    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastError: null,
      lastCompletedAt: Date.now(),
    })
    return
  }

  const domainsToUpload = dirtyDomains.length > 0 ? dirtyDomains : requestedDomains
  for (const domain of domainsToUpload) {
    enqueueAutoDataSync(domain, 'manual-upload', 'manual')
  }
  await flushAutoDataSyncNow()

  if (state.status === 'waiting_provider') {
    throw new Error('Sync provider is not configured')
  }

  if (
    state.status === 'failed'
    && state.affectedDomains.some(domain => requestedDomains.includes(domain))
  ) {
    throw new Error(state.lastError || 'Failed to upload records and settings')
  }

}

export async function downloadAutoDataSyncNow(
  mode: 'auto' | 'manual' = 'manual',
  knownRemoteMeta: AutoDataSyncRemoteMeta | null = null,
  options: AutoDataSyncDownloadOptions = {}
): Promise<boolean> {
  const requestedDomains = options.domains ?? await getEnabledAutoDataSyncDomains()
  if (new Set(requestedDomains).size > 1) {
    const failedDomains: AutoDataSyncDomain[] = []
    let lastError: string | null = null
    for (const domain of new Set(requestedDomains)) {
      if (!await downloadAutoDataSyncNow(mode, knownRemoteMeta, { ...options, domains: [domain] })) {
        failedDomains.push(domain)
        lastError = state.lastError
      }
    }
    if (failedDomains.length > 0) {
      updateState({
        isSyncing: false,
        phase: 'failed',
        status: 'failed',
        lastError: lastError || 'Failed to download app data',
        lastFailedAt: Date.now(),
        affectedDomains: failedDomains,
      })
      return false
    }
    return true
  }
  const downloadStartedAt = Date.now()
  if (!await isAutoDataSyncProviderConfigured()) {
    debugAutoDataSync('download blocked because provider is not configured')
    updateState({
      isSyncing: false,
      phase: 'waiting_provider',
      currentDomain: null,
      syncMode: null,
      status: 'waiting_provider',
      lastError: null,
    })
    return false
  }

  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const domainsToDownload = options.domains?.length
    ? Array.from(new Set(options.domains))
    : await getEnabledAutoDataSyncDomains()
  if (domainsToDownload.includes('conversations')) {
    await waitForConversationSyncIdle()
  }
  cancelPendingAutoDataSyncUpload(`download:${mode}`, domainsToDownload)
  const shouldDownloadRecords = domainsToDownload.includes('records')
  const shouldDownloadSettings = domainsToDownload.includes('settings')
  const shouldDownloadConversations = domainsToDownload.includes('conversations')
  let remoteMeta = knownRemoteMeta
  if (!remoteMeta) {
    try {
      remoteMeta = await downloadAutoDataSyncMeta(store, provider)
    } catch (error) {
      debugAutoDataSync('download remote meta lookup failed', {
        message: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  let localRecordSnapshot: AutoDataSyncRecordSnapshot | null = null
  let recordSnapshotApplied = false
  let downloadStage = 'initialize'
  setAutoDataSyncApplyingRemote(true)
  updateState({
    isSyncing: true,
    phase: 'downloading',
    currentDomain: null,
    syncMode: mode,
    status: 'syncing',
    lastError: null,
    affectedDomains: domainsToDownload,
  })

  try {
    debugAutoDataSync('download started')
    if (shouldDownloadRecords) {
      downloadStage = 'check-record-safety'
      await assertRemoteRecordsSafeForDownload(store, provider, mode, options)
      downloadStage = 'save-local-record-snapshot'
      localRecordSnapshot = await createAutoDataSyncLocalRecordSnapshot(`before-download:${mode}`)
    }
    const [
      { default: useTagStore },
      { default: useMarkStore },
      { default: useSettingsSyncStore },
      { default: useSettingStore },
    ] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
      import('@/stores/settingsSync'),
      import('@/stores/setting'),
    ])

    let tagResult: Tag[] = []
    let markResult: Mark[] = []
    let memoryResult = true
    let settingsResult = true
    let conversationResult = true

    if (shouldDownloadRecords) {
      const domainStartedAt = Date.now()
      downloadStage = 'download-tags'
      tagResult = await useTagStore.getState().downloadTags({ allowMissingRemote: true, fetchOnly: true })
      downloadStage = 'download-marks'
      markResult = await useMarkStore.getState().downloadMarks({
        allowMissingRemote: true,
        deferRefresh: true,
        fetchOnly: true,
      })
      const { getAllMarks } = await import('@/db/marks')
      const { replaceRecordSnapshot } = await import('@/db/record-snapshot')
      markResult = preserveLegacyRecordTags(markResult, await getAllMarks())
      downloadStage = 'replace-record-snapshot'
      await replaceRecordSnapshot(markResult, tagResult)
      recordSnapshotApplied = true
      downloadStage = 'refresh-tags'
      await useTagStore.getState().fetchTags()
      downloadStage = 'download-canvases'
      await downloadCanvases({ allowMissingRemote: true })
      const { default: useCanvasStore } = await import('@/stores/canvas')
      downloadStage = 'refresh-canvas-store'
      await useCanvasStore.getState().loadProjects()
      downloadStage = 'download-record-assets'
      await downloadRecordAssets(markResult)
      downloadStage = 'refresh-marks'
      await Promise.all([
        useMarkStore.getState().fetchMarks(),
        useMarkStore.getState().fetchAllMarks(),
      ])
      recordSyncTiming('domainDownload', domainStartedAt, {
        domain: 'records',
        tags: tagResult.length,
        marks: markResult.length,
      })
    }

    if (shouldDownloadSettings) {
      const domainStartedAt = Date.now()
      downloadStage = 'download-settings'
      settingsResult = await useSettingsSyncStore.getState().downloadSettings({ allowMissingRemote: true })
      if (settingsResult) {
        downloadStage = 'download-memories'
        memoryResult = await downloadMemorySyncData(store, provider)
        const { default: useMemoriesStore } = await import('@/stores/memories')
        await Promise.all([
          useMemoriesStore.getState().loadMemories(),
          useMemoriesStore.getState().loadStats(),
          useMemoriesStore.getState().loadPolicy(),
        ])
      }
      recordSyncTiming('domainDownload', domainStartedAt, {
        domain: 'settings',
        success: settingsResult,
      })
    }
    if (shouldDownloadConversations) {
      const domainStartedAt = Date.now()
      downloadStage = 'download-conversations'
      conversationResult = await downloadConversations({ allowMissingRemote: true })
      recordSyncTiming('domainDownload', domainStartedAt, {
        domain: 'conversations',
        success: conversationResult,
      })
    }
    debugAutoDataSync('download domain results', {
      domains: domainsToDownload,
      tags: tagResult,
      marks: markResult,
      memories: memoryResult,
      settings: settingsResult,
      conversations: conversationResult,
    })

    if (!tagResult || !markResult || !memoryResult || !settingsResult || !conversationResult) {
      throw new Error('Failed to download app data')
    }

    if (shouldDownloadSettings) {
      downloadStage = 'refresh-settings-store'
      await useSettingStore.getState().initSettingData()
      debugAutoDataSync('settings state refreshed after download')
    }

    if (remoteMeta) {
      downloadStage = 'apply-remote-meta'
      await markAutoDataSyncRemoteMetaApplied(remoteMeta, domainsToDownload)
    }
    downloadStage = 'clear-dirty-domains'
    for (const domain of domainsToDownload) {
      await clearAutoDataSyncDirtyDomain(domain)
    }
    clearFailedAutoDataSyncDomains(domainsToDownload)
    await storeAutoDataSyncBaselineFingerprints(store, domainsToDownload)

    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastCompletedAt: Date.now(),
      lastError: null,
    })
    debugAutoDataSync('download completed')
    return true
  } catch (error) {
    const message = getAutoDataSyncErrorMessage(error, 'Failed to download app data')
    debugAutoDataSync('download failed', { stage: downloadStage, error: message })
    if (localRecordSnapshot && recordSnapshotApplied) {
      await restoreAutoDataSyncLocalRecordSnapshot(localRecordSnapshot, `download-failed:${mode}`)
    }
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: `${downloadStage}: ${message}`,
      lastFailedAt: Date.now(),
      affectedDomains: domainsToDownload,
    })
    return false
  } finally {
    setAutoDataSyncApplyingRemote(false)
    recordSyncTiming('autoDataDownload', downloadStartedAt, {
      mode,
      domains: domainsToDownload,
      status: state.status,
    })
  }
}

export async function refreshRemoteRecordsNow(): Promise<boolean> {
  try {
    if (!await isAutoDataSyncProviderConfigured()) {
      updateState({
        isSyncing: false,
        phase: 'waiting_provider',
        currentDomain: null,
        syncMode: null,
        status: 'waiting_provider',
        lastError: null,
      })
      return false
    }

    const store = await Store.load('store.json')
    const provider = await getAutoDataSyncProvider(store)
    const remoteMeta = await downloadAutoDataSyncMeta(store, provider)

    if (!remoteMeta) {
      return downloadAutoDataSyncNow('manual', null, { domains: ['records'] })
    }

    const decision = await getRemoteMetaDecision(store, remoteMeta, undefined, 'records')
    if (!decision.remoteIsNewer) {
      return true
    }

    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
    if (dirtyDomains.includes('records')) {
      const remoteApplyDecision = await canApplyRemoteDomainsWithoutConflict(
        store,
        provider,
        ['records']
      )
      if (remoteApplyDecision !== 'safe') {
        return mergeAutoDataSyncDomains(['records'])
      }
    }

    return downloadAutoDataSyncNow('manual', remoteMeta, { domains: ['records'] })
  } catch (error) {
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: error instanceof Error ? error.message : 'Failed to refresh remote records',
      lastFailedAt: Date.now(),
      affectedDomains: ['records'],
    })
    return false
  }
}

async function mergeAutoDataSyncDomains(targetDomains: AutoDataSyncDomain[]): Promise<boolean> {
  if (new Set(targetDomains).size > 1) {
    const failedDomains: AutoDataSyncDomain[] = []
    let lastError: string | null = null
    for (const domain of new Set(targetDomains)) {
      if (!await mergeAutoDataSyncDomains([domain])) {
        failedDomains.push(domain)
        lastError = state.lastError
      }
    }
    if (failedDomains.length > 0) {
      updateState({
        isSyncing: false,
        phase: 'failed',
        status: 'failed',
        lastError: lastError || 'Failed to merge app data',
        lastFailedAt: Date.now(),
        affectedDomains: failedDomains,
      })
      return false
    }
    return true
  }
  if (processing) {
    debugAutoDataSync('automatic merge skipped because sync is busy')
    return false
  }

  processing = true
  setAutoDataSyncApplyingRemote(true)
  let localRecordSnapshot: AutoDataSyncRecordSnapshot | null = null
  updateState({
    isSyncing: true,
    phase: 'downloading',
    currentDomain: null,
    syncMode: 'auto',
    status: 'syncing',
    lastError: null,
    affectedDomains: targetDomains,
  })

  try {
    const store = await Store.load('store.json')
    const provider = await getAutoDataSyncProvider(store)
    const mergeRecords = targetDomains.includes('records')
    const mergeSettings = targetDomains.includes('settings')
    const mergeConversations = targetDomains.includes('conversations')
    if (mergeConversations) {
      await waitForConversationSyncIdle()
    }
    if (mergeRecords) {
      localRecordSnapshot = await createAutoDataSyncLocalRecordSnapshot('before-automatic-merge')
    }
    const [
      { default: useTagStore },
      { default: useMarkStore },
      { default: useSettingsSyncStore },
      { default: useSettingStore },
      tagsDb,
      marksDb,
      memoriesDb,
    ] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
      import('@/stores/settingsSync'),
      import('@/stores/setting'),
      import('@/db/tags'),
      import('@/db/marks'),
      import('@/db/memories'),
    ])

    const [localTags, localMarks] = mergeRecords
      ? await Promise.all([tagsDb.getTags(), marksDb.getAllMarks()])
      : [[], []]
    const localMemoryData = mergeSettings ? await memoriesDb.getMemorySyncData() : null
    const remoteTags = mergeRecords
      ? await useTagStore.getState().downloadTags({ allowMissingRemote: true, fetchOnly: true })
      : []
    const remoteMarks = mergeRecords
      ? await useMarkStore.getState().downloadMarks({ allowMissingRemote: true, preserveLegacyTags: false, fetchOnly: true })
      : []
    const remoteMemoryData = mergeSettings
      ? await getRemoteMemorySyncData(store, provider)
      : null
    const settingsResult = mergeSettings
      ? await useSettingsSyncStore.getState().downloadSettings({ allowMissingRemote: true })
      : true
    const conversationResult = mergeConversations
      ? await downloadConversations({ allowMissingRemote: true })
      : true

    if (!settingsResult || !conversationResult) {
      throw new Error('Failed to merge remote app data')
    }

    const tagMergeResult = mergeTags(localTags, remoteTags)
    const mergedTags = tagMergeResult.tags
    const mergedMarks = mergeMarksById(localMarks, remoteMarks, tagMergeResult.remoteTagIdMap)
    const mergedMemoryData = mergeMemorySyncData(localMemoryData, remoteMemoryData)

    if (mergeRecords) {
      const { replaceRecordSnapshot } = await import('@/db/record-snapshot')
      await replaceRecordSnapshot(mergedMarks, mergedTags)
      await downloadRecordAssets(mergedMarks)
      await useTagStore.getState().fetchTags()
      await Promise.all([
        useMarkStore.getState().fetchMarks(),
        useMarkStore.getState().fetchAllMarks(),
      ])
      useTagStore.getState().getCurrentTag()
    }
    if (mergeSettings) {
      if (mergedMemoryData) await memoriesDb.replaceMemorySyncData(mergedMemoryData)
      const { default: useMemoriesStore } = await import('@/stores/memories')
      await Promise.all([
        useMemoriesStore.getState().loadMemories(),
        useMemoriesStore.getState().loadStats(),
        useMemoriesStore.getState().loadPolicy(),
      ])
      await useSettingStore.getState().initSettingData()
    }

    setAutoDataSyncApplyingRemote(false)
    updateState({
      isSyncing: true,
      phase: 'uploading',
      currentDomain: null,
      syncMode: 'auto',
      status: 'syncing',
      lastError: null,
    })

    for (const domain of targetDomains) {
      await uploadDomain(domain)
    }
    await uploadAutoDataSyncMeta(targetDomains)
    for (const domain of targetDomains) {
      await clearAutoDataSyncDirtyDomain(domain)
    }
    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastError: null,
      lastCompletedAt: Date.now(),
    })
    debugAutoDataSync('automatic merge completed', {
      localTags: localTags.length,
      remoteTags: remoteTags.length,
      mergedTags: mergedTags.length,
      localMarks: localMarks.length,
      remoteMarks: remoteMarks.length,
      mergedMarks: mergedMarks.length,
      mergedMemories: mergedMemoryData?.memories.length || 0,
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to merge local and remote data'
    debugAutoDataSync('automatic merge failed', { message })
    if (localRecordSnapshot) {
      await restoreAutoDataSyncLocalRecordSnapshot(localRecordSnapshot, 'automatic-merge-failed')
    }
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: message,
      lastFailedAt: Date.now(),
      affectedDomains: targetDomains,
    })
    return false
  } finally {
    setAutoDataSyncApplyingRemote(false)
    processing = false
  }
}

export async function initAutoDataSyncRuntime(): Promise<void> {
  if (runtimeInitialized) {
    return
  }

  runtimeInitialized = true

  try {
    const store = await Store.load('store.json')
    if (await store.get<string>('primaryBackupMethod') === 'selfHosted') {
      debugAutoDataSync('runtime skipped for self-hosted sync provider')
      return
    }
    const lastCompletedAt = await getAutoDataSyncLastCompletedAt(store)
    if (lastCompletedAt > 0) {
      updateState({ lastCompletedAt })
    }
    await initializeMissingAutoDataSyncBaselineFingerprints(store)

    if ((await getEnabledAutoDataSyncDomains()).length === 0) {
      debugAutoDataSync('runtime initialized with auto data sync disabled')
      updateState({
        isSyncing: false,
        phase: 'idle',
        currentDomain: null,
        syncMode: null,
        status: 'idle',
        lastError: null,
      })
      return
    }

    if (!await isAutoDataSyncProviderConfigured()) {
      debugAutoDataSync('runtime waiting for provider configuration')
      updateState({
        isSyncing: false,
        phase: 'waiting_provider',
        currentDomain: null,
        syncMode: null,
        status: 'waiting_provider',
        lastError: null,
      })
      scheduleProviderRetry()
    } else {
      debugAutoDataSync('runtime initialized')
      startPeriodicAutoDataSyncMetaCheck()
      if (await needsMemorySettingsMigration(store)) {
        enqueueAutoDataSync('settings', 'memory-settings-migration')
      } else {
        void checkRemoteAutoDataSync('startup', { uploadDirtyDomains: true })
      }
    }
  } catch (error) {
    runtimeInitialized = false
    console.error('Failed to initialize auto data sync runtime:', error)
  }
}

export async function retryAutoDataSync(domain?: AutoDataSyncDomain): Promise<void> {
  const failedTask = domain
    ? failedTasks[domain]
    : failedTasks.records || failedTasks.settings || failedTasks.conversations
  if (failedTask) {
    queue.unshift({
      ...failedTask,
      retryCount: 0,
      readyAt: undefined,
      mode: 'manual',
    })
    delete failedTasks[failedTask.domain]
    delete failedTaskErrors[failedTask.domain]
    await flushAutoDataSyncNow()
    return
  }

  await checkRemoteAutoDataSync('periodic', { uploadDirtyDomains: false, force: true })
}

async function getAutoDataSyncDelay(): Promise<number> {
  return DEFAULT_AUTO_DATA_SYNC_DELAY
}

async function isConversationSyncBusy() {
  const { default: useChatStore } = await import('@/stores/chat')
  const chatState = useChatStore.getState()
  return chatState.loading || chatState.agentState.isRunning
}

async function waitForConversationSyncIdle() {
  const deadline = Date.now() + CONVERSATION_SYNC_BUSY_WAIT_TIMEOUT
  while (await isConversationSyncBusy()) {
    if (Date.now() >= deadline) {
      throw new Error('Conversation sync is waiting for the active reply to finish')
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
}

async function isAutoDataSyncDomainEnabled(domain: AutoDataSyncDomain): Promise<boolean> {
  const store = await Store.load('store.json')
  const key = domain === 'records'
    ? 'autoRecordSyncEnabled'
    : domain === 'settings'
      ? 'autoSettingsSyncEnabled'
      : 'autoConversationSyncEnabled'
  const enabled = await store.get<boolean>(key)
  if (enabled !== undefined) return enabled

  if (domain === 'conversations') return true

  const legacyEnabled = await store.get<boolean>('autoDataSyncEnabled')
  return legacyEnabled !== false
}

async function getEnabledAutoDataSyncDomains() {
  const enabled = await Promise.all(AUTO_DATA_SYNC_DOMAINS.map(async domain => ({
    domain,
    enabled: await isAutoDataSyncDomainEnabled(domain),
  })))
  return enabled.filter(item => item.enabled).map(item => item.domain)
}

export async function isAutoDataSyncProviderConfigured(): Promise<boolean> {
  const store = await Store.load('store.json')
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  switch (provider) {
    case 'github':
      return Boolean(
        await store.get<string>('accessToken')
        && await store.get<string>('githubUsername')
        && await getConfiguredGitRepository('github')
      )
    case 'gitee':
      return Boolean(
        await store.get<string>('giteeAccessToken')
        && await store.get<string>('giteeUsername')
        && await getConfiguredGitRepository('gitee')
      )
    case 'gitlab': {
      const repo = await getConfiguredGitRepository('gitlab')
      if (!await store.get<string>('gitlabAccessToken')
        || !await store.get<string>('gitlabUsername')
        || !repo) return false
      if (await store.get<string>(`gitlab_${repo}_project_id`)) return true
      try {
        const { checkSyncProjectState } = await import('@/lib/sync/gitlab')
        return Boolean(await checkSyncProjectState(repo))
      } catch {
        return false
      }
    }
    case 'gitea':
      return Boolean(
        await store.get<string>('giteaAccessToken')
        && await store.get<string>('giteaUsername')
        && await getConfiguredGitRepository('gitea')
      )
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      return Boolean(config?.accessKeyId && config.secretAccessKey && config.region && config.bucket)
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      return Boolean(config?.url && config.username && config.password)
    }
    case 'cloudFolder': {
      const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      return Boolean(config?.path)
    }
    default:
      return false
  }
}

async function getConfiguredGitRepository(provider: 'github' | 'gitee' | 'gitlab' | 'gitea') {
  return getDataSyncRepoName(provider)
}

async function scheduleProcess() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  const delay = await getAutoDataSyncDelay()
  debugAutoDataSync('schedule queue processing', {
    delayMs: delay,
    pendingCount: queue.length,
  })
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void processQueue()
  }, delay)
}

function scheduleProviderRetry() {
  if (providerRetryTimer) return

  providerRetryTimer = setTimeout(() => {
    providerRetryTimer = null
    void (async () => {
      try {
        const store = await Store.load('store.json')
        if (await store.get<string>('primaryBackupMethod') === 'selfHosted') return
        if (!await isAutoDataSyncProviderConfigured()) {
          scheduleProviderRetry()
          return
        }

        if (queue.length > 0) {
          await processQueue()
          return
        }

        startPeriodicAutoDataSyncMetaCheck()
        if (await needsMemorySettingsMigration(store)) {
          enqueueAutoDataSync('settings', 'memory-settings-migration')
        } else {
          await checkRemoteAutoDataSync('startup', { uploadDirtyDomains: true, force: true })
        }
      } catch (error) {
        console.error('Failed to resume auto data sync after provider configuration:', error)
        scheduleProviderRetry()
      }
    })()
  }, 30_000)
}

function clearPeriodicAutoDataSyncMetaCheck(): void {
  if (remoteMetaCheckTimer) {
    clearTimeout(remoteMetaCheckTimer)
    remoteMetaCheckTimer = null
  }
  const globalRuntimeState = getGlobalAutoDataSyncRuntimeState()
  if (globalRuntimeState.ownerId === AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID) {
    if (globalRuntimeState.remoteMetaCheckTimer) {
      clearTimeout(globalRuntimeState.remoteMetaCheckTimer)
    }
    globalRuntimeState.remoteMetaCheckTimer = null
  }
}

function schedulePeriodicAutoDataSyncMetaCheck(delayMs: number): void {
  clearPeriodicAutoDataSyncMetaCheck()
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return

  const globalRuntimeState = getGlobalAutoDataSyncRuntimeState()
  if (globalRuntimeState.ownerId !== AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID) return

  debugAutoDataSync('periodic remote meta check scheduled', {
    intervalMs: delayMs,
    intervalIndex: remoteMetaCheckIntervalIndex,
    runtimeId: AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID,
  })
  remoteMetaCheckTimer = setTimeout(() => {
    remoteMetaCheckTimer = null
    globalRuntimeState.remoteMetaCheckTimer = null
    void (async () => {
      const latestGlobalRuntimeState = getGlobalAutoDataSyncRuntimeState()
      if (latestGlobalRuntimeState.ownerId !== AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID) return

      const wasBusy = processing || applyingRemote || queue.length > 0
      const lastCompletedAt = state.lastCompletedAt
      await checkRemoteAutoDataSync('periodic', { uploadDirtyDomains: true })
      const completedWork = state.lastCompletedAt !== lastCompletedAt
      remoteMetaCheckIntervalIndex = wasBusy || completedWork
        ? 0
        : Math.min(
          remoteMetaCheckIntervalIndex + 1,
          AUTO_DATA_SYNC_META_CHECK_INTERVALS.length - 1,
        )
      schedulePeriodicAutoDataSyncMetaCheck(
        AUTO_DATA_SYNC_META_CHECK_INTERVALS[remoteMetaCheckIntervalIndex],
      )
    })()
  }, delayMs)
  globalRuntimeState.remoteMetaCheckTimer = remoteMetaCheckTimer
}

function startPeriodicAutoDataSyncMetaCheck(): void {
  if (remoteMetaCheckTimer) return

  const globalRuntimeState = getGlobalAutoDataSyncRuntimeState()
  if (globalRuntimeState.remoteMetaCheckTimer) {
    clearTimeout(globalRuntimeState.remoteMetaCheckTimer)
  }
  globalRuntimeState.ownerId = AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID
  globalRuntimeState.remoteMetaCheckTimer = null

  if (!remoteMetaVisibilityListenerAttached && typeof document !== 'undefined') {
    remoteMetaVisibilityListenerAttached = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearPeriodicAutoDataSyncMetaCheck()
        return
      }
      remoteMetaCheckIntervalIndex = 0
      schedulePeriodicAutoDataSyncMetaCheck(0)
    })
  }

  schedulePeriodicAutoDataSyncMetaCheck(
    AUTO_DATA_SYNC_META_CHECK_INTERVALS[remoteMetaCheckIntervalIndex],
  )
}

async function processQueue() {
  if (processing || queue.length === 0) {
    debugAutoDataSync('skip queue processing', {
      processing,
      pendingCount: queue.length,
    })
    return
  }

  const enabledDomains = await getEnabledAutoDataSyncDomains()
  queue = queue.filter(task => task.mode === 'manual' || enabledDomains.includes(task.domain))
  if (queue.length === 0) {
    debugAutoDataSync('clear disabled auto data sync domains from queue')
    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      status: 'idle',
      lastError: null,
    })
    return
  }

  if (!await isAutoDataSyncProviderConfigured()) {
    debugAutoDataSync('wait to process queue because provider is not configured')
    updateState({
      isSyncing: false,
      phase: 'waiting_provider',
      currentDomain: null,
      syncMode: null,
      status: 'waiting_provider',
      lastError: null,
    })
    scheduleProviderRetry()
    return
  }

  if (providerRetryTimer) {
    clearTimeout(providerRetryTimer)
    providerRetryTimer = null
  }

  startPeriodicAutoDataSyncMetaCheck()
  const dirtyDomains = (await getAutoDataSyncDirtyDomains(await Store.load('store.json')))
    .filter(domain => enabledDomains.includes(domain))
  for (const domain of dirtyDomains) {
    if (queue.some(task => task.domain === domain)) continue
    queue.push({
      id: `${Date.now()}-${++seq}`,
      seq,
      domain,
      reason: 'resume-dirty-domain',
      createdAt: Date.now(),
      retryCount: 0,
      mode: 'auto',
    })
  }

  processing = true
  debugAutoDataSync('queue processing started', { pendingCount: queue.length })

  while (queue.length > 0) {
    const readyTaskIndex = queue.findIndex(item => !item.readyAt || item.readyAt <= Date.now())
    if (readyTaskIndex < 0) {
      const nextReadyAt = Math.min(...queue.map(item => item.readyAt || Date.now()))
      if (taskRetryTimer) clearTimeout(taskRetryTimer)
      taskRetryTimer = setTimeout(() => {
        taskRetryTimer = null
        void processQueue()
      }, Math.max(0, nextReadyAt - Date.now()))
      break
    }
    const task = queue.splice(readyTaskIndex, 1)[0]
    if (!task) {
      continue
    }

    // A streaming reply can keep conversation data unstable for tens of
    // seconds. Revisit it later without occupying the other domains' queue.
    if (task.domain === 'conversations' && await isConversationSyncBusy()) {
      task.readyAt = Date.now() + 1_000
      queue.push(task)
      continue
    }

    debugAutoDataSync('task started', {
      id: task.id,
      seq: task.seq,
      domain: task.domain,
      reason: task.reason,
      mode: task.mode,
      retryCount: task.retryCount,
      remainingCount: queue.length,
    })
    const taskStartedAt = Date.now()

    try {
      updateState({
        isSyncing: true,
        phase: 'checking_remote',
        currentDomain: task.domain,
        syncMode: task.mode,
        status: 'syncing',
        lastError: null,
      })

      const store = await Store.load('store.json')
      const provider = await getAutoDataSyncProvider(store)
      if (
        task.domain === 'records'
        && await shouldPullRemoteRecordsBeforeUpload(store, provider, task.reason)
      ) {
        delete failedTasks.records
        delete failedTaskErrors.records
        processing = false
        debugAutoDataSync('upload converted to remote pull because local records are empty', {
          id: task.id,
          domain: task.domain,
          reason: task.reason,
          mode: task.mode,
          provider,
        })
        const downloaded = await downloadAutoDataSyncNow(task.mode, null, { domains: ['records'] })
        if (!downloaded) {
          failedTasks.records = task
          failedTaskErrors.records = state.lastError || 'Failed to download records'
        }
        if (queue.length > 0) await processQueue()
        return
      }

      const uploadDecision = await guardAutoDataSyncUploadAgainstRemoteNewer(task.domain)
      if (uploadDecision.action === 'merge') {
        const mergeDomains = uploadDecision.domains
        processing = false
        const merged = await mergeAutoDataSyncDomains(mergeDomains)
        if (!merged) {
          failedTasks[task.domain] = task
          failedTaskErrors[task.domain] = state.lastError || 'Failed to merge sync domain'
        } else {
          clearFailedAutoDataSyncDomains(mergeDomains)
        }
        if (queue.length > 0) await processQueue()
        return
      }

      if (uploadDecision.action === 'pull') {
        processing = false
        const downloaded = await downloadAutoDataSyncNow('auto', uploadDecision.remoteMeta, {
          domains: uploadDecision.domains,
        })
        if (!downloaded) {
          failedTasks[task.domain] = task
          failedTaskErrors[task.domain] = state.lastError || 'Failed to download sync domain'
        }
        if (queue.length > 0) await processQueue()
        return
      }

      updateState({
        isSyncing: true,
        phase: 'uploading',
        currentDomain: task.domain,
        syncMode: task.mode,
        status: 'syncing',
        lastError: null,
      })
      await uploadDomain(task.domain)
      debugAutoDataSync('domain uploaded', {
        domain: task.domain,
      })
      await uploadAutoDataSyncMeta([task.domain])
      dropRedundantFrontTasks(task.domain, taskStartedAt)
      if (!queue.some(item => item.domain === task.domain)) {
        await clearAutoDataSyncDirtyDomain(task.domain)
      }
      recordSyncTiming('syncTask', taskStartedAt, {
        domain: task.domain,
        mode: task.mode,
        reason: task.reason,
        retryCount: task.retryCount,
        success: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto data sync failed'
      recordSyncTiming('syncTask', taskStartedAt, {
        domain: task.domain,
        mode: task.mode,
        reason: task.reason,
        retryCount: task.retryCount,
        success: false,
      })

      if (task.retryCount < MAX_RETRY_COUNT) {
        task.retryCount += 1
        const retryDelay = Math.min(5_000 * 2 ** (task.retryCount - 1), 60_000)
        task.readyAt = Date.now() + retryDelay
        queue.push(task)
        debugAutoDataSync('task failed, retry scheduled', {
          id: task.id,
          domain: task.domain,
          retryCount: task.retryCount,
          retryDelayMs: retryDelay,
          message,
        })
        continue
      }

      failedTasks[task.domain] = task
      failedTaskErrors[task.domain] = message
      debugAutoDataSync('task failed after retries', {
        id: task.id,
        domain: task.domain,
        retryCount: task.retryCount,
        message,
      })
      queue = queue.filter(item => item.domain !== task.domain)
      if (queue.length > 0) {
        continue
      }
    }
  }

  processing = false
  if (queue.length > 0) {
    updateState({
      isSyncing: false,
      phase: 'queued',
      currentDomain: null,
      syncMode: null,
      status: 'queued',
    })
    return
  }
  const failedDomain = failedTasks.records
    ? 'records'
    : failedTasks.settings
      ? 'settings'
      : failedTasks.conversations
        ? 'conversations'
        : null
  if (failedDomain) {
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: failedTaskErrors[failedDomain] || 'Auto data sync failed',
      lastFailedAt: Date.now(),
      affectedDomains: [failedDomain],
    })
    return
  }
  debugAutoDataSync('queue processing completed')
  updateState({
    isSyncing: false,
    phase: 'idle',
    currentDomain: null,
    syncMode: null,
    status: 'idle',
    lastError: null,
    lastCompletedAt: Date.now(),
  })
}

function dropRedundantFrontTasks(domain: AutoDataSyncDomain, taskStartedAt: number) {
  while (queue[0]?.domain === domain && queue[0].createdAt <= taskStartedAt) {
    debugAutoDataSync('drop redundant queued task', {
      id: queue[0].id,
      domain,
      taskCreatedAt: queue[0].createdAt,
      taskStartedAt,
    })
    queue.shift()
  }
}

async function uploadDomain(domain: AutoDataSyncDomain) {
  const startedAt = Date.now()
  debugAutoDataSync('upload domain started', { domain })
  await ensureAutoDataSyncRemoteDataPath()
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)

  if (domain === 'records') {
    const [{ default: useTagStore }, { default: useMarkStore }] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
    ])

    const { getAllMarks } = await import('@/db/marks')
    const marks = await getAllMarks()
    await uploadRecordAssets(marks)
    const tagResult = await useTagStore.getState().uploadTags()
    const markResult = await useMarkStore.getState().uploadMarks()
    const canvasResult = await uploadCanvases()
    debugAutoDataSync('records upload results', {
      tags: tagResult,
      marks: markResult,
      canvases: canvasResult,
    })

    if (!tagResult || !markResult || !canvasResult) {
      throw new Error('Failed to upload records')
    }

    recordSyncTiming('domainUpload', startedAt, { domain, success: true })
    return
  }

  if (domain === 'conversations') {
    await waitForConversationSyncIdle()
    const result = await uploadConversations()
    debugAutoDataSync('conversations upload result', { conversations: result })
    if (!result) throw new Error('Failed to upload conversations')
    recordSyncTiming('domainUpload', startedAt, { domain, success: true })
    return
  }

  const { default: useSettingsSyncStore } = await import('@/stores/settingsSync')
  const { getMemorySyncData } = await import('@/db/memories')
  const result = await useSettingsSyncStore.getState().uploadSettings()
  const memoryResult = result
    ? await uploadMemorySyncData(store, provider, await getMemorySyncData())
    : false
  debugAutoDataSync('settings upload result', { settings: result, memories: memoryResult })

  if (!result || !memoryResult) {
    throw new Error('Failed to upload settings')
  }
  recordSyncTiming('domainUpload', startedAt, { domain, success: true })
}

async function uploadAutoDataSyncMeta(uploadedDomains: AutoDataSyncDomain[]) {
  const startedAt = Date.now()
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const now = Date.now()
  const deviceId = await getAutoDataSyncDeviceId()
  const previousMetadata = await downloadAutoDataSyncMeta(store, provider).catch(() => null)
  const domainStates: AutoDataSyncRemoteMeta['domainStates'] = {
    ...previousMetadata?.domainStates,
  }
  for (const domain of uploadedDomains) {
    domainStates[domain] = {
      updatedAt: new Date(now).toISOString(),
      updatedAtMs: now,
      deviceId,
    }
  }
  const metadata = {
    schemaVersion: 3,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    deviceId,
    provider,
    domains: AUTO_DATA_SYNC_DOMAINS,
    lastUploadedDomains: AUTO_DATA_SYNC_DOMAINS.filter(domain => uploadedDomains.includes(domain)),
    domainStates,
    files: {
      records: [AUTO_DATA_SYNC_TAGS_PATH, AUTO_DATA_SYNC_MARKS_PATH, CANVAS_SYNC_PATH, CANVAS_SYNC_ITEMS_DIRECTORY],
      settings: [AUTO_DATA_SYNC_SETTINGS_PATH, AUTO_DATA_SYNC_MEMORIES_PATH],
      conversations: [CONVERSATION_SYNC_INDEX_PATH, CONVERSATION_SYNC_DIRECTORY],
      meta: AUTO_DATA_SYNC_META_PATH,
    },
    appVersion: await getAppVersion(),
  }
  const content = JSON.stringify(metadata, null, 2)
  debugAutoDataSync('meta upload started', {
    provider,
    path: AUTO_DATA_SYNC_META_PATH,
    lastUploadedDomains: metadata.lastUploadedDomains,
    contentLength: content.length,
  })

  switch (provider) {
    case 'github':
    case 'gitee':
    case 'gitlab':
    case 'gitea':
      await uploadGitMetaFile(provider, content)
      break
    case 's3':
      await uploadS3MetaFile(store, content)
      break
    case 'webdav':
      await uploadWebDAVMetaFile(store, content)
      break
    case 'cloudFolder':
      await uploadCloudFolderMetaFile(store, content)
      break
    default:
      throw new Error('Sync provider is not configured')
  }

  const parsedMetadata = parseAutoDataSyncMeta(content)
  if (parsedMetadata) {
    await cacheAutoDataSyncMeta(store, provider, parsedMetadata)
  }

  await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY), now)
  await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_KEY), metadata)
  if (uploadedDomains.includes('settings')) {
    await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_MEMORY_SETTINGS_MIGRATED_KEY), true)
  }
  for (const domain of uploadedDomains) {
    await store.set(
      await getAutoDataSyncStateKey(`${AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY}:${domain}`),
      now,
    )
  }
  await store.save()
  await storeAutoDataSyncBaselineFingerprints(store, uploadedDomains)
  debugAutoDataSync('local upload meta stored', {
    updatedAtMs: metadata.updatedAtMs,
    provider: metadata.provider,
    deviceId: metadata.deviceId,
    lastUploadedDomains: metadata.lastUploadedDomains,
  })
  recordSyncTiming('metaUpload', startedAt, {
    provider,
    domains: uploadedDomains,
    bytes: new TextEncoder().encode(content).byteLength,
  })
}

async function guardAutoDataSyncUploadAgainstRemoteNewer(
  domain: AutoDataSyncDomain
): Promise<AutoDataSyncUploadGuardDecision> {
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const remoteMeta = await downloadAutoDataSyncMeta(store, provider)

  // Older releases uploaded memories in the records domain. Merge the existing
  // remote file once before the first settings upload, regardless of timestamps.
  if (domain === 'settings' && await needsMemorySettingsMigration(store)) {
    return { action: 'merge', domains: ['settings'] }
  }

  if (!remoteMeta) {
    debugAutoDataSync('pre-upload remote meta check found no metadata', { provider, domain })
    const hasUntrackedRemoteDomain = await hasUntrackedRemoteDomainBeforeUpload(store, provider, domain)
    if (!hasUntrackedRemoteDomain) {
      return { action: 'upload' }
    }

    return { action: 'merge', domains: [domain] }
  }

  const decision = await getRemoteMetaDecision(store, remoteMeta, undefined, domain)
  debugAutoDataSync('pre-upload remote meta decision', {
    provider,
    domain,
    remoteUpdatedAtMs: remoteMeta.updatedAtMs,
    localBaseline: decision.localBaseline,
    currentDeviceId: decision.currentDeviceId,
    remoteDeviceId: remoteMeta.deviceId,
    remoteFromCurrentDevice: decision.remoteFromCurrentDevice,
    remoteIsNewer: decision.remoteIsNewer,
    pendingCount: queue.length,
  })

  if (!decision.remoteIsNewer) {
    return { action: 'upload' }
  }

  const pendingDomains = [domain]
  // `lastUploadedDomains` only describes the latest metadata write. Another
  // domain may have a still-unapplied newer version in `domainStates`; using
  // the top-level list here can repeatedly pull an unrelated domain and starve
  // the task that is actually being uploaded.
  const remoteChangedDomains = await getRemoteNewerDomains(
    store,
    remoteMeta,
    pendingDomains,
    decision.currentDeviceId,
  )
  if (remoteChangedDomains.length === 0) {
    remoteChangedDomains.push(domain)
  }
  const conflictingDomains = pendingDomains.filter(item => remoteChangedDomains.includes(item))
  const remoteApplyDecision = conflictingDomains.length > 0
    ? await canApplyRemoteDomainsWithoutConflict(store, provider, conflictingDomains)
    : 'safe'

  if (remoteApplyDecision === 'safe') {
    return {
      action: 'pull',
      domains: remoteChangedDomains,
      remoteMeta,
    }
  }

  return { action: 'merge', domains: conflictingDomains }
}

async function checkRemoteAutoDataSync(
  reason: 'startup' | 'periodic',
  options: { uploadDirtyDomains?: boolean; force?: boolean } = {}
) {
  const startedAt = Date.now()
  let enabledDomains: AutoDataSyncDomain[] = []

  try {
    enabledDomains = await getEnabledAutoDataSyncDomains()
    if (enabledDomains.length === 0) {
      debugAutoDataSync('remote meta check skipped because auto data sync is disabled', { reason })
      return
    }

    if (!await isAutoDataSyncProviderConfigured()) {
      debugAutoDataSync('remote meta check skipped because provider is not configured', { reason })
      return
    }

    if (processing || applyingRemote || queue.length > 0) {
      debugAutoDataSync('remote meta check skipped because sync is busy', {
        reason,
        processing,
        applyingRemote,
        pendingCount: queue.length,
      })
      return
    }

    if (!options.force && reason === 'periodic' && state.phase === 'failed') {
      debugAutoDataSync('periodic remote meta check skipped because sync needs user attention', {
        phase: state.phase,
        lastError: state.lastError,
      })
      return
    }

    const store = await Store.load('store.json')
    const dirtyDomains = (await getAutoDataSyncDirtyDomains(store))
      .filter(domain => enabledDomains.includes(domain))
    const provider = await getAutoDataSyncProvider(store)
    debugAutoDataSync('remote meta check started', { reason, provider, dirtyDomains })
    updateState({
      isSyncing: false,
      phase: 'checking_remote',
      currentDomain: null,
      syncMode: 'auto',
      status: 'idle',
      lastError: null,
    })
    const remoteMeta = await downloadAutoDataSyncMeta(store, provider)

    if (!remoteMeta) {
      debugAutoDataSync('remote meta check found no metadata', {
        reason,
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
        dirtyDomains,
      })
      if (dirtyDomains.length > 0 && options.uploadDirtyDomains) {
        await uploadDirtyAutoDataSyncDomains(dirtyDomains, `${reason}-no-remote-meta`)
      } else {
        updateState({
          phase: 'idle',
          syncMode: null,
          status: 'idle',
        })
      }
      return
    }

    const currentDeviceId = await getAutoDataSyncDeviceId()
    const candidateRemoteDomains = remoteMeta.hasExplicitDomainStates
      ? AUTO_DATA_SYNC_DOMAINS.filter(domain => remoteMeta.domainStates[domain])
      : remoteMeta.domains.length > 0
        ? remoteMeta.domains
        : remoteMeta.lastUploadedDomains.length > 0
          ? remoteMeta.lastUploadedDomains
          : enabledDomains
    const remoteChangedDomains = await getRemoteNewerDomains(
      store,
      remoteMeta,
      candidateRemoteDomains.filter(domain => enabledDomains.includes(domain)),
      currentDeviceId,
    )
    const remoteIsNewer = remoteChangedDomains.length > 0
    const hasDirtyDomains = dirtyDomains.length > 0
    const shouldPull = remoteIsNewer && !hasDirtyDomains

    debugAutoDataSync('remote meta decision', {
      reason,
      provider,
      remoteUpdatedAtMs: remoteMeta.updatedAtMs,
      currentDeviceId,
      remoteIsNewer,
      dirtyDomains,
      shouldPull,
      remoteChangedDomains,
      domains: remoteMeta.domains,
      lastUploadedDomains: remoteMeta.lastUploadedDomains,
    })

    if (hasDirtyDomains) {
      if (remoteIsNewer) {
        const conflictingDomains = dirtyDomains.filter(domain => remoteChangedDomains.includes(domain))
        const remoteApplyDecision = conflictingDomains.length > 0
          ? await canApplyRemoteDomainsWithoutConflict(store, provider, conflictingDomains)
          : 'safe'
        debugAutoDataSync('dirty domains remote apply decision completed', {
          reason,
          dirtyDomains,
          remoteChangedDomains,
          conflictingDomains,
          remoteApplyDecision,
        })

        if (remoteApplyDecision === 'safe') {
          const downloaded = await downloadAutoDataSyncNow('auto', remoteMeta, {
            domains: remoteChangedDomains,
          })
          const failedDomains = downloaded ? [] : [...state.affectedDomains]
          const failureMessage = downloaded ? null : state.lastError
          if (options.uploadDirtyDomains) {
            const remainingDirtyDomains = (await getAutoDataSyncDirtyDomains(store))
              .filter(domain => !remoteChangedDomains.includes(domain))
            if (remainingDirtyDomains.length > 0) {
              await uploadDirtyAutoDataSyncDomains(
                remainingDirtyDomains,
                `${reason}-after-remote-domain-pull`
              )
            }
          }
          if (failedDomains.length > 0) {
            updateState({
              isSyncing: false,
              phase: 'failed',
              status: 'failed',
              lastError: failureMessage,
              lastFailedAt: Date.now(),
              affectedDomains: failedDomains,
            })
          }
          return
        }

        const merged = await mergeAutoDataSyncDomains(conflictingDomains)
        const failedDomains = merged ? [] : [...state.affectedDomains]
        const failureMessage = merged ? null : state.lastError
        if (options.uploadDirtyDomains) {
          const remainingDirtyDomains = (await getAutoDataSyncDirtyDomains(store))
            .filter(domain => !conflictingDomains.includes(domain))
          if (remainingDirtyDomains.length > 0) {
            await uploadDirtyAutoDataSyncDomains(
              remainingDirtyDomains,
              `${reason}-after-automatic-domain-merge`,
            )
          }
        }
        if (failedDomains.length > 0) {
          updateState({
            isSyncing: false,
            phase: 'failed',
            status: 'failed',
            lastError: failureMessage,
            lastFailedAt: Date.now(),
            affectedDomains: failedDomains,
          })
        }
        return
      }

      if (!options.uploadDirtyDomains) {
        debugAutoDataSync('remote meta pull skipped because local data is dirty', {
          reason,
          dirtyDomains,
          remoteIsNewer,
        })
        updateState({
          phase: 'idle',
          syncMode: null,
          status: 'idle',
        })
        return
      }

      await uploadDirtyAutoDataSyncDomains(dirtyDomains, `${reason}-local-dirty`)
      return
    }

    if (!shouldPull) {
      updateState({
        phase: 'idle',
        syncMode: null,
        status: 'idle',
      })
      return
    }

    const downloaded = await downloadAutoDataSyncNow('auto', remoteMeta, {
      domains: remoteChangedDomains,
    })
    if (!downloaded) {
      debugAutoDataSync('remote pull failed', { reason })
      return
    }

    debugAutoDataSync('remote pull completed', {
      reason,
      remoteUpdatedAtMs: remoteMeta.updatedAtMs,
    })
  } catch (error) {
    debugAutoDataSync('remote meta check failed', {
      reason,
      error: getAutoDataSyncErrorMessage(error, 'Unknown error'),
    })
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: error instanceof Error ? error.message : 'Failed to check remote sync metadata',
      lastFailedAt: Date.now(),
      affectedDomains: enabledDomains,
    })
  } finally {
    recordSyncTiming('metaCheck', startedAt, {
      reason,
      phase: state.phase,
      status: state.status,
      enabledDomains,
    })
  }
}

async function uploadDirtyAutoDataSyncDomains(dirtyDomains: AutoDataSyncDomain[], reason: string) {
  debugAutoDataSync('startup dirty domains upload requested', {
    dirtyDomains,
    reason,
  })

  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  if (
    dirtyDomains.includes('records')
    && await shouldPullRemoteRecordsBeforeUpload(store, provider, reason)
  ) {
    debugAutoDataSync('dirty domains upload converted to remote pull because local records are empty', {
      reason,
      provider,
      dirtyDomains,
    })
    await downloadAutoDataSyncNow('auto', null, { domains: ['records'] })
    dirtyDomains = dirtyDomains.filter(domain => domain !== 'records')
    if (dirtyDomains.length === 0) return
  }

  for (const domain of dirtyDomains) {
    enqueueAutoDataSync(domain, reason, 'auto')
  }

  await flushAutoDataSyncNow()

  debugAutoDataSync('startup dirty domains upload completed', {
    dirtyDomains,
    status: state.status,
    lastError: state.lastError,
  })
}

async function assertRemoteRecordsSafeForDownload(
  store: Store,
  provider: AutoDataSyncProvider,
  mode: 'auto' | 'manual',
  options: AutoDataSyncDownloadOptions
) {
  const [{ getAllMarks }, remoteMarksContent] = await Promise.all([
    import('@/db/marks'),
    downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MARKS_PATH),
  ])
  const localMarks = await getAllMarks()

  if (!remoteMarksContent) {
    debugAutoDataSync('remote records safety check skipped because remote marks file is missing', {
      mode,
      provider,
      localMarksCount: localMarks.length,
    })
    return
  }

  const remoteMarks = parseRemoteJsonArray<Mark>(remoteMarksContent)
  if (!remoteMarks) {
    debugAutoDataSync('remote records safety check failed because remote marks are invalid', {
      mode,
      provider,
      localMarksCount: localMarks.length,
    })
    throw new Error('Remote records file is invalid. Pull was blocked to avoid data loss.')
  }

  debugAutoDataSync('remote records safety check completed', {
    mode,
    provider,
    localMarksCount: localMarks.length,
    remoteMarksCount: remoteMarks.length,
  })

  if (!options.allowRemoteEmptyRecords && localMarks.length > 0 && remoteMarks.length === 0) {
    throw new Error(AUTO_DATA_SYNC_REMOTE_RECORD_ERASE_MESSAGE)
  }
}

async function createAutoDataSyncLocalRecordSnapshot(reason: string): Promise<AutoDataSyncRecordSnapshot | null> {
  try {
    const [tagsDb, marksDb, canvasesDb, store] = await Promise.all([
      import('@/db/tags'),
      import('@/db/marks'),
      import('@/db/canvases'),
      Store.load('store.json'),
    ])
    const [tags, marks, canvases] = await Promise.all([
      tagsDb.getTags(),
      marksDb.getAllMarks(),
      canvasesDb.getCanvasProjects({ includeDeleted: true }),
    ])

    if (tags.length === 0 && marks.length === 0 && canvases.length === 0) {
      debugAutoDataSync('local record snapshot skipped because records are empty', { reason })
      return null
    }

    const now = Date.now()
    const snapshot: AutoDataSyncRecordSnapshot = {
      schemaVersion: 1,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      reason,
      tags,
      marks,
      canvases,
    }
    const previousSnapshots = await getAutoDataSyncStateValue<AutoDataSyncRecordSnapshot[]>(store, AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY)
    const snapshots = Array.isArray(previousSnapshots) ? previousSnapshots : []
    await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY), [
      snapshot,
      ...snapshots,
    ].slice(0, MAX_AUTO_DATA_SYNC_RECORD_SNAPSHOTS))
    await store.save()
    debugAutoDataSync('local record snapshot stored', {
      reason,
      createdAtMs: snapshot.createdAtMs,
      tagsCount: snapshot.tags.length,
      marksCount: snapshot.marks.length,
      canvasesCount: snapshot.canvases.length,
    })
    return snapshot
  } catch (error) {
    debugAutoDataSync('local record snapshot failed', {
      reason,
      error: getAutoDataSyncErrorMessage(error, 'Unknown error'),
    })
    return null
  }
}

async function restoreAutoDataSyncLocalRecordSnapshot(
  snapshot: AutoDataSyncRecordSnapshot,
  reason: string
) {
  let restoreStage = 'initialize'
  try {
    setAutoDataSyncApplyingRemote(true)
    const [
      { default: useTagStore },
      { default: useMarkStore },
      { default: useCanvasStore },
      canvasesDb,
      memoriesDb,
    ] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
      import('@/stores/canvas'),
      import('@/db/canvases'),
      import('@/db/memories'),
    ])

    const { replaceRecordSnapshot } = await import('@/db/record-snapshot')
    restoreStage = 'replace-record-snapshot'
    await replaceRecordSnapshot(snapshot.marks, snapshot.tags)
    restoreStage = 'restore-canvases'
    await canvasesDb.replaceAllCanvasProjects(snapshot.canvases)
    restoreStage = 'refresh-tags'
    await useTagStore.getState().fetchTags()
    if (snapshot.memoryData) {
      restoreStage = 'restore-memories'
      await memoriesDb.replaceMemorySyncData(snapshot.memoryData)
    }
    restoreStage = 'refresh-local-stores'
    await Promise.all([
      useMarkStore.getState().fetchMarks(),
      useMarkStore.getState().fetchAllMarks(),
      useCanvasStore.getState().loadProjects(),
    ])
    useTagStore.getState().getCurrentTag()
    if (snapshot.memoryData) {
      restoreStage = 'refresh-memory-store'
      const { default: useMemoriesStore } = await import('@/stores/memories')
      await Promise.all([
        useMemoriesStore.getState().loadMemories(),
        useMemoriesStore.getState().loadStats(),
        useMemoriesStore.getState().loadPolicy(),
      ])
    }
    debugAutoDataSync('local record snapshot restored', {
      reason,
      snapshotReason: snapshot.reason,
      createdAtMs: snapshot.createdAtMs,
      tagsCount: snapshot.tags.length,
      marksCount: snapshot.marks.length,
      canvasesCount: snapshot.canvases.length,
      memoriesCount: snapshot.memoryData?.memories.length || 0,
    })
  } catch (error) {
    debugAutoDataSync('local record snapshot restore failed', {
      reason,
      createdAtMs: snapshot.createdAtMs,
      stage: restoreStage,
      error: getAutoDataSyncErrorMessage(error, 'Unknown error'),
    })
  } finally {
    setAutoDataSyncApplyingRemote(false)
  }
}

async function hasUntrackedRemoteDomainBeforeUpload(
  store: Store,
  provider: AutoDataSyncProvider,
  domain: AutoDataSyncDomain
) {
  if (domain === 'settings') {
    const [remoteSettingsContent, remoteMemoryContent] = await Promise.all([
      downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_SETTINGS_PATH),
      downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MEMORIES_PATH),
    ])
    return Boolean(remoteSettingsContent || remoteMemoryContent)
  }

  if (domain === 'conversations') {
    return hasRemoteConversationSyncData()
  }

  const [{ getAllMarks }, remoteMarksContent] = await Promise.all([
    import('@/db/marks'),
    downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MARKS_PATH),
  ])

  if (!remoteMarksContent) {
    return false
  }

  const localMarks = await getAllMarks()
  const remoteMarks = parseRemoteJsonArray<Mark>(remoteMarksContent)
  if (!remoteMarks) {
    debugAutoDataSync('upload blocked because untracked remote marks are invalid', {
      provider,
      domain,
      localMarksCount: localMarks.length,
    })
    return true
  }

  const hasConflict = remoteMarks.length > 0 && !areMarkCollectionsEquivalent(localMarks, remoteMarks)
  debugAutoDataSync('untracked remote records upload guard checked', {
    provider,
    domain,
    localMarksCount: localMarks.length,
    remoteMarksCount: remoteMarks.length,
    hasConflict,
  })

  return hasConflict
}

async function shouldPullRemoteRecordsBeforeUpload(
  store: Store,
  provider: AutoDataSyncProvider,
  reason: string
): Promise<boolean> {
  try {
    const { getAllMarks } = await import('@/db/marks')
    const localMarks = await getAllMarks()

    if (localMarks.length > 0) {
      debugAutoDataSync('empty local records upload guard skipped', {
        reason,
        provider,
        localMarksCount: localMarks.length,
      })
      return false
    }

    const remoteMarksContent = await downloadAutoDataSyncRemoteFileContent(
      store,
      provider,
      AUTO_DATA_SYNC_MARKS_PATH
    )
    const remoteMarksCount = getRemoteMarksCount(remoteMarksContent)
    debugAutoDataSync('empty local records upload guard checked', {
      reason,
      provider,
      localMarksCount: localMarks.length,
      remoteMarksCount,
    })

    return remoteMarksCount > 0
  } catch (error) {
    debugAutoDataSync('empty local records upload guard failed', {
      reason,
      provider,
      message: error instanceof Error ? error.message : 'unknown error',
    })
    return false
  }
}

function getRemoteMarksCount(content: string | null): number {
  return parseRemoteJsonArray<Mark>(content)?.length || 0
}

function parseRemoteJsonArray<T>(content: string | null): T[] | null {
  if (!content) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(content)
    return Array.isArray(parsed) ? parsed as T[] : null
  } catch {
    return null
  }
}

function parseRemoteJsonRecord(content: string | null): Record<string, unknown> | null {
  if (!content) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function parseMemorySyncData(content: string | null): MemorySyncData | null {
  const parsed = parseRemoteJsonRecord(content)
  if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.memories)) return null
  const policy = parsed.policy
  if (
    typeof policy !== 'object'
    || policy === null
    || Array.isArray(policy)
    || typeof (policy as Record<string, unknown>).generateMemories !== 'boolean'
    || !isFiniteNumber((policy as Record<string, unknown>).generationStartedAt)
    || !isFiniteNumber((policy as Record<string, unknown>).updatedAt)
  ) {
    return null
  }

  const memories = parsed.memories
  if (!memories.every(isMemorySyncRecord)) return null
  const ids = new Set<string>()
  for (const memory of memories) {
    if (ids.has(memory.id)) return null
    ids.add(memory.id)
  }
  return {
    schemaVersion: 1,
    memories: memories as MemorySyncRecord[],
    policy: {
      useMemories: true,
      generateMemories: (policy as Record<string, unknown>).generateMemories as boolean,
      excludeExternalContext: true,
      generationStartedAt: (policy as Record<string, unknown>).generationStartedAt as number,
      updatedAt: (policy as Record<string, unknown>).updatedAt as number,
    },
  }
}

function isMemorySyncRecord(value: unknown): value is MemorySyncRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const memory = value as Record<string, unknown>
  const optionalString = (field: string) =>
    memory[field] === undefined || memory[field] === null || typeof memory[field] === 'string'
  const optionalNumber = (field: string) =>
    memory[field] === undefined || memory[field] === null || isFiniteNumber(memory[field])

  return typeof memory.id === 'string' && memory.id.length > 0
    && typeof memory.content === 'string'
    && (memory.category === 'preference' || memory.category === 'memory')
    && (memory.kind === 'preference' || memory.kind === 'fact' || memory.kind === 'experience' || memory.kind === 'decision')
    && (memory.scopeType === 'global' || memory.scopeType === 'workspace')
    && (memory.scopeType !== 'workspace' || (typeof memory.scopeId === 'string' && memory.scopeId.length > 0))
    && (memory.applyMode === 'always' || memory.applyMode === 'relevant')
    && (memory.status === 'active' || memory.status === 'pending' || memory.status === 'archived')
    && (memory.origin === 'manual' || memory.origin === 'explicit_chat' || memory.origin === 'auto_chat')
    && isFiniteNumber(memory.confidence) && memory.confidence >= 0 && memory.confidence <= 1
    && (memory.sensitivity === 'normal' || memory.sensitivity === 'suspected_sensitive')
    && isFiniteNumber(memory.createdAt)
    && isFiniteNumber(memory.updatedAt)
    && optionalString('scopeId')
    && optionalString('conflictKey')
    && optionalString('replacedId')
    && optionalNumber('archivedAt')
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

async function getRemoteMemorySyncData(
  store: Store,
  provider: AutoDataSyncProvider,
): Promise<MemorySyncData | null> {
  const content = await downloadAutoDataSyncRemoteFileContent(
    store,
    provider,
    AUTO_DATA_SYNC_MEMORIES_PATH,
  )
  if (!content) return null
  const data = parseMemorySyncData(content)
  if (!data) throw new Error('Remote memories file is invalid')
  return data
}

async function downloadMemorySyncData(store: Store, provider: AutoDataSyncProvider): Promise<boolean> {
  const data = await getRemoteMemorySyncData(store, provider)
  if (!data) return true
  const { replaceMemorySyncData } = await import('@/db/memories')
  await replaceMemorySyncData(data)
  return true
}

function mergeMemorySyncData(
  local: MemorySyncData | null,
  remote: MemorySyncData | null,
): MemorySyncData | null {
  if (!local) return remote
  if (!remote) return local

  const byId = new Map(local.memories.map(memory => [memory.id, memory]))
  for (const memory of remote.memories) {
    const localMemory = byId.get(memory.id)
    if (!localMemory || memory.updatedAt >= localMemory.updatedAt) {
      byId.set(memory.id, memory)
    }
  }
  return {
    schemaVersion: 1,
    memories: Array.from(byId.values()),
    policy: remote.policy.updatedAt >= local.policy.updatedAt
      ? remote.policy
      : local.policy,
  }
}

async function getAutoDataSyncContentFingerprints(
  store: Store,
  provider: AutoDataSyncProvider,
  domain: AutoDataSyncDomain
): Promise<AutoDataSyncContentFingerprints | null> {
  const local = await getLocalAutoDataSyncDomainFingerprint(store, domain)

  if (domain === 'records') {
    const [remoteTagsContent, remoteMarksContent, remoteCanvasIndexContent] = await Promise.all([
      downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_TAGS_PATH),
      downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MARKS_PATH),
      downloadAutoDataSyncRemoteFileContent(store, provider, CANVAS_SYNC_PATH),
    ])
    const remoteTags = parseRemoteJsonArray<Tag>(remoteTagsContent)
    const remoteMarks = parseRemoteJsonArray<Mark>(remoteMarksContent)
    const remoteCanvasIndex = parseCanvasSyncIndex(remoteCanvasIndexContent)
    const remoteCanvases = remoteCanvasIndex?.canvases || (
      parseRemoteJsonArray<CanvasProject>(
        await downloadAutoDataSyncRemoteFileContent(store, provider, LEGACY_CANVAS_SYNC_PATH)
      ) || []
    )
    if (!remoteTags || !remoteMarks) {
      return null
    }

    return {
      local,
      remote: stableSerialize({
        tags: remoteTags.map(getTagSyncKey).sort(),
        marks: remoteMarks.map(getMarkSyncKey).sort(),
        canvases: remoteCanvases.map(project => [project.id, project.updatedAt, project.deletedAt, project.pinnedAt, project.title]),
      }),
    }
  }

  if (domain === 'conversations') {
    const remoteIndexContent = await downloadAutoDataSyncRemoteFileContent(
      store,
      provider,
      CONVERSATION_SYNC_INDEX_PATH,
    )
    const remote = getRemoteConversationSyncFingerprint(remoteIndexContent)
    return remote ? { local, remote } : null
  }

  const [remoteSettingsContent, remoteMemoriesContent] = await Promise.all([
    downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_SETTINGS_PATH),
    downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MEMORIES_PATH),
  ])
  const remoteSettings = parseRemoteJsonRecord(remoteSettingsContent)
  const remoteMemoryData = remoteMemoriesContent ? parseMemorySyncData(remoteMemoriesContent) : null
  if (!remoteSettings || (remoteMemoriesContent && !remoteMemoryData)) {
    return null
  }

  const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
  return {
    local,
    remote: stableSerialize({
      settings: filterSyncData(remoteSettings, { excludeSensitiveConfig }),
      memories: remoteMemoryData?.memories.map(getMemorySyncKey).sort() || [],
      memoryPolicy: remoteMemoryData?.policy || null,
    }),
  }
}

async function getLocalAutoDataSyncDomainFingerprint(
  store: Store,
  domain: AutoDataSyncDomain
): Promise<string> {
  if (domain === 'records') {
    const [tagsDb, marksDb, canvasesDb] = await Promise.all([
      import('@/db/tags'),
      import('@/db/marks'),
      import('@/db/canvases'),
    ])
    const [tags, marks, canvases] = await Promise.all([
      tagsDb.getTags(),
      marksDb.getAllMarks(),
      canvasesDb.getCanvasProjects({ includeDeleted: true }),
    ])
    return stableSerialize({
      tags: tags.map(getTagSyncKey).sort(),
      marks: marks.map(getMarkSyncKey).sort(),
      canvases: canvases.map(project => [project.id, project.updatedAt, project.deletedAt, project.pinnedAt, project.title]),
    })
  }

  if (domain === 'conversations') {
    return getLocalConversationSyncFingerprint()
  }

  const localSettings = Object.fromEntries(await store.entries()) as Record<string, unknown>
  const excludeSensitiveConfig = await store.get<boolean>('excludeSensitiveConfig') !== false
  const { getMemorySyncData } = await import('@/db/memories')
  const memoryData = await getMemorySyncData()
  return stableSerialize({
    settings: filterSyncData(localSettings, { excludeSensitiveConfig }),
    memories: memoryData.memories.map(getMemorySyncKey).sort(),
    memoryPolicy: memoryData.policy,
  })
}

async function getAutoDataSyncBaselineFingerprints(store: Store) {
  const value = await getAutoDataSyncStateValue<AutoDataSyncDomainFingerprints>(store, AUTO_DATA_SYNC_BASELINE_FINGERPRINTS_KEY)
  return value && typeof value === 'object' ? value : {}
}

async function storeAutoDataSyncBaselineFingerprints(
  store: Store,
  domains: AutoDataSyncDomain[]
) {
  const fingerprints = await getAutoDataSyncBaselineFingerprints(store)
  for (const domain of domains) {
    fingerprints[domain] = await getLocalAutoDataSyncDomainFingerprint(store, domain)
  }
  await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_BASELINE_FINGERPRINTS_KEY), fingerprints)
  await store.save()
}

async function initializeMissingAutoDataSyncBaselineFingerprints(store: Store) {
  const lastCompletedAt = await getAutoDataSyncLastCompletedAt(store)
  if (lastCompletedAt <= 0) {
    return
  }

  const [fingerprints, dirtyDomains] = await Promise.all([
    getAutoDataSyncBaselineFingerprints(store),
    getAutoDataSyncDirtyDomains(store),
  ])
  const cleanDomainsWithoutBaseline = AUTO_DATA_SYNC_DOMAINS.filter(domain => (
    !dirtyDomains.includes(domain) && !fingerprints[domain]
  ))
  if (cleanDomainsWithoutBaseline.length === 0) {
    return
  }

  await storeAutoDataSyncBaselineFingerprints(store, cleanDomainsWithoutBaseline)
}

async function canApplyRemoteDomainsWithoutConflict(
  store: Store,
  provider: AutoDataSyncProvider,
  domains: AutoDataSyncDomain[]
): Promise<AutoDataSyncRemoteApplyDecision> {
  try {
    const baselines = await getAutoDataSyncBaselineFingerprints(store)

    for (const domain of domains) {
      if (domain === 'records') {
        const [{ getAllMarks }, remoteMarksContent] = await Promise.all([
          import('@/db/marks'),
          downloadAutoDataSyncRemoteFileContent(store, provider, AUTO_DATA_SYNC_MARKS_PATH),
        ])
        const localMarks = await getAllMarks()
        const remoteMarks = parseRemoteJsonArray<Mark>(remoteMarksContent)
        if (localMarks.length > 0 && remoteMarks?.length === 0) {
          return 'conflict'
        }
      }

      const fingerprints = await getAutoDataSyncContentFingerprints(store, provider, domain)
      if (!fingerprints) {
        return 'unavailable'
      }

      if (fingerprints.local === fingerprints.remote) {
        continue
      }

      if (baselines[domain] && fingerprints.local === baselines[domain]) {
        continue
      }

      return 'conflict'
    }

    return 'safe'
  } catch (error) {
    debugAutoDataSync('remote apply decision failed', {
      provider,
      domains,
      message: error instanceof Error ? error.message : 'unknown error',
    })
    return 'unavailable'
  }
}

function areMarkCollectionsEquivalent(left: Mark[], right: Mark[]) {
  if (left.length !== right.length) {
    return false
  }

  const rightKeys = new Set(right.map(getMarkExactKey))
  return left.every(mark => rightKeys.has(getMarkExactKey(mark)))
}

async function downloadAutoDataSyncRemoteFileContent(
  store: Store,
  provider: AutoDataSyncProvider,
  path: string
): Promise<string | null> {
  switch (provider) {
    case 'github': {
      const { getFiles } = await import('@/lib/sync/github')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path, repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitee': {
      const { getFiles } = await import('@/lib/sync/gitee')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path, repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitlab': {
      const { getDefaultBranch, getFileContent } = await import('@/lib/sync/gitlab')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFileContent({ path, ref: await getDefaultBranch(repo), repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitea': {
      const { getFiles } = await import('@/lib/sync/gitea')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path, repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      if (!config) {
        return null
      }
      const { s3Download } = await import('@/lib/sync/s3')
      const file = await s3Download(config, path)
      return file?.content || null
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!config) {
        return null
      }
      const { webdavDownload } = await import('@/lib/sync/webdav')
      const file = await webdavDownload(config, path)
      return file?.content || null
    }
    case 'cloudFolder': {
      const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (!config) return null
      const { cloudFolderDownload } = await import('@/lib/sync/cloud-folder')
      return (await cloudFolderDownload(config, path))?.content || null
    }
  }
}

async function getAutoDataSyncMetaCacheKey(
  store: Store,
  provider: AutoDataSyncProvider,
): Promise<string> {
  if (provider === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    return JSON.stringify([
      provider,
      config?.provider || 'folder',
      config?.path || '',
      config?.oneDriveClientId || '',
      config?.oneDriveRootId || '',
    ])
  }
  if (provider === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    return JSON.stringify([
      provider,
      config?.endpoint || '',
      config?.region || '',
      config?.bucket || '',
      config?.pathPrefix || '',
    ])
  }
  if (provider === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    return JSON.stringify([provider, config?.url || '', config?.pathPrefix || ''])
  }
  return JSON.stringify([provider, await getDataSyncRepoName(provider)])
}

async function cacheAutoDataSyncMeta(
  store: Store,
  provider: AutoDataSyncProvider,
  value: AutoDataSyncRemoteMeta | null,
): Promise<void> {
  remoteMetaCache.set(await getAutoDataSyncMetaCacheKey(store, provider), {
    value,
    cachedAt: Date.now(),
  })
}

async function downloadAutoDataSyncMeta(
  store: Store,
  provider: AutoDataSyncProvider,
): Promise<AutoDataSyncRemoteMeta | null> {
  const cacheKey = await getAutoDataSyncMetaCacheKey(store, provider)
  const cached = remoteMetaCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < AUTO_DATA_SYNC_META_CACHE_TTL) {
    debugAutoDataSync('remote meta cache hit', { provider })
    return cached.value
  }

  const pending = remoteMetaRequests.get(cacheKey)
  if (pending) {
    debugAutoDataSync('remote meta request joined', { provider })
    return pending
  }

  const request = downloadAutoDataSyncMetaUncached(store, provider)
    .then((value) => {
      remoteMetaCache.set(cacheKey, { value, cachedAt: Date.now() })
      return value
    })
    .finally(() => {
      remoteMetaRequests.delete(cacheKey)
    })
  remoteMetaRequests.set(cacheKey, request)
  return request
}

async function downloadAutoDataSyncMetaUncached(
  store: Store,
  provider: AutoDataSyncProvider
): Promise<AutoDataSyncRemoteMeta | null> {
  const startedAt = Date.now()
  let content: string | null = null

  switch (provider) {
    case 'github': {
      const { getFiles } = await import('@/lib/sync/github')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitee': {
      const { getFiles } = await import('@/lib/sync/gitee')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitlab': {
      const { getDefaultBranch, getFileContent } = await import('@/lib/sync/gitlab')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFileContent({ path: AUTO_DATA_SYNC_META_PATH, ref: await getDefaultBranch(repo), repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitea': {
      const { getFiles } = await import('@/lib/sync/gitea')
      const repo = await getDataSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      if (!config) {
        return null
      }
      const { s3Download } = await import('@/lib/sync/s3')
      const file = await s3Download(config, AUTO_DATA_SYNC_META_PATH)
      content = file?.content || null
      break
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!config) {
        return null
      }
      const { webdavDownload } = await import('@/lib/sync/webdav')
      const file = await webdavDownload(config, AUTO_DATA_SYNC_META_PATH)
      content = file?.content || null
      break
    }
    case 'cloudFolder': {
      const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (!config) return null
      const { cloudFolderDownload } = await import('@/lib/sync/cloud-folder')
      content = (await cloudFolderDownload(config, AUTO_DATA_SYNC_META_PATH))?.content || null
      break
    }
  }

  const metadata = parseAutoDataSyncMeta(content)
  recordSyncTiming('metaDownload', startedAt, {
    provider,
    found: Boolean(metadata),
    bytes: content ? new TextEncoder().encode(content).byteLength : 0,
  })
  return metadata
}

function decodeRemoteGitFileContent(file: unknown, path: string): string | null {
  if (!file) {
    return null
  }

  try {
    return decodeBase64ToString(getRemoteFileContent(file, path))
  } catch {
    return null
  }
}

function parseAutoDataSyncMeta(content: string | null): AutoDataSyncRemoteMeta | null {
  if (!content) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }

    const data = parsed as Record<string, unknown>
    const parsedUpdatedAtMs = typeof data.updatedAtMs === 'number'
      ? data.updatedAtMs
      : typeof data.updatedAt === 'string'
        ? Date.parse(data.updatedAt)
        : 0

    if (!Number.isFinite(parsedUpdatedAtMs) || parsedUpdatedAtMs <= 0) {
      return null
    }

    const domains = normalizeAutoDataSyncDomains(data.domains)
    const lastUploadedDomains = normalizeAutoDataSyncDomains(data.lastUploadedDomains)
    const domainStates = normalizeAutoDataSyncDomainStates(
      data.domainStates,
      parsedUpdatedAtMs,
      typeof data.updatedAt === 'string' ? data.updatedAt : null,
      typeof data.deviceId === 'string' ? data.deviceId : null,
      lastUploadedDomains.length > 0 ? lastUploadedDomains : domains,
    )

    return {
      updatedAtMs: parsedUpdatedAtMs,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      deviceId: typeof data.deviceId === 'string' ? data.deviceId : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
      domains,
      lastUploadedDomains,
      domainStates,
      hasExplicitDomainStates: typeof data.domainStates === 'object'
        && data.domainStates !== null
        && !Array.isArray(data.domainStates),
    }
  } catch {
    return null
  }
}

function normalizeAutoDataSyncDomainStates(
  value: unknown,
  legacyUpdatedAtMs: number,
  legacyUpdatedAt: string | null,
  legacyDeviceId: string | null,
  legacyDomains: AutoDataSyncDomain[],
) {
  const result: AutoDataSyncRemoteMeta['domainStates'] = {}
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = value as Record<string, unknown>
    for (const domain of AUTO_DATA_SYNC_DOMAINS) {
      const stateValue = entries[domain]
      if (typeof stateValue !== 'object' || stateValue === null || Array.isArray(stateValue)) continue
      const stateRecord = stateValue as Record<string, unknown>
      if (typeof stateRecord.updatedAtMs !== 'number' || !Number.isFinite(stateRecord.updatedAtMs)) continue
      result[domain] = {
        updatedAtMs: stateRecord.updatedAtMs,
        updatedAt: typeof stateRecord.updatedAt === 'string' ? stateRecord.updatedAt : null,
        deviceId: typeof stateRecord.deviceId === 'string' ? stateRecord.deviceId : null,
      }
    }
  }

  for (const domain of legacyDomains) {
    result[domain] ??= {
      updatedAtMs: legacyUpdatedAtMs,
      updatedAt: legacyUpdatedAt,
      deviceId: legacyDeviceId,
    }
  }
  return result
}

function normalizeAutoDataSyncDomains(value: unknown): AutoDataSyncDomain[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isAutoDataSyncDomain)
}

function isAutoDataSyncDomain(value: unknown): value is AutoDataSyncDomain {
  return value === 'records' || value === 'settings' || value === 'conversations'
}

async function getAutoDataSyncProvider(store: Store): Promise<AutoDataSyncProvider> {
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  if (
    provider === 'github' ||
    provider === 'gitee' ||
    provider === 'gitlab' ||
    provider === 'gitea' ||
    provider === 's3' ||
    provider === 'webdav' ||
    provider === 'cloudFolder'
  ) {
    return provider
  }

  return 'github'
}

async function getStoredNumber(store: Store, key: string) {
  const value = await getAutoDataSyncStateValue<number>(store, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function getAutoDataSyncLastCompletedAt(store: Store) {
  const lastLocalUploadAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY)
  const lastAppliedRemoteAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY)
  return Math.max(lastLocalUploadAt, lastAppliedRemoteAt)
}

async function getAutoDataSyncDomainLastCompletedAt(store: Store, domain: AutoDataSyncDomain) {
  const [lastLocalUploadAt, lastAppliedRemoteAt] = await Promise.all([
    getStoredNumber(store, `${AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY}:${domain}`),
    getStoredNumber(store, `${AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY}:${domain}`),
  ])
  return Math.max(lastLocalUploadAt, lastAppliedRemoteAt)
}

async function getRemoteMetaDecision(
  store: Store,
  remoteMeta: AutoDataSyncRemoteMeta,
  currentDeviceId?: string,
  domain?: AutoDataSyncDomain,
) {
  const deviceId = currentDeviceId || await getAutoDataSyncDeviceId()
  const remoteDomainState = domain ? remoteMeta.domainStates[domain] : undefined
  const remoteUpdatedAtMs = remoteDomainState?.updatedAtMs ?? remoteMeta.updatedAtMs
  const remoteDeviceId = remoteDomainState?.deviceId ?? remoteMeta.deviceId
  const localBaseline = domain && remoteMeta.hasExplicitDomainStates
    ? await getAutoDataSyncDomainLastCompletedAt(store, domain)
    : await getAutoDataSyncLastCompletedAt(store)
  const remoteFromCurrentDevice = remoteDeviceId === deviceId
  const remoteIsNewer = !remoteFromCurrentDevice && remoteUpdatedAtMs > localBaseline

  return {
    localBaseline,
    currentDeviceId: deviceId,
    remoteFromCurrentDevice,
    remoteIsNewer,
  }
}

async function getRemoteNewerDomains(
  store: Store,
  remoteMeta: AutoDataSyncRemoteMeta,
  domains: AutoDataSyncDomain[],
  currentDeviceId?: string,
) {
  const decisions = await Promise.all(domains.map(async domain => ({
    domain,
    decision: await getRemoteMetaDecision(store, remoteMeta, currentDeviceId, domain),
  })))
  return decisions.filter(item => item.decision.remoteIsNewer).map(item => item.domain)
}

async function getAutoDataSyncDirtyDomains(store: Store) {
  const value = await getAutoDataSyncStateValue<AutoDataSyncDomain[]>(store, AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY)
  return normalizeAutoDataSyncDomains(value)
}

async function markAutoDataSyncDomainsDirty(domains: AutoDataSyncDomain[]) {
  const normalizedDomains = Array.from(new Set(domains))
  if (normalizedDomains.length === 0) return

  const update = async () => {
    const store = await Store.load('store.json')
    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
    const nextDirtyDomains = Array.from(new Set([...dirtyDomains, ...normalizedDomains]))
    if (nextDirtyDomains.length === dirtyDomains.length) return

    await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY), nextDirtyDomains)
    await store.save()
    debugAutoDataSync('dirty domains marked', { domains: normalizedDomains })
  }

  dirtyWriteQueue = dirtyWriteQueue.then(update, update)
  await dirtyWriteQueue
}

async function markAutoDataSyncDirty(domain: AutoDataSyncDomain) {
  try {
    await markAutoDataSyncDomainsDirty([domain])
  } catch (error) {
    debugAutoDataSync('failed to mark dirty domain', {
      domain,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}

async function clearAutoDataSyncDirtyDomain(domain: AutoDataSyncDomain) {
  const update = async () => {
    const store = await Store.load('store.json')
    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
    const nextDirtyDomains = dirtyDomains.filter(item => item !== domain)
    await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY), nextDirtyDomains)
    await store.save()
    debugAutoDataSync('dirty domain cleared', {
      domain,
      previousDirtyDomains: dirtyDomains,
      dirtyDomains: nextDirtyDomains,
    })
  }

  dirtyWriteQueue = dirtyWriteQueue.then(update, update)
  await dirtyWriteQueue
}

async function markAutoDataSyncRemoteMetaApplied(
  remoteMeta: AutoDataSyncRemoteMeta,
  domains: AutoDataSyncDomain[],
) {
  const store = await Store.load('store.json')
  const previousAppliedRemoteAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY)
  const previousLocalUploadAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY)
  await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY), remoteMeta.updatedAtMs)
  await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_KEY), remoteMeta)
  for (const domain of domains) {
    const updatedAtMs = remoteMeta.domainStates[domain]?.updatedAtMs ?? remoteMeta.updatedAtMs
    await store.set(
      await getAutoDataSyncStateKey(`${AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY}:${domain}`),
      updatedAtMs,
    )
  }
  if (domains.includes('settings')) {
    await store.set(await getAutoDataSyncStateKey(AUTO_DATA_SYNC_MEMORY_SETTINGS_MIGRATED_KEY), true)
  }
  await store.save()
  debugAutoDataSync('remote meta applied locally', {
    remoteUpdatedAtMs: remoteMeta.updatedAtMs,
    previousAppliedRemoteAt,
    previousLocalUploadAt,
    localBaseline: Math.max(previousLocalUploadAt, remoteMeta.updatedAtMs),
    deviceId: remoteMeta.deviceId,
    domains: remoteMeta.domains,
    lastUploadedDomains: remoteMeta.lastUploadedDomains,
  })
}

async function uploadGitMetaFile(
  provider: 'github' | 'gitee' | 'gitlab' | 'gitea',
  content: string
) {
  const repo = await getDataSyncRepoName(provider)

  switch (provider) {
    case 'github': {
      const { getFiles, uploadFile } = await import('@/lib/sync/github')
      const existingFile = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      debugAutoDataSync('git meta target resolved', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
        hasExistingSha: Boolean(getRemoteFileSha(existingFile)),
      })
      const result = await uploadFile({
        file: content,
        repo,
        path: AUTO_DATA_SYNC_META_PATH,
        filename: 'meta.json',
        sha: getRemoteFileSha(existingFile),
        message: 'Update auto data sync metadata',
      })

      if (!result) {
        throw new Error('Failed to upload auto data sync metadata')
      }
      debugAutoDataSync('meta upload completed', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
      })
      return
    }
    case 'gitee': {
      const { getFiles, uploadFile } = await import('@/lib/sync/gitee')
      const existingFile = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      debugAutoDataSync('git meta target resolved', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
        hasExistingSha: Boolean(getRemoteFileSha(existingFile)),
      })
      const result = await uploadFile({
        file: content,
        repo,
        path: AUTO_DATA_SYNC_META_PATH,
        filename: 'meta.json',
        sha: getRemoteFileSha(existingFile),
        message: 'Update auto data sync metadata',
      })

      if (!result) {
        throw new Error('Failed to upload auto data sync metadata')
      }
      debugAutoDataSync('meta upload completed', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
      })
      return
    }
    case 'gitlab': {
      const { getFiles, uploadFile } = await import('@/lib/sync/gitlab')
      const existingFile = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      debugAutoDataSync('git meta target resolved', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
        hasExistingSha: Boolean(getRemoteFileSha(existingFile)),
      })
      const result = await uploadFile({
        file: content,
        repo,
        path: AUTO_DATA_SYNC_META_PATH,
        filename: 'meta.json',
        sha: getRemoteFileSha(existingFile),
        message: 'Update auto data sync metadata',
      })

      if (!result) {
        throw new Error('Failed to upload auto data sync metadata')
      }
      debugAutoDataSync('meta upload completed', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
      })
      return
    }
    case 'gitea': {
      const { getFiles, uploadFile } = await import('@/lib/sync/gitea')
      const existingFile = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      debugAutoDataSync('git meta target resolved', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
        hasExistingSha: Boolean(getRemoteFileSha(existingFile)),
      })
      const result = await uploadFile({
        file: content,
        repo,
        path: AUTO_DATA_SYNC_META_PATH,
        filename: 'meta.json',
        sha: getRemoteFileSha(existingFile),
        message: 'Update auto data sync metadata',
      })

      if (!result) {
        throw new Error('Failed to upload auto data sync metadata')
      }
      debugAutoDataSync('meta upload completed', {
        provider,
        path: AUTO_DATA_SYNC_META_PATH,
      })
      return
    }
  }
}

async function uploadS3MetaFile(store: Store, content: string) {
  const config = await store.get<S3Config>('s3SyncConfig')
  if (!config) {
    throw new Error('S3 sync config is not configured')
  }

  const { s3Upload } = await import('@/lib/sync/s3')
  const result = await s3Upload(config, AUTO_DATA_SYNC_META_PATH, content)

  if (!result) {
    throw new Error('Failed to upload auto data sync metadata')
  }
  debugAutoDataSync('meta upload completed', {
    provider: 's3',
    path: AUTO_DATA_SYNC_META_PATH,
  })
}

async function uploadWebDAVMetaFile(store: Store, content: string) {
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!config) {
    throw new Error('WebDAV sync config is not configured')
  }

  const { webdavUpload } = await import('@/lib/sync/webdav')
  const result = await webdavUpload(config, AUTO_DATA_SYNC_META_PATH, content)

  if (!result) {
    throw new Error('Failed to upload auto data sync metadata')
  }
  debugAutoDataSync('meta upload completed', {
    provider: 'webdav',
    path: AUTO_DATA_SYNC_META_PATH,
  })
}

async function uploadCloudFolderMetaFile(store: Store, content: string) {
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  if (!config) {
    throw new Error('Cloud folder sync config is not configured')
  }
  const { cloudFolderUpload } = await import('@/lib/sync/cloud-folder')
  const result = await cloudFolderUpload(config, AUTO_DATA_SYNC_META_PATH, content)
  if (!result) throw new Error('Failed to write auto data sync metadata')
  debugAutoDataSync('meta upload completed', {
    provider: 'cloudFolder',
    path: AUTO_DATA_SYNC_META_PATH,
  })
}

async function uploadMemorySyncData(
  store: Store,
  provider: AutoDataSyncProvider,
  data: MemorySyncData,
): Promise<boolean> {
  const content = JSON.stringify(data)
  switch (provider) {
    case 'github':
    case 'gitee':
    case 'gitlab':
    case 'gitea': {
      const repo = await getDataSyncRepoName(provider)
      const sync = provider === 'github'
        ? await import('@/lib/sync/github')
        : provider === 'gitee'
          ? await import('@/lib/sync/gitee')
          : provider === 'gitlab'
            ? await import('@/lib/sync/gitlab')
            : await import('@/lib/sync/gitea')
      const existingFile = await sync.getFiles({ path: AUTO_DATA_SYNC_MEMORIES_PATH, repo })
      return Boolean(await sync.uploadFile({
        file: content,
        repo,
        path: AUTO_DATA_SYNC_MEMORIES_PATH,
        filename: 'memories.json',
        sha: getRemoteFileSha(existingFile),
        message: 'Update synced memories',
      }))
    }
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      if (!config) return false
      const { s3Upload } = await import('@/lib/sync/s3')
      return Boolean(await s3Upload(config, AUTO_DATA_SYNC_MEMORIES_PATH, content))
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!config) return false
      const { webdavUpload } = await import('@/lib/sync/webdav')
      return Boolean(await webdavUpload(config, AUTO_DATA_SYNC_MEMORIES_PATH, content))
    }
    case 'cloudFolder': {
      const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (!config) return false
      const { cloudFolderUpload } = await import('@/lib/sync/cloud-folder')
      return Boolean(await cloudFolderUpload(config, AUTO_DATA_SYNC_MEMORIES_PATH, content))
    }
  }
}

async function getAutoDataSyncDeviceId() {
  const { getDeviceId } = await import('@/lib/sync/conflict-resolution')
  return getDeviceId()
}

async function getAppVersion() {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    return await getVersion()
  } catch {
    return undefined
  }
}

function getRemoteFileSha(file: unknown): string | undefined {
  if (!isRemoteFileEntry(file)) {
    return undefined
  }

  return file.sha
}

function isRemoteFileEntry(value: unknown): value is RemoteFileEntry {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function ensureAutoDataSyncRemoteDataPath() {
  const store = await Store.load('store.json')
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  if (provider !== 'github') {
    debugAutoDataSync('skip remote .data path conflict check for provider', { provider })
    return
  }

  const { getFiles, deleteFile } = await import('@/lib/sync/github')

  const repo = await getDataSyncRepoName('github')
  const dataPath = await getFiles({ path: '.data', repo })
  debugAutoDataSync('checked remote .data path', {
    provider,
    path: '.data',
    type: isRemoteFileEntry(dataPath) ? dataPath.type : Array.isArray(dataPath) ? 'directory' : 'missing',
    hasSha: isRemoteFileEntry(dataPath) ? Boolean(dataPath.sha) : false,
  })

  if (isRemoteFileEntry(dataPath) && dataPath.type === 'file' && dataPath.sha) {
    debugAutoDataSync('delete remote .data file before creating data directory')
    const result = await deleteFile({
      path: '.data',
      sha: dataPath.sha,
      repo,
    })

    if (!result) {
      throw new Error('Failed to clean remote .data path conflict')
    }
    debugAutoDataSync('remote .data path conflict cleaned')
  }
}
