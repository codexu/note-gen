import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { decodeBase64ToString, getFiles as getGithubFiles, getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFiles as getGiteeFiles, getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileContent as getGitlabFileContent, getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileContent as getGiteaFileContent, getFileCommits as getGiteaFileCommits, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { s3HeadObject, s3Download } from './s3'
import { webdavHeadObject, webdavDownload } from './webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { toast } from '@/hooks/use-toast'
import { readTextFile, writeTextFile, stat, mkdir, exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import {
  checkFileLock,
  detectAndHandleConflict,
  mergeSimpleContent,
  updateFileSyncTime,
  cleanupExpiredLocks,
  getFileSyncStatus,
  getFileRestoreTime
} from './conflict-resolution'
import { sanitizeFilePath, hasInvalidFileNameChars } from './filename-utils'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import useSyncStore from '@/stores/sync'
import emitter from '@/lib/emitter'

// Store 实例缓存
let storeInstance: Store | null = null

/**
 * 获取 Store 实例
 */
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

/**
 * 获取 GitLab 分支配置
 */
async function getGitlabBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('gitlabBranch') || 'main'
}

/**
 * 获取 Gitea 分支配置
 */
async function getGiteaBranch(): Promise<string> {
  const store = await getStore()
  return await store.get<string>('giteaBranch') || 'main'
}

/**
 * 从 store 获取本地记录的远程 SHA
 */
export async function getLocalRecordedSha(filePath: string): Promise<string | null> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  return syncedShas[filePath] || null
}

/**
 * 设置本地记录的远程 SHA
 */
export async function setLocalRecordedSha(filePath: string, sha: string): Promise<void> {
  const store = await getStore()
  const syncedShas = await store.get<Record<string, string>>('syncedFileShas') || {}
  syncedShas[filePath] = sha
  await store.set('syncedFileShas', syncedShas)
}

export interface FileMetadata {
  path: string
  localSha?: string
  remoteSha?: string
  lastModified?: number
  lastSyncTime?: number
  syncStatus: 'synced' | 'local_newer' | 'remote_newer' | 'conflict' | 'unknown'
}

export interface SyncResult {
  shouldUpdate: boolean
  action: 'none' | 'pull' | 'push' | 'conflict'
  localContent?: string
  remoteContent?: string
  reason?: string
}

/**
 * 计算文件内容的 SHA 值
 */
export async function calculateFileSha(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 获取本地文件元数据（增强版，处理文件名兼容性和目录检查）
 */
export async function getLocalFileMetadata(path: string): Promise<FileMetadata> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    let fileStat
    if (workspace.isCustom) {
      fileStat = await stat(pathOptions.path)
    } else {
      fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    let content = ''
    if (workspace.isCustom) {
      content = await readTextFile(pathOptions.path)
    } else {
      content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    return {
      path,
      localSha: await calculateFileSha(content),
      lastModified: fileStat.mtime?.getTime(),
      syncStatus: 'unknown'
    }
  } catch (error) {
    // 如果是目录不存在的错误，这是正常的，返回未知状态
    if (error instanceof Error && 
        (error.message.includes('no such file') || 
         error.message.includes('not found') ||
         error.message.includes('系统找不到指定的路径'))) {
      return {
        path,
        syncStatus: 'unknown'
      }
    }
    
    return {
      path,
      syncStatus: 'unknown'
    }
  }
}

/**
 * 获取远程文件信息
 */
export async function getRemoteFileInfo(path: string): Promise<{ sha?: string; lastModified?: number }> {
  const store = await Store.load('store.json')
  const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

  try {
    let file
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        file = await getGithubFiles({ path, repo: githubRepo })
        if (file) {
          // 获取最新提交信息
          const commits = await getGithubFileCommits({ path, repo: githubRepo })
          if (commits && commits.length > 0) {
            return {
              sha: file.sha,
              lastModified: new Date(commits[0].commit.committer.date).getTime()
            }
          }
          // 当前平台 API 不直接返回 SHA，返回 undefined
          return { sha: undefined }
        }
        break

      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        file = await getGiteeFiles({ path, repo: giteeRepo })
        if (file) {
          const commits = await getGiteeFileCommits({ path, repo: giteeRepo })
          if (commits && commits.length > 0) {
            return {
              sha: file.sha,
              lastModified: new Date(commits[0].commit.committer.date).getTime()
            }
          }
          // 当前平台 API 不直接返回 SHA，返回 undefined
          return { sha: undefined }
        }
        break

      case 'gitlab': {
        const gitlabRepo = await getSyncRepoName('gitlab')
        const gitlabBranch = await getGitlabBranch()
        file = await getGitlabFileContent({ path, ref: gitlabBranch, repo: gitlabRepo })
        if (file) {
          const commits = await getGitlabFileCommits({ path, repo: gitlabRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].id,
              lastModified: new Date(commits.data[0].committed_date).getTime()
            }
          }
          // 当前平台 API 不直接返回 SHA，返回 undefined
          return { sha: undefined }
        }
        break
      }

      case 'gitea': {
        const giteaRepo = await getSyncRepoName('gitea')
        const giteaBranch = await getGiteaBranch()
        file = await getGiteaFileContent({ path, ref: giteaBranch, repo: giteaRepo })
        if (file) {
          const commits = await getGiteaFileCommits({ path, repo: giteaRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].sha,
              lastModified: new Date(commits.data[0].commit.committer.date).getTime()
            }
          }
          // 当前平台 API 不直接返回 SHA，返回 undefined
          return { sha: undefined }
        }
        break
      }
    }
  } catch {
    // 静默处理错误
  }

  return { sha: undefined, lastModified: undefined }
}

