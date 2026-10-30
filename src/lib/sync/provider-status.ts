import { Store } from '@tauri-apps/plugin-store'

import { SyncStateEnum } from '@/lib/sync/github.types'
import { getOptionalSyncRepoName } from '@/lib/sync/repo-utils'
import { testS3Connection } from '@/lib/sync/s3'
import { testWebDAVConnection } from '@/lib/sync/webdav'
import { testCloudFolderConnection } from '@/lib/sync/cloud-folder'
import useSyncStore from '@/stores/sync'
import type { CloudFolderConfig, S3Config, SyncPlatform, WebDAVConfig } from '@/types/sync'
import { getDb, initAllDatabases } from '@/db'
import { SELF_HOSTED_PROTOCOL_VERSION } from '@/lib/self-hosted-sync/protocol'

type GitSyncPlatform = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface ProviderCheckTarget {
  workspacePath: string
  repo: string
  credentials: string
}

const providerStatusChecks = new Map<string, Promise<void>>()
const latestProviderRequests = new Map<SyncPlatform, number>()
let providerRequestId = 0

async function getProviderCheckTarget(store: Store, platform: GitSyncPlatform): Promise<ProviderCheckTarget> {
  const tokenKey = platform === 'github' ? 'accessToken' : `${platform}AccessToken`
  const credentials = await Promise.all([
    store.get<string>(tokenKey),
    platform === 'gitlab' || platform === 'gitea' ? store.get<string>(`${platform}InstanceType`) : undefined,
    platform === 'gitlab' || platform === 'gitea' ? store.get<string>(`${platform}CustomUrl`) : undefined,
  ])
  return {
    workspacePath: await store.get<string>('workspacePath') || '',
    repo: await getOptionalSyncRepoName(platform),
    credentials: JSON.stringify(credentials),
  }
}

async function isProviderCheckTargetCurrent(
  store: Store,
  platform: GitSyncPlatform,
  target: ProviderCheckTarget,
) {
  const current = await getProviderCheckTarget(store, platform)
  return current.workspacePath === target.workspacePath && current.repo === target.repo && current.credentials === target.credentials
}

async function getSelfHostedCheckTarget() {
  await initAllDatabases()
  const database = await getDb()
  return database.select<Array<{ id: string; state: string; serverUrl: string; instanceId: string; accountId: string | null; deviceId: string | null }>>(
    `select id, state, server_url as serverUrl, instance_id as instanceId,
       account_id as accountId, device_id as deviceId from self_hosted_sync_profiles order by id`
  )
}

async function getProviderStatusKey(store: Store, platform: SyncPlatform): Promise<string> {
  if (platform === 'github' || platform === 'gitee' || platform === 'gitlab' || platform === 'gitea') {
    return JSON.stringify([platform, await getProviderCheckTarget(store, platform)])
  }
  if (platform === 'selfHosted') return JSON.stringify([platform, await getSelfHostedCheckTarget()])
  return JSON.stringify([platform, await store.get<unknown>(`${platform}SyncConfig`)])
}

function failProviderCheck(platform: SyncPlatform) {
  const syncStore = useSyncStore.getState()
  switch (platform) {
    case 'github': syncStore.setSyncRepoState(SyncStateEnum.fail); break
    case 'gitee': syncStore.setGiteeSyncRepoState(SyncStateEnum.fail); break
    case 'gitlab': syncStore.setGitlabSyncProjectState(SyncStateEnum.fail); break
    case 'gitea': syncStore.setGiteaSyncRepoState(SyncStateEnum.fail); break
    case 's3': syncStore.setS3Connected(false); break
    case 'webdav': syncStore.setWebDAVConnected(false); break
    case 'cloudFolder': syncStore.setCloudFolderConnected(false); break
    case 'selfHosted': syncStore.setSelfHostedServiceAvailable(false); break
  }
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
  const target = await getSelfHostedCheckTarget()
  const current = async () => JSON.stringify(await getSelfHostedCheckTarget()) === JSON.stringify(target)
  const profile = target.find(item => item.state === 'connected')
  if (!profile) {
    if (await current()) useSyncStore.getState().setSelfHostedConnected(false)
    return
  }
  let available = false
  try {
    const { authenticatedClient } = await import('@/lib/self-hosted-sync/profile')
    const { client } = await authenticatedClient(profile.id)
    const capabilities = await client.capabilities()
    if (capabilities.instanceId === profile.instanceId
      && capabilities.protocol.minimum <= SELF_HOSTED_PROTOCOL_VERSION && capabilities.protocol.maximum >= SELF_HOSTED_PROTOCOL_VERSION) {
      // An open health endpoint alone does not establish usable sync access.
      await client.workspaces()
      available = true
    }
  } finally {
    if (await current()) {
      useSyncStore.getState().setSelfHostedConnected(true)
      useSyncStore.getState().setSelfHostedServiceAvailable(available)
    }
  }
}

async function runProviderStatusCheck(store: Store, platform: SyncPlatform) {
  switch (platform) {
    case 'local':
      return
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

export async function checkSyncProviderStatus(platform: SyncPlatform): Promise<void> {
  if (platform === 'local') return
  const requestId = ++providerRequestId
  latestProviderRequests.set(platform, requestId)
  useSyncStore.getState().setProviderChecking(platform)
  let store: Store | undefined
  let targetKey: string | undefined
  const isCurrent = async () => {
    if (latestProviderRequests.get(platform) !== requestId) return false
    if (!store || !targetKey) return true
    try {
      return await getProviderStatusKey(store, platform) === targetKey
    } catch {
      return latestProviderRequests.get(platform) === requestId
    }
  }
  try {
    store = await Store.load('store.json')
    targetKey = await getProviderStatusKey(store, platform)
    let check = providerStatusChecks.get(targetKey)
    if (!check) {
      check = runProviderStatusCheck(store, platform)
      providerStatusChecks.set(targetKey, check)
      const key = targetKey
      void check.finally(() => {
        if (providerStatusChecks.get(key) === check) providerStatusChecks.delete(key)
      }).catch(() => undefined)
    }
    await check
    if (await isCurrent()) useSyncStore.getState().setProviderCheckSettled(platform)
  } catch (error) {
    if (await isCurrent()) failProviderCheck(platform)
    throw error
  }
}
