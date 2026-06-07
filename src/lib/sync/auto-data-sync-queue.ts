'use client'

import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { decodeBase64ToString, getRemoteFileContent } from '@/lib/sync/remote-file'
import type { S3Config, WebDAVConfig } from '@/types/sync'
import type { Mark } from '@/db/marks'
import type { Tag } from '@/db/tags'

export type AutoDataSyncDomain = 'records' | 'settings'
type AutoDataSyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
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
}

interface AutoDataSyncTask {
  id: string
  seq: number
  domain: AutoDataSyncDomain
  reason: string
  createdAt: number
  retryCount: number
  mode: 'auto' | 'manual'
}

interface AutoDataSyncRemoteMeta {
  updatedAtMs: number
  updatedAt: string | null
  deviceId: string | null
  provider: string | null
  domains: AutoDataSyncDomain[]
  lastUploadedDomains: AutoDataSyncDomain[]
}

type AutoDataSyncListener = (state: AutoDataSyncState) => void
export type AutoDataSyncConflictResolution = 'merge' | 'download_remote' | 'upload_local' | 'later'
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
}
interface AutoDataSyncDownloadOptions {
  allowRemoteEmptyRecords?: boolean
}
interface AutoDataSyncGlobalRuntimeState {
  ownerId: string | null
  remoteMetaCheckTimer: ReturnType<typeof setInterval> | null
}
type AutoDataSyncGlobalScope = typeof globalThis & {
  __noteGenAutoDataSyncRuntimeState?: AutoDataSyncGlobalRuntimeState
}