/**
 * 比较本地和远程文件版本
 * 注意：由于本地使用 SHA-256 而远程使用 Git blob SHA（SHA-1），两种算法不同
 * 因此不直接比较 SHA，而是依赖修改时间进行比较
 */
export async function compareFileVersions(path: string): Promise<SyncResult> {
  // 检查当前平台是否是 S3
  const store = await getStore()
  const platform = await store.get<string>('primaryBackupMethod')

  if (platform === 's3') {
    return compareS3FileVersions(path)
  }

  if (platform === 'webdav') {
    return compareWebDAVFileVersions(path)
  }

  const localMeta = await getLocalFileMetadata(path)
  const remoteInfo = await getRemoteFileInfo(path)

  // 获取最后同步时间和恢复时间
  const syncStatus = await getFileSyncStatus(path)
  const lastSyncTime = syncStatus.lastSyncTime
  const lastRestoreTime = await getFileRestoreTime(path)

  // SHA 比较逻辑：使用本地记录的远程 SHA 与当前远程 SHA 进行比较
  if (remoteInfo.sha) {
    const localRecordedSha = await getLocalRecordedSha(path)

    // 如果有本地记录的 SHA 和远程 SHA，进行比较
    if (localRecordedSha && localRecordedSha !== remoteInfo.sha) {
      // SHA 不一致，说明远程文件已更新，需要拉取
      return {
        shouldUpdate: true,
        action: 'pull',
        reason: '远程文件已更新（SHA 不匹配），需要拉取更新'
      }
    }

    // 如果没有本地记录的 SHA，但远程有内容，记录 SHA
    if (!localRecordedSha) {
      await setLocalRecordedSha(path, remoteInfo.sha)
    } else {
      // SHA 匹配，直接返回，无需继续比较时间
      return {
        shouldUpdate: false,
        action: 'none',
        reason: 'SHA 匹配，文件已同步'
      }
    }
  }

  // 如果本地文件不存在
  if (!localMeta.localSha) {
    if (remoteInfo.sha) {
      return {
        shouldUpdate: true,
        action: 'pull',
        reason: '本地文件不存在，需要从远程拉取'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // 如果远程文件不存在，但本地文件存在
  if (!remoteInfo.sha) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: '远程文件不存在，需要推送到远程'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // 比较修改时间（不直接比较 SHA，因为算法不同）
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified || 0

  // 如果两个时间都未知，且两边都有内容，返回冲突（需要用户判断）
  if (localTime === 0 && remoteTime === 0) {
    return {
      shouldUpdate: true,
      action: 'conflict',
      reason: '无法确定文件更新时间，需要手动处理'
    }
  }

  // 如果远程时间未知（获取失败），但远程 SHA 存在
  if (remoteTime === 0 && remoteInfo.sha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '无法确定远程文件更新时间，拉取远程版本'
    }
  }

  // 如果本地时间未知（获取失败），但本地 SHA 存在
  if (localTime === 0 && localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: '无法确定本地文件更新时间，推送本地版本'
    }
  }

  // 拉取后缓冲期（10秒）：如果本地时间 > 远程时间，但本地时间 ≈ 最后同步时间
  // 说明这是刚拉取的内容，不是用户编辑的，不需要推送
  const PULL_GRACE_PERIOD = 10 * 1000 // 10 秒
  if (localTime > remoteTime) {
    // 检查是否在同步或恢复缓冲期内
    const isInSyncGrace = lastSyncTime && localTime - lastSyncTime < PULL_GRACE_PERIOD
    const isInRestoreGrace = lastRestoreTime && localTime - lastRestoreTime < PULL_GRACE_PERIOD
    if (isInSyncGrace || isInRestoreGrace) {
      return {
        shouldUpdate: false,
        action: 'none',
        reason: '刚完成同步或恢复，处于缓冲期内，不触发推送'
      }
    }
  }

  if (remoteTime > localTime) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '远程文件较新，需要拉取更新'
    }
  } else if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: '本地文件较新，需要推送更新'
    }
  }

  // 如果时间相同，认为已同步（避免频繁冲突）
  return {
    shouldUpdate: false,
    action: 'none',
    reason: '文件修改时间相同，认为已同步'
  }
}

