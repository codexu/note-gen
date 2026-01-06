import { Store } from '@tauri-apps/plugin-store'
import { decodeBase64ToString, getFiles as getGithubFiles, getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFiles as getGiteeFiles, getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileContent as getGitlabFileContent, getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileContent as getGiteaFileContent, getFileCommits as getGiteaFileCommits } from '@/lib/sync/gitea'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { toast } from '@/hooks/use-toast'
import { confirm } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { 
  checkFileLock, 
  acquireFileLock, 
  releaseFileLock, 
  detectAndHandleConflict, 
  mergeSimpleContent,
  updateFileSyncTime,
  cleanupExpiredLocks
} from './conflict-resolution'
import { sanitizeFilePath, hasInvalidFileNameChars } from './filename-utils'

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
 * 获取本地文件元数据（增强版，处理文件名兼容性）
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
 * 保存文件到本地（增强版，处理文件名兼容性）
 */
export async function saveLocalFile(path: string, content: string): Promise<void> {
  const workspace = await getWorkspacePath()
  
  // 检查并清理文件名
  if (hasInvalidFileNameChars(path)) {
    const sanitizedPath = sanitizeFilePath(path)
    console.warn(`文件路径包含不安全字符，已自动转换: "${path}" -> "${sanitizedPath}"`)
    path = sanitizedPath
  }
  
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
 * 自动同步检测和处理（增强版，包含冲突处理）
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
        const confirmed = await confirm(
          `检测到远程文件有更新：${syncResult.reason}\n\n是否立即获取最新版本？`,
          { title: '文件同步' }
        )
        if (!confirmed) return null
      }
      
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
      } catch {
        // 本地文件不存在，直接拉取
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
        
        toast({
          title: '自动同步',
          description: `已从远程获取最新版本：${path}`,
        })
        
        return remoteContent
      }
    }
    
    if (syncResult.action === 'conflict') {
      toast({
        title: '同步冲突',
        description: syncResult.reason,
        variant: 'destructive'
      })
    }
    
  } catch (error) {
    console.error(`Auto sync failed for ${path}:`, error)
    toast({
      title: '自动同步失败',
      description: error instanceof Error ? error.message : '未知错误',
      variant: 'destructive'
    })
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
