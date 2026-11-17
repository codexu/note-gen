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

export interface SyncProviderCheckOptions {
  isActive?: () => boolean
}

interface ProviderCheckTarget {
  workspacePath: string
  repo: string
  credentials: string
}

interface ProviderStatusCheck {
  callers: Set<() => boolean>
  stopped: boolean
  promise: Promise<void>
}

const providerStatusChecks = new Map<string, ProviderStatusCheck>()
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
  isActive: () => boolean,
) {
  if (!isActive()) return false
  const current = await getProviderCheckTarget(store, platform)
  return isActive() && current.workspacePath === target.workspacePath && current.repo === target.repo && current.credentials === target.credentials
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

async function checkGithubStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('accessToken')
  const target = await getProviderCheckTarget(store, 'github')
  if (!await isProviderCheckTargetCurrent(store, 'github', target, isActive)) return

  syncStore.setSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/github')
    if (!isActive()) return
    const userResponse = await getUserInfo()
    if (!isActive()) return
    if (userResponse) syncStore.setUserInfo(userResponse.data)
    if (!await isProviderCheckTargetCurrent(store, 'github', target, isActive)) return

    if (!target.repo) {
      syncStore.setSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'github', target, isActive)) return
    syncStore.setSyncRepoInfo(repo)
    syncStore.setSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check GitHub status:', error)
    if (await isProviderCheckTargetCurrent(store, 'github', target, isActive)) {
      syncStore.setSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkGiteeStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteeAccessToken')
  const target = await getProviderCheckTarget(store, 'gitee')
  if (!await isProviderCheckTargetCurrent(store, 'gitee', target, isActive)) return

  syncStore.setGiteeSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteeSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitee')
    if (!isActive()) return
    const userInfo = await getUserInfo()
    if (!isActive()) return
    syncStore.setGiteeUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitee', target, isActive)) return

    if (!target.repo) {
      syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitee', target, isActive)) return
    syncStore.setGiteeSyncRepoInfo(repo ?? undefined)
    syncStore.setGiteeSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check Gitee status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitee', target, isActive)) {
      syncStore.setGiteeSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkGitlabStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('gitlabAccessToken')
  const target = await getProviderCheckTarget(store, 'gitlab')
  if (!await isProviderCheckTargetCurrent(store, 'gitlab', target, isActive)) return

  syncStore.setGitlabSyncProjectInfo(undefined)
  if (!accessToken) {
    syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
    return
  }

  syncStore.setGitlabSyncProjectState(SyncStateEnum.checking)
  try {
    const { checkSyncProjectState, getUserInfo } = await import('@/lib/sync/gitlab')
    if (!isActive()) return
    const userInfo = await getUserInfo()
    if (!isActive()) return
    syncStore.setGitlabUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitlab', target, isActive)) return

    if (!target.repo) {
      syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
      return
    }
    const project = await checkSyncProjectState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitlab', target, isActive)) return
    syncStore.setGitlabSyncProjectInfo(project ?? undefined)
    syncStore.setGitlabSyncProjectState(project ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check GitLab status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitlab', target, isActive)) {
      syncStore.setGitlabSyncProjectState(SyncStateEnum.fail)
    }
  }
}

async function checkGiteaStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const accessToken = await store.get<string>('giteaAccessToken')
  const target = await getProviderCheckTarget(store, 'gitea')
  if (!await isProviderCheckTargetCurrent(store, 'gitea', target, isActive)) return

  syncStore.setGiteaSyncRepoInfo(undefined)
  if (!accessToken) {
    syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
    return
  }

  syncStore.setGiteaSyncRepoState(SyncStateEnum.checking)
  try {
    const { checkSyncRepoState, getUserInfo } = await import('@/lib/sync/gitea')
    if (!isActive()) return
    const userInfo = await getUserInfo()
    if (!isActive()) return
    syncStore.setGiteaUserInfo(userInfo)
    if (!await isProviderCheckTargetCurrent(store, 'gitea', target, isActive)) return

    if (!target.repo) {
      syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
      return
    }
    const repo = await checkSyncRepoState(target.repo)
    if (!await isProviderCheckTargetCurrent(store, 'gitea', target, isActive)) return
    syncStore.setGiteaSyncRepoInfo(repo ?? undefined)
    syncStore.setGiteaSyncRepoState(repo ? SyncStateEnum.success : SyncStateEnum.fail)
  } catch (error) {
    console.error('Failed to check Gitea status:', error)
    if (await isProviderCheckTargetCurrent(store, 'gitea', target, isActive)) {
      syncStore.setGiteaSyncRepoState(SyncStateEnum.fail)
    }
  }
}

async function checkS3Status(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<S3Config>('s3SyncConfig')
  if (!isActive()) return
  const configured = config?.accessKeyId && config.secretAccessKey && config.region && config.bucket
  const connected = configured ? await testS3Connection(config).catch(() => false) : false
  const currentConfig = await store.get<S3Config>('s3SyncConfig')
  if (isActive() && JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setS3Connected(connected)
  }
}