const DEFAULT_AUTO_DATA_SYNC_DELAY = 10_000
const DEFAULT_AUTO_DATA_SYNC_META_CHECK_INTERVAL = 10_000
const MAX_RETRY_COUNT = 3
const AUTO_DATA_SYNC_META_PATH = '.data/meta.json'
const AUTO_DATA_SYNC_TAGS_PATH = '.data/tags.json'
const AUTO_DATA_SYNC_MARKS_PATH = '.data/marks.json'
const AUTO_DATA_SYNC_SETTINGS_PATH = '.data/settings.json'
const AUTO_DATA_SYNC_DOMAINS: AutoDataSyncDomain[] = ['records', 'settings']
const AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY = 'autoDataSyncDirtyDomains'
const AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY = 'autoDataSyncLastLocalUploadMetaUpdatedAtMs'
const AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY = 'autoDataSyncLastAppliedRemoteMetaUpdatedAtMs'
const AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_KEY = 'autoDataSyncLastLocalUploadMeta'
const AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_KEY = 'autoDataSyncLastAppliedRemoteMeta'
const AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY = 'autoDataSyncRecordSnapshots'
const AUTO_DATA_SYNC_REMOTE_NEWER_CONFLICT_MESSAGE = 'Remote data changed before upload. Choose whether to pull remote data or upload local data.'
const AUTO_DATA_SYNC_UNTRACKED_REMOTE_RECORDS_MESSAGE = 'Remote records already exist but sync metadata is missing. Merge or explicitly choose which side to keep before uploading.'
const AUTO_DATA_SYNC_REMOTE_RECORD_ERASE_MESSAGE = 'Remote records are empty while local records exist. Automatic pull was blocked to avoid data loss.'
const MAX_AUTO_DATA_SYNC_RECORD_SNAPSHOTS = 5
const AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`

let seq = 0
let queue: AutoDataSyncTask[] = []
let processing = false
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let remoteMetaCheckTimer: ReturnType<typeof setInterval> | null = null
let applyingRemote = false
let applyingRemoteDepth = 0
let failedTask: AutoDataSyncTask | null = null
let runtimeInitialized = false

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
}

const listeners = new Set<AutoDataSyncListener>()

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
  return left.tagId === right.tagId &&
    left.type === right.type &&
    (left.content || '') === (right.content || '') &&
    (left.desc || '') === (right.desc || '') &&
    (left.url || '') === (right.url || '')
}

function getMarkExactKey(mark: Mark): string {
  return JSON.stringify([
    mark.tagId,
    mark.type,
    mark.content || '',
    mark.desc || '',
    mark.url || '',
    mark.deleted,
    mark.createdAt,
  ])
}

function mergeMarksById(
  localMarks: Mark[],
  remoteMarks: Mark[],
  remoteTagIdMap: Map<number, number>
): Mark[] {
  const merged = new Map<number, Mark>()
  const exactKeyToId = new Map<string, number>()
  let maxId = Math.max(0, ...localMarks.map(mark => mark.id))

  for (const mark of localMarks) {
    merged.set(mark.id, mark)
    exactKeyToId.set(getMarkExactKey(mark), mark.id)
  }

  for (const remoteMark of remoteMarks) {
    const normalizedRemoteMark = {
      ...remoteMark,
      tagId: remoteTagIdMap.get(remoteMark.tagId) ?? remoteMark.tagId,
    }
    const exactDuplicateId = exactKeyToId.get(getMarkExactKey(normalizedRemoteMark))
    if (exactDuplicateId !== undefined) {
      continue
    }

    const localMark = merged.get(normalizedRemoteMark.id)

    if (!localMark) {
      merged.set(normalizedRemoteMark.id, normalizedRemoteMark)
      exactKeyToId.set(getMarkExactKey(normalizedRemoteMark), normalizedRemoteMark.id)
      maxId = Math.max(maxId, normalizedRemoteMark.id)
      continue
    }

    if (marksShareCoreIdentity(localMark, normalizedRemoteMark)) {
      const nextMark = normalizedRemoteMark.createdAt >= localMark.createdAt ? normalizedRemoteMark : localMark
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
  }

  return Array.from(merged.values())
}

function debugAutoDataSync(message: string, details?: Record<string, unknown>) {
  void message
  void details
}

function updateState(next: Partial<AutoDataSyncState>) {
  state = {
    ...state,
    ...next,
    pendingCount: queue.length,
  }

  emitter.emit('auto-data-sync-state-changed', state)
  listeners.forEach((listener) => listener(state))
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
  if (applyingRemote) {
    debugAutoDataSync('skip enqueue while applying remote data', { domain, reason, mode })
    return
  }

  failedTask = null
  const lastTask = queue[queue.length - 1]
  if (lastTask?.domain === domain) {
    void markAutoDataSyncDirty(domain)
    debugAutoDataSync('merge queued task', {
      domain,
      reason,
      mode,
      pendingCount: queue.length,
    })
    lastTask.reason = reason
    lastTask.createdAt = Date.now()
    lastTask.mode = mode
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
  void markAutoDataSyncDirty(domain)

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
}

export async function flushAutoDataSyncNow(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  await processQueue()
}

function cancelPendingAutoDataSyncUpload(reason: string) {
  const pendingCount = queue.length
  const hadDebounceTimer = Boolean(debounceTimer)

  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  queue = []
  failedTask = null

  if (pendingCount > 0 || hadDebounceTimer) {
    debugAutoDataSync('pending upload queue cancelled', {
      reason,
      pendingCount,
      hadDebounceTimer,
    })
    updateState({
      pendingCount: 0,
      status: state.isSyncing ? state.status : 'idle',
      phase: state.isSyncing ? state.phase : 'idle',
    })
  }
}

export async function uploadAutoDataSyncNow(): Promise<void> {
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
  if (await shouldPullRemoteRecordsBeforeUpload(store, provider, 'manual-upload')) {
    debugAutoDataSync('manual upload converted to remote pull because local records are empty', {
      provider,
    })
    const downloaded = await downloadAutoDataSyncNow('manual')
    if (!downloaded) {
      throw new Error(state.lastError || 'Failed to download records and settings')
    }
    return
  }

  enqueueAllAutoDataSync('manual-upload', 'manual')
  await flushAutoDataSyncNow()

  if (state.status === 'waiting_provider') {
    throw new Error('Sync provider is not configured')
  }

  if (state.status === 'failed') {
    throw new Error(state.lastError || 'Failed to upload records and settings')
  }

  if (state.status === 'conflict') {
    throw new Error(state.lastError || AUTO_DATA_SYNC_REMOTE_NEWER_CONFLICT_MESSAGE)
  }
}

export async function downloadAutoDataSyncNow(
  mode: 'auto' | 'manual' = 'manual',
  knownRemoteMeta: AutoDataSyncRemoteMeta | null = null,
  options: AutoDataSyncDownloadOptions = {}
): Promise<boolean> {
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

  cancelPendingAutoDataSyncUpload(`download:${mode}`)

  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
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
  setAutoDataSyncApplyingRemote(true)
  updateState({
    isSyncing: true,
    phase: 'downloading',
    currentDomain: null,
    syncMode: mode,
    status: 'syncing',
    lastError: null,
  })

  try {
    debugAutoDataSync('download started')
    await assertRemoteRecordsSafeForDownload(store, provider, mode, options)
    localRecordSnapshot = await createAutoDataSyncLocalRecordSnapshot(`before-download:${mode}`)
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

    const tagResult = await useTagStore.getState().downloadTags({ allowMissingRemote: true })
    const markResult = await useMarkStore.getState().downloadMarks({ allowMissingRemote: true })
    const settingsResult = await useSettingsSyncStore.getState().downloadSettings({ allowMissingRemote: true })
    debugAutoDataSync('download domain results', {
      tags: tagResult,
      marks: markResult,
      settings: settingsResult,
    })

    if (!tagResult || !markResult || !settingsResult) {
      throw new Error('Failed to download records and settings')
    }

    await useSettingStore.getState().initSettingData()
    debugAutoDataSync('settings state refreshed after download')

    if (remoteMeta) {
      await markAutoDataSyncRemoteMetaApplied(remoteMeta)
    }
    await clearAutoDataSyncDirtyDomains()

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
    const message = error instanceof Error ? error.message : 'Failed to download records and settings'
    debugAutoDataSync('download failed', { message })
    if (localRecordSnapshot) {
      await restoreAutoDataSyncLocalRecordSnapshot(localRecordSnapshot, `download-failed:${mode}`)
    }
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: message,
      lastFailedAt: Date.now(),
    })
    return false
  } finally {
    setAutoDataSyncApplyingRemote(false)
  }
}

export async function resolveAutoDataSyncConflict(action: AutoDataSyncConflictResolution): Promise<boolean> {
  debugAutoDataSync('conflict resolution requested', { action })

  if (action === 'later') {
    queue = []
    failedTask = null
    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastError: null,
    })
    return true
  }

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

  queue = []
  failedTask = null

  if (action === 'merge') {
    return mergeAutoDataSyncConflict()
  }

  if (action === 'download_remote') {
    return downloadAutoDataSyncNow('manual', null, { allowRemoteEmptyRecords: true })
  }

  if (processing) {
    debugAutoDataSync('local overwrite skipped because sync is busy')
    return false
  }

  processing = true
  const uploadedDomains = new Set<AutoDataSyncDomain>()
  await createAutoDataSyncLocalRecordSnapshot('before-upload-local-overwrite')

  try {
    for (const domain of AUTO_DATA_SYNC_DOMAINS) {
      updateState({
        isSyncing: true,
        phase: 'uploading',
        currentDomain: domain,
        syncMode: 'manual',
        status: 'syncing',
        lastError: null,
      })
      await uploadDomain(domain)
      uploadedDomains.add(domain)
    }

    await uploadAutoDataSyncMeta(Array.from(uploadedDomains))
    await clearAutoDataSyncDirtyDomains()
    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastError: null,
      lastCompletedAt: Date.now(),
    })
    debugAutoDataSync('local overwrite completed', {
      uploadedDomains: Array.from(uploadedDomains),
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload local data'
    debugAutoDataSync('local overwrite failed', { message })
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: message,
      lastFailedAt: Date.now(),
    })
    return false
  } finally {
    processing = false
  }
}

async function mergeAutoDataSyncConflict(): Promise<boolean> {
  if (processing) {
    debugAutoDataSync('merge conflict skipped because sync is busy')
    return false
  }

  processing = true
  setAutoDataSyncApplyingRemote(true)
  let localRecordSnapshot: AutoDataSyncRecordSnapshot | null = null
  updateState({
    isSyncing: true,
    phase: 'downloading',
    currentDomain: null,
    syncMode: 'manual',
    status: 'syncing',
    lastError: null,
  })

  try {
    localRecordSnapshot = await createAutoDataSyncLocalRecordSnapshot('before-merge-conflict')
    const [
      { default: useTagStore },
      { default: useMarkStore },
      { default: useSettingsSyncStore },
      { default: useSettingStore },
      tagsDb,
      marksDb,
    ] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
      import('@/stores/settingsSync'),
      import('@/stores/setting'),
      import('@/db/tags'),
      import('@/db/marks'),
    ])

    const [localTags, localMarks] = await Promise.all([
      tagsDb.getTags(),
      marksDb.getAllMarks(),
    ])
    const remoteTags = await useTagStore.getState().downloadTags({ allowMissingRemote: true })
    const remoteMarks = await useMarkStore.getState().downloadMarks({ allowMissingRemote: true })
    const settingsResult = await useSettingsSyncStore.getState().downloadSettings({ allowMissingRemote: true })

    if (!settingsResult) {
      throw new Error('Failed to merge remote settings')
    }

    const tagMergeResult = mergeTags(localTags, remoteTags)
    const mergedTags = tagMergeResult.tags
    const mergedMarks = mergeMarksById(localMarks, remoteMarks, tagMergeResult.remoteTagIdMap)

    await tagsDb.deleteAllTags()
    await tagsDb.insertTags(mergedTags)
    await marksDb.deleteAllMarks()
    await marksDb.insertMarks(mergedMarks)
    await Promise.all([
      useTagStore.getState().fetchTags(),
      useMarkStore.getState().fetchMarks(),
    ])
    useTagStore.getState().getCurrentTag()
    await useSettingStore.getState().initSettingData()

    setAutoDataSyncApplyingRemote(false)
    updateState({
      isSyncing: true,
      phase: 'uploading',
      currentDomain: null,
      syncMode: 'manual',
      status: 'syncing',
      lastError: null,
    })

    await uploadDomain('records')
    await uploadDomain('settings')
    await uploadAutoDataSyncMeta(AUTO_DATA_SYNC_DOMAINS)
    await clearAutoDataSyncDirtyDomains()

    updateState({
      isSyncing: false,
      phase: 'idle',
      currentDomain: null,
      syncMode: null,
      status: 'idle',
      lastError: null,
      lastCompletedAt: Date.now(),
    })
    debugAutoDataSync('merge conflict completed', {
      localTags: localTags.length,
      remoteTags: remoteTags.length,
      mergedTags: mergedTags.length,
      localMarks: localMarks.length,
      remoteMarks: remoteMarks.length,
      mergedMarks: mergedMarks.length,
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to merge local and remote data'
    debugAutoDataSync('merge conflict failed', { message })
    if (localRecordSnapshot) {
      await restoreAutoDataSyncLocalRecordSnapshot(localRecordSnapshot, 'merge-conflict-failed')
    }
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: message,
      lastFailedAt: Date.now(),
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
    const lastCompletedAt = await getAutoDataSyncLastCompletedAt(store)
    if (lastCompletedAt > 0) {
      updateState({ lastCompletedAt })
    }

    if (!await isAutoDataSyncEnabled()) {
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
    } else {
      debugAutoDataSync('runtime initialized')
      startPeriodicAutoDataSyncMetaCheck()
      void checkRemoteAutoDataSync('startup', { uploadDirtyDomains: true })
    }
  } catch (error) {
    runtimeInitialized = false
    console.error('Failed to initialize auto data sync runtime:', error)
  }
}

export async function retryAutoDataSync(): Promise<void> {
  if (failedTask) {
    queue.unshift({
      ...failedTask,
      retryCount: 0,
      mode: 'manual',
    })
    failedTask = null
    await flushAutoDataSyncNow()
    return
  }

  await checkRemoteAutoDataSync('periodic', { uploadDirtyDomains: false, force: true })
}

async function getAutoDataSyncDelay(): Promise<number> {
  const store = await Store.load('store.json')
  const autoSync = await store.get<string>('autoSync')
  const seconds = Number.parseInt(autoSync || '', 10)

  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000
  }

  return DEFAULT_AUTO_DATA_SYNC_DELAY
}

async function isAutoDataSyncEnabled(): Promise<boolean> {
  const store = await Store.load('store.json')
  const enabled = await store.get<boolean>('autoDataSyncEnabled')

  return enabled !== false
}

export async function isAutoDataSyncProviderConfigured(): Promise<boolean> {
  const store = await Store.load('store.json')
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  switch (provider) {
    case 'github':
      return Boolean(await store.get<string>('accessToken') && await store.get<string>('githubUsername'))
    case 'gitee':
      return Boolean(await store.get<string>('giteeAccessToken') && await store.get<string>('giteeUsername'))
    case 'gitlab':
      return Boolean(await store.get<string>('gitlabAccessToken'))
    case 'gitea':
      return Boolean(await store.get<string>('giteaAccessToken') && await store.get<string>('giteaUsername'))
    case 's3': {
      const config = await store.get<S3Config>('s3SyncConfig')
      return Boolean(config?.accessKeyId && config.secretAccessKey && config.region && config.bucket)
    }
    case 'webdav': {
      const config = await store.get<WebDAVConfig>('webdavSyncConfig')
      return Boolean(config?.url && config.username && config.password)
    }
    default:
      return false
  }
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

async function getAutoDataSyncMetaCheckInterval(): Promise<number> {
  return DEFAULT_AUTO_DATA_SYNC_META_CHECK_INTERVAL
}

function startPeriodicAutoDataSyncMetaCheck() {
  if (remoteMetaCheckTimer) {
    return
  }

  const globalRuntimeState = getGlobalAutoDataSyncRuntimeState()
  if (globalRuntimeState.remoteMetaCheckTimer) {
    clearInterval(globalRuntimeState.remoteMetaCheckTimer)
  }
  globalRuntimeState.ownerId = AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID
  globalRuntimeState.remoteMetaCheckTimer = null

  void getAutoDataSyncMetaCheckInterval().then((interval) => {
    if (remoteMetaCheckTimer) {
      return
    }

    const currentGlobalRuntimeState = getGlobalAutoDataSyncRuntimeState()
    if (currentGlobalRuntimeState.ownerId !== AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID) {
      return
    }

    debugAutoDataSync('periodic remote meta check scheduled', {
      intervalMs: interval,
      runtimeId: AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID,
    })
    remoteMetaCheckTimer = setInterval(() => {
      const latestGlobalRuntimeState = getGlobalAutoDataSyncRuntimeState()
      if (latestGlobalRuntimeState.ownerId !== AUTO_DATA_SYNC_RUNTIME_INSTANCE_ID) {
        if (remoteMetaCheckTimer) {
          clearInterval(remoteMetaCheckTimer)
          remoteMetaCheckTimer = null
        }
        return
      }

      void checkRemoteAutoDataSync('periodic', { uploadDirtyDomains: false })
    }, interval)
    currentGlobalRuntimeState.remoteMetaCheckTimer = remoteMetaCheckTimer
  })
}

async function processQueue() {
  if (processing || queue.length === 0) {
    debugAutoDataSync('skip queue processing', {
      processing,
      pendingCount: queue.length,
    })
    return
  }

  if (!await isAutoDataSyncEnabled()) {
    queue = []
    debugAutoDataSync('clear queue because auto data sync is disabled')
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
    queue = []
    debugAutoDataSync('clear queue because provider is not configured')
    updateState({
      isSyncing: false,
      phase: 'waiting_provider',
      currentDomain: null,
      syncMode: null,
      status: 'waiting_provider',
      lastError: null,
    })
    return
  }

  processing = true
  const uploadedDomains = new Set<AutoDataSyncDomain>()
  debugAutoDataSync('queue processing started', { pendingCount: queue.length })

  while (queue.length > 0) {
    const task = queue.shift()
    if (!task) {
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
      if (await shouldPullRemoteRecordsBeforeUpload(store, provider, task.reason)) {
        queue = []
        failedTask = null
        processing = false
        debugAutoDataSync('upload converted to remote pull because local records are empty', {
          id: task.id,
          domain: task.domain,
          reason: task.reason,
          mode: task.mode,
          provider,
        })
        await downloadAutoDataSyncNow(task.mode)
        return
      }

      const uploadAllowed = await guardAutoDataSyncUploadAgainstRemoteNewer(task.domain)
      if (!uploadAllowed) {
        processing = false
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
      uploadedDomains.add(task.domain)
      debugAutoDataSync('domain uploaded', {
        domain: task.domain,
        uploadedDomains: Array.from(uploadedDomains),
      })
      await uploadAutoDataSyncMeta(Array.from(uploadedDomains))
      dropRedundantFrontTasks(task.domain, taskStartedAt)
      if (!queue.some(item => item.domain === task.domain)) {
        await clearAutoDataSyncDirtyDomain(task.domain)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Auto data sync failed'

      if (task.retryCount < MAX_RETRY_COUNT) {
        task.retryCount += 1
        queue.unshift(task)
        const retryDelay = Math.min(5_000 * 2 ** (task.retryCount - 1), 60_000)
        debugAutoDataSync('task failed, retry scheduled', {
          id: task.id,
          domain: task.domain,
          retryCount: task.retryCount,
          retryDelayMs: retryDelay,
          message,
        })
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
        continue
      }

      failedTask = task
      debugAutoDataSync('task failed after retries', {
        id: task.id,
        domain: task.domain,
        retryCount: task.retryCount,
        message,
      })
      updateState({
        isSyncing: false,
        phase: 'failed',
        currentDomain: null,
        syncMode: null,
        status: 'failed',
        lastError: message,
        lastFailedAt: Date.now(),
      })
      processing = false
      return
    }
  }

  processing = false
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
  debugAutoDataSync('upload domain started', { domain })
  await ensureAutoDataSyncRemoteDataPath()

  if (domain === 'records') {
    const [{ default: useTagStore }, { default: useMarkStore }] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
    ])

    const tagResult = await useTagStore.getState().uploadTags()
    const markResult = await useMarkStore.getState().uploadMarks()
    debugAutoDataSync('records upload results', {
      tags: tagResult,
      marks: markResult,
    })

    if (!tagResult || !markResult) {
      throw new Error('Failed to upload records')
    }

    return
  }

  const { default: useSettingsSyncStore } = await import('@/stores/settingsSync')
  const result = await useSettingsSyncStore.getState().uploadSettings()
  debugAutoDataSync('settings upload result', { settings: result })

  if (!result) {
    throw new Error('Failed to upload settings')
  }
}

async function uploadAutoDataSyncMeta(uploadedDomains: AutoDataSyncDomain[]) {
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const now = Date.now()
  const metadata = {
    schemaVersion: 1,
    updatedAt: new Date(now).toISOString(),
    updatedAtMs: now,
    deviceId: await getAutoDataSyncDeviceId(),
    provider,
    domains: AUTO_DATA_SYNC_DOMAINS,
    lastUploadedDomains: AUTO_DATA_SYNC_DOMAINS.filter(domain => uploadedDomains.includes(domain)),
    files: {
      records: [AUTO_DATA_SYNC_TAGS_PATH, AUTO_DATA_SYNC_MARKS_PATH],
      settings: [AUTO_DATA_SYNC_SETTINGS_PATH],
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
    default:
      throw new Error('Sync provider is not configured')
  }

  await store.set(AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY, now)
  await store.set(AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_KEY, metadata)
  await store.save()
  debugAutoDataSync('local upload meta stored', {
    updatedAtMs: metadata.updatedAtMs,
    provider: metadata.provider,
    deviceId: metadata.deviceId,
    lastUploadedDomains: metadata.lastUploadedDomains,
  })
}

async function guardAutoDataSyncUploadAgainstRemoteNewer(domain: AutoDataSyncDomain): Promise<boolean> {
  const store = await Store.load('store.json')
  const provider = await getAutoDataSyncProvider(store)
  const remoteMeta = await downloadAutoDataSyncMeta(store, provider)

  if (!remoteMeta) {
    debugAutoDataSync('pre-upload remote meta check found no metadata', { provider, domain })
    const hasUntrackedRemoteRecords = await hasUntrackedRemoteRecordsBeforeUpload(store, provider, domain)
    if (!hasUntrackedRemoteRecords) {
      return true
    }

    updateState({
      isSyncing: false,
      phase: 'conflict',
      currentDomain: null,
      syncMode: null,
      status: 'conflict',
      lastError: AUTO_DATA_SYNC_UNTRACKED_REMOTE_RECORDS_MESSAGE,
      lastFailedAt: Date.now(),
    })
    return false
  }

  const decision = await getRemoteMetaDecision(store, remoteMeta)
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
    return true
  }

  updateState({
    isSyncing: false,
    phase: 'conflict',
    currentDomain: null,
    syncMode: null,
    status: 'conflict',
    lastError: AUTO_DATA_SYNC_REMOTE_NEWER_CONFLICT_MESSAGE,
    lastFailedAt: Date.now(),
  })
  return false
}

async function checkRemoteAutoDataSync(
  reason: 'startup' | 'periodic',
  options: { uploadDirtyDomains?: boolean; force?: boolean } = {}
) {
  try {
    if (!await isAutoDataSyncEnabled()) {
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

    if (!options.force && reason === 'periodic' && (state.phase === 'failed' || state.phase === 'conflict')) {
      debugAutoDataSync('periodic remote meta check skipped because sync needs user attention', {
        phase: state.phase,
        lastError: state.lastError,
      })
      return
    }

    const store = await Store.load('store.json')
    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
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
    const decision = await getRemoteMetaDecision(store, remoteMeta, currentDeviceId)
    const localBaseline = decision.localBaseline
    const remoteFromCurrentDevice = decision.remoteFromCurrentDevice
    const remoteIsNewer = decision.remoteIsNewer
    const hasDirtyDomains = dirtyDomains.length > 0
    const shouldPull = remoteIsNewer && !hasDirtyDomains

    debugAutoDataSync('remote meta decision', {
      reason,
      provider,
      remoteUpdatedAtMs: remoteMeta.updatedAtMs,
      localBaseline,
      currentDeviceId: decision.currentDeviceId,
      remoteDeviceId: remoteMeta.deviceId,
      remoteFromCurrentDevice,
      remoteIsNewer,
      dirtyDomains,
      shouldPull,
      domains: remoteMeta.domains,
      lastUploadedDomains: remoteMeta.lastUploadedDomains,
    })

    if (hasDirtyDomains) {
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

      if (remoteIsNewer) {
        if (await shouldPullRemoteRecordsBeforeUpload(store, provider, `${reason}-dirty-remote-newer`)) {
          debugAutoDataSync('dirty remote conflict converted to remote pull because local records are empty', {
            reason,
            provider,
            dirtyDomains,
            remoteUpdatedAtMs: remoteMeta.updatedAtMs,
          })
          const downloaded = await downloadAutoDataSyncNow('auto', remoteMeta)
          if (!downloaded) {
            debugAutoDataSync('remote pull failed', { reason })
          }
          return
        }

        debugAutoDataSync('remote pull blocked by local dirty conflict', {
          reason,
          dirtyDomains,
          remoteUpdatedAtMs: remoteMeta.updatedAtMs,
          localBaseline,
        })
        updateState({
          isSyncing: false,
          phase: 'conflict',
          currentDomain: null,
          syncMode: null,
          status: 'conflict',
          lastError: AUTO_DATA_SYNC_REMOTE_NEWER_CONFLICT_MESSAGE,
          lastFailedAt: Date.now(),
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

    const downloaded = await downloadAutoDataSyncNow('auto', remoteMeta)
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
      message: error instanceof Error ? error.message : 'unknown error',
    })
    updateState({
      isSyncing: false,
      phase: 'failed',
      currentDomain: null,
      syncMode: null,
      status: 'failed',
      lastError: error instanceof Error ? error.message : 'Failed to check remote sync metadata',
      lastFailedAt: Date.now(),
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
  if (await shouldPullRemoteRecordsBeforeUpload(store, provider, reason)) {
    debugAutoDataSync('dirty domains upload converted to remote pull because local records are empty', {
      reason,
      provider,
      dirtyDomains,
    })
    await downloadAutoDataSyncNow('auto')
    return
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
    const [tagsDb, marksDb, store] = await Promise.all([
      import('@/db/tags'),
      import('@/db/marks'),
      Store.load('store.json'),
    ])
    const [tags, marks] = await Promise.all([
      tagsDb.getTags(),
      marksDb.getAllMarks(),
    ])

    if (tags.length === 0 && marks.length === 0) {
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
    }
    const previousSnapshots = await store.get<AutoDataSyncRecordSnapshot[]>(AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY)
    const snapshots = Array.isArray(previousSnapshots) ? previousSnapshots : []
    await store.set(AUTO_DATA_SYNC_RECORD_SNAPSHOTS_KEY, [
      snapshot,
      ...snapshots,
    ].slice(0, MAX_AUTO_DATA_SYNC_RECORD_SNAPSHOTS))
    await store.save()
    debugAutoDataSync('local record snapshot stored', {
      reason,
      createdAtMs: snapshot.createdAtMs,
      tagsCount: snapshot.tags.length,
      marksCount: snapshot.marks.length,
    })
    return snapshot
  } catch (error) {
    debugAutoDataSync('local record snapshot failed', {
      reason,
      message: error instanceof Error ? error.message : 'unknown error',
    })
    return null
  }
}

async function restoreAutoDataSyncLocalRecordSnapshot(
  snapshot: AutoDataSyncRecordSnapshot,
  reason: string
) {
  try {
    setAutoDataSyncApplyingRemote(true)
    const [
      { default: useTagStore },
      { default: useMarkStore },
      tagsDb,
      marksDb,
    ] = await Promise.all([
      import('@/stores/tag'),
      import('@/stores/mark'),
      import('@/db/tags'),
      import('@/db/marks'),
    ])

    await tagsDb.deleteAllTags()
    await tagsDb.insertTags(snapshot.tags)
    await marksDb.deleteAllMarks()
    await marksDb.insertMarks(snapshot.marks)
    await Promise.all([
      useTagStore.getState().fetchTags(),
      useMarkStore.getState().fetchMarks(),
    ])
    useTagStore.getState().getCurrentTag()
    debugAutoDataSync('local record snapshot restored', {
      reason,
      snapshotReason: snapshot.reason,
      createdAtMs: snapshot.createdAtMs,
      tagsCount: snapshot.tags.length,
      marksCount: snapshot.marks.length,
    })
  } catch (error) {
    debugAutoDataSync('local record snapshot restore failed', {
      reason,
      createdAtMs: snapshot.createdAtMs,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  } finally {
    setAutoDataSyncApplyingRemote(false)
  }
}

async function hasUntrackedRemoteRecordsBeforeUpload(
  store: Store,
  provider: AutoDataSyncProvider,
  domain: AutoDataSyncDomain
) {
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
      const [{ getSyncRepoName }, { getFiles }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/github'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFiles({ path, repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitee': {
      const [{ getSyncRepoName }, { getFiles }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitee'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFiles({ path, repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitlab': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitlab'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path, ref: 'main', repo })
      return decodeRemoteGitFileContent(file, path)
    }
    case 'gitea': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitea'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path, ref: 'main', repo })
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
  }
}

async function downloadAutoDataSyncMeta(
  store: Store,
  provider: AutoDataSyncProvider
): Promise<AutoDataSyncRemoteMeta | null> {
  let content: string | null = null

  switch (provider) {
    case 'github': {
      const [{ getSyncRepoName }, { getFiles }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/github'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitee': {
      const [{ getSyncRepoName }, { getFiles }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitee'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitlab': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitlab'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path: AUTO_DATA_SYNC_META_PATH, ref: 'main', repo })
      content = decodeRemoteGitFileContent(file, AUTO_DATA_SYNC_META_PATH)
      break
    }
    case 'gitea': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitea'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path: AUTO_DATA_SYNC_META_PATH, ref: 'main', repo })
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
  }

  return parseAutoDataSyncMeta(content)
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

    return {
      updatedAtMs: parsedUpdatedAtMs,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      deviceId: typeof data.deviceId === 'string' ? data.deviceId : null,
      provider: typeof data.provider === 'string' ? data.provider : null,
      domains: normalizeAutoDataSyncDomains(data.domains),
      lastUploadedDomains: normalizeAutoDataSyncDomains(data.lastUploadedDomains),
    }
  } catch {
    return null
  }
}

function normalizeAutoDataSyncDomains(value: unknown): AutoDataSyncDomain[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isAutoDataSyncDomain)
}

function isAutoDataSyncDomain(value: unknown): value is AutoDataSyncDomain {
  return value === 'records' || value === 'settings'
}

async function getAutoDataSyncProvider(store: Store): Promise<AutoDataSyncProvider> {
  const provider = await store.get<string>('primaryBackupMethod') || 'github'

  if (
    provider === 'github' ||
    provider === 'gitee' ||
    provider === 'gitlab' ||
    provider === 'gitea' ||
    provider === 's3' ||
    provider === 'webdav'
  ) {
    return provider
  }

  return 'github'
}

async function getStoredNumber(store: Store, key: string) {
  const value = await store.get<number>(key)
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function getAutoDataSyncLastCompletedAt(store: Store) {
  const lastLocalUploadAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY)
  const lastAppliedRemoteAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY)
  return Math.max(lastLocalUploadAt, lastAppliedRemoteAt)
}

async function getRemoteMetaDecision(
  store: Store,
  remoteMeta: AutoDataSyncRemoteMeta,
  currentDeviceId?: string
) {
  const deviceId = currentDeviceId || await getAutoDataSyncDeviceId()
  const localBaseline = await getAutoDataSyncLastCompletedAt(store)
  const remoteFromCurrentDevice = remoteMeta.deviceId === deviceId
  const remoteIsNewer = !remoteFromCurrentDevice && remoteMeta.updatedAtMs > localBaseline

  return {
    localBaseline,
    currentDeviceId: deviceId,
    remoteFromCurrentDevice,
    remoteIsNewer,
  }
}

async function getAutoDataSyncDirtyDomains(store: Store) {
  const value = await store.get<AutoDataSyncDomain[]>(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY)
  return normalizeAutoDataSyncDomains(value)
}

async function markAutoDataSyncDirty(domain: AutoDataSyncDomain) {
  try {
    const store = await Store.load('store.json')
    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
    if (dirtyDomains.includes(domain)) {
      return
    }

    await store.set(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY, [...dirtyDomains, domain])
    await store.save()
    debugAutoDataSync('dirty domain marked', { domain })
  } catch (error) {
    debugAutoDataSync('failed to mark dirty domain', {
      domain,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}

async function clearAutoDataSyncDirtyDomain(domain: AutoDataSyncDomain) {
  const store = await Store.load('store.json')
  const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
  const nextDirtyDomains = dirtyDomains.filter(item => item !== domain)
  await store.set(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY, nextDirtyDomains)
  await store.save()
  debugAutoDataSync('dirty domain cleared', {
    domain,
    previousDirtyDomains: dirtyDomains,
    dirtyDomains: nextDirtyDomains,
  })
}

async function clearAutoDataSyncDirtyDomains() {
  const store = await Store.load('store.json')
  const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
  await store.set(AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY, [])
  await store.save()
  debugAutoDataSync('all dirty domains cleared', {
    previousDirtyDomains: dirtyDomains,
  })
}

async function markAutoDataSyncRemoteMetaApplied(remoteMeta: AutoDataSyncRemoteMeta) {
  const store = await Store.load('store.json')
  const previousAppliedRemoteAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY)
  const previousLocalUploadAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY)
  await store.set(AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY, remoteMeta.updatedAtMs)
  await store.set(AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_KEY, remoteMeta)
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
  const { getSyncRepoName } = await import('@/lib/sync/repo-utils')
  const repo = await getSyncRepoName(provider)

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

  const [{ getSyncRepoName }, { getFiles, deleteFile }] = await Promise.all([
    import('@/lib/sync/repo-utils'),
    import('@/lib/sync/github'),
  ])

  const repo = await getSyncRepoName('github')
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
