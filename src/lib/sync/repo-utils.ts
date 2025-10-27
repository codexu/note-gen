import { RepoNames } from './github.types'
import { Store } from '@tauri-apps/plugin-store'

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
    switch (platform) {
      case 'github':
        customRepoName = await store.get<string>('githubCustomSyncRepo') || ''
        break
      case 'gitee':
        customRepoName = await store.get<string>('giteeCustomSyncRepo') || ''
        break
      case 'gitlab':
        customRepoName = await store.get<string>('gitlabCustomSyncRepo') || ''
        break
      case 'gitea':
        customRepoName = await store.get<string>('giteaCustomSyncRepo') || ''
        break
    }
  } else if (type === 'image' && platform === 'github') {
    customRepoName = await store.get<string>('githubCustomImageRepo') || ''
  }
  
  // 如果有自定义仓库名且不为空，使用自定义名称，否则使用默认名称
  if (customRepoName.trim()) {
    return customRepoName.trim()
  }
  
  // 返回默认仓库名
  return type === 'sync' ? RepoNames.sync : RepoNames.image
}

/**
 * 获取同步仓库名称
 * @param platform 平台：'github' | 'gitee' | 'gitlab' | 'gitea'
 * @returns 同步仓库名称
 */
export async function getSyncRepoName(platform: 'github' | 'gitee' | 'gitlab' | 'gitea'): Promise<string> {
  return getActualRepoName('sync', platform)
}

/**
 * 获取图床仓库名称（仅支持GitHub）
 * @returns GitHub图床仓库名称
 */
export async function getImageRepoName(): Promise<string> {
  return getActualRepoName('image', 'github')
}
