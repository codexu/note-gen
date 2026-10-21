import { Store } from '@tauri-apps/plugin-store'

import { getOptionalSyncRepoName } from './repo-utils'
import type { CloudFolderConfig } from '@/types/sync'

const GIT_SYNC_PROVIDERS = ['github', 'gitee', 'gitlab', 'gitea'] as const
type GitSyncProvider = typeof GIT_SYNC_PROVIDERS[number]

function normalizeWorkspacePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function isGitSyncProvider(provider: string): provider is GitSyncProvider {
  return GIT_SYNC_PROVIDERS.includes(provider as GitSyncProvider)
}

export async function getCurrentSyncContext(target?: string) {
  const store = await Store.load('store.json')
  const workspacePath = normalizeWorkspacePath(await store.get<string>('workspacePath') || '')
  const provider = target ?? (await store.get<string>('primaryBackupMethod') || 'github')
  const repo = isGitSyncProvider(provider)
    ? await getOptionalSyncRepoName(provider)
    : provider === 'cloudFolder'
      ? (await store.get<CloudFolderConfig>('cloudFolderSyncConfig'))?.path || ''
      : ''

  return {
    workspacePath,
    workspaceKey: workspacePath || '__default__',
    provider,
    repo,
  }
}

export async function getSyncMetadataKey(path: string, target?: string) {
  const context = await getCurrentSyncContext(target)
  return JSON.stringify([context.workspaceKey, context.provider, context.repo, path])
}
