import { Store } from '@tauri-apps/plugin-store'

import { getOptionalSyncRepoName } from '@/lib/sync/repo-utils'
import type { DirTree } from '@/stores/article'
import {
  SYNC_PLATFORMS,
  type CloudFolderConfig,
  type S3Config,
  type SyncPlatform,
  type WebDAVConfig,
} from '@/types/sync'

export type FileTreeSyncStatus = 'loading' | 'error' | 'dirty' | 'synced' | 'local-only' | 'remote-only'
export type SyncConfigurationReason =
  | 'missing-credentials'
  | 'missing-repository'
  | 'unsupported-platform'
  | 'reauthentication-required'

export function validateFileTreeName(name: string): 'empty' | 'invalid' | null {
  const trimmed = name.trim()
  if (!trimmed) return 'empty'
  if (trimmed === '.' || trimmed === '..' || /[\\/\0-\x1f]/.test(trimmed)) return 'invalid'
  return null
}

export function getFileTreeSyncStatus(item: DirTree): FileTreeSyncStatus {
  const childStatuses = item.children?.map(getFileTreeSyncStatus) ?? []
  if (item.loading) return 'loading'
  if (item.syncError || childStatuses.includes('error')) return 'error'
  if (
    (item.isLocale && item.sha && item.syncDirty)
    || childStatuses.includes('dirty')
  ) return 'dirty'
  if (
    item.isLocale
    && (Boolean(item.sha) || childStatuses.some(status => status === 'synced' || status === 'remote-only'))
  ) return 'synced'
  if (item.isLocale) return 'local-only'
  return 'remote-only'
}

export function buildFileTreeSyncStatusMap(tree: DirTree[]) {
  const statuses = new Map<string, FileTreeSyncStatus>()

  function visit(item: DirTree, parentPath = ''): FileTreeSyncStatus {
    const path = parentPath ? `${parentPath}/${item.name}` : item.name
    const childStatuses = (item.children ?? []).map(child => visit(child, path))
    let status: FileTreeSyncStatus

    if (item.loading) status = 'loading'
    else if (item.syncError || childStatuses.includes('error')) status = 'error'
    else if (
      (item.isLocale && item.sha && item.syncDirty)
      || childStatuses.includes('dirty')
    ) status = 'dirty'
    else if (
      item.isLocale
      && (Boolean(item.sha) || childStatuses.some(childStatus => (
        childStatus === 'synced' || childStatus === 'remote-only'
      )))
    ) status = 'synced'
    else if (item.isLocale) status = 'local-only'
    else status = 'remote-only'

    statuses.set(path, status)
    return status
  }

  tree.forEach(item => visit(item))
  return statuses
}

export async function getSyncConfiguration(): Promise<{
  configured: boolean
  platform: SyncPlatform
  reason?: SyncConfigurationReason
}> {
  const store = await Store.load('store.json')
  const storedPlatform = await store.get<string>('primaryBackupMethod') ?? 'github'
  const platform = SYNC_PLATFORMS.find(candidate => candidate === storedPlatform)
  if (!platform) {
    return { platform: 'github', configured: false, reason: 'unsupported-platform' }
  }
  if (platform === 'local') {
    return { platform, configured: false }
  }

  if (platform === 's3') {
    const config = await store.get<S3Config>('s3SyncConfig')
    return {
      platform,
      configured: Boolean(config?.accessKeyId && config.secretAccessKey && config.region && config.bucket),
    }
  }

  if (platform === 'webdav') {
    const config = await store.get<WebDAVConfig>('webdavSyncConfig')
    return {
      platform,
      configured: Boolean(config?.url && config.username && config.password),
    }
  }

  if (platform === 'cloudFolder') {
    const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
    return { platform, configured: Boolean(config?.path) }
  }

  if (platform === 'selfHosted') {
    const { getDb } = await import('@/db')
    const database = await getDb()
    const profiles = await database.select<Array<{
      id: string
      state: 'connected' | 'disconnected' | 'reauthentication-required'
    }>>(
      "select id, state from self_hosted_sync_profiles order by updated_at desc limit 1"
    )
    const profile = profiles[0]
    if (profile?.state === 'reauthentication-required') {
      console.info('[self-hosted-sync] availability.reauthentication-required', { profileId: profile.id })
      return { platform, configured: false, reason: 'reauthentication-required' }
    }
    const profileId = profile?.state === 'connected' ? profile.id : undefined
    if (!profileId) {
      console.info('[self-hosted-sync] availability.no-connected-profile')
      return { platform, configured: false, reason: 'missing-credentials' }
    }
    try {
      console.info('[self-hosted-sync] availability.prepare-workspace', { profileId })
      const { ensureDefaultLibraryForCurrentWorkspace } = await import('@/lib/self-hosted-sync/workspaces')
      await ensureDefaultLibraryForCurrentWorkspace(profileId, '我的工作区')
    } catch (error) {
      console.warn('[self-hosted-sync] availability.prepare-workspace-failed', { profileId, error })
      return { platform, configured: false, reason: 'missing-credentials' }
    }
    const { getCurrentWorkspaceRoot } = await import('@/lib/self-hosted-sync/workspaces')
    const localRoot = await getCurrentWorkspaceRoot()
    const rows = await database.select<Array<{ total: number }>>(
      `select count(*) as total from self_hosted_workspace_bindings
       where workspace_type = 'library' and local_root = $1 and binding_state = 'bound'`,
      [localRoot]
    )
    const configured = (rows[0]?.total ?? 0) > 0
    console.info('[self-hosted-sync] availability.result', { profileId, configured })
    return { platform, configured }
  }

  const credentials: Record<Exclude<SyncPlatform, 'local' | 's3' | 'webdav' | 'cloudFolder' | 'selfHosted'>, [string, string]> = {
    github: ['accessToken', 'githubUsername'],
    gitee: ['giteeAccessToken', 'giteeUsername'],
    gitlab: ['gitlabAccessToken', 'gitlabUsername'],
    gitea: ['giteaAccessToken', 'giteaUsername'],
  }
  const [tokenKey, usernameKey] = credentials[platform]
  const [token, username] = await Promise.all([
    store.get<string>(tokenKey),
    store.get<string>(usernameKey),
  ])

  if (!token?.trim() || !username?.trim()) {
    return { platform, configured: false, reason: 'missing-credentials' }
  }

  const repo = await getOptionalSyncRepoName(platform)
  return repo
    ? { platform, configured: true }
    : { platform, configured: false, reason: 'missing-repository' }
}