/**
 * 从远程拉取文件内容
 */
export async function pullRemoteFile(path: string): Promise<string> {
  const store = await Store.load('store.json')
  const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

  try {
    let file
    switch (primaryBackupMethod) {
      case 'github':
        const githubRepo = await getSyncRepoName('github')
        file = await getGithubFiles({ path, repo: githubRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        file = await getGiteeFiles({ path, repo: giteeRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break

      case 'gitlab': {
        const gitlabRepo = await getSyncRepoName('gitlab')
        const gitlabBranch = await getGitlabBranch()
        file = await getGitlabFileContent({ path, ref: gitlabBranch, repo: gitlabRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 'gitea': {
        const giteaRepo = await getSyncRepoName('gitea')
        const giteaBranch = await getGiteaBranch()
        file = await getGiteaFileContent({ path, ref: giteaBranch, repo: giteaRepo })
        if (file && typeof file.content === 'string') {
          return decodeBase64ToString(file.content)
        }
        break
      }

      case 's3': {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (s3Config) {
          const s3File = await s3Download(s3Config, path)
          if (s3File) {
            return s3File.content
          }
        }
        break
      }

      case 'webdav': {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (webdavConfig) {
          const webdavFile = await webdavDownload(webdavConfig, path)
          if (webdavFile) {
            return webdavFile.content
          }
        }
        break
      }
    }
  } catch (error) {
    throw error
  }

  throw new Error('无法获取远程文件内容')
}

/**
 * 确保目录存在，如果不存在则创建
 */
export async function ensureDirectoryExists(filePath: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(filePath)) {
    filePath = sanitizeFilePath(filePath)
  }
  
  // 提取目录路径
  const dirPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : ''
  
  if (!dirPath) {
    return // 根目录，无需创建
  }
  
  const pathOptions = await getFilePathOptions(dirPath)
  
  try {
    let dirExists = false
    if (workspace.isCustom) {
      dirExists = await exists(pathOptions.path)
    } else {
      dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
    }
    
    if (!dirExists) {
      // 递归创建目录
      if (workspace.isCustom) {
        await mkdir(pathOptions.path, { recursive: true })
      } else {
        await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true })
      }
    }
  } catch (error) {
    throw error
  }
}

/**
 * 保存文件到本地（增强版，处理文件名兼容性和目录创建）
 */
export async function saveLocalFile(path: string, content: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(path)) {
    path = sanitizeFilePath(path)
  }
  
  // 确保目录存在
  await ensureDirectoryExists(path)
  
  const pathOptions = await getFilePathOptions(path)
  
  try {
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, content)
    } else {
      await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
    }
  } catch (error) {
    throw error
  }
}

/**
 * 获取远程文件的最新 commit 信息
 */
export async function getRemoteCommitInfo(path: string): Promise<{
  sha: string
  message: string
  author: string
  date: Date
  additions?: number
  deletions?: number
} | null> {
  try {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
    const repo = await getSyncRepoName(primaryBackupMethod as 'github' | 'gitee' | 'gitlab' | 'gitea')
    
    let commits: any[] = []
    
    switch (primaryBackupMethod) {
      case 'github':
        commits = await getGithubFileCommits({ path, repo })
        break
      case 'gitee':
        commits = await getGiteeFileCommits({ path, repo })
        break
      case 'gitlab':
        const gitlabResult = await getGitlabFileCommits({ path, repo })
        commits = Array.isArray(gitlabResult) ? gitlabResult : []
        break
      case 'gitea':
        const giteaResult = await getGiteaFileCommits({ path, repo })
        commits = Array.isArray(giteaResult) ? giteaResult : []
        break
    }
    
    if (!commits || commits.length === 0) {
      return null
    }
    
    const latestCommit = commits[0]
    
    // 提取 commit 信息
    let author = 'Unknown'
    let message = 'No message'
    let date = new Date()
    let sha = ''
    let additions: number | undefined
    let deletions: number | undefined
    
    if (primaryBackupMethod === 'github') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
      additions = latestCommit.stats?.additions
      deletions = latestCommit.stats?.deletions
    } else if (primaryBackupMethod === 'gitee') {
      author = latestCommit.author?.name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.sha || ''
    } else if (primaryBackupMethod === 'gitlab') {
      author = latestCommit.author_name || 'Unknown'
      message = latestCommit.message || 'No message'
      date = new Date(latestCommit.created_at || Date.now())
      sha = latestCommit.id || ''
    } else if (primaryBackupMethod === 'gitea') {
      author = latestCommit.commit?.author?.name || 'Unknown'
      message = latestCommit.commit?.message || 'No message'
      date = new Date(latestCommit.commit?.author?.date || Date.now())
      sha = latestCommit.sha || ''
    }
    
    return {
      sha,
      message,
      author,
      date,
      additions,
      deletions
    }
  } catch {
    return null
  }
}

