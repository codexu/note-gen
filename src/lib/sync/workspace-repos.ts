import { Store } from '@tauri-apps/plugin-store'

export const SYNC_REPO_PLATFORMS = ['github', 'gitee', 'gitlab', 'gitea'] as const

export type SyncRepoPlatform = typeof SYNC_REPO_PLATFORMS[number]
export type WorkspaceSyncRepos = Partial<Record<SyncRepoPlatform, string>>

type WorkspaceSyncRepoMap = Record<string, WorkspaceSyncRepos>

const WORKSPACE_SYNC_REPOS_KEY = 'workspaceSyncRepos'
const DEFAULT_WORKSPACE_KEY = '__default__'

const LEGACY_REPO_KEYS: Record<SyncRepoPlatform, string> = {
  github: 'githubCustomSyncRepo',
  gitee: 'giteeCustomSyncRepo',
  gitlab: 'gitlabCustomSyncRepo',
  gitea: 'giteaCustomSyncRepo',
}

let updateQueue: Promise<void> = Promise.resolve()

function getWorkspaceKey(workspacePath: string): string {
  const normalizedPath = workspacePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return normalizedPath || DEFAULT_WORKSPACE_KEY
}

async function getLegacyRepo(store: Store, platform: SyncRepoPlatform): Promise<string> {
  return await store.get<string>(LEGACY_REPO_KEYS[platform]) || ''
}

export async function getWorkspaceSyncRepos(workspacePath?: string): Promise<WorkspaceSyncRepos> {
  await updateQueue
  const store = await Store.load('store.json')
  const currentWorkspacePath = workspacePath ?? await store.get<string>('workspacePath') ?? ''
  const workspaceKey = getWorkspaceKey(currentWorkspacePath)
  const repoMap = await store.get<WorkspaceSyncRepoMap>(WORKSPACE_SYNC_REPOS_KEY) || {}
  const workspaceRepos = repoMap[workspaceKey] || {}

  const entries = await Promise.all(SYNC_REPO_PLATFORMS.map(async (platform) => {
    const workspaceRepo = workspaceRepos[platform]
    const repo = workspaceRepo === undefined && workspaceKey === DEFAULT_WORKSPACE_KEY
      ? await getLegacyRepo(store, platform)
      : workspaceRepo || ''
    return [platform, repo] as const
  }))

  return Object.fromEntries(entries) as WorkspaceSyncRepos
}

export async function setWorkspaceSyncRepo(
  platform: SyncRepoPlatform,
  repo: string,
  workspacePath?: string
): Promise<void> {
  await updateQueue
  const inspectionStore = await Store.load('store.json')
  const targetWorkspacePath = workspacePath ?? await inspectionStore.get<string>('workspacePath') ?? ''
  const workspaceKey = getWorkspaceKey(targetWorkspacePath)
  const initialRepoMap = await inspectionStore.get<WorkspaceSyncRepoMap>(WORKSPACE_SYNC_REPOS_KEY) || {}
  const activeWorkspacePath = await inspectionStore.get<string>('workspacePath') ?? ''
  const isActiveWorkspace = getWorkspaceKey(activeWorkspacePath) === workspaceKey
  const existingRepo = initialRepoMap[workspaceKey]?.[platform]
    ?? (workspaceKey === DEFAULT_WORKSPACE_KEY ? await getLegacyRepo(inspectionStore, platform) : '')

  if (existingRepo === repo) return

  let finishSyncTargetChange: (() => void) | undefined
  const changesDataSyncRepository = workspaceKey === DEFAULT_WORKSPACE_KEY
  if (isActiveWorkspace || changesDataSyncRepository) {
    const [{ getSyncPushQueue }, autoDataSyncQueue] = await Promise.all([
      import('@/lib/sync/sync-push-queue'),
      import('@/lib/sync/auto-data-sync-queue'),
    ])
    const syncPushQueue = getSyncPushQueue()
    await Promise.all([
      isActiveWorkspace ? syncPushQueue.prepareForWorkspaceSwitch() : Promise.resolve(),
      changesDataSyncRepository
        ? autoDataSyncQueue.prepareAutoDataSyncForRepositoryChange()
        : Promise.resolve(),
    ])
    finishSyncTargetChange = () => {
      if (isActiveWorkspace) syncPushQueue.finishWorkspaceSwitch()
      if (changesDataSyncRepository) autoDataSyncQueue.finishAutoDataSyncRepositoryChange()
    }
  }

  const update = async () => {
    const store = await Store.load('store.json')
    const repoMap = await store.get<WorkspaceSyncRepoMap>(WORKSPACE_SYNC_REPOS_KEY) || {}
    await store.set(WORKSPACE_SYNC_REPOS_KEY, {
      ...repoMap,
      [workspaceKey]: {
        ...repoMap[workspaceKey],
        [platform]: repo,
      },
    })
    await store.save()
  }

  updateQueue = updateQueue.then(update, update)
  try {
    await updateQueue
  } finally {
    finishSyncTargetChange?.()
  }
}
