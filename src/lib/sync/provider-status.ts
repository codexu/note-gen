import { Store } from '@tauri-apps/plugin-store'

import { SyncStateEnum } from '@/lib/sync/github.types'
import { getOptionalSyncRepoName } from '@/lib/sync/repo-utils'
import { testS3Connection } from '@/lib/sync/s3'
import { testWebDAVConnection } from '@/lib/sync/webdav'
import { testCloudFolderConnection } from '@/lib/sync/cloud-folder'
import useSyncStore from '@/stores/sync'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'
import { getDb } from '@/db'

type GitSyncPlatform = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface ProviderCheckTarget {
  workspacePath: string
  repo: string
}

async function getProviderCheckTarget(store: Store, platform: GitSyncPlatform): Promise<ProviderCheckTarget> {
  return {
    workspacePath: await store.get<string>('workspacePath') || '',
    repo: await getOptionalSyncRepoName(platform),
  }
}

async function isProviderCheckTargetCurrent(
  store: Store,
  platform: GitSyncPlatform,
  target: ProviderCheckTarget,
) {
  const currentWorkspacePath = await store.get<string>('workspacePath') || ''
  if (currentWorkspacePath !== target.workspacePath) return false
  return await getOptionalSyncRepoName(platform) === target.repo
}

async function checkGithubStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('accessToken')
  const target = await getProviderCheckTarget(store, 'github')
  if (!await isProviderCheckTargetCurrent(store, 'github', target)) return

  syncStore.setSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/github')
    const userResponse = await getUserInfo()
    if (userResponse) syncStore.setUserInfo(userResponse.data)
    if (!await isProviderCheckTargetCurrent(store, 'github', target)) return

    if (!target.repo) {
      syncStore.setSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'github', target)) return
    syncStore.setSyncRepoInfo(repo)
    syncStore.setSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check GitHub status:', error)
    if (await isProviderCheckTargetCurrent(store, 'github', target)) {
      syncStore.setSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkGiteeStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteeAccessToken')
  const target = await getProviderCheckTarget(store, 'gitee')
  if (!await isProviderCheckTargetCurrent(store, 'gitee', target)) return

  syncStore.setGiteeSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteeSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitee')
    const userInfo = await getUserInfo()
    syncStore.setGiteeUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitee', target)) return

    if (!target.repo) {
      syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitee', target)) return
    syncStore.setGiteeSyncRepoInfo(repo ?? undefined)
    syncStore.setGiteeSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check Gitee status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitee', target)) {
      syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkGitlabStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('gitlabAccessToken')
  const target = await getProviderCheckTarget(store, 'gitlab')
  if (!await isProviderCheckTargetCurrent(store, 'gitlab', target)) return

  syncStore.setGitlabSyncProjectInfo(undefined)
  if (!accessToken) {
    syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
    return
  }

  syncStore.setGitlabSyncProjectState(SyncStateEnum.checking)
  try {
    const { checkSyncProjectState, getUserInfo } = await import('@/lib/sync/gitlab')
    const userInfo = await getUserInfo()
    syncStore.setGitlabUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitlab', target)) return

    if (!target.repo) {
      syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
      return
    }
    const project = await checkSyncProjectState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitlab', target)) return
    syncStore.setGitlabSyncProjectInfo(project ?? undefined)
    syncStore.setGitlabSyncProjectState(project ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check GitLab status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitlab', target)) {
      syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }
}

async function checkGiteaStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteaAccessToken')
  const target = await getProviderCheckTarget(store, 'gitea')
  if (!await isProviderCheckTargetCurrent(store, 'gitea', target)) return

  syncStore.setGiteaSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteaSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitea')
    const userInfo = await getUserInfo()
    syncStore.setGiteaUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitea', target)) return

    if (!target.repo) {
      syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitea', target)) return
    syncStore.setGiteaSyncRepoInfo(repo ?? undefined)
    syncStore.setGiteaSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check Gitea status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitea', target)) {
      syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkS3Status(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<S3Config>('s3SyncConfig')
  const configured = config?.accessKeyId && config.secretAccessKey && config.region && config.bucket
  const connected = configured ? await testS3Connection(config).catch(() => false) : false
  const currentConfig = await store.get<S3Config>('s3SyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setS3Connected(connected)
  }
}

async function checkWebDAVStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  const configured = config?.url && config.username && config.password
  const connected = configured ? await testWebDAVConnection(config).catch(() => false) : false
  const currentConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setWebDAVConnected(connected)
  }
}

async function checkCloudFolderStatus(store: Store) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  const connected = config?.path
    ? await testCloudFolderConnection(config).catch(() => false)
    : false
  const currentConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  if (JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setCloudFolderConnected(connected)
  }
}

async function checkSelfHostedStatus() {
  const database = await getDb()
  const rows = await database.select<Array<{ total: number }>>(
    "select count(*) as total from self_hosted_sync_profiles where state = 'connected'"
  )
  useSyncStore.getState().setSelfHostedConnected((rows[0]?.total ?? 0) > 0)
}

export async function checkSyncProviderStatus(platform: SyncPlatform) {
  const store = await Store.load('store.json')

  switch (platform) {
    case 'github':
      return checkGithubStatus(store)
    case 'gitee':
      return checkGiteeStatus(store)
    case 'gitlab':
      return checkGitlabStatus(store)
    case 'gitea':
      return checkGiteaStatus(store)
    case 's3':
      return checkS3Status(store)
    case 'webdav':
      return checkWebDAVStatus(store)
    case 'cloudFolder':
      return checkCloudFolderStatus(store)
    case 'selfHosted':
      return checkSelfHostedStatus()
  }
}