/**
 * 自动同步检测和处理（增强版，包含冲突处理和 commit 信息展示）
 */
export async function autoSyncIfNeeded(path: string, options: {
  autoPull?: boolean
  showConfirm?: boolean
  enableConflictResolution?: boolean
} = {}): Promise<string | null> {
  const { autoPull = true, showConfirm = false, enableConflictResolution = true } = options
  
  try {
    // 清理过期锁
    await cleanupExpiredLocks()
    
    // 检查文件是否被其他设备锁定
    if (enableConflictResolution) {
      const lockInfo = await checkFileLock(path)
      if (lockInfo) {
        toast({
          title: '文件锁定',
          description: `文件正在被 ${lockInfo.userName} 在其他设备上编辑`,
          variant: 'destructive'
        })
        return null
      }
    }
    
    const syncResult = await compareFileVersions(path)
    
    if (!syncResult.shouldUpdate || syncResult.action === 'none') {
      return null
    }
    
    if (syncResult.action === 'pull' && autoPull) {
      if (showConfirm) {
        // 获取 commit 信息
        const commitInfo = await getRemoteCommitInfo(path)

        // 使用新的拉取确认对话框
        return new Promise<string | null>((resolve) => {
          useSyncConfirmStore.getState().showPullDialog({
            fileName: path || '',
            commitInfo: commitInfo || undefined,
            onConfirm: async () => {
              try {
                // 执行实际的同步逻辑
                const result = await performSync(path || '', enableConflictResolution)
                resolve(result)
              } catch {
                resolve(null)
              }
            },
            onCancel: () => {
              resolve(null)
            }
          })
        })
      } else {
        // 直接执行同步（不显示确认对话框）
        return await performSync(path, enableConflictResolution)
      }
    }
    
    return null
  } catch {
    return null
  }
}

/**
 * 执行实际的同步操作
 */
