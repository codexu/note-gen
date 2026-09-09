'use client'

import { exists, readFile } from '@tauri-apps/plugin-fs'

import { getCurrentFolder } from '@/lib/path'
import { getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'

import { isSyncConfigured } from './sync-manager'
import {
  downloadRemoteBytes,
  getRemoteContentType,
  uploadLocalLibraryFile,
  uploadRemoteBytes,
} from './remote-library'
import {
  createStaticAssetSyncMarker,
  matchesRememberedStaticAssetContent,
  rememberStaticAssetSyncMarker,
  withStaticAssetSyncLock,
} from './static-asset-sync-origin'

const STATIC_IMAGE_PATH_PATTERN = /\.(?:jpe?g|png|gif|bmp|webp|svg)$/i
const MAX_UPLOAD_ATTEMPTS = 3

export type StaticAssetSyncSource = {
  workspaceKey: string
  epoch: number
}

type StaticAssetTask = {
  path: string
  workspaceKey: string
  epoch: number
  dueAt: number
  attempts: number
}

const pendingTasks = new Map<string, StaticAssetTask>()
const immediateUploads = new Map<string, Promise<string>>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let activeFlush: Promise<void> | null = null
let workspaceSwitchPauseDepth = 0
let syncEpoch = 0

function normalizeRelativePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function normalizeWorkspaceKey(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function getCurrentWorkspaceKey(): string {
  return normalizeWorkspaceKey(useSettingStore.getState().workspacePath)
}

export function captureStaticAssetSyncSource(): StaticAssetSyncSource {
  return {
    workspaceKey: getCurrentWorkspaceKey(),
    epoch: syncEpoch,
  }
}

function isSourceCurrent(source: StaticAssetSyncSource): boolean {
  return workspaceSwitchPauseDepth === 0
    && source.workspaceKey === getCurrentWorkspaceKey()
    && source.epoch === syncEpoch
}

function getTaskKey(workspaceKey: string, path: string): string {
  return `${workspaceKey}\0${path}`
}

function getAutoSyncDelay(): number {
  const value = useSettingStore.getState().autoSync
  if (!value || value === 'disabled') return 0

  const seconds = Number.parseInt(value, 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
}

function isEligibleStaticImagePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !/^[a-zA-Z]:\//.test(path)
    && STATIC_IMAGE_PATH_PATTERN.test(path)
    && !path.split('/').some(part => part.startsWith('.'))
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function readLocalBytes(path: string): Promise<Uint8Array | null> {
  const pathOptions = await getFilePathOptions(path)
  const fileExists = pathOptions.baseDir
    ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await exists(pathOptions.path)
  if (!fileExists) return null

  return pathOptions.baseDir
    ? await readFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    : await readFile(pathOptions.path)
}

function markTaskRemote(path: string): void {
  const state = useArticleStore.getState()
  const current = getCurrentFolder(path, state.fileTree)
  if (current?.isFile && current.sha) {
    state.markFileRemote(path, current.sha)
  }
}

function clearFlushTimer(): void {
  if (!flushTimer) return
  clearTimeout(flushTimer)
  flushTimer = null
}

function scheduleNextFlush(): void {
  clearFlushTimer()

  const delay = getAutoSyncDelay()
  if (
    workspaceSwitchPauseDepth > 0
    || !delay
    || pendingTasks.size === 0
    || !useArticleStore.getState().syncStaticAssets
  ) {
    return
  }

  const workspaceKey = getCurrentWorkspaceKey()
  let earliestDueAt = Number.POSITIVE_INFINITY
  for (const task of pendingTasks.values()) {
    if (task.workspaceKey === workspaceKey) {
      earliestDueAt = Math.min(earliestDueAt, task.dueAt)
    }
  }
  if (!Number.isFinite(earliestDueAt)) return

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushPendingStaticAssetSync()
  }, Math.max(0, earliestDueAt - Date.now()))
}

async function uploadChangedStaticAsset(task: StaticAssetTask): Promise<void> {
  const isTaskCurrent = () => (
    workspaceSwitchPauseDepth === 0
    && task.workspaceKey === getCurrentWorkspaceKey()
    && task.epoch === syncEpoch
    && useArticleStore.getState().syncStaticAssets
  )
  if (!isTaskCurrent()) return

  const taskKey = getTaskKey(task.workspaceKey, task.path)
  const immediateUpload = immediateUploads.get(taskKey)
  if (immediateUpload) {
    try {
      await immediateUpload
    } catch {
      // The normal queue below retries an image when its immediate upload failed.
    }
  }

  await withStaticAssetSyncLock(task.path, async operationKey => {
    const localBytes = await readLocalBytes(task.path)
    if (!localBytes || !isTaskCurrent()) return
    if (await matchesRememberedStaticAssetContent(task.path, localBytes, operationKey)) {
      markTaskRemote(task.path)
      return
    }

    let remoteBytes: Uint8Array | null = null
    try {
      remoteBytes = await downloadRemoteBytes(task.path)
      if (!isTaskCurrent()) return
      if (bytesEqual(localBytes, remoteBytes)) {
        rememberStaticAssetSyncMarker(
          await createStaticAssetSyncMarker(task.path, localBytes, operationKey),
        )
        markTaskRemote(task.path)
        return
      }
    } catch {
      // A missing or temporarily unreadable remote file still needs an upload attempt.
    }

    if (!isTaskCurrent()) return

    const latestLocalBytes = await readLocalBytes(task.path)
    if (!latestLocalBytes || !isTaskCurrent()) return
    if (!bytesEqual(localBytes, latestLocalBytes)) {
      if (await matchesRememberedStaticAssetContent(
        task.path,
        latestLocalBytes,
        operationKey,
      )) {
        markTaskRemote(task.path)
        return
      }
      if (remoteBytes && bytesEqual(latestLocalBytes, remoteBytes)) {
        rememberStaticAssetSyncMarker(
          await createStaticAssetSyncMarker(task.path, latestLocalBytes, operationKey),
        )
        markTaskRemote(task.path)
        return
      }
    }

    const marker = await createStaticAssetSyncMarker(
      task.path,
      latestLocalBytes,
      operationKey,
    )
    if (!isTaskCurrent()) return
    const sha = await uploadRemoteBytes(
      task.path,
      latestLocalBytes,
      `Upload file: ${task.path}`,
      getRemoteContentType(task.path),
    )
    rememberStaticAssetSyncMarker(marker)
    if (isTaskCurrent()) {
      useArticleStore.getState().markFileRemote(task.path, sha)
    }
  })
}

async function drainPendingTasks(force: boolean): Promise<void> {
  if (workspaceSwitchPauseDepth > 0) return

  const articleState = useArticleStore.getState()
  if (!articleState.syncStaticAssets) {
    pendingTasks.clear()
    return
  }

  const delay = getAutoSyncDelay()
  if (!force && !delay) return

  const workspaceKey = getCurrentWorkspaceKey()
  const now = Date.now()

  for (const [key, task] of pendingTasks) {
    if (task.workspaceKey !== workspaceKey || task.epoch !== syncEpoch) {
      pendingTasks.delete(key)
    }
  }

  const hasReadyTask = Array.from(pendingTasks.values()).some(task => (
    task.workspaceKey === workspaceKey && (force || task.dueAt <= now)
  ))
  if (!hasReadyTask) return

  const provider = useSettingStore.getState().primaryBackupMethod
  if (provider === 'selfHosted') {
    for (const [key, task] of pendingTasks) {
      if (task.workspaceKey === workspaceKey) pendingTasks.delete(key)
    }
    return
  }
  if (!await isSyncConfigured()) {
    for (const task of pendingTasks.values()) {
      if (task.workspaceKey === workspaceKey && (force || task.dueAt <= now)) {
        task.dueAt = Number.POSITIVE_INFINITY
      }
    }
    return
  }

  const tasks: StaticAssetTask[] = []
  for (const [key, task] of pendingTasks) {
    if (task.workspaceKey === workspaceKey && (force || task.dueAt <= now)) {
      pendingTasks.delete(key)
      tasks.push(task)
    }
  }

  for (const task of tasks) {
    if (task.workspaceKey !== getCurrentWorkspaceKey()) return
    if (!useArticleStore.getState().syncStaticAssets) return

    try {
      await uploadChangedStaticAsset(task)
    } catch (error) {
      const attempts = task.attempts + 1
      const taskKey = getTaskKey(task.workspaceKey, task.path)
      if (
        workspaceSwitchPauseDepth > 0
        || task.workspaceKey !== getCurrentWorkspaceKey()
        || task.epoch !== syncEpoch
        || !useArticleStore.getState().syncStaticAssets
      ) {
        continue
      }
      if (pendingTasks.has(taskKey)) {
        continue
      }
      if (attempts < MAX_UPLOAD_ATTEMPTS) {
        pendingTasks.set(taskKey, {
          ...task,
          attempts,
          dueAt: Date.now() + Math.max(delay, 1000),
        })
      } else {
        console.error(`[StaticAssetSyncQueue] Failed to upload ${task.path}:`, error)
      }
    }
  }
}

export function enqueueStaticAssetSync(
  path: string,
  source = captureStaticAssetSyncSource(),
): void {
  if (!isSourceCurrent(source)) return

  const normalizedPath = normalizeRelativePath(path)
  if (!isEligibleStaticImagePath(normalizedPath)) return
  if (!useArticleStore.getState().syncStaticAssets) return

  const workspaceKey = getCurrentWorkspaceKey()
  const delay = getAutoSyncDelay()
  pendingTasks.set(getTaskKey(workspaceKey, normalizedPath), {
    path: normalizedPath,
    workspaceKey,
    epoch: source.epoch,
    dueAt: Date.now() + delay,
    attempts: 0,
  })
  scheduleNextFlush()
}

export async function uploadStaticAssetNow(
  path: string,
  source = captureStaticAssetSyncSource(),
): Promise<string | undefined> {
  if (!isSourceCurrent(source)) return undefined

  const normalizedPath = normalizeRelativePath(path)
  if (!isEligibleStaticImagePath(normalizedPath)) return undefined

  const workspaceKey = source.workspaceKey
  const taskKey = getTaskKey(workspaceKey, normalizedPath)
  const existingUpload = immediateUploads.get(taskKey)
  if (existingUpload) return await existingUpload

  const upload = uploadLocalLibraryFile(normalizedPath).then(sha => {
    if (workspaceSwitchPauseDepth === 0 && workspaceKey === getCurrentWorkspaceKey()) {
      useArticleStore.getState().markFileRemote(normalizedPath, sha)
    }
    return sha
  })
  immediateUploads.set(taskKey, upload)

  try {
    return await upload
  } finally {
    if (immediateUploads.get(taskKey) === upload) {
      immediateUploads.delete(taskKey)
    }
  }
}

export async function flushPendingStaticAssetSync(
  options: { force?: boolean } = {},
): Promise<void> {
  clearFlushTimer()

  while (activeFlush) {
    await activeFlush
    if (!options.force) return
  }

  const flush = drainPendingTasks(options.force === true)
  activeFlush = flush
  try {
    await flush
  } catch (error) {
    console.error('[StaticAssetSyncQueue] Failed to flush pending images:', error)
  } finally {
    if (activeFlush === flush) activeFlush = null
    scheduleNextFlush()
  }
}

export async function prepareStaticAssetSyncForWorkspaceSwitch(): Promise<void> {
  workspaceSwitchPauseDepth += 1
  syncEpoch += 1
  pendingTasks.clear()
  clearFlushTimer()

  const uploads = [
    ...(activeFlush ? [activeFlush] : []),
    ...immediateUploads.values(),
  ]
  if (uploads.length === 0) return

  await Promise.allSettled(uploads)
}

export function finishStaticAssetSyncWorkspaceSwitch(): void {
  workspaceSwitchPauseDepth = Math.max(0, workspaceSwitchPauseDepth - 1)
  scheduleNextFlush()
}
