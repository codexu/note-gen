import { Store } from '@tauri-apps/plugin-store'
import { calculateFileSha, getLocalFileMetadata, getRemoteFileInfo, compareFileVersions, pullRemoteFile, saveLocalFile, setLocalRecordedSha } from './auto-sync'
import { decodeBase64ToString } from './github'
import { updateFileSyncTime } from './conflict-resolution'
import { getSyncRepoName } from './repo-utils'
import { uploadFile as uploadToGithub, getFiles as getGithubFiles, deleteFile as deleteGithubFile } from './github'
import { uploadFile as uploadToGitee, getFiles as getGiteeFiles, deleteFile as deleteGiteeFile } from './gitee'
import { uploadFile as uploadToGitlab, getFileContent as getGitlabFile, deleteFile as deleteGitlabFile } from './gitlab'
import { uploadFile as uploadToGitea, getFileContent as getGiteaFile, deleteFile as deleteGiteaFile } from './gitea'
import { s3Upload, s3Download, s3Delete } from './s3'
import { webdavUpload, webdavDownload, webdavDelete } from './webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import useSyncStore from '@/stores/sync'
import { toast } from '@/hooks/use-toast'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { shouldExclude } from '@/config/sync-exclusions'

/**
 * 获取 GitLab 分支配置
 */
async function getGitlabBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * 获取 Gitea 分支配置
 */