async function performSync(path: string, enableConflictResolution: boolean): Promise<string | null> {
  try {
    // 获取本地内容用于冲突检测
    let localContent = ''
    let actualPath = path
    
    // 检查并清理文件名
    if (hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
    }
    
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(actualPath)
      if (workspace.isCustom) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch (error) {
      // 本地文件不存在或目录不存在，这是正常的同步场景
      if (error instanceof Error && 
          (error.message.includes('no such file') || 
           error.message.includes('not found') ||
           error.message.includes('系统找不到指定的路径'))) {
      } else {
        // 静默处理读取本地文件时的意外错误
      }
      // 继续处理，将直接拉取远程文件
    }
    
    const remoteContent = await pullRemoteFile(path)

    // 获取远程文件的 SHA，用于后续更新记录的 SHA
    const remoteInfo = await getRemoteFileInfo(path)
    const remoteSha = remoteInfo.sha

    // 检测和处理冲突
    if (enableConflictResolution && localContent && localContent !== remoteContent) {
      const resolution = await detectAndHandleConflict(path, localContent, remoteContent)
      
      let finalContent = remoteContent
      switch (resolution.action) {
        case 'keep_local':
          finalContent = localContent
          toast({
            title: '冲突处理',
            description: '保留本地版本'
          })
          break
        case 'keep_remote':
          finalContent = remoteContent
          toast({
            title: '冲突处理',
            description: '使用远程版本'
          })
          break
        case 'merge':
          finalContent = mergeSimpleContent(localContent, remoteContent)
          toast({
            title: '冲突处理',
            description: '自动合并成功'
          })
          break
        case 'manual':
          toast({
            title: '需要手动处理',
            description: '冲突较复杂，请手动处理',
            variant: 'destructive'
          })
          return null
      }
      
      await saveLocalFile(actualPath, finalContent)
      await updateFileSyncTime(actualPath)

      // 成功拉取后，更新记录的 SHA
      if (remoteSha) {
        await setLocalRecordedSha(actualPath, remoteSha)
      }

      // 通知编辑器内容已更新
      emitter.emit('sync-content-updated', { path: actualPath, content: finalContent })

      return finalContent
    } else {
      // 无冲突，直接保存
      await saveLocalFile(actualPath, remoteContent)
      await updateFileSyncTime(actualPath)

      // 成功拉取后，更新记录的 SHA
      if (remoteSha) {
        await setLocalRecordedSha(actualPath, remoteSha)
      }

      // 通知编辑器内容已更新
      emitter.emit('sync-content-updated', { path: actualPath, content: remoteContent })

      return remoteContent
    }
  } catch {
    return null
  }
  
  return null
}

/**
 * 检查网络连接状态
 */
export async function hasNetworkConnection(): Promise<boolean> {
  try {
    const store = await Store.load('store.json')
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'

    // 真正的网络检测：尝试发送请求到 API 端点
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10秒超时

    let url = ''
    let token = ''
    let proxy: Proxy | undefined = undefined

    switch (primaryBackupMethod) {
      case 'github':
        token = await store.get<string>('accessToken') || ''
        url = 'https://api.github.com/user'
        break
      case 'gitee':
        token = await store.get<string>('giteeAccessToken') || ''
        url = 'https://gitee.com/api/v5/user'
        break
      case 'gitlab':
        token = await store.get<string>('gitlabAccessToken') || ''
        const gitlabUrl = await store.get<string>('gitlabUrl') || 'https://gitlab.com'
        url = `${gitlabUrl}/api/v4/user`
        break
      case 'gitea':
        token = await store.get<string>('giteaAccessToken') || ''
        url = `${await getGiteaApiBaseUrl()}/user`
        // Gitea 自建实例可能需要代理
        const giteaProxyUrl = await store.get<string>('proxy')
        if (giteaProxyUrl) {
          proxy = { all: giteaProxyUrl }
        }
        break
      default:
        clearTimeout(timeoutId)
        return false
    }

    if (!token) {
      clearTimeout(timeoutId)
      return false
    }

    const fetchOptions: any = {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }

    // Gitea 自建实例使用代理
    if (proxy) {
      fetchOptions.proxy = proxy
    }

    const response = await fetch(url, fetchOptions)

    clearTimeout(timeoutId)
    return response.ok
  } catch (error) {
    // 网络错误、超时等
    console.error('Network connection check failed:', error)
    return false
  }
}