async function checkWebDAVStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (!isActive()) return
  const configured = config?.url && config.username && config.password
  const connected = configured ? await testWebDAVConnection(config).catch(() => false) : false
  const currentConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
  if (isActive() && JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setWebDAVConnected(connected)
  }
}

async function checkCloudFolderStatus(store: Store, isActive: () => boolean) {
  const syncStore = useSyncStore.getState()
  const config = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  if (!isActive()) return
  const connected = config?.path
    ? await testCloudFolderConnection(config).catch(() => false)
    : false
  const currentConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
  if (isActive() && JSON.stringify(currentConfig) === JSON.stringify(config)) {
    syncStore.setCloudFolderConnected(connected)
  }
}

async function checkSelfHostedStatus(isActive: () => boolean) {
  const target = await getSelfHostedCheckTarget()
  if (!isActive()) return
  const current = async () => {
    const matches = JSON.stringify(await getSelfHostedCheckTarget()) === JSON.stringify(target)
    return isActive() && matches
  }
  const profile = target.find(item => item.state === 'connected')
  if (!profile) {
    if (await current()) useSyncStore.getState().setSelfHostedConnected(false)
    return
  }
  let available = false
  try {
    const { authenticatedClient } = await import('@/lib/self-hosted-sync/profile')
    if (!isActive()) return
    const { client } = await authenticatedClient(profile.id)
    if (!isActive()) return
    const capabilities = await client.capabilities()
    if (!isActive()) return
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

async function runProviderStatusCheck(store: Store, platform: SyncPlatform, isActive: () => boolean) {
  if (!isActive()) return
  switch (platform) {
    case 'local':
      return
    case 'github':
      return checkGithubStatus(store, isActive)
    case 'gitee':
      return checkGiteeStatus(store, isActive)
    case 'gitlab':
      return checkGitlabStatus(store, isActive)
    case 'gitea':
      return checkGiteaStatus(store, isActive)
    case 's3':
      return checkS3Status(store, isActive)
    case 'webdav':
      return checkWebDAVStatus(store, isActive)
    case 'cloudFolder':
      return checkCloudFolderStatus(store, isActive)
    case 'selfHosted':
      return checkSelfHostedStatus(isActive)
  }
}

function joinProviderStatusCheck(
  store: Store,
  platform: SyncPlatform,
  targetKey: string,
  caller: () => boolean,
): ProviderStatusCheck {
  const existing = providerStatusChecks.get(targetKey)
  if (existing && !existing.stopped) {
    existing.callers.add(caller)
    return existing
  }

  const isActive = () => {
    if (entry.stopped) return false
    if (Array.from(entry.callers).some(check => check())) return true
    // A later caller must start a fresh check once this one has already
    // observed that none of its original callers still authorizes it.
    entry.stopped = true
    if (providerStatusChecks.get(targetKey) === entry) providerStatusChecks.delete(targetKey)
    return false
  }
  const entry: ProviderStatusCheck = {
    callers: new Set([caller]),
    stopped: false,
    promise: Promise.resolve().then(() => runProviderStatusCheck(store, platform, isActive)),
  }
  providerStatusChecks.set(targetKey, entry)
  void entry.promise.finally(() => {
    if (providerStatusChecks.get(targetKey) === entry) providerStatusChecks.delete(targetKey)
  }).catch(() => undefined)
  return entry
}

export async function checkSyncProviderStatus(platform: SyncPlatform, options: SyncProviderCheckOptions = {}): Promise<void> {
  const isActive = options.isActive ?? (() => true)
  if (platform === 'local' || !isActive()) return
  let requestId: number | undefined
  let store: Store | undefined
  let targetKey: string | undefined
  let check: ProviderStatusCheck | undefined
  const isCurrent = async () => {
    if (requestId === undefined || !isActive() || latestProviderRequests.get(platform) !== requestId) return false
    if (!store || !targetKey) return true
    try {
      const currentKey = await getProviderStatusKey(store, platform)
      return isActive() && latestProviderRequests.get(platform) === requestId && currentKey === targetKey
    } catch {
      return isActive() && latestProviderRequests.get(platform) === requestId
    }
  }
  try {
    store = await Store.load('store.json')
    if (!isActive()) return
    targetKey = await getProviderStatusKey(store, platform)
    if (!isActive()) return
    // Only callers that still authorize a check take ownership of its status.
    // A cancelled target lookup leaves any existing check untouched.
    requestId = ++providerRequestId
    latestProviderRequests.set(platform, requestId)
    useSyncStore.getState().setProviderChecking(platform)
    check = joinProviderStatusCheck(store, platform, targetKey, isActive)
    await check.promise
    if (await isCurrent()) useSyncStore.getState().setProviderCheckSettled(platform)
  } catch (error) {
    if (await isCurrent()) failProviderCheck(platform)
    throw error
  } finally {
    check?.callers.delete(isActive)
    if (requestId !== undefined && latestProviderRequests.get(platform) === requestId && !isActive()) {
      useSyncStore.getState().setProviderCheckSettled(platform)
    }
  }
}