async function getGiteaBranch(): Promise<string> {
  const store = await Store.load('store.json')
  return await store.get<string>('giteaBranch') || 'main'
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

// 同步配置
export interface SyncConfig {
  autoSync: boolean           // 自动同步总开关
  autoPushOnSave: boolean     // 保存时自动推送
  autoPullOnOpen: boolean     // 打开时自动拉取
  autoPullOnSwitch: boolean   // 切换文件时自动拉取
  conflictPolicy: 'ask' | 'local' | 'remote'
}

export const defaultSyncConfig: SyncConfig = {
  autoSync: true,
  autoPushOnSave: true,
  autoPullOnOpen: false,      // 默认关闭
  autoPullOnSwitch: false,    // 默认关闭
  conflictPolicy: 'ask'
}

// 同步状态
export interface SyncState {
  isSyncing: boolean          // 是否正在同步
  pendingSync: boolean         // 是否有待同步的变更
  lastSyncTime: number        // 最后同步时间
  lastSyncSha: string         // 最后同步的 SHA
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

// 同步结果
export interface SyncResult {
  success: boolean
  action: 'push' | 'pull' | 'delete' | 'none' | 'conflict'
  message?: string
  error?: string
}

// 同步日志
export interface SyncLog {
  timestamp: number
  action: 'push' | 'pull' | 'delete'
  filePath: string
  success: boolean
  error?: string
}

// 同步管理器
export class SyncManager {
  private config: SyncConfig = { ...defaultSyncConfig }
  private state: SyncState = {
    isSyncing: false,
    pendingSync: false,
    lastSyncTime: 0,
    lastSyncSha: '',
    syncStatus: 'unknown'
  }
  private syncQueue: Map<string, { timestamp: number }> = new Map()
  private throttleTimer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.loadConfig()
  }

  /**
   * 加载配置
   */
  async loadConfig(): Promise<void> {
    try {
      // 先从 sync_config.json 加载配置
      const syncStore = await Store.load('sync_config.json')
      const savedConfig = await syncStore.get<SyncConfig>('config')
      if (savedConfig) {
        this.config = { ...defaultSyncConfig, ...savedConfig }
      }

      // 再从 store.json 读取设置中的 autoPull 配置
      const settingStore = await Store.load('store.json')
      const autoPullOnOpen = await settingStore.get<boolean>('autoPullOnOpen')
      const autoPullOnSwitch = await settingStore.get<boolean>('autoPullOnSwitch')

      // 覆盖配置
      if (autoPullOnOpen !== undefined && autoPullOnOpen !== null) {
        this.config.autoPullOnOpen = autoPullOnOpen
      }
      if (autoPullOnSwitch !== undefined && autoPullOnSwitch !== null) {
        this.config.autoPullOnSwitch = autoPullOnSwitch
      }
    } catch {
      // 静默处理配置加载错误
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(): Promise<void> {
    try {
      const store = await Store.load('sync_config.json')
      await store.set('config', this.config)
      await store.save()
    } catch {
      // 静默处理配置保存错误
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(config: Partial<SyncConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
    await this.saveConfig()
  }

  /**
   * 获取配置
   */
  getConfig(): SyncConfig {
    return { ...this.config }
  }

  /**
   * 获取同步状态
   */
  getState(): SyncState {
    return { ...this.state }
  }

  /**
   * 获取当前使用的平台
   */
  async getCurrentPlatform(): Promise<string> {
    const store = await Store.load('store.json')
    return await store.get<string>('primaryBackupMethod') || 'github'
  }

  /**
   * 计算文件的 SHA
   */
  async calculateSha(content: string): Promise<string> {
    return await calculateFileSha(content)
  }

  /**
   * 获取本地文件 SHA
   */
  async getLocalSha(path: string): Promise<string | null> {
    const meta = await getLocalFileMetadata(path)
    return meta.localSha || null
  }

  /**
   * 获取远程文件 SHA
   */
  async getRemoteSha(path: string): Promise<string | null> {
    const info = await getRemoteFileInfo(path)
    return info.sha || null
  }

  /**
   * 推送文件到远程
   */
  async pushFile(path: string, content: string): Promise<SyncResult> {
    // 检查是否应该排除
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }

    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 不需要 repo，直接设为空字符串
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)
      const sha = (platform === 's3' || platform === 'webdav') ? undefined : await this.getRemoteSha(path) || undefined
      const message = `Sync: ${path} - ${new Date().toLocaleString('zh-CN')}`
      const filename = path.split('/').pop() || path

      let uploadSuccess = false

      switch (platform) {
        case 'github': {
          const result = await uploadToGithub({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitee': {
          const result = await uploadToGitee({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitlab': {
          const result = await uploadToGitlab({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 'gitea': {
          const result = await uploadToGitea({ file: content, sha, message, repo, path, filename })
          uploadSuccess = !!result
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'push', error: 'S3 配置未找到' }
          }
          // S3 使用相对路径作为 key，不需要添加 pathPrefix
          const result = await s3Upload(s3Config, path, content)
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateS3FileEtag(path, result.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'push', error: 'WebDAV 配置未找到' }
          }
          const result = await webdavUpload(webdavConfig, path, content)
          uploadSuccess = !!result
          if (uploadSuccess && result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateWebDAVFileEtag(path, result.etag)
          }
          break
        }
      }

      if (uploadSuccess) {
        // 推送成功后更新本地记录的远程 SHA
        if (platform !== 's3' && platform !== 'webdav') {
          const newRemoteSha = await this.getRemoteSha(path)
          if (newRemoteSha) {
            await setLocalRecordedSha(path, newRemoteSha)
          }
        }
        await this.logSync(path, 'push', true)
        return { success: true, action: 'push', message: '推送成功' }
      }

      await this.logSync(path, 'push', false, '推送失败')
      return { success: false, action: 'push', error: '推送失败' }
    } catch (error) {
      await this.logSync(path, 'push', false, String(error))
      return { success: false, action: 'push', error: String(error) }
    }
  }

  /**
   * 从远程拉取文件
   */
  async pullFile(path: string): Promise<SyncResult> {
    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 不需要 repo
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)

      let content: string | undefined

      switch (platform) {
        case 'github':
          const githubFile = await getGithubFiles({ path, repo })
          content = githubFile?.content
          break
        case 'gitee':
          const giteeFile = await getGiteeFiles({ path, repo })
          content = giteeFile?.content
          break
        case 'gitlab': {
          const branch = await getGitlabBranch()
          const gitlabFile = await getGitlabFile({ path, ref: branch, repo })
          content = gitlabFile?.content
          break
        }
        case 'gitea': {
          const branch = await getGiteaBranch()
          const giteaFile = await getGiteaFile({ path, ref: branch, repo })
          content = giteaFile?.content
          break
        }
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'pull', error: 'S3 配置未找到' }
          }
          // S3 使用相对路径作为 key
          const s3File = await s3Download(s3Config, path)
          if (s3File) {
            content = s3File.content
            // 更新 ETag 记录
            useSyncStore.getState().updateS3FileEtag(path, s3File.etag)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'pull', error: 'WebDAV 配置未找到' }
          }
          const webdavFile = await webdavDownload(webdavConfig, path)
          if (webdavFile) {
            content = webdavFile.content
            // 更新 ETag 记录
            useSyncStore.getState().updateWebDAVFileEtag(path, webdavFile.etag)
          }
          break
        }
      }

      if (content) {
        // S3 和 WebDAV 不需要 base64 解码，其他平台需要
        let decodedContent = content
        if (platform !== 's3' && platform !== 'webdav') {
          decodedContent = decodeBase64ToString(content)
        }
        await saveLocalFile(path, decodedContent)

        // 获取远程文件的 SHA 并更新本地记录
        if (platform !== 's3' && platform !== 'webdav') {
          const remoteSha = await this.getRemoteSha(path)
          if (remoteSha) {
            await setLocalRecordedSha(path, remoteSha)
          }
        }

        await updateFileSyncTime(path)
        await this.logSync(path, 'pull', true)
        return { success: true, action: 'pull', message: '拉取成功' }
      }

      await this.logSync(path, 'pull', false, '文件不存在')
      return { success: false, action: 'pull', error: '远程文件不存在' }
    } catch (error) {
      await this.logSync(path, 'pull', false, String(error))
      return { success: false, action: 'pull', error: String(error) }
    }
  }

  /**
   * 删除远程文件
   */
  async deleteRemoteFile(path: string): Promise<SyncResult> {
    try {
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 不需要 repo
      const repo = (platform === 's3' || platform === 'webdav') ? '' : await getSyncRepoName(platform)
      const sha = (platform === 's3' || platform === 'webdav') ? undefined : await this.getRemoteSha(path)

      // S3 和 WebDAV 不需要 SHA，但其他平台需要
      if ((platform !== 's3' && platform !== 'webdav') && !sha) {
        return { success: true, action: 'none', message: '远程文件不存在，无需删除' }
      }

      let success = false

      switch (platform) {
        case 'github':
          success = !!(await deleteGithubFile({ path, sha: sha!, repo }))
          break
        case 'gitee':
          success = !!(await deleteGiteeFile({ path, sha: sha!, repo }))
          break
        case 'gitlab':
          success = !!(await deleteGitlabFile({ path, sha: sha!, repo }))
          break
        case 'gitea':
          success = !!(await deleteGiteaFile({ path, sha: sha!, repo }))
          break
        case 's3': {
          const s3Config = await getS3Config()
          if (!s3Config) {
            return { success: false, action: 'delete', error: 'S3 配置未找到' }
          }
          // S3 使用相对路径作为 key
          success = await s3Delete(s3Config, path)
          if (success) {
            // 移除 ETag 记录
            useSyncStore.getState().removeS3FileEtag(path)
          }
          break
        }
        case 'webdav': {
          const webdavConfig = await getWebDAVConfig()
          if (!webdavConfig) {
            return { success: false, action: 'delete', error: 'WebDAV 配置未找到' }
          }
          success = await webdavDelete(webdavConfig, path)
          if (success) {
            // 移除 ETag 记录
            useSyncStore.getState().removeWebDAVFileEtag(path)
          }
          break
        }
      }

      if (success) {
        await this.logSync(path, 'delete', true)
        return { success: true, action: 'delete', message: '删除成功' }
      }

      await this.logSync(path, 'delete', false, '删除失败')
      return { success: false, action: 'delete', error: '删除失败' }
    } catch (error) {
      await this.logSync(path, 'delete', false, String(error))
      return { success: false, action: 'delete', error: String(error) }
    }
  }

  /**
   * 处理冲突
   */
  async resolveConflict(path: string, strategy: 'ask' | 'local' | 'remote', localContent?: string, remoteContent?: string): Promise<SyncResult> {
    try {
      // 如果策略是 ask，需要获取用户选择
      if (strategy === 'ask') {
        // 这里会通过 UI 弹窗让用户选择，实际处理在外部
        return { success: false, action: 'conflict', message: '需要用户选择' }
      }

      // 获取内容
      if (!localContent) {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        try {
          localContent = workspace.isCustom
            ? await readTextFile(pathOptions.path)
            : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        } catch {
          localContent = ''
        }
      }

      if (!remoteContent) {
        remoteContent = await pullRemoteFile(path)
      }

      switch (strategy) {
        case 'local':
          // 保留本地，删除远程然后重新上传
          await this.deleteRemoteFile(path)
          await this.pushFile(path, localContent)
          toast({ title: '冲突处理', description: '保留本地版本' })
          break
        case 'remote':
          // 使用远程版本
          await saveLocalFile(path, remoteContent)
          await updateFileSyncTime(path)
          toast({ title: '冲突处理', description: '使用远程版本' })
          break
      }

      return { success: true, action: 'push', message: '冲突已解决' }
    } catch (error) {
      return { success: false, action: 'conflict', error: String(error) }
    }
  }

  /**
   * 同步单个文件
   */
  async syncFile(path: string, options: {
    onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>
  } = {}): Promise<SyncResult> {
    // 检查是否正在同步
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return { success: true, action: 'none', message: '同步中，标记待同步' }
    }

    this.state.isSyncing = true

    try {
      // 获取本地和远程的 SHA
      const localSha = await this.getLocalSha(path)
      const remoteSha = await this.getRemoteSha(path)

      // 比较版本
      const syncResult = await compareFileVersions(path)

      if (syncResult.action === 'none') {
        return { success: true, action: 'none', message: '文件已同步' }
      }

      if (syncResult.action === 'push') {
        // 推送本地版本
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const content = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

        const result = await this.pushFile(path, content)
        this.state.lastSyncTime = Date.now()
        this.state.lastSyncSha = localSha || ''
        return result
      }

      if (syncResult.action === 'pull') {
        // 拉取远程版本
        const result = await this.pullFile(path)
        this.state.lastSyncTime = Date.now()
        this.state.lastSyncSha = remoteSha || ''
        return result
      }

      if (syncResult.action === 'conflict' && options.onConflict) {
        // 处理冲突
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        const localContent = workspace.isCustom
          ? await readTextFile(pathOptions.path)
          : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        const remoteContent = await pullRemoteFile(path)
        const choice = await options.onConflict(localContent, remoteContent)

        if (choice === 'cancel') {
          return { success: false, action: 'conflict', error: '用户取消' }
        }

        return await this.resolveConflict(path, choice, localContent, remoteContent)
      }

      return { success: true, action: 'none' }
    } finally {
      this.state.isSyncing = false

      // 如果有待同步的变更，继续同步
      if (this.state.pendingSync) {
        this.state.pendingSync = false
        await this.syncFile(path, options)
      }
    }
  }

  /**
   * 保存时触发推送（带节流）
   */
  async onSave(path: string): Promise<void> {
    if (!this.config.autoSync || !this.config.autoPushOnSave) {
      return
    }

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return
    }

    // 标记该路径需要同步（内容从磁盘读取）
    this.syncQueue.set(path, { timestamp: Date.now() })

    // 如果正在同步，标记待同步
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return
    }

    // 节流 2 秒
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer)
    }

    this.throttleTimer = setTimeout(async () => {
      await this.processSyncQueue()
    }, 2000)
  }

  /**
   * 打开时触发拉取
   * 返回 { updated: true, content: string } 如果拉取了新内容
   */
  async onOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
    if (!this.config.autoSync || !this.config.autoPullOnOpen) {
      return null
    }

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return null
    }

    // 比较版本，决定是否需要拉取
    const syncResult = await compareFileVersions(path)

    if (syncResult.action === 'pull') {
      const result = await this.pullFile(path)
      if (result.success && result.action === 'pull') {
        // 读取拉取的内容并返回
        try {
          const { pullRemoteFile } = await import('./auto-sync')
          const content = await pullRemoteFile(path)
          return { updated: true, content }
        } catch {
          return { updated: true }
        }
      }
      return { updated: result.success }
    }

    // 处理冲突情况：远程文件较新但 SHA 不同（可能是同步过的）
    if (syncResult.action === 'conflict') {
      const result = await this.pullFile(path)
      if (result.success && result.action === 'pull') {
        try {
          const { pullRemoteFile } = await import('./auto-sync')
          const content = await pullRemoteFile(path)
          return { updated: true, content }
        } catch {
          return { updated: true }
        }
      }
      return { updated: result.success }
    }

    return null
  }

  /**
   * 处理同步队列
   */
  private async processSyncQueue(): Promise<void> {
    this.state.isSyncing = true

    try {
      for (const [path] of this.syncQueue) {
        // 始终从磁盘读取最新内容，确保上传的是本地最新内容
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)

        let content: string
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        const result = await this.pushFile(path, content)
        if (result.success) {
          this.syncQueue.delete(path)
        }
      }
    } finally {
      this.state.isSyncing = false
      this.state.pendingSync = false
    }
  }

  /**
   * 同步所有文件
   */
  async syncAll(paths: string[]): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    for (const path of paths) {
      const result = await this.syncFile(path)
      results.push(result)
    }

    return results
  }

  /**
   * 记录同步日志
   */
  private async logSync(filePath: string, action: 'push' | 'pull' | 'delete', success: boolean, error?: string): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []

      logs.unshift({
        timestamp: Date.now(),
        action,
        filePath,
        success,
        error
      })

      // 只保留最近 100 条
      if (logs.length > 100) {
        logs.splice(100)
      }

      await store.set('logs', logs)
      await store.save()
    } catch {
    }
  }

  /**
   * 获取同步日志
   */
  async getLogs(limit?: number): Promise<SyncLog[]> {
    try {
      const store = await Store.load('sync_logs.json')
      const logs = await store.get<SyncLog[]>('logs') || []
      return limit ? logs.slice(0, limit) : logs
    } catch {
      return []
    }
  }

  /**
   * 清除同步日志
   */
  async clearLogs(): Promise<void> {
    try {
      const store = await Store.load('sync_logs.json')
      await store.set('logs', [])
      await store.save()
    } catch {
    }
  }

  /**
   * 获取文件的同步状态
   */
  async getFileSyncStatus(path: string): Promise<SyncState['syncStatus']> {
    const localSha = await this.getLocalSha(path)
    const remoteSha = await this.getRemoteSha(path)

    if (!localSha && !remoteSha) {
      return 'unknown'
    }

    if (!localSha) {
      return 'remote_newer'
    }

    if (!remoteSha) {
      return 'local_newer'
    }

    if (localSha === remoteSha) {
      return 'synced'
    }

    return 'conflict'
  }
}

