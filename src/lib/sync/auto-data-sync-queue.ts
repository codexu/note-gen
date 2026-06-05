'use client'

import { Store } from '@tauri-apps/plugin-store'
import emitter from '@/lib/emitter'
import { decodeBase64ToString, getRemoteFileContent } from '@/lib/sync/remote-file'
import type { S3Config, WebDAVConfig } from '@/types/sync'

export type AutoDataSyncDomain = 'records' | 'settings'
type AutoDataSyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'

export interface AutoDataSyncState {
  isSyncing: boolean
  currentDomain: AutoDataSyncDomain | null
  pendingCount: number
  lastError: string | null
  lastCompletedAt: number | null
  lastFailedAt: number | null
  syncMode: 'auto' | 'manual' | null
  status: 'idle' | 'queued' | 'syncing' | 'failed' | 'waiting_provider'
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
type RemoteFileEntry = {
  name?: string
  path?: string
  type?: string
  sha?: string
}

const DEFAULT_AUTO_DATA_SYNC_DELAY = 10_000
const DEFAULT_AUTO_DATA_SYNC_META_CHECK_INTERVAL = 60_000
const MAX_RETRY_COUNT = 3
const AUTO_DATA_SYNC_META_PATH = '.data/meta.json'
const AUTO_DATA_SYNC_DOMAINS: AutoDataSyncDomain[] = ['records', 'settings']
const AUTO_DATA_SYNC_LOG_PREFIX = '[auto-data-sync]'
const AUTO_DATA_SYNC_DIRTY_DOMAINS_KEY = 'autoDataSyncDirtyDomains'
const AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY = 'autoDataSyncLastLocalUploadMetaUpdatedAtMs'
const AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY = 'autoDataSyncLastAppliedRemoteMetaUpdatedAtMs'

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
  currentDomain: null,
  pendingCount: 0,
  lastError: null,
  lastCompletedAt: null,
  lastFailedAt: null,
  syncMode: null,
  status: 'idle',
}

const listeners = new Set<AutoDataSyncListener>()

