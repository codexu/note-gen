'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'
import { pullRemoteFile } from './auto-sync'
import { getRemoteFileInfo } from './auto-sync'

interface PushTask {
  path: string
  timestamp: number
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
  private processingTaskTimestamp = 0
  private lastInputTime: number = Date.now()

  private readonly IDLE_THRESHOLD = 10 * 1000 // 用户停止输入 10 秒后执行推送
  private readonly CHECK_INTERVAL = 1000 // 每秒检查一次

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
    const now = Date.now()
    const task: PushTask = {
      path,
      timestamp: now
    }

    // 重置 lastInputTime，确保从现在开始计算 10 秒
    this.lastInputTime = now

    // 如果当前有任务正在处理
    if (this.isProcessing) {
      // 如果新任务比正在处理的任务更新，将新任务加入队列
      if (task.timestamp > this.processingTaskTimestamp) {
        this.queue = [task]
        return
      }
      return
    }

    // 清空队列，只保留最新任务
    this.queue = [task]

    // 设置防抖定时器
    this.scheduleFlush()
  }

  /**
   * 防抖调度 - 用户停止输入 10 秒后执行推送
   */
  private scheduleFlush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    const checkIdle = () => {
      const now = Date.now()
      const timeSinceInput = now - this.lastInputTime

      if (timeSinceInput >= this.IDLE_THRESHOLD) {
        // 用户停止输入超过 10 秒，执行推送
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
   */
  private async flush() {
    if (this.isProcessing || this.queue.length === 0) return

    // 保留队列中最新的任务
    const latestTask = this.queue.pop()
    this.queue = [] // 清空队列

    if (!latestTask) return

    this.isProcessing = true
    this.processingTaskTimestamp = latestTask.timestamp

    try {
      // 等待 100ms 确保文件系统完成写入
      await new Promise(resolve => setTimeout(resolve, 100))
      await this.pushToRemote(latestTask.path)
    } finally {
      this.isProcessing = false
      // 检查是否有新任务加入
      if (this.queue.length > 0) {
        this.scheduleFlush()
      }
    }
  }

  /**
   * 推送到远程仓库
   */
  private async pushToRemote(path: string): Promise<{ success: boolean; sha?: string }> {
    const maxRetries = 3

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const store = await Store.load('store.json')
        const provider = (await store.get<string>('primaryBackupMethod') || 'github') as 'gitee' | 'github' | 'gitlab' | 'gitea'
        const repo = await getSyncRepoName(provider)

        // 从磁盘读取最新内容，确保上传的是本地最新内容
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

        // 检查本地内容是否与远程相同，如果相同则跳过推送
        try {
          const remoteContent = await pullRemoteFile(path)
          if (remoteContent === content) {
            // 获取远程 SHA 用于更新文件树
            const remoteSha = await this.getRemoteSha(path)
            return { success: true, sha: remoteSha }
          }
        } catch {
          // 远程文件不存在或获取失败，继续推送
        }

        // 生成提交信息
        const commitMessage = await this.generateCommitMessage(path, content)

        let success = false
        let uploadedSha: string | undefined

        switch (provider) {
          case 'github': {
            const githubModule = await import('@/lib/sync/github') as any
            // 每次尝试都重新获取远程 SHA，因为远程可能在变化
            const fileInfo = await githubModule.getFiles({ path, repo })
            const result = await githubModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            success = true
            uploadedSha = result?.data?.content?.sha || fileInfo?.sha
            break
          }
          case 'gitee': {
            const giteeModule = await import('@/lib/sync/gitee') as any
            // 每次尝试都重新获取远程 SHA
            const fileInfo = await giteeModule.getFiles({ path, repo })
            const result = await giteeModule.uploadFile({
              ext: path.split('.').pop() || 'md',
              file: content,
              filename: path.split('/').pop() || path,
              sha: fileInfo?.sha,
              message: commitMessage,
              repo,
              path
            })
            success = true
            uploadedSha = result?.data?.sha || fileInfo?.sha
            break
          }
          case 'gitlab': {
            const gitlabModule = await import('@/lib/sync/gitlab') as any
            await gitlabModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: undefined, // GitLab 使用 last_commit_id，不使用 sha
              message: commitMessage,
              repo,
              path
            })
            success = true
            // GitLab 上传成功后获取最新 SHA
            uploadedSha = await this.getRemoteSha(path)
            break
          }
          case 'gitea': {
            const giteaModule = await import('@/lib/sync/gitea') as any
            await giteaModule.uploadFile({
              file: content,
              filename: path.split('/').pop() || path,
              sha: undefined, // Gitea API 处理方式
              message: commitMessage,
              repo,
              path
            })
            success = true
            // Gitea 上传成功后获取最新 SHA
            uploadedSha = await this.getRemoteSha(path)
            break
          }
        }

        if (success) {
          console.log(`[SyncPushQueue] 推送成功: ${path}, sha: ${uploadedSha || '未获取到'}`)
          emitter.emit('sync-push-completed', { path, success: true, sha: uploadedSha })
          return { success: true, sha: uploadedSha }
        }
      } catch (error: any) {
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

        if (isShaMismatch && attempt < maxRetries) {
          console.log(`[SyncPushQueue] SHA 不匹配，${attempt}/${maxRetries} 次重试，等待后重试...`)
          // 等待一段时间后重试（指数退避）
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 500))
          continue
        }

        // 如果是最后一次尝试或不是 SHA 错误，打印错误日志
        if (attempt === maxRetries || !isShaMismatch) {
          console.error('[SyncPushQueue] 推送失败:', error)
          emitter.emit('sync-push-completed', { path, success: false })
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
   * 生成 AI 提交信息
   */
  private async generateCommitMessage(path: string, content: string): Promise<string> {
    try {
      const { fetchAi } = await import('@/lib/ai/chat')
      const prompt = `请为以下文档内容生成一个简洁的 Git 提交信息（不超过 50 个字符）：

${content.slice(0, 1000)}${content.length > 1000 ? '...' : ''}

直接返回提交信息，不需要任何解释或格式。`
      const message = await fetchAi(prompt, 'commitModel')
      return message.trim().slice(0, 50) || `Update ${path}`
    } catch {
      return `Update ${path}`
    }
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
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