// 单例实例
let syncManager: SyncManager | null = null

export function getSyncManager(): SyncManager {
  if (!syncManager) {
    syncManager = new SyncManager()
  }
  return syncManager
}

// 便捷函数
export async function syncOnSave(path: string): Promise<void> {
  const manager = getSyncManager()
  await manager.onSave(path)
}

export async function syncOnOpen(path: string): Promise<{ updated: boolean; content?: string } | null> {
  const manager = getSyncManager()
  return await manager.onOpen(path)
}

export async function syncSingleFile(path: string, onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>): Promise<SyncResult> {
  const manager = getSyncManager()
  return await manager.syncFile(path, { onConflict })
}

/**
 * 检查同步是否已配置
 * 检查是否有选择同步平台并配置了对应的访问令牌
 */
export async function isSyncConfigured(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const platform = await store.get<string>('primaryBackupMethod')

    // 如果没有选择平台，返回 false
    if (!platform) {
      return false
    }

    // 检查对应平台的访问令牌（确保不是空字符串）
    const token = await store.get<string>('accessToken')
    switch (platform) {
      case 'github':
        return !!(token && token.trim().length > 0)
      case 'gitee': {
        const giteeToken = await store.get<string>('giteeAccessToken')
        return !!(giteeToken && giteeToken.trim().length > 0)
      }
      case 'gitlab': {
        const gitlabToken = await store.get<string>('gitlabAccessToken')
        return !!(gitlabToken && gitlabToken.trim().length > 0)
      }
      case 'gitea': {
        const giteaToken = await store.get<string>('giteaAccessToken')
        return !!(giteaToken && giteaToken.trim().length > 0)
      }
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        return !!(
          s3Config &&
          s3Config.accessKeyId &&
          s3Config.secretAccessKey &&
          s3Config.region &&
          s3Config.bucket
        )
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        return !!(
          webdavConfig &&
          webdavConfig.url &&
          webdavConfig.username &&
          webdavConfig.password
        )
      }
      default:
        return false
    }
  } catch {
    return false
  }
}
