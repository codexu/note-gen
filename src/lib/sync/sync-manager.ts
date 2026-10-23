import { Store } from '@tauri-apps/plugin-store'
import { getSyncMetadataKey } from './sync-context'
import { getWorkspaceOverwriteVersion, readVersionedWorkspaceFile, uploadGuardedWorkspaceFile } from './guarded-workspace-upload'
import { prepareWorkspacePathUpload, retryWorkspacePathMoves } from './workspace-path-moves'
import { captureWorkspaceRemoteWriteGuard } from './workspace-remote-write-guard'
import { calculateFileSha, getLocalFileMetadata, getRemoteFileInfo, compareFileVersions, pullRemoteFile, setLocalRecordedSha, getLocalRecordedSha } from './auto-sync'
import { hasInvalidFileNameChars, sanitizeFilePath } from './filename-utils'
import { updateFileSyncTime } from './conflict-resolution'
import { getOptionalSyncRepoName } from './repo-utils'
import {
  androidCloudFolderWorkspaceDelete,
  androidCloudFolderWorkspaceDownloadBytes,
  androidCloudFolderWorkspaceUpload,
  supportsCloudFolderWorkspace,
} from './cloud-folder'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import useSyncStore from '@/stores/sync'
import { isFileDeletionPending } from '@/stores/file-deletion'
import { toast } from '@/hooks/use-toast'
import { exists, mkdir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { dirname } from '@tauri-apps/api/path'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { shouldExclude } from '@/config/sync-exclusions'
import {
  getEditorPathMutationRevision,
  prepareActiveEditorDeactivation,
  prepareActiveEditorDeactivationDurably,
  runEditorPathWriteTransaction,
} from '@/lib/editor-deactivation'

async function getCloudFolderWorkspaceConfig(): Promise<CloudFolderConfig | null> {
  const store = await Store.load('store.json')
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  return config && supportsCloudFolderWorkspace(config) ? config : null
}

// 同步配置
export interface SyncConfig {
  autoSync: boolean           // 自动同步总开关
  autoPushOnSave: boolean     // 保存时自动推送
  autoPullOnOpen: boolean     // 打开或切换文件时自动拉取
  conflictPolicy: 'ask' | 'local' | 'remote'
}

export const defaultSyncConfig: SyncConfig = {
  autoSync: true,
  autoPushOnSave: true,
  autoPullOnOpen: true,       // 默认开启
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
  content?: string
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

      // 覆盖配置
      if (autoPullOnOpen !== undefined && autoPullOnOpen !== null) {
        this.config.autoPullOnOpen = autoPullOnOpen
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
  async pushFile(path: string, content: string, overwrite = false): Promise<SyncResult> {
    if (isFileDeletionPending(path)) {
      return { success: true, action: 'none', message: '文件正在删除' }
    }
    // 检查是否应该排除
    if (shouldExclude(path)) {
      return { success: true, action: 'none', message: '文件被排除在同步之外' }
    }

    try {
      if (await (await Store.load('store.json')).get('platformSwitchRecovery')) throw new Error('SYNC_SWITCH_STALE')
      if (await this.getCurrentPlatform() === 'selfHosted') {
        const [{ enqueueFileSnapshot }, { getSelfHostedSyncRuntime }] = await Promise.all([
          import('@/lib/self-hosted-sync/outbox'),
          import('@/lib/self-hosted-sync/runtime'),
        ])
        if (isFileDeletionPending(path)) return { success: true, action: 'none', message: '文件正在删除' }
        await enqueueFileSnapshot(path)
        void getSelfHostedSyncRuntime().wake('local-change')
        return { success: true, action: 'push', message: '已加入自托管同步队列', content }
      }
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'
      await prepareWorkspacePathUpload(path)
      const metadataKey = await getSyncMetadataKey(path, platform)
      const acceptedVersion = overwrite
        ? await getWorkspaceOverwriteVersion(path, platform)
        : await getLocalRecordedSha(path)
      const message = `Sync: ${path} - ${new Date().toLocaleString('zh-CN')}`
      let version: string
      const config = platform === 'cloudFolder' ? await getCloudFolderWorkspaceConfig() : null
      if (platform === 'cloudFolder' && config?.provider !== 'oneDrive') {
        if (!config) return { success: false, action: 'push', error: '网盘文件夹未配置' }
        const beforeWrite = await captureWorkspaceRemoteWriteGuard(path, platform, true, content)
        const result = await androidCloudFolderWorkspaceUpload(config, path, content, undefined, beforeWrite)
        version = result.etag
      } else {
        // An idempotent manual retry must also accept the version attached to
        // the downloaded bytes, rather than a separate, newer metadata read.
        let matchingVersion: string | undefined
        try {
          const remoteFile = await readVersionedWorkspaceFile(path, platform)
          if (new TextDecoder().decode(remoteFile.content) === content) matchingVersion = remoteFile.version
        } catch { /* Missing/unreadable remote: the conditional write remains authoritative. */ }
        version = matchingVersion || await uploadGuardedWorkspaceFile(path, content, platform, acceptedVersion, message, metadataKey)
      }
      if (version) {
        await setLocalRecordedSha(path, version, metadataKey)
        if (platform === 's3') useSyncStore.getState().updateS3FileEtag(path, version)
        if (platform === 'webdav') useSyncStore.getState().updateWebDAVFileEtag(path, version)
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
  async pullFile(
    path: string,
    // Direct pulls capture at function entry. Callers that perform version
    // checks first pass the revision captured before those awaits.
    initialEditorMutationRevision = getEditorPathMutationRevision(path),
  ): Promise<SyncResult> {
    if (isFileDeletionPending(path)) return { success: true, action: 'none', message: '文件正在删除' }
    try {
      const store = await Store.load('store.json')
      if (await store.get('platformSwitchRecovery')) throw new Error('SYNC_SWITCH_STALE')
      if (await this.getCurrentPlatform() === 'selfHosted') {
        const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
        await getSelfHostedSyncRuntime().wake('foreground')
        return { success: true, action: 'none', message: '已检查自托管同步事件' }
      }
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'
      await retryWorkspacePathMoves()
      const pullMetadataKey = await getSyncMetadataKey(path, platform)
      const targetIsCurrent = async () => !await store.get('platformSwitchRecovery')
        && await this.getCurrentPlatform() === platform && await getSyncMetadataKey(path, platform) === pullMetadataKey
      const config = platform === 'cloudFolder' ? await getCloudFolderWorkspaceConfig() : null
      const remoteFile = platform === 'cloudFolder' && config?.provider !== 'oneDrive'
        ? config ? await androidCloudFolderWorkspaceDownloadBytes(config, path) : null
        : await readVersionedWorkspaceFile(path, platform)
      if (remoteFile) {
        if (isFileDeletionPending(path)) return { success: true, action: 'none', message: '文件正在删除' }
        const decodedContent = new TextDecoder().decode(remoteFile.content)
        const acceptedVersion = 'version' in remoteFile ? remoteFile.version : remoteFile.etag

        if (!await prepareActiveEditorDeactivationDurably(path)) {
          return { success: false, action: 'none', error: '编辑器正在处理未完成的内容' }
        }
        const localPathOptions = await getFilePathOptions(hasInvalidFileNameChars(path) ? sanitizeFilePath(path) : path)
        const writeCapturedFile = async (content: string) => {
          // Never resolve the workspace again during rollback: it may already
          // have changed while an older pull was waiting on disk or network.
          const parent = await dirname(localPathOptions.path)
          const options = localPathOptions.baseDir ? { baseDir: localPathOptions.baseDir } : {}
          if (parent && parent !== '.') await mkdir(parent, { ...options, recursive: true })
          await writeTextFile(localPathOptions.path, content, options)
        }
        const pullAccepted = await runEditorPathWriteTransaction(path, async ({ hasQueuedSave }) => {
          if (isFileDeletionPending(path)) return false
          const stableFileExists = localPathOptions.baseDir
            ? await exists(localPathOptions.path, { baseDir: localPathOptions.baseDir })
            : await exists(localPathOptions.path)
          const stableContent = stableFileExists
            ? localPathOptions.baseDir
              ? await readTextFile(localPathOptions.path, { baseDir: localPathOptions.baseDir })
              : await readTextFile(localPathOptions.path)
            : null

          const restoreStableContent = async () => {
            if (stableContent !== null) {
              await writeCapturedFile(stableContent)
              return
            }
            const remoteSnapshotExists = localPathOptions.baseDir
              ? await exists(localPathOptions.path, { baseDir: localPathOptions.baseDir })
              : await exists(localPathOptions.path)
            if (!remoteSnapshotExists) return
            if (localPathOptions.baseDir) {
              await remove(localPathOptions.path, { baseDir: localPathOptions.baseDir })
            } else {
              await remove(localPathOptions.path)
            }
          }

          if (!await targetIsCurrent() || getEditorPathMutationRevision(path) !== initialEditorMutationRevision
            || isFileDeletionPending(path)) {
            return false
          }

          try {
            await writeCapturedFile(decodedContent)
          } catch (error) {
            await restoreStableContent()
            throw error
          }

          // This is deliberately the synchronous preflight. A durable flush
          // here would await the transaction gate itself. Any newly flushed
          // editor save is queued behind the gate and detected below.
          const syncContextIsStable = await targetIsCurrent()
          const editorIsStable = prepareActiveEditorDeactivation()
          if (
            !syncContextIsStable
            || !editorIsStable
            || hasQueuedSave()
            || getEditorPathMutationRevision(path) !== initialEditorMutationRevision
            || isFileDeletionPending(path)
          ) {
            await restoreStableContent()
            return false
          }
          return true
        })
        if (!pullAccepted) {
          return { success: false, action: 'none', error: '本地内容在拉取期间发生变化' }
        }

        // Metadata does not participate in the content transaction. Finish it
        // in the background so there is no extra await window between the
        // final content verification and handing the snapshot to the editor.
        void (async () => {
          if (acceptedVersion) await setLocalRecordedSha(path, acceptedVersion, pullMetadataKey)
          await updateFileSyncTime(path, pullMetadataKey)
          await this.logSync(path, 'pull', true)
        })().catch(error => {
          console.error('Failed to finalize pull metadata:', error)
        })
        return { success: true, action: 'pull', message: '拉取成功', content: decodedContent }
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
      if (await this.getCurrentPlatform() === 'selfHosted') {
        const [{ enqueueFileSnapshot }, { getSelfHostedSyncRuntime }] = await Promise.all([
          import('@/lib/self-hosted-sync/outbox'),
          import('@/lib/self-hosted-sync/runtime'),
        ])
        await enqueueFileSnapshot(path, 'delete')
        void getSelfHostedSyncRuntime().wake('local-change')
        return { success: true, action: 'delete', message: '删除操作已加入自托管同步队列' }
      }
      const platform = await this.getCurrentPlatform() as 'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav' | 'cloudFolder'
      const metadataKey = await getSyncMetadataKey(path, platform)
      const acceptedVersion = await getLocalRecordedSha(path)
      const store = await Store.load('store.json')
      if (await store.get('platformSwitchRecovery')) throw new Error('SYNC_SWITCH_STALE')
      const config = platform === 'cloudFolder' ? await getCloudFolderWorkspaceConfig() : null
      let success: boolean
      if (platform === 'cloudFolder' && config?.provider !== 'oneDrive') {
        if (!config) return { success: false, action: 'delete', error: '网盘文件夹未配置' }
        const beforeWrite = await captureWorkspaceRemoteWriteGuard(path, platform, false)
        success = await androidCloudFolderWorkspaceDelete(config, path, undefined, beforeWrite)
      } else {
        const remote = await import('./remote-library')
        if (!await remote.getRemoteFileMetadata(path, 'workspace', platform)) {
          return { success: true, action: 'none', message: '远程文件不存在，无需删除' }
        }
        if (!acceptedVersion || await this.getCurrentPlatform() !== platform
          || await getSyncMetadataKey(path, platform) !== metadataKey) throw new Error('SYNC_SWITCH_STALE')
        await remote.deleteRemoteFile(path, 'workspace', { version: acceptedVersion }, platform)
        success = true
      }
      if (success) {
        await setLocalRecordedSha(path, '', metadataKey)
        if (platform === 's3') useSyncStore.getState().removeS3FileEtag(path)
        if (platform === 'webdav') useSyncStore.getState().removeWebDAVFileEtag(path)
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
  async resolveConflict(path: string, strategy: 'ask' | 'local' | 'remote', localContent?: string): Promise<SyncResult> {
    try {
      // 如果策略是 ask，需要获取用户选择
      if (strategy === 'ask') {
        // 这里会通过 UI 弹窗让用户选择，实际处理在外部
        return { success: false, action: 'conflict', message: '需要用户选择' }
      }

      // 获取内容
      if (strategy === 'local' && localContent === undefined) {
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

      const result = strategy === 'local'
        ? await this.pushFile(path, localContent ?? '', true)
        : await this.pullFile(path)
      if (!result.success) return { ...result, action: 'conflict' }
      toast({ title: '冲突处理', description: strategy === 'local' ? '保留本地版本' : '使用远程版本' })
      return result
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
    if (isFileDeletionPending(path)) return { success: true, action: 'none', message: '文件正在删除' }
    if (await this.getCurrentPlatform() === 'selfHosted') {
      const [{ enqueueFileSnapshot }, { getSelfHostedSyncRuntime }] = await Promise.all([
        import('@/lib/self-hosted-sync/outbox'),
        import('@/lib/self-hosted-sync/runtime'),
      ])
      if (isFileDeletionPending(path)) return { success: true, action: 'none', message: '文件正在删除' }
      await enqueueFileSnapshot(path)
      void getSelfHostedSyncRuntime().wake('local-change')
      return { success: true, action: 'push', message: '已加入自托管同步队列' }
    }
    // 检查是否正在同步
    if (this.state.isSyncing) {
      this.state.pendingSync = true
      return { success: true, action: 'none', message: '同步中，标记待同步' }
    }

    this.state.isSyncing = true
    const initialEditorMutationRevision = getEditorPathMutationRevision(path)

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
        const result = await this.pullFile(path, initialEditorMutationRevision)
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

        return await this.resolveConflict(path, choice, localContent)
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
    if (isFileDeletionPending(path)) return
    if (!this.config.autoSync || !this.config.autoPushOnSave) {
      return
    }
    if (await (await Store.load('store.json')).get('platformSwitchRecovery')) return

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return
    }

    if (await this.getCurrentPlatform() === 'selfHosted') {
      const [{ enqueueFileSnapshot }, { getSelfHostedSyncRuntime }] = await Promise.all([
        import('@/lib/self-hosted-sync/outbox'),
        import('@/lib/self-hosted-sync/runtime'),
      ])
      if (isFileDeletionPending(path)) return
      await enqueueFileSnapshot(path)
      void getSelfHostedSyncRuntime().wake('local-change')
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
  async onOpen(
    path: string,
    initialEditorMutationRevision = getEditorPathMutationRevision(path),
  ): Promise<{ updated: boolean; content?: string } | null> {
    if (!this.config.autoSync || !this.config.autoPullOnOpen) {
      return null
    }
    if (await (await Store.load('store.json')).get('platformSwitchRecovery')) return null

    // 检查是否应该排除
    if (shouldExclude(path)) {
      return null
    }
    if (await this.getCurrentPlatform() === 'selfHosted') {
      const { getSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/runtime')
      await getSelfHostedSyncRuntime().wake('foreground')
      return null
    }
    // 比较版本，决定是否需要拉取
    const syncResult = await compareFileVersions(path)

    if (syncResult.action === 'pull') {
      const result = await this.pullFile(path, initialEditorMutationRevision)
      if (result.success && result.action === 'pull') {
        return { updated: true, content: result.content }
      }
      return { updated: result.success }
    }

    // 处理冲突情况：远程文件较新但 SHA 不同（可能是同步过的）
    if (syncResult.action === 'conflict') {
      const result = await this.pullFile(path, initialEditorMutationRevision)
      if (result.success && result.action === 'pull') {
        return { updated: true, content: result.content }
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
        if (isFileDeletionPending(path)) {
          this.syncQueue.delete(path)
          continue
        }
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

export async function syncOnOpen(
  path: string,
  initialEditorMutationRevision = getEditorPathMutationRevision(path),
): Promise<{ updated: boolean; content?: string } | null> {
  const manager = getSyncManager()
  return await manager.onOpen(path, initialEditorMutationRevision)
}

export async function syncSingleFile(path: string, onConflict?: (local: string, remote: string) => Promise<'local' | 'remote' | 'cancel'>): Promise<SyncResult> {
  const manager = getSyncManager()
  return await manager.syncFile(path, { onConflict })
}

function hasConfiguredText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

/**
 * 检查同步是否已配置
 * 检查是否有选择同步平台并配置了对应的访问令牌
 */
export async function isSyncConfigured(
  options?: { throwOnError?: boolean },
): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    if (await store.get('platformSwitchRecovery')) return false
    const platform = await store.get<string>('primaryBackupMethod') || 'github'

    // 检查对应平台的访问令牌（确保不是空字符串）
    switch (platform) {
      case 'local':
        return false
      case 'github': {
        const token = await store.get<string>('accessToken')
        const username = await store.get<string>('githubUsername')
        const repo = await getOptionalSyncRepoName('github')
        return hasConfiguredText(token) && hasConfiguredText(username) && hasConfiguredText(repo)
      }
      case 'gitee': {
        const giteeToken = await store.get<string>('giteeAccessToken')
        const giteeUsername = await store.get<string>('giteeUsername')
        const repo = await getOptionalSyncRepoName('gitee')
        return hasConfiguredText(giteeToken) && hasConfiguredText(giteeUsername) && hasConfiguredText(repo)
      }
      case 'gitlab': {
        const gitlabToken = await store.get<string>('gitlabAccessToken')
        const gitlabUsername = await store.get<string>('gitlabUsername')
        const repo = await getOptionalSyncRepoName('gitlab')
        const projectId = await store.get<string>(`gitlab_${repo}_project_id`)
        const instanceType = await store.get<string>('gitlabInstanceType')
        const customUrl = await store.get<string>('gitlabCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(gitlabToken) &&
          hasConfiguredText(gitlabUsername) &&
          hasConfiguredText(repo) &&
          hasConfiguredText(projectId) &&
          instanceConfigured
      }
      case 'gitea': {
        const giteaToken = await store.get<string>('giteaAccessToken')
        const giteaUsername = await store.get<string>('giteaUsername')
        const repo = await getOptionalSyncRepoName('gitea')
        const instanceType = await store.get<string>('giteaInstanceType')
        const customUrl = await store.get<string>('giteaCustomUrl')
        const instanceConfigured = instanceType !== 'self-hosted' || hasConfiguredText(customUrl)

        return hasConfiguredText(giteaToken) &&
          hasConfiguredText(giteaUsername) &&
          hasConfiguredText(repo) &&
          instanceConfigured
      }
      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        return Boolean(s3Config) &&
          hasConfiguredText(s3Config?.accessKeyId) &&
          hasConfiguredText(s3Config?.secretAccessKey) &&
          hasConfiguredText(s3Config?.region) &&
          hasConfiguredText(s3Config?.bucket)
      }
      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        return Boolean(webdavConfig) &&
          hasConfiguredText(webdavConfig?.url) &&
          hasConfiguredText(webdavConfig?.username) &&
          hasConfiguredText(webdavConfig?.password)
      }
      case 'cloudFolder': {
        const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        return Boolean(config && supportsCloudFolderWorkspace(config))
      }
      case 'selfHosted': {
        const database = await (await import('@/db')).getDb()
        const rows = await database.select<Array<{ total: number }>>(
          "select count(*) as total from self_hosted_sync_profiles where state = 'connected'"
        )
        return (rows[0]?.total ?? 0) > 0
      }
      default:
        return false
    }
  } catch (error) {
    if (options?.throwOnError) throw error
    return false
  }
}
