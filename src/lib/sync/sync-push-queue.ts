'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import { setLocalRecordedSha, getLocalRecordedSha } from './auto-sync'
import { isSyncConfigured } from './sync-manager'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import useFileDeletionStore, { isFileDeletionPending } from '@/stores/file-deletion'
import { CloudFolderConfig } from '@/types/sync'
import { debugSyncPerf } from './remote-file'
import { generateGitSyncCommitMessage } from './commit-message'
import { getSyncMetadataKey } from './sync-context'
import { prepareWorkspacePathUpload, resumeWorkspacePathMoves } from './workspace-path-moves'
import { supportsCloudFolderWorkspace } from './cloud-folder'
import { captureWorkspaceRemoteWriteGuard } from './workspace-remote-write-guard'
import { readVersionedWorkspaceFile, uploadGuardedWorkspaceFile } from './guarded-workspace-upload'
import { getRemoteFileMetadata } from './remote-library'
import { normalizeRemoteVersion } from './remote-content-cache'
import { isSyncStaleError, readSyncStaleDetails } from './sync-stale-error'
import { collectLocalMarkdownImagePaths } from '@/lib/markdown-media-path'
import {
  enqueueStaticAssetSync,
  finishStaticAssetSyncWorkspaceSwitch,
  flushPendingStaticAssetSync,
  prepareStaticAssetSyncForWorkspaceSwitch,
} from './static-asset-sync-queue'

type SyncProvider = 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'

async function enqueueSelfHostedFile(path: string) {
  const { enqueueFileSnapshot } = await import('@/lib/self-hosted-sync/outbox')
  const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
  await enqueueFileSnapshot(path)
  void getSelfHostedSyncRuntime().wake('file:push-queue')
}

async function getCloudFolderWorkspaceConfig(): Promise<CloudFolderConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config && supportsCloudFolderWorkspace(config) ? config : null
}

interface PushTask {
  path: string
  timestamp: number
  workspacePath: string
  generation: number
}

function getPerfNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function roundMs(value: number) {
  return Math.round(value)
}

// 当前模块实例的监听器；跨热更新的清理由下方全局 dispose 回调负责。
let initialized = false
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleSavedListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let editorInputListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let syncPulledListener: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let articleOpenedListener: any = null

class SyncPushQueue {
  private queue: PushTask[] = []
  private retired = false
  private readonly ready: Promise<void>
  private isProcessing = false
  private manualRetryPending = false
  private flushPromise: Promise<void> | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastInputTime: number = Date.now()
  private generation = 0
  private workspaceSwitchPauseDepth = 0
  private pausedPaths = new Set<string>()
  private activePath: string | null = null
  private fileDeletionUnsubscribe: (() => void) | null = null
  private readonly WORKSPACE_SWITCH_WAIT_TIMEOUT = 3_000

  constructor(previousQueue: Promise<PushTask[]> = Promise.resolve([])) {
    const generation = this.generation
    this.ready = previousQueue.then(tasks => {
      if (generation !== this.generation || this.workspaceSwitchPauseDepth > 0) return
      const workspacePath = useSettingStore.getState().workspacePath
      this.queue.push(...tasks
        .filter(task => task.workspacePath === workspacePath)
        .map(task => ({ ...task, generation })))
      if (this.queue.length) this.scheduleFlush()
    })
  }

  private get IDLE_THRESHOLD(): number {
    // 动态读取 autoSync 设置
    const state = useSettingStore.getState()
    if (!state) return 0
    if (state.primaryBackupMethod === 'local') return 0

    const { autoSync } = state

    if (!autoSync || autoSync === 'disabled') {
      return 0 // 禁用自动同步
    }
    return parseInt(autoSync, 10) * 1000
  }

  private readonly CHECK_INTERVAL = 100 // 每 100ms 检查一次

  /**
   * 初始化监听器 - 只执行一次
   */
  init() {
    if (initialized || this.retired) return
    initialized = true
    this.initListeners()
    if (typeof window !== 'undefined') window.addEventListener('online', resumeWorkspacePathMoves)
  }

