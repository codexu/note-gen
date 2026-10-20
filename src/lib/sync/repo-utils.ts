import { RepoNames } from './github.types'
import { Store } from '@tauri-apps/plugin-store'
import { getWorkspaceSyncRepos } from './workspace-repos'

/**
 * 获取实际使用的仓库名称
 * @param type 仓库类型：'sync' | 'image'
 * @param platform 平台：'github' | 'gitee' | 'gitlab' | 'gitea'
 * @returns 实际使用的仓库名称
 */
export async function getActualRepoName(
  type: 'sync' | 'image',
  platform: 'github' | 'gitee' | 'gitlab' | 'gitea'
): Promise<string> {
  const store = await Store.load('store.json')
  
  // 根据类型和平台获取自定义仓库名
  let customRepoName = ''
  
  if (type === 'sync') {
    const workspaceRepos = await getWorkspaceSyncRepos()
    customRepoName = workspaceRepos[platform] || ''
  } else if (type === 'image' && platform === 'github') {
    customRepoName = await store.get<string>('githubCustomImageRepo') || ''
  }
  
  // 如果有自定义仓库名且不为空，使用自定义名称，否则使用默认名称
  if (customRepoName.trim()) {
    return customRepoName.trim()
  }

  if (type === 'sync') {
    const workspacePath = await store.get<string>('workspacePath') || ''
    return workspacePath.trim() ? '' : RepoNames.sync
  }
  
  // 返回默认仓库名
  return RepoNames.image
}

/**
 * 获取当前工作区必需的同步仓库名称。
 * 自定义工作区未配置仓库时抛出错误，防止请求意外落到默认仓库。
 * @param platform 平台：'github' | 'gitee' | 'gitlab' | 'gitea'
 * @returns 同步仓库名称
 */
export async function getSyncRepoName(platform: 'github' | 'gitee' | 'gitlab' | 'gitea'): Promise<string> {
  const repo = await getActualRepoName('sync', platform)
  if (!repo) {
    throw new Error('Sync repository is not configured for the current workspace')
  }
  return repo
}

export async function getOptionalSyncRepoName(platform: 'github' | 'gitee' | 'gitlab' | 'gitea'): Promise<string> {
  return getActualRepoName('sync', platform)
}

/**
 * 获取应用级数据的同步仓库。记录、标签、画布和配置始终使用默认工作区仓库，
 * 不跟随当前文件工作区切换。
 */
export async function getDataSyncRepoName(
  platform: 'github' | 'gitee' | 'gitlab' | 'gitea'
): Promise<string> {
  const workspaceRepos = await getWorkspaceSyncRepos('')
  return workspaceRepos[platform]?.trim() || RepoNames.sync
}

/**
 * 获取图床仓库名称（仅支持GitHub）
 * @returns GitHub图床仓库名称
 */
export async function getImageRepoName(): Promise<string> {
  return getActualRepoName('image', 'github')
}