function debugAutoDataSync(message: string, details?: Record<string, unknown>) {
  if (details) {
    console.debug(`${AUTO_DATA_SYNC_LOG_PREFIX} ${message}`, details)
    return
  }

  console.debug(`${AUTO_DATA_SYNC_LOG_PREFIX} ${message}`)
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
    updateState({ status: processing ? 'syncing' : 'queued', lastError: null })
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

  updateState({ status: processing ? 'syncing' : 'queued', lastError: null })
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

export async function uploadAutoDataSyncNow(): Promise<void> {
  debugAutoDataSync('manual upload requested')
  enqueueAllAutoDataSync('manual-upload', 'manual')
  await flushAutoDataSyncNow()

  if (state.status === 'waiting_provider') {
    throw new Error('Sync provider is not configured')
  }

  if (state.status === 'failed') {
    throw new Error(state.lastError || 'Failed to upload records and settings')
  }
}

export async function downloadAutoDataSyncNow(mode: 'auto' | 'manual' = 'manual'): Promise<boolean> {
  if (!await isAutoDataSyncProviderConfigured()) {
    debugAutoDataSync('download blocked because provider is not configured')
    updateState({
      isSyncing: false,
      currentDomain: null,
      syncMode: null,
      status: 'waiting_provider',
      lastError: null,
    })
    return false
  }

  setAutoDataSyncApplyingRemote(true)
  updateState({
    isSyncing: true,
    currentDomain: null,
    syncMode: mode,
    status: 'syncing',
    lastError: null,
  })

  try {
    debugAutoDataSync('download started')
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

    const tagResult = await useTagStore.getState().downloadTags()
    const markResult = await useMarkStore.getState().downloadMarks()
    const settingsResult = await useSettingsSyncStore.getState().downloadSettings()
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

    updateState({
      isSyncing: false,
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
    updateState({
      isSyncing: false,
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

export async function initAutoDataSyncRuntime(): Promise<void> {
  if (runtimeInitialized) {
    return
  }

  runtimeInitialized = true

  try {
    if (!await isAutoDataSyncEnabled()) {
      debugAutoDataSync('runtime initialized with auto data sync disabled')
      updateState({
        isSyncing: false,
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
  }

  await flushAutoDataSyncNow()
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
  const delay = await getAutoDataSyncDelay()
  return Math.max(delay, DEFAULT_AUTO_DATA_SYNC_META_CHECK_INTERVAL)
}

function startPeriodicAutoDataSyncMetaCheck() {
  if (remoteMetaCheckTimer) {
    return
  }

  void getAutoDataSyncMetaCheckInterval().then((interval) => {
    if (remoteMetaCheckTimer) {
      return
    }

    debugAutoDataSync('periodic remote meta check scheduled', { intervalMs: interval })
    remoteMetaCheckTimer = setInterval(() => {
      void checkRemoteAutoDataSync('periodic', { uploadDirtyDomains: false })
    }, interval)
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

    updateState({
      isSyncing: true,
      currentDomain: task.domain,
      syncMode: task.mode,
      status: 'syncing',
      lastError: null,
    })
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
      records: ['.data/tags.json', '.data/marks.json'],
      settings: ['.data/settings.json'],
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
  await store.save()
}

async function checkRemoteAutoDataSync(
  reason: 'startup' | 'periodic',
  options: { uploadDirtyDomains?: boolean } = {}
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

    const store = await Store.load('store.json')
    const dirtyDomains = await getAutoDataSyncDirtyDomains(store)
    const provider = await getAutoDataSyncProvider(store)
    debugAutoDataSync('remote meta check started', { reason, provider, dirtyDomains })
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
      }
      return
    }

    const currentDeviceId = await getAutoDataSyncDeviceId()
    const lastLocalUploadAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_LOCAL_UPLOAD_META_MS_KEY)
    const lastAppliedRemoteAt = await getStoredNumber(store, AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY)
    const localBaseline = Math.max(lastLocalUploadAt, lastAppliedRemoteAt)
    const remoteFromCurrentDevice = remoteMeta.deviceId === currentDeviceId
    const remoteIsNewer = !remoteFromCurrentDevice && remoteMeta.updatedAtMs > localBaseline
    const hasDirtyDomains = dirtyDomains.length > 0
    const shouldPull = remoteIsNewer && !hasDirtyDomains

    debugAutoDataSync('remote meta decision', {
      reason,
      provider,
      remoteUpdatedAtMs: remoteMeta.updatedAtMs,
      localBaseline,
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
        return
      }

      if (remoteIsNewer) {
        const message = 'Remote data is newer while local data has pending changes'
        debugAutoDataSync('remote pull blocked by local dirty conflict', {
          reason,
          dirtyDomains,
          remoteUpdatedAtMs: remoteMeta.updatedAtMs,
          localBaseline,
        })
        updateState({
          isSyncing: false,
          currentDomain: null,
          syncMode: null,
          status: 'failed',
          lastError: message,
          lastFailedAt: Date.now(),
        })
        return
      }

      await uploadDirtyAutoDataSyncDomains(dirtyDomains, `${reason}-local-dirty`)
      return
    }

    if (!shouldPull) {
      return
    }

    const downloaded = await downloadAutoDataSyncNow('auto')
    if (!downloaded) {
      debugAutoDataSync('remote pull failed', { reason })
      return
    }

    await markAutoDataSyncRemoteMetaApplied(remoteMeta)
    debugAutoDataSync('remote pull completed', {
      reason,
      remoteUpdatedAtMs: remoteMeta.updatedAtMs,
    })
  } catch (error) {
    debugAutoDataSync('remote meta check failed', {
      reason,
      message: error instanceof Error ? error.message : 'unknown error',
    })
  }
}

async function uploadDirtyAutoDataSyncDomains(dirtyDomains: AutoDataSyncDomain[], reason: string) {
  debugAutoDataSync('startup dirty domains upload requested', {
    dirtyDomains,
    reason,
  })

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
      content = decodeRemoteGitFileContent(file)
      break
    }
    case 'gitee': {
      const [{ getSyncRepoName }, { getFiles }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitee'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFiles({ path: AUTO_DATA_SYNC_META_PATH, repo })
      content = decodeRemoteGitFileContent(file)
      break
    }
    case 'gitlab': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitlab'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path: AUTO_DATA_SYNC_META_PATH, ref: 'main', repo })
      content = decodeRemoteGitFileContent(file)
      break
    }
    case 'gitea': {
      const [{ getSyncRepoName }, { getFileContent }] = await Promise.all([
        import('@/lib/sync/repo-utils'),
        import('@/lib/sync/gitea'),
      ])
      const repo = await getSyncRepoName(provider)
      const file = await getFileContent({ path: AUTO_DATA_SYNC_META_PATH, ref: 'main', repo })
      content = decodeRemoteGitFileContent(file)
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

function decodeRemoteGitFileContent(file: unknown): string | null {
  if (!file) {
    return null
  }

  try {
    return decodeBase64ToString(getRemoteFileContent(file, AUTO_DATA_SYNC_META_PATH))
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
  debugAutoDataSync('dirty domain cleared', { domain, dirtyDomains: nextDirtyDomains })
}

async function markAutoDataSyncRemoteMetaApplied(remoteMeta: AutoDataSyncRemoteMeta) {
  const store = await Store.load('store.json')
  await store.set(AUTO_DATA_SYNC_LAST_APPLIED_REMOTE_META_MS_KEY, remoteMeta.updatedAtMs)
  await store.save()
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