  private initListeners() {
    // 移除旧的监听器（如果有）
    this.removeListeners()
    this.fileDeletionUnsubscribe = useFileDeletionStore.subscribe(state => {
      if (!state.progress) return
      this.queue = this.queue.filter(task => !isFileDeletionPending(task.path, task.workspacePath))
      for (const path of this.pausedPaths) {
        if (isFileDeletionPending(path)) this.pausedPaths.delete(path)
      }
    })

    // 监听文章保存事件
    articleSavedListener = ((event: { path: string; content: string }) => {
      this.addTask(event.path)
    }) as any
    emitter.on('article-saved', articleSavedListener)

    // 监听用户输入事件，重置计时器
    editorInputListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('editor-input', editorInputListener)

    // 监听拉取完成事件，重置计时器
    syncPulledListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('sync-pulled', syncPulledListener)

    // 监听文件切换事件，重置计时器
    articleOpenedListener = (() => {
      this.lastInputTime = Date.now()
    }) as any
    emitter.on('article-opened', articleOpenedListener)
  }

  private removeListeners() {
    this.fileDeletionUnsubscribe?.()
    this.fileDeletionUnsubscribe = null
    if (articleSavedListener) {
      emitter.off('article-saved', articleSavedListener)
    }
    if (editorInputListener) {
      emitter.off('editor-input', editorInputListener)
    }
    if (syncPulledListener) {
      emitter.off('sync-pulled', syncPulledListener)
    }
    if (articleOpenedListener) {
      emitter.off('article-opened', articleOpenedListener)
    }
    articleSavedListener = null
    editorInputListener = null
    syncPulledListener = null
    articleOpenedListener = null
  }

  /**
   * 添加任务到队列 - 只保留最新的任务
   * 每次调用都会重新开始 10 秒计时
   */
  addTask(path: string) {
    if (this.retired) return
    if (isFileDeletionPending(path)) return
    if (this.workspaceSwitchPauseDepth > 0) { this.pausedPaths.add(path); return }
    if (useSettingStore.getState().primaryBackupMethod === 'local') return

    const now = Date.now()
    const task: PushTask = {
      path,
      timestamp: now,
      workspacePath: useSettingStore.getState().workspacePath,
      generation: this.generation,
    }

    // 重置 lastInputTime，确保从现在开始计算 10 秒
    this.lastInputTime = now

    // 如果当前有任务正在处理
    if (this.isProcessing) {
      // Bug fix: Instead of silently dropping, add the task to queue for processing
      // This ensures all file changes are eventually synced
      this.queue.push(task)
      return
    }

    // 清空队列，只保留最新任务
    this.queue = [task]

    // 设置防抖定时器
    this.scheduleFlush()
  }

