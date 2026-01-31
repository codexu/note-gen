import { Store } from '@tauri-apps/plugin-store'
import { decodeBase64ToString, getFiles as getGithubFiles, getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFiles as getGiteeFiles, getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileContent as getGitlabFileContent, getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileContent as getGiteaFileContent, getFileCommits as getGiteaFileCommits } from '@/lib/sync/gitea'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { toast } from '@/hooks/use-toast'
import { readTextFile, writeTextFile, stat, mkdir, exists } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { 
  checkFileLock, 
  detectAndHandleConflict, 
  mergeSimpleContent,
  updateFileSyncTime,
  cleanupExpiredLocks
} from './conflict-resolution'
import { sanitizeFilePath, hasInvalidFileNameChars } from './filename-utils'
import { useSyncConfirmStore } from '@/stores/sync-confirm'

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
    const sanitizedPath = sanitizeFilePath(path)
    console.warn(`文件路径包含不安全字符，已自动转换: "${path}" -> "${sanitizedPath}"`)
    path = sanitizedPath
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
      console.warn(`Local file does not exist (this is normal for sync): ${path}`)
      return {
        path,
        syncStatus: 'unknown'
      }
    }
    
    console.warn(`Failed to get local metadata for ${path}:`, error)
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
        }
        break
        
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        file = await getGitlabFileContent({ path, ref: 'main', repo: gitlabRepo })
        if (file) {
          const commits = await getGitlabFileCommits({ path, repo: gitlabRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].id,
              lastModified: new Date(commits.data[0].committed_date).getTime()
            }
          }
        }
        break
        
      case 'gitea':
        const giteaRepo = await getSyncRepoName('gitea')
        file = await getGiteaFileContent({ path, ref: 'main', repo: giteaRepo })
        if (file) {
          const commits = await getGiteaFileCommits({ path, repo: giteaRepo })
          if (commits && commits.data && commits.data.length > 0) {
            return {
              sha: commits.data[0].sha,
              lastModified: new Date(commits.data[0].commit.committer.date).getTime()
            }
          }
        }
        break
    }
  } catch (error) {
    console.warn(`Failed to get remote info for ${path}:`, error)
  }
  
  return {}
}

/**
 * 比较本地和远程文件版本
 */
export async function compareFileVersions(path: string): Promise<SyncResult> {
  const localMeta = await getLocalFileMetadata(path)
  const remoteInfo = await getRemoteFileInfo(path)
  
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
  
  // 如果远程文件不存在
  if (!remoteInfo.sha) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: '远程文件不存在'
    }
  }
  
  // 比较 SHA
  if (localMeta.localSha === remoteInfo.sha) {
    return {
      shouldUpdate: false,
      action: 'none',
      reason: '文件已同步'
    }
  }
  
  // 比较修改时间
  const localTime = localMeta.lastModified || 0
  const remoteTime = remoteInfo.lastModified || 0
  
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
  
  // 如果时间相同但 SHA 不同，可能是冲突
  return {
    shouldUpdate: true,
    action: 'conflict',
    reason: '文件内容不同但修改时间相同，可能存在冲突'
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
        if (file?.content) {
          return decodeBase64ToString(file.content)
        }
        break
        
      case 'gitee':
        const giteeRepo = await getSyncRepoName('gitee')
        file = await getGiteeFiles({ path, repo: giteeRepo })
        if (file?.content) {
          return decodeBase64ToString(file.content)
        }
        break
        
      case 'gitlab':
        const gitlabRepo = await getSyncRepoName('gitlab')
        file = await getGitlabFileContent({ path, ref: 'main', repo: gitlabRepo })
        if (file?.content) {
          return decodeBase64ToString(file.content)
        }
        break
        
      case 'gitea':
        const giteaRepo = await getSyncRepoName('gitea')
        file = await getGiteaFileContent({ path, ref: 'main', repo: giteaRepo })
        if (file?.content) {
          return decodeBase64ToString(file.content)
        }
        break
    }
  } catch (error) {
    console.error(`Failed to pull remote file ${path}:`, error)
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
    console.error(`Failed to create directory ${dirPath}:`, error)
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
    const sanitizedPath = sanitizeFilePath(path)
    console.warn(`文件路径包含不安全字符，已自动转换: "${path}" -> "${sanitizedPath}"`)
    path = sanitizedPath
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
    console.error(`Failed to save local file ${path}:`, error)
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
  } catch (error) {
    console.warn('Failed to get remote commit info:', error)
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
        
        // 使用新的确认对话框
        return new Promise<string | null>((resolve) => {
          useSyncConfirmStore.getState().showConfirmDialog({
            fileName: path || '',
            commitInfo: commitInfo || undefined,
            onConfirm: async () => {
              try {
                // 执行实际的同步逻辑
                const result = await performSync(path || '', enableConflictResolution)
                resolve(result)
              } catch (error) {
                console.error('Sync failed:', error)
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
  } catch (error) {
    console.error('Auto sync failed:', error)
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
      console.warn(`文件路径包含不安全字符，已自动转换: "${path}" -> "${actualPath}"`)
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
        console.warn(`Unexpected error reading local file ${actualPath}:`, error)
      }
      // 继续处理，将直接拉取远程文件
    }
    
    const remoteContent = await pullRemoteFile(path)
    
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
      
      return finalContent
    } else {
      // 无冲突，直接保存
      await saveLocalFile(actualPath, remoteContent)
      await updateFileSyncTime(actualPath)
      
      return remoteContent
    }
  } catch (error) {
    console.error('Perform sync failed:', error)
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
    
    // 简单的网络检测：尝试获取用户信息
    switch (primaryBackupMethod) {
      case 'github':
        const accessToken = await store.get<string>('accessToken')
        return !!accessToken
      case 'gitee':
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        return !!giteeAccessToken
      case 'gitlab':
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        return !!gitlabAccessToken
      case 'gitea':
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        return !!giteaAccessToken
      default:
        return false
    }
  } catch {
    return false
  }
}