/**
 * 比较 S3 本地和远程文件版本
 * 使用 ETag 进行比较
 */
export async function compareS3FileVersions(path: string): Promise<SyncResult> {
  // 获取 S3 配置
  const store = await getStore()
  const config = await store.get<S3Config>('s3SyncConfig')
  if (!config) {
    return { shouldUpdate: false, action: 'none', reason: 'S3 未配置' }
  }

  // 获取 proxy
  const proxyUrl = await store.get<string>('proxy')
  const proxy = proxyUrl ? { all: proxyUrl } : undefined

  // 获取本地文件的元数据
  const localMeta = await getLocalFileMetadata(path)

  // 从 sync store 获取本地记录的云端 ETag
  const syncStoreState = useSyncStore.getState()
  const localRecordedEtag = syncStoreState.s3FileEtags[path]

  // 获取远程文件的 ETag
  const remoteInfo = await s3HeadObject(config, path, proxy)

  // 如果远程不存在
  if (!remoteInfo) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: '远程文件不存在，需要推送到远程'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // 如果本地不存在
  if (!localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '本地文件不存在，需要从远程拉取'
    }
  }

  // 比较 ETag
  if (localRecordedEtag && localRecordedEtag !== remoteInfo.etag) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '远程文件已更新（ETag 不匹配），需要拉取更新'
    }
  }

  // ETag 匹配
  if (localRecordedEtag === remoteInfo.etag) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: 'ETag 匹配，文件已同步'
    }
  }

  // 没有本地记录的 ETag，记录并检查时间
  // 使用修改时间比较
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified ? new Date(remoteInfo.lastModified).getTime() : 0

  if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: '本地文件较新，需要推送'
    }
  }

  return {
    shouldUpdate: true,
    action: 'pull',
    reason: '远程文件较新，需要拉取'
  }
}

/**
 * 比较 WebDAV 本地和远程文件版本
 * 使用 ETag 进行比较
 */
export async function compareWebDAVFileVersions(path: string): Promise<SyncResult> {
  // 获取 WebDAV 配置
  const store = await getStore()
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!config) {
    return { shouldUpdate: false, action: 'none', reason: 'WebDAV 未配置' }
  }

  // 获取 proxy
  const proxyUrl = await store.get<string>('proxy')
  const proxy = proxyUrl ? { all: proxyUrl } : undefined

  // 获取本地文件的元数据
  const localMeta = await getLocalFileMetadata(path)

  // 从 sync store 获取本地记录的云端 ETag
  const syncStoreState = useSyncStore.getState()
  const localRecordedEtag = syncStoreState.webdavFileEtags[path]

  // 获取远程文件的 ETag
  const remoteInfo = await webdavHeadObject(config, path, proxy)

  // 如果远程不存在
  if (!remoteInfo) {
    if (localMeta.localSha) {
      return {
        shouldUpdate: true,
        action: 'push',
        reason: '远程文件不存在，需要推送到远程'
      }
    }
    return { shouldUpdate: false, action: 'none' }
  }

  // 如果本地不存在
  if (!localMeta.localSha) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '本地文件不存在，需要从远程拉取'
    }
  }

  // 比较 ETag
  if (localRecordedEtag && localRecordedEtag !== remoteInfo.etag) {
    return {
      shouldUpdate: true,
      action: 'pull',
      reason: '远程文件已更新（ETag 不匹配），需要拉取更新'
    }
  }

  // ETag 匹配
  if (localRecordedEtag === remoteInfo.etag) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: 'ETag 匹配，文件已同步'
    }
  }

  // 没有本地记录的 ETag，记录并检查时间
  // 使用修改时间比较
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified ? new Date(remoteInfo.lastModified).getTime() : 0

  if (localTime > remoteTime) {
    return {
      shouldUpdate: true,
      action: 'push',
      reason: '本地文件较新，需要推送'
    }
  }

  return {
    shouldUpdate: true,
    action: 'pull',
    reason: '远程文件较新，需要拉取'
  }
}
