'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import { pullRemoteFile, setLocalRecordedSha, getLocalRecordedSha } from './auto-sync'
import { getRemoteFileInfo } from './auto-sync'
import { isSyncConfigured } from './sync-manager'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import { debugSyncPerf } from './remote-file'
import { generateGitSyncCommitMessage } from './commit-message'
import { getSyncMetadataKey } from './sync-context'
import { supportsCloudFolderWorkspace } from './cloud-folder'
import {
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

/**
 * 获取 S3 配置
 */
async function getS3Config(): Promise<S3Config | null> {
  const store = await Store.load('store.json')
  const config = await store.get<S3Config>('s3SyncConfig')
  if (config && config.accessKeyId && config.secretAccessKey && config.region && config.bucket) {
    return config
  }
  return null
}

/**
 * 获取 WebDAV 配置
 */
async function getWebDAVConfig(): Promise<WebDAVConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (config && config.url && config.username && config.password) {
    return config
  }
  return null
}

/**
 * 获取代理配置
 */
async function getProxyConfig(): Promise<{ all: string } | undefined> {
  const store = await Store.load('store.json')
  const proxyUrl = await store.get<string>('proxy')
  return proxyUrl ? { all: proxyUrl } : undefined
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

// 使用模块级变量来跟踪初始化状态，避免 HMR 重复注册
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
  private isProcessing = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastInputTime: number = Date.now()
  private generation = 0
  private workspaceSwitchPauseDepth = 0
  private readonly WORKSPACE_SWITCH_WAIT_TIMEOUT = 3_000

  private get IDLE_THRESHOLD(): number {
    // 动态读取 autoSync 设置
    const state = useSettingStore.getState()
    if (!state) return 0

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
    if (initialized) return
    initialized = true
    this.initListeners()
  }

  private initListeners() {
    // 移除旧的监听器（如果有）
    this.removeListeners()

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
    if (this.workspaceSwitchPauseDepth > 0) return

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
   * 防抖调度 - 用户停止输入后执行推送
   */
  private scheduleFlush() {
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
  private async flush() {
    if (this.isProcessing || this.queue.length === 0) {
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
      this.isProcessing = true

      try {
        // Wait for file system to complete write
        await new Promise(resolve => setTimeout(resolve, 100))
        // 发送开始推送事件
        emitter.emit('sync-push-started', { path: task.path })
        await this.pushToRemote(task.path, task)
      } catch (error) {
        console.error(`[SyncPushQueue] Failed to push ${task.path}:`, error)
      } finally {
        this.isProcessing = false
      }
    }

    // Schedule if there are new tasks
    if (this.queue.length > 0) {
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
    const taskSyncMetadataKey = await getSyncMetadataKey(path)
    if (!this.isTaskCurrent(task)) return { success: false }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isTaskCurrent(task)) return { success: false }
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
        const repo = (provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder')
          ? await getSyncRepoName(provider)
          : undefined
        logPerf('loadConfig', {
          attempt,
          hasRepo: Boolean(repo),
        })

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

        // 检查本地内容是否与远程相同，如果相同则跳过推送
        try {
          const remoteContent = await pullRemoteFile(path)
          logPerf('pullRemoteFile', {
            attempt,
            remoteLength: remoteContent.length,
            isSameContent: remoteContent === content,
          })
          if (remoteContent === content) {
            if (!this.isTaskCurrent(task)) return { success: false }
            // 获取远程 SHA 用于更新文件树
            const remoteSha = await this.getRemoteSha(path)
            if (!this.isTaskCurrent(task)) return { success: false }
            logPerf('getRemoteShaWhenSame', {
              attempt,
              hasSha: Boolean(remoteSha),
            })
            // 更新本地记录的 SHA，这样下次推送时就会检测到 SHA 匹配而跳过
            if (remoteSha) {
              await setLocalRecordedSha(path, remoteSha, taskSyncMetadataKey)
              logPerf('recordLocalSha', {
                attempt,
                hasSha: true,
              })
            }
            // 发送完成事件
            emitter.emit('sync-push-completed', { path, success: true, sha: remoteSha })
            logPerf('completed', {
              attempt,
              skippedUpload: true,
              success: true,
              hasSha: Boolean(remoteSha),
            })
            return { success: true, sha: remoteSha }
          }
        } catch (remoteError) {
          // 远程文件不存在或获取失败，继续推送
          logPerf('pullRemoteFileFailed', {
            attempt,
            message: remoteError instanceof Error ? remoteError.message : String(remoteError),
          })
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

        switch (provider) {
          case 'github': {
            const githubModule = await import('@/lib/sync/github') as any
            logPerf('loadProviderModule', { attempt, module: 'github' })
            // 每次尝试都重新获取远程 SHA，因为远程可能在变化
            const fileInfo = await githubModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            // 检查返回的是文件还是目录
            // GitHub API 对文件返回对象，对目录返回数组
            // 如果是数组（目录），则无法获取 sha，跳过推送
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }

            const result = await githubModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            // 检查上传是否成功（result 必须存在且有 data）
            if (result && result.data) {
              success = true
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitee': {
            const giteeModule = await import('@/lib/sync/gitee') as any
            logPerf('loadProviderModule', { attempt, module: 'gitee' })
            // 每次尝试都重新获取远程 SHA
            const fileInfo = await giteeModule.getFiles({ path, repo})
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })

            // 检查返回的是文件还是目录
            // Gitee API 对文件返回对象，对目录返回数组
            // 如果是数组（目录），则无法获取 sha，跳过推送
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }

            const result = await giteeModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
              hasResultSha: Boolean(result?.data?.content?.sha),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // Gitee API 返回的是 result.data.content.sha
              uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            }
            break
          }
          case 'gitlab': {
            const gitlabModule = await import('@/lib/sync/gitlab') as any
            logPerf('loadProviderModule', { attempt, module: 'gitlab' })
            // 先获取远程文件的 SHA（blob_id），uploadFile 会用它获取 last_commit_id
            const fileInfo = await gitlabModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // GitLab getFiles 返回文件对象或文件数组，检查是否为数组（目录）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }
            const result = await gitlabModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha, // GitLab 会用 sha 获取 last_commit_id
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // GitLab 上传成功后从 commit 获取 SHA
              uploadedSha = await this.getRemoteSha(path)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 'gitea': {
            const giteaModule = await import('@/lib/sync/gitea') as any
            logPerf('loadProviderModule', { attempt, module: 'gitea' })
            // 先获取远程文件的 SHA
            const fileInfo = await giteaModule.getFiles({ path, repo })
            logPerf('getRemoteFile', {
              attempt,
              isDirectory: Array.isArray(fileInfo),
              hasRemoteSha: Boolean(fileInfo?.sha),
            })
            // Gitea getFiles 返回文件对象或文件数组，检查是否为数组（目录）
            if (Array.isArray(fileInfo)) {
              console.warn(`[SyncPushQueue] ${path} 是目录，无法推送`)
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'remote-is-directory',
              })
              return { success: false }
            }
            const result = await giteaModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha, // 传递 SHA 以便 Gitea 进行冲突检测
              message: commitMessage,
              repo,
              path
            })
            logPerf('uploadFile', {
              attempt,
              hasData: Boolean(result?.data),
            })
            // 检查上传是否成功
            if (result && result.data) {
              success = true
              // Gitea 上传成功后从 commit 获取 SHA
              uploadedSha = await this.getRemoteSha(path)
              logPerf('refreshUploadedSha', {
                attempt,
                hasSha: Boolean(uploadedSha),
              })
            }
            break
          }
          case 's3': {
            const s3Module = await import('@/lib/sync/s3') as any
            const s3Config = await getS3Config()
            logPerf('loadProviderModule', { attempt, module: 's3', hasConfig: Boolean(s3Config) })
            if (!s3Config) {
              console.warn('[SyncPushQueue] S3 未配置')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false }
            }

            // 获取代理配置
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // S3 不需要 SHA 检查，直接上传
            const result = await s3Module.s3Upload(s3Config, path, content, proxy)
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result && result.etag) {
              success = true
              uploadedSha = result.etag // 使用 ETag 作为标识
              // 更新本地记录的 ETag
              if (this.isTaskCurrent(task)) {
                useSyncStore.getState().updateS3FileEtag(path, result.etag)
              }
            }
            break
          }
          case 'webdav': {
            const webdavModule = await import('@/lib/sync/webdav') as any
            const webdavConfig = await getWebDAVConfig()
            logPerf('loadProviderModule', { attempt, module: 'webdav', hasConfig: Boolean(webdavConfig) })
            if (!webdavConfig) {
              console.warn('[SyncPushQueue] WebDAV 未配置')
              emitter.emit('sync-push-completed', { path, success: false })
              logPerf('completed', {
                attempt,
                success: false,
                reason: 'missing-config',
              })
              return { success: false }
            }

            // 获取代理配置
            const proxy = await getProxyConfig()
            logPerf('loadProxyConfig', {
              attempt,
              hasProxy: Boolean(proxy),
            })

            // WebDAV 不需要 SHA 检查，直接上传
            const result = await webdavModule.webdavUpload(webdavConfig, path, content, proxy)
            logPerf('uploadFile', {
              attempt,
              hasResult: Boolean(result),
              hasEtag: Boolean(result?.etag),
            })
            if (result) {
              success = true
              uploadedSha = result.etag || 'uploaded' // 使用 ETag 作为标识，空字符串使用默认值
              // 更新本地记录的 ETag
              if (this.isTaskCurrent(task)) {
                useSyncStore.getState().updateWebDAVFileEtag(path, result.etag || '')
              }
            }
            break
          }
          case 'cloudFolder': {
            const config = await getCloudFolderWorkspaceConfig()
            if (!config) {
              emitter.emit('sync-push-completed', { path, success: false })
              return { success: false }
            }
            const { androidCloudFolderWorkspaceUpload } = await import('@/lib/sync/cloud-folder')
            const result = await androidCloudFolderWorkspaceUpload(config, path, content)
            success = true
            uploadedSha = result.etag
            break
          }
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
      } catch (error: any) {
        if (!this.isTaskCurrent(task)) return { success: false }
        logPerf('failedAttempt', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
          status: error?.status,
        })
        // 检查是否是 SHA 不匹配错误
        const errorMessage = error?.message || ''
        const errorStatus = error?.status || 0

        // SHA 不匹配错误的特征：
        // 1. HTTP 状态码 422 (Unprocessable Entity) - GitHub/GitLab 常用
        // 2. HTTP 状态码 409 (Conflict) - 文件冲突
        // 3. 错误消息包含相关关键词
        const isShaMismatch =
          errorStatus === 422 ||
          errorStatus === 409 ||
          errorMessage.includes('does not match') ||
          errorMessage.includes('sha') ||
          errorMessage.includes('SHA') ||
          errorMessage.includes('blob') ||
          errorMessage.includes('conflict') ||
          errorMessage.includes('out of date') ||
          errorMessage.includes('已过时') ||
          errorMessage.includes('冲突')

        // 如果是 SHA 不匹配错误且是首次尝试，显示确认对话框让用户选择
        if (isShaMismatch && attempt === 1) {
          // 获取本地记录的 SHA 和远程 SHA
          const localRecordedSha = await getLocalRecordedSha(path)
          const remoteFileInfo = await getRemoteFileInfo(path)
          const remoteFileSha = remoteFileInfo.sha
          logPerf('shaMismatchInfo', {
            attempt,
            hasLocalSha: Boolean(localRecordedSha),
            hasRemoteSha: Boolean(remoteFileSha),
          })

          // 发射事件让 UI 显示确认对话框
          emitter.emit('sync-sha-mismatch', {
            path,
            workspacePath: useSettingStore.getState().workspacePath,
            localSha: localRecordedSha || undefined,
            remoteSha: remoteFileSha || undefined,
            force: false
          })

          // 不再自动重试，等待用户确认
          emitter.emit('sync-push-completed', { path, success: false })
          logPerf('completed', {
            attempt,
            success: false,
            reason: 'sha-mismatch',
          })
          return { success: false }
        }

        if (isShaMismatch && attempt < maxRetries) {
          // 等待一段时间后重试（指数退避）
          const waitTime = Math.pow(2, attempt - 1) * 500
          logPerf('retryWait', {
            attempt,
            waitMs: waitTime,
          })
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        // 如果是最后一次尝试或不是 SHA 错误，打印错误日志
        if (attempt === maxRetries || !isShaMismatch) {
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
    }

    return { success: false }
  }

  /**
   * 获取远程文件的 SHA
   */
  private async getRemoteSha(path: string): Promise<string | undefined> {
    try {
      const info = await getRemoteFileInfo(path)
      return info.sha
    } catch {
      return undefined
    }
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
      if (
        this.workspaceSwitchPauseDepth > 0
        || expectedWorkspacePath !== useSettingStore.getState().workspacePath
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
      const repo = (provider !== 's3' && provider !== 'webdav' && provider !== 'cloudFolder')
        ? await getSyncRepoName(provider)
        : undefined

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

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          // 强制上传：不带 sha 参数
          const result = await githubModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined, // 强制上传，不带 sha
            message: commitMessage,
            repo,
            path
          })
          if (result && result.data) {
            success = true
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const result = await giteeModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined, // 强制上传
            message: commitMessage,
            repo,
            path
          })
          if (result && result.data) {
            success = true
            // Gitee API 返回的是 result.data.content.sha
            uploadedSha = result?.data?.content?.sha
          }
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          await gitlabModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined,
            message: commitMessage,
            repo,
            path
          })
          success = true
          uploadedSha = await this.getRemoteSha(path)
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.uploadFile({
            file: content,
            filename: path.split('/').pop() || path,
            sha: undefined,
            message: commitMessage,
            repo,
            path
          })
          success = true
          uploadedSha = await this.getRemoteSha(path)
          break
        }
        case 's3': {
          const s3Module = await import('@/lib/sync/s3') as any
          const s3Config = await getS3Config()
          if (!s3Config) {
            console.warn('[SyncPushQueue] S3 未配置')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          // 获取代理配置
          const proxy = await getProxyConfig()

          // S3 强制推送：直接上传，不检查 ETag
          const result = await s3Module.s3Upload(s3Config, path, content, proxy)
          if (result && result.etag) {
            success = true
            uploadedSha = result.etag
            // 更新本地记录的 ETag
            useSyncStore.getState().updateS3FileEtag(path, result.etag)
          }
          break
        }
        case 'webdav': {
          const webdavModule = await import('@/lib/sync/webdav') as any
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            console.warn('[SyncPushQueue] WebDAV 未配置')
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }

          // 获取代理配置
          const proxy = await getProxyConfig()

          // WebDAV 强制推送：直接上传，不检查 ETag
          const result = await webdavModule.webdavUpload(webdavConfig, path, content, proxy)
          if (result && result.etag) {
            success = true
            uploadedSha = result.etag
            // 更新本地记录的 ETag
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag)
          }
          break
        }
        case 'cloudFolder': {
          const config = await getCloudFolderWorkspaceConfig()
          if (!config) {
            emitter.emit('sync-push-completed', { path, success: false })
            return { success: false }
          }
          const { androidCloudFolderWorkspaceUpload } = await import('@/lib/sync/cloud-folder')
          const result = await androidCloudFolderWorkspaceUpload(config, path, content)
          success = true
          uploadedSha = result.etag
          break
        }
      }

      if (success) {
        // 保存新的 SHA
        if (uploadedSha) {
          await setLocalRecordedSha(path, uploadedSha)
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
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  async prepareForWorkspaceSwitch() {
    this.workspaceSwitchPauseDepth += 1
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

  finishWorkspaceSwitch() {
    this.workspaceSwitchPauseDepth = Math.max(0, this.workspaceSwitchPauseDepth - 1)
    this.lastInputTime = Date.now()
    finishStaticAssetSyncWorkspaceSwitch()
  }
}

// 单例实例
let syncPushQueue: SyncPushQueue | null = null

export function getSyncPushQueue(): SyncPushQueue {
  if (!syncPushQueue) {
    syncPushQueue = new SyncPushQueue()
    syncPushQueue.init() // 确保只初始化一次事件监听器
  }
  return syncPushQueue
}

export default SyncPushQueue
