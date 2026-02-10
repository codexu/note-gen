'use client'

import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import emitter from '@/lib/emitter'

interface PushTask {
  path: string
  timestamp: number
}

class SyncPushQueue {
  private queue: PushTask[] = []
  private isProcessing = false
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private processingTaskTimestamp = 0

  constructor() {
    // 监听文章保存事件
    this.initListeners()
  }

  private initListeners() {
    // 监听文章保存事件（从编辑器底部栏的保存按钮触发）
    emitter.on('article-saved', ((event: { path: string; content: string }) => {
      this.addTask(event.path)
    }) as any)
  }

  /**
   * 添加任务到队列
   */
  addTask(path: string) {
    const task: PushTask = {
      path,
      timestamp: Date.now()
    }

    // 如果当前有任务正在处理，比较时间戳
    if (this.isProcessing) {
      // 如果新任务比正在处理的任务更新，取消正在处理的任务
      if (task.timestamp > this.processingTaskTimestamp) {
        console.log('[SyncPushQueue] 新任务更新，取消正在进行的推送')
        this.isProcessing = false
      } else {
        // 新任务更旧，忽略
        return
      }
    }

    // 添加到队列
    this.queue.push(task)

    // 设置防抖定时器
    this.scheduleFlush()
  }

  /**
   * 防抖调度
   */
  private scheduleFlush() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.flush()
    }, 2000) // 2 秒防抖
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
  private async pushToRemote(path: string): Promise<boolean> {
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

      // 生成提交信息
      const commitMessage = await this.generateCommitMessage(path, content)

      let success = false

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          const fileInfo = await githubModule.getFiles({ path, repo })
          await githubModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path
          })
          success = true
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const fileInfo = await giteeModule.getFiles({ path, repo })
          await giteeModule.uploadFile({
            ext: path.split('.').pop() || 'md',
            file: content,
            filename: path.split('/').pop() || path,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path
          })
          success = true
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          await gitlabModule.updateFileContent({ path, ref: 'main', repo, content, message: commitMessage })
          success = true
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.updateFileContent({ path, ref: 'main', repo, content, message: commitMessage })
          success = true
          break
        }
      }

      if (success) {
        console.log(`[SyncPushQueue] 推送成功: ${path}`)
        emitter.emit('sync-push-completed', { path, success: true })
      }

      return success
    } catch (error) {
      console.error('[SyncPushQueue] 推送失败:', error)
      emitter.emit('sync-push-completed', { path, success: false, error })
      return false
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
  }
  return syncPushQueue
}

export default SyncPushQueue