  /**
   * 手动重试仍走正常推送和冲突检查，即使关闭自动同步也可执行。
   */
  async retry(paths: string[]): Promise<void> {
    if (this.retired) return
    if (this.workspaceSwitchPauseDepth > 0) return
    if (useSettingStore.getState().primaryBackupMethod === 'local') return
    const workspacePath = useSettingStore.getState().workspacePath
    for (const path of new Set(paths)) {
      if (isFileDeletionPending(path, workspacePath)) continue
      this.queue.push({ path, timestamp: Date.now(), workspacePath, generation: this.generation })
    }
    if (this.flushPromise) {
      this.manualRetryPending = true
      await this.flushPromise
      return
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    await this.flush()
  }

  /** 防抖调度 - 用户停止输入后执行推送 */
  private scheduleFlush() {
    if (this.retired) return
    // 如果自动同步被禁用，直接返回
    if (!this.IDLE_THRESHOLD) {
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const checkIdle = () => {
      const now = Date.now()
      const timeSinceInput = now - this.lastInputTime

      if (timeSinceInput >= this.IDLE_THRESHOLD) {
        // 用户停止输入超过等待时间，执行推送
        this.flush()
      } else {
        // 继续等待
        this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
      }
    }

    this.debounceTimer = setTimeout(checkIdle, this.CHECK_INTERVAL)
  }

  /**
   * 清空队列并处理任务
   * Bug fix: Process all tasks in the queue, not just the last one
   */
  private async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise
    const run = async (): Promise<void> => {
      try {
        await this.flushBatch()
      } finally {
        this.flushPromise = null
      }
      if (this.manualRetryPending && this.queue.length > 0) {
        this.manualRetryPending = false
        await this.flush()
      }
    }
    this.flushPromise = run()
    return this.flushPromise
  }

  private async flushBatch(): Promise<void> {
    await this.ready
    if (this.retired || this.isProcessing || this.queue.length === 0) {
      return
    }

    if (!await isSyncConfigured()) {
      this.clear()
      return
    }

    // Upload newly created or changed local images before Markdown starts
    // referencing them on another device.
    await flushPendingStaticAssetSync({ force: true })

    // Bug fix: Process all tasks in the queue (newest first)
    // Group by path - keep only the newest task for each path
    const taskMap = new Map<string, PushTask>()
    while (this.queue.length > 0) {
      const task = this.queue.shift()!
      if (task.generation !== this.generation) continue
      // Only keep the newest task for each path
      const taskKey = `${task.workspacePath}\0${task.path}`
      const existing = taskMap.get(taskKey)
      if (!existing || task.timestamp > existing.timestamp) {
        taskMap.set(taskKey, task)
      }
    }
    const tasksToProcess = Array.from(taskMap.values()).sort((a, b) => b.timestamp - a.timestamp)

    this.isProcessing = false // Will be set to true in the loop

    // Process each task
    for (const task of tasksToProcess) {
      if (task.generation !== this.generation) continue
      if (task.workspacePath !== useSettingStore.getState().workspacePath) continue
      if (isFileDeletionPending(task.path, task.workspacePath)) continue
      this.isProcessing = true
      this.activePath = task.path

      try {
        // Wait for file system to complete write
        await new Promise(resolve => setTimeout(resolve, 100))
        // 发送开始推送事件
        emitter.emit('sync-push-started', { path: task.path })
        await this.pushToRemote(task.path, task)
      } catch (error) {
        console.error(`[SyncPushQueue] Failed to push ${task.path}:`, error)
        if (this.isTaskCurrent(task)) emitter.emit('sync-push-completed', { path: task.path, success: false })
      } finally {
        this.isProcessing = false
        this.activePath = null
      }
    }

    // Schedule if there are new tasks
    if (this.queue.length > 0 && !this.manualRetryPending) {
      this.scheduleFlush()
    }
  }

  /**
   * 推送到远程仓库
   */
  private isTaskCurrent(task: PushTask) {
    return task.generation === this.generation
      && task.workspacePath === useSettingStore.getState().workspacePath
      && this.workspaceSwitchPauseDepth === 0
      && !isFileDeletionPending(task.path, task.workspacePath)
  }

  private async pushToRemote(path: string, task: PushTask): Promise<{ success: boolean; sha?: string }> {
    const maxRetries = 3
    const syncStartedAt = getPerfNow()
    let previousPerfAt = syncStartedAt
    let providerForLog: SyncProvider | 'unknown' = 'unknown'
    const logPerf = (step: string, payload: Record<string, unknown> = {}) => {
      const now = getPerfNow()
      debugSyncPerf(`syncQueue.${step}`, {
        path,
        provider: providerForLog,
        stepMs: roundMs(now - previousPerfAt),
        totalMs: roundMs(now - syncStartedAt),
        ...payload,
      })
      previousPerfAt = now
    }

    if (!await isSyncConfigured()) {
      logPerf('skipped', { reason: 'sync-not-configured' })
      return { success: false }
    }
    await prepareWorkspacePathUpload(path)
    const taskSyncMetadataKey = await getSyncMetadataKey(path)
    let acceptedVersion = await getLocalRecordedSha(path)
    if (!this.isTaskCurrent(task)) return { success: false }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isTaskCurrent(task) || await getSyncMetadataKey(path) !== taskSyncMetadataKey) return { success: false }
        logPerf('startAttempt', {
          attempt,
          maxRetries,
        })
        const store = await Store.load('store.json')
        const provider = (await store.get<string>('primaryBackupMethod') || 'github') as SyncProvider
        providerForLog = provider
        if (provider === 'selfHosted') {
          await enqueueSelfHostedFile(path)
          return { success: true }
        }
        logPerf('loadConfig', { attempt, provider })

        // 从磁盘读取最新内容，确保上传的是本地最新内容
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        logPerf('readLocalFile', {
          attempt,
          workspaceCustom: workspace.isCustom,
          contentLength: content.length,
        })

        const referencedImagePaths = collectLocalMarkdownImagePaths(content, path)
        for (const imagePath of referencedImagePaths) {
          enqueueStaticAssetSync(imagePath)
        }
        await flushPendingStaticAssetSync({ force: true })
        if (!this.isTaskCurrent(task)) return { success: false }
        logPerf('flushReferencedStaticAssets', {
          attempt,
          referencedImages: referencedImagePaths.length,
        })

        // Version-recording failures must not fall through to another upload.
        let matchingVersion: string | undefined
        try {
          const remoteFile = await readVersionedWorkspaceFile(path, provider)
          const remoteContent = new TextDecoder().decode(remoteFile.content)
          logPerf('pullRemoteFile', {
            attempt,
            remoteLength: remoteContent?.length || 0,
            isSameContent: remoteContent === content,
          })
          if (remoteContent === content) matchingVersion = remoteFile.version
        } catch (remoteError) {
          logPerf('pullRemoteFileFailed', {
            attempt,
            message: remoteError instanceof Error ? remoteError.message : String(remoteError),
          })
        }
        if (matchingVersion) {
          if (!this.isTaskCurrent(task)) return { success: false }
          await setLocalRecordedSha(path, matchingVersion, taskSyncMetadataKey)
          emitter.emit('sync-push-completed', { path, success: true, sha: matchingVersion })
          logPerf('completed', { attempt, skippedUpload: true, success: true, hasSha: true })
          return { success: true, sha: matchingVersion }
        }

        const needsCommitMessage = provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder'
        const commitMessage = needsCommitMessage
          ? await generateGitSyncCommitMessage(path, content)
          : ''
        if (needsCommitMessage) {
          logPerf('generateCommitMessage', {
            attempt,
            messageLength: commitMessage.length,
            thinkingDisabled: true,
          })
        } else {
          logPerf('skipCommitMessage', {
            attempt,
            reason: 'provider-without-commits',
          })
        }

        if (!this.isTaskCurrent(task)) return { success: false }

        let success = false
        let uploadedSha: string | undefined

        const cloudConfig = provider === 'cloudFolder' ? await getCloudFolderWorkspaceConfig() : null
        if (provider === 'cloudFolder' && cloudConfig?.provider !== 'oneDrive') {
          if (!cloudConfig) throw new Error('Cloud folder is not configured')
          const { androidCloudFolderWorkspaceUpload } = await import('./cloud-folder')
          const beforeWrite = await captureWorkspaceRemoteWriteGuard(path, provider, true, content)
          const result = await androidCloudFolderWorkspaceUpload(cloudConfig, path, content, undefined, beforeWrite)
          success = true
          uploadedSha = result.etag
        } else {
          uploadedSha = await uploadGuardedWorkspaceFile(path, content, provider, acceptedVersion, commitMessage, taskSyncMetadataKey)
          success = true
        }
        if (uploadedSha && this.isTaskCurrent(task)) {
          if (provider === 's3') useSyncStore.getState().updateS3FileEtag(path, uploadedSha)
          if (provider === 'webdav') useSyncStore.getState().updateWebDAVFileEtag(path, uploadedSha)
        }

        if (success) {
          if (!this.isTaskCurrent(task)) {
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }
          // 推送成功后，保存远程 SHA 到本地 store
          if (uploadedSha) {
            await setLocalRecordedSha(path, uploadedSha, taskSyncMetadataKey)
            logPerf('recordLocalSha', {
              attempt,
              hasSha: true,
            })
          }
          emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
          logPerf('completed', {
            attempt,
            success: true,
            hasSha: Boolean(uploadedSha),
          })
          return { success: true, sha: uploadedSha }
        } else {
          // 上传失败（result 为空或无效）
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'empty-upload-result',
          })
          return { success: false }
        }
      } catch (error) {
        if (!this.isTaskCurrent(task)) return { success: false }
        const errorRecord = error && typeof error === 'object' ? error as Record<string, unknown> : undefined
        const errorMessage = typeof errorRecord?.message === 'string' ? errorRecord.message : String(error)
        const errorStatus = typeof errorRecord?.status === 'number' ? errorRecord.status : 0
        logPerf('failedAttempt', {
          attempt,
          message: errorMessage,
          status: errorStatus,
        })
        const stale = isSyncStaleError(error)
        const staleDetails = readSyncStaleDetails(error)
        const concernsFile = !staleDetails?.path || staleDetails.path === path
        // 本地继续保存只会使本次内容快照失效，重新读取后重试。
        let shouldRetry = concernsFile && staleDetails?.source === 'local' && staleDetails.check === 'content'
        const possibleRemoteConflict = stale
          ? concernsFile && staleDetails?.source === 'remote' && staleDetails.check !== 'configuration'
          : errorStatus === 409 || errorStatus === 412 || errorStatus === 422
            || /does not match|sha|blob|conflict|out of date|已过时|冲突/i.test(errorMessage)

        if (possibleRemoteConflict && providerForLog !== 'unknown' && providerForLog !== 'selfHosted') {
          try {
            if (await getSyncMetadataKey(path) !== taskSyncMetadataKey || !this.isTaskCurrent(task)) return { success: false }
            // 使用文件版本，避免把 GitLab/Gitea 的提交 SHA 与 blob SHA 比较。
            const remoteFile = await getRemoteFileMetadata(path, 'workspace', providerForLog)
            const latestAcceptedVersion = await getLocalRecordedSha(path)
            if (await getSyncMetadataKey(path) !== taskSyncMetadataKey || !this.isTaskCurrent(task)) return { success: false }
            const remoteVersion = normalizeRemoteVersion(remoteFile?.version)
            const expectedVersion = normalizeRemoteVersion(acceptedVersion || undefined)

            // 查询失败或远端缺少可用版本都不能作为文件冲突的证据。
            if (!remoteFile || remoteVersion) {
              if (remoteVersion === expectedVersion) {
                shouldRetry = true
              } else if (remoteVersion && remoteVersion === normalizeRemoteVersion(latestAcceptedVersion || undefined)) {
                // 使用本客户端并发同步已接受的新基准，下一次重新读取本地内容。
                acceptedVersion = latestAcceptedVersion
                shouldRetry = true
              } else {
                emitter.emit('sync-sha-mismatch', {
                  path,
                  workspacePath: task.workspacePath,
                  localSha: acceptedVersion || undefined,
                  remoteSha: remoteFile?.version || undefined,
                  force: false,
                })
                emitter.emit('sync-push-completed', { path, success: false })
                logPerf('completed', { attempt, success: false, reason: 'sha-mismatch' })
                return { success: false }
              }
            }
          } catch (metadataError) {
            logPerf('shaMismatchInfoFailed', {
              attempt,
              message: metadataError instanceof Error ? metadataError.message : String(metadataError),
            })
          }
        }

        if (shouldRetry && attempt < maxRetries) {
          // 等待一段时间后重试（指数退避）
          const waitTime = Math.pow(2, attempt - 1) * 500
          logPerf('retryWait', {
            attempt,
            waitMs: waitTime,
          })
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        console.error('[SyncPushQueue] 推送失败:', error)
        emitter.emit('sync-push-completed', { path, success: false })
        logPerf('completed', {
          attempt,
          success: false,
          reason: 'error',
        })
        return { success: false }
      }
    }

    return { success: false }
  }

  /**
   * 强制推送文件到远程（忽略 SHA 不匹配）
   * 用于用户确认后强制覆盖远程文件
   */
  async forcePush(
    path: string,
    expectedWorkspacePath = useSettingStore.getState().workspacePath,
  ): Promise<{ success: boolean; sha?: string }> {
    try {
      await this.ready
      if (
        this.retired
        || this.workspaceSwitchPauseDepth > 0
        || expectedWorkspacePath !== useSettingStore.getState().workspacePath
        || isFileDeletionPending(path, expectedWorkspacePath)
      ) {
        return { success: false }
      }

      if (!await isSyncConfigured()) {
        return { success: false }
      }

      const store = await Store.load('store.json')
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as SyncProvider
      if (provider === 'selfHosted') {
        await enqueueSelfHostedFile(path)
        return { success: true }
      }
      await prepareWorkspacePathUpload(path)
      const forceMetadataKey = await getSyncMetadataKey(path, provider)
      const { getWorkspaceOverwriteVersion } = await import('./guarded-workspace-upload')
      const overwriteVersion = await getWorkspaceOverwriteVersion(path, provider)

      // 从磁盘读取最新内容
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(path)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

      const needsCommitMessage = provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder'
      const commitMessage = needsCommitMessage
        ? await generateGitSyncCommitMessage(path, content)
        : ''

      let success = false
      let uploadedSha: string | undefined

      const cloudConfig = provider === 'cloudFolder' ? await getCloudFolderWorkspaceConfig() : null
      if (provider === 'cloudFolder' && cloudConfig?.provider !== 'oneDrive') {
        if (!cloudConfig) throw new Error('Cloud folder is not configured')
        const { androidCloudFolderWorkspaceUpload } = await import('./cloud-folder')
        const beforeWrite = await captureWorkspaceRemoteWriteGuard(path, provider, true, content)
        const result = await androidCloudFolderWorkspaceUpload(cloudConfig, path, content, undefined, beforeWrite)
        uploadedSha = result.etag
      } else {
        uploadedSha = await uploadGuardedWorkspaceFile(path, content, provider, overwriteVersion, commitMessage, forceMetadataKey)
      }
      success = true
      if (provider === 's3') useSyncStore.getState().updateS3FileEtag(path, uploadedSha)
      if (provider === 'webdav') useSyncStore.getState().updateWebDAVFileEtag(path, uploadedSha)

      if (success) {
        // 保存新的 SHA
        if (uploadedSha) {
          await setLocalRecordedSha(path, uploadedSha, forceMetadataKey)
        }
        emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
        return { success: true, sha: uploadedSha }
      } else {
        emitter.emit('sync-push-completed', { path, success: false })
        return { success: false }
      }
    } catch (error) {
      console.error('[SyncPushQueue] 强制推送失败:', error)
      emitter.emit('sync-push-completed', { path, success: false })
      return { success: false }
    }
  }

  /**
   * 清空队列
   */
  clear() {
    this.generation += 1
    this.queue = []
    this.manualRetryPending = false
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  async dispose(): Promise<PushTask[]> {
    this.retired = true
    this.manualRetryPending = false
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.removeListeners()
    if (typeof window !== 'undefined') window.removeEventListener('online', resumeWorkspacePathMoves)
    initialized = false
    // 已进入传输层的写入先正常完成并记录版本，再移交尚未执行的任务。
    try {
      await this.ready
      await this.flushPromise
    } catch (error) {
      console.error('[SyncPushQueue] 清理旧同步队列失败:', error)
    }
    const tasks = this.queue.filter(task => this.isTaskCurrent(task))
    this.clear()
    return tasks
  }

  async prepareForWorkspaceSwitch() {
    this.workspaceSwitchPauseDepth += 1
    for (const task of this.queue) this.pausedPaths.add(task.path)
    if (this.activePath && this.isProcessing) this.pausedPaths.add(this.activePath)
    this.clear()
    await prepareStaticAssetSyncForWorkspaceSwitch()
    const deadline = Date.now() + this.WORKSPACE_SWITCH_WAIT_TIMEOUT
    while (this.isProcessing) {
      if (Date.now() >= deadline) {
        console.warn('[SyncPushQueue] 工作区切换等待同步任务超时，旧任务将在后台安全结束')
        break
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }

  finishWorkspaceSwitch(resumeCancelledTasks = false) {
    this.workspaceSwitchPauseDepth = Math.max(0, this.workspaceSwitchPauseDepth - 1)
    this.lastInputTime = Date.now()
    finishStaticAssetSyncWorkspaceSwitch()
    if (this.workspaceSwitchPauseDepth === 0) {
      if (resumeCancelledTasks && useSettingStore.getState().primaryBackupMethod !== 'local') {
        const workspacePath = useSettingStore.getState().workspacePath
        this.queue.push(...[...this.pausedPaths].map(path => ({ path, workspacePath, generation: this.generation, timestamp: Date.now() })))
        if (this.queue.length) this.scheduleFlush()
      }
      resumeWorkspacePathMoves()
      this.pausedPaths.clear()
      this.activePath = null
    }
  }
}

type SyncPushQueueGlobal = typeof globalThis & {
  __noteGenSyncPushQueueDispose?: () => Promise<PushTask[]>
}

const syncPushQueueGlobal = globalThis as SyncPushQueueGlobal
const previousQueueHandoff = syncPushQueueGlobal.__noteGenSyncPushQueueDispose?.() || Promise.resolve([])

// 单例实例；新模块接管时先等待旧模块的在途写入结束。
let syncPushQueue: SyncPushQueue | null = null
syncPushQueueGlobal.__noteGenSyncPushQueueDispose = () => syncPushQueue
  ? syncPushQueue.dispose()
  : previousQueueHandoff

export function getSyncPushQueue(): SyncPushQueue {
  if (!syncPushQueue) {
    const queue = new SyncPushQueue(previousQueueHandoff)
    syncPushQueue = queue
    queue.init()
  }
  return syncPushQueue
}

export default SyncPushQueue
