import { Store } from '@tauri-apps/plugin-store'
import type useSettingStore from '@/stores/setting'

import { RepoNames, SyncStateEnum, type GithubRepoInfo, type UserInfo } from './github.types'
import type { GiteeRepoInfo } from './gitee'
import { GitlabInstanceType, type GitlabProjectInfo, type GitlabUserInfo } from './gitlab.types'
import { GiteaInstanceType, type GiteaRepositoryInfo, type GiteaUserInfo } from './gitea.types'
import { getOptionalSyncRepoName } from './repo-utils'
import { getWorkspaceSyncRepos, SYNC_REPO_PLATFORMS, type SyncRepoPlatform } from './workspace-repos'

export type RepositoryCheckResult = 'success' | 'not-found' | 'missing-token' | 'error'
export type RepositoryCreateResult = 'created' | 'missing-token' | 'create-error'
export type RepositoryListResult = {
  status: 'success' | 'missing-token' | 'error'
  repositories: string[]
}

export interface RepositoryCheckSnapshot {
  result: RepositoryCheckResult
  github?: { userInfo?: UserInfo; repoInfo?: GithubRepoInfo }
  gitee?: { userInfo?: Record<string, unknown>; repoInfo?: GiteeRepoInfo }
  gitlab?: { userInfo?: GitlabUserInfo; repoInfo?: GitlabProjectInfo }
  gitea?: { userInfo?: GiteaUserInfo; repoInfo?: GiteaRepositoryInfo }
}

interface CheckContext {
  platform: SyncRepoPlatform
  token: string
  key: string
}

interface CheckEntry {
  snapshot?: RepositoryCheckSnapshot
  inFlight?: Promise<RepositoryCheckSnapshot>
}

interface GitProviderTarget {
  workspacePath: string
  repo: string
  context: CheckContext
}

const TOKEN_KEYS: Record<SyncRepoPlatform, string> = {
  github: 'accessToken',
  gitee: 'giteeAccessToken',
  gitlab: 'gitlabAccessToken',
  gitea: 'giteaAccessToken',
}

const repositoryChecks = new Map<string, CheckEntry>()
const accountChecks = new Map<string, CheckEntry>()
const activeProviderTargets = new Map<SyncRepoPlatform, string>()
const listeners = new Set<() => void>()
let warmupScheduled: Promise<void> | undefined
let warmupPromise: Promise<void> | undefined

function getSettingsProviderTarget(platform: SyncRepoPlatform, settings: ReturnType<typeof useSettingStore.getState>): GitProviderTarget {
  const repos = {
    github: settings.githubCustomSyncRepo,
    gitee: settings.giteeCustomSyncRepo,
    gitlab: settings.gitlabCustomSyncRepo,
    gitea: settings.giteaCustomSyncRepo,
  }
  const tokens = {
    github: settings.accessToken,
    gitee: settings.giteeAccessToken,
    gitlab: settings.gitlabAccessToken,
    gitea: settings.giteaAccessToken,
  }
  const token = tokens[platform].trim()
  const instanceType = platform === 'gitlab' ? settings.gitlabInstanceType : platform === 'gitea' ? settings.giteaInstanceType : ''
  const customUrl = platform === 'gitlab' ? settings.gitlabCustomUrl : platform === 'gitea' ? settings.giteaCustomUrl : ''
  return {
    workspacePath: settings.workspacePath,
    repo: repos[platform].trim() || (settings.workspacePath ? '' : RepoNames.sync),
    context: { platform, token, key: JSON.stringify([platform, token, instanceType, customUrl.trim()]) },
  }
}

function getProviderTargetKey(target: GitProviderTarget) {
  return JSON.stringify([target.workspacePath, target.repo, target.context.key])
}

export function subscribeRepositoryChecks(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notifyRepositoryChecks() {
  listeners.forEach(listener => listener())
}

async function getCheckContext(platform: SyncRepoPlatform): Promise<CheckContext> {
  const store = await Store.load('store.json')
  const [token, instanceType, customUrl] = await Promise.all([
    store.get<string>(TOKEN_KEYS[platform]),
    platform === 'gitlab' || platform === 'gitea' ? store.get<string>(`${platform}InstanceType`) : undefined,
    platform === 'gitlab' || platform === 'gitea' ? store.get<string>(`${platform}CustomUrl`) : undefined,
  ])
  return {
    platform,
    token: token?.trim() || '',
    key: JSON.stringify([
      platform,
      token?.trim() || '',
      instanceType || (platform === 'gitlab' ? GitlabInstanceType.OFFICIAL : platform === 'gitea' ? GiteaInstanceType.OFFICIAL : ''),
      customUrl?.trim() || '',
    ]),
  }
}

function getRepositoryKey(context: CheckContext, repo: string) {
  return JSON.stringify([context.key, repo.trim()])
}

async function inspectAccount(context: CheckContext): Promise<RepositoryCheckSnapshot> {
  if (!context.token) return { result: 'missing-token' }

  try {
    switch (context.platform) {
      case 'github': {
        const { getUserInfo } = await import('./github')
        const response = await getUserInfo(context.token)
        return response
          ? { result: 'success', github: { userInfo: response.data as UserInfo } }
          : { result: 'error' }
      }
      case 'gitee': {
        const { getUserInfo } = await import('./gitee')
        const userInfo = await getUserInfo() as Record<string, unknown> | undefined
        return userInfo && typeof userInfo.login === 'string'
          ? { result: 'success', gitee: { userInfo } }
          : { result: 'error' }
      }
      case 'gitlab': {
        const { getUserInfo } = await import('./gitlab')
        return { result: 'success', gitlab: { userInfo: await getUserInfo(context.token) } }
      }
      case 'gitea': {
        const { getUserInfo } = await import('./gitea')
        return { result: 'success', gitea: { userInfo: await getUserInfo(context.token) } }
      }
    }
  } catch (error) {
    console.error(`Failed to check ${context.platform} account:`, error)
    return { result: 'error' }
  }
}

function checkAccount(context: CheckContext, force = false): Promise<RepositoryCheckSnapshot> {
  const existing = accountChecks.get(context.key)
  if (existing?.inFlight) return existing.inFlight
  if (existing?.snapshot && !force) return Promise.resolve(existing.snapshot)

  const entry: CheckEntry = {}
  accountChecks.set(context.key, entry)
  entry.inFlight = inspectAccount(context).then(snapshot => {
    entry.snapshot = snapshot
    entry.inFlight = undefined
    return snapshot
  })
  return entry.inFlight
}

async function inspectRepository(context: CheckContext, repo: string, force: boolean): Promise<RepositoryCheckSnapshot> {
  const account = await checkAccount(context, force)
  if (account.result !== 'success') return account

  try {
    switch (context.platform) {
      case 'github': {
        const { checkSyncRepoState } = await import('./github')
        const repoInfo = await checkSyncRepoState(repo) as GithubRepoInfo | undefined | false
        return { ...account, result: repoInfo ? 'success' : 'not-found', github: { ...account.github, repoInfo: repoInfo || undefined } }
      }
      case 'gitee': {
        const { checkSyncRepoState } = await import('./gitee')
        const repoInfo = await checkSyncRepoState(repo)
        return { ...account, result: repoInfo ? 'success' : 'not-found', gitee: { ...account.gitee, repoInfo: repoInfo || undefined } }
      }
      case 'gitlab': {
        const { checkSyncProjectState } = await import('./gitlab')
        const repoInfo = await checkSyncProjectState(repo)
        return { ...account, result: repoInfo ? 'success' : 'not-found', gitlab: { ...account.gitlab, repoInfo: repoInfo || undefined } }
      }
      case 'gitea': {
        const { checkSyncRepoState } = await import('./gitea')
        const repoInfo = await checkSyncRepoState(repo)
        return { ...account, result: repoInfo ? 'success' : 'not-found', gitea: { ...account.gitea, repoInfo: repoInfo || undefined } }
      }
    }
  } catch (error) {
    console.error(`Failed to check ${context.platform} repository:`, error)
    return { ...account, result: 'error' }
  }
}

function requestRepositoryCheck(context: CheckContext, repo: string, force = false): Promise<RepositoryCheckSnapshot> {
  const key = getRepositoryKey(context, repo)
  const existing = repositoryChecks.get(key)
  if (existing?.inFlight) return existing.inFlight
  if (existing?.snapshot && !force) return Promise.resolve(existing.snapshot)

  const entry: CheckEntry = {}
  repositoryChecks.set(key, entry)
  entry.inFlight = inspectRepository(context, repo.trim(), force).then(async (snapshot): Promise<RepositoryCheckSnapshot> => {
    const currentContext = await getCheckContext(context.platform)
    if (currentContext.key !== context.key) {
      if (repositoryChecks.get(key) === entry) repositoryChecks.delete(key)
      return { result: 'error' }
    }
    entry.snapshot = snapshot
    entry.inFlight = undefined
    if (repositoryChecks.get(key) === entry) notifyRepositoryChecks()
    return snapshot
  }).catch(error => {
    console.error(`Failed to cache ${context.platform} repository check:`, error)
    const snapshot: RepositoryCheckSnapshot = { result: 'error' }
    entry.snapshot = snapshot
    entry.inFlight = undefined
    if (repositoryChecks.get(key) === entry) notifyRepositoryChecks()
    return snapshot
  })
  return entry.inFlight
}

/** Start each configured workspace repository once per application session. */
export function warmupRepositoryChecks(): Promise<void> {
  if (warmupPromise) return warmupPromise

  let markScheduled: (() => void) | undefined
  warmupScheduled = new Promise<void>(resolve => { markScheduled = resolve })
  warmupPromise = (async () => {
    try {
      const store = await Store.load('store.json')
      const [workspacePath, workspaceHistory, contexts] = await Promise.all([
        store.get<string>('workspacePath'),
        store.get<string[]>('workspaceHistory'),
        Promise.all(SYNC_REPO_PLATFORMS.map(getCheckContext)),
      ])
      const paths = Array.from(new Set(['', workspacePath || '', ...(workspaceHistory || [])]))
      const repositories = await Promise.all(paths.map(async path => ({ path, repos: await getWorkspaceSyncRepos(path) })))
      const checks: Promise<RepositoryCheckSnapshot>[] = []
      contexts.filter(context => context.token).forEach(context => {
        repositories.forEach(({ path, repos }) => {
          const repo = repos[context.platform]?.trim() || (path ? '' : RepoNames.sync)
          if (repo) checks.push(requestRepositoryCheck(context, repo))
        })
      })
      markScheduled?.()
      await Promise.all(checks)
    } catch (error) {
      console.error('Failed to initialize repository checks:', error)
    } finally {
      markScheduled?.()
    }
  })()
  return warmupPromise
}

export async function getCachedRepositoryCheckSnapshot(
  platform: SyncRepoPlatform,
  repo: string,
): Promise<RepositoryCheckSnapshot | undefined> {
  void warmupRepositoryChecks()
  await warmupScheduled
  const context = await getCheckContext(platform)
  const entry = repositoryChecks.get(getRepositoryKey(context, repo))
  return entry?.inFlight || entry?.snapshot
}

export async function getCachedRepositoryCheck(platform: SyncRepoPlatform, repo: string): Promise<RepositoryCheckResult | undefined> {
  return (await getCachedRepositoryCheckSnapshot(platform, repo))?.result
}

export async function checkRepository(
  platform: SyncRepoPlatform,
  repo: string,
  options: { force?: boolean } = {},
): Promise<RepositoryCheckResult> {
  const context = await getCheckContext(platform)
  return (await requestRepositoryCheck(context, repo, options.force)).result
}

async function applySnapshot(
  platform: SyncRepoPlatform,
  snapshot: RepositoryCheckSnapshot | undefined,
  target: GitProviderTarget,
) {
  const [{ default: useSyncStore }, { default: useSettingStore }] = await Promise.all([
    import('@/stores/sync'),
    import('@/stores/setting'),
  ])
  const currentTarget = getSettingsProviderTarget(platform, useSettingStore.getState())
  if (getProviderTargetKey(currentTarget) !== getProviderTargetKey(target)) return
  const state = snapshot?.result === 'success' ? SyncStateEnum.success : SyncStateEnum.fail
  const providerChecks = { ...useSyncStore.getState().providerChecks, [platform]: 'settled' as const }
  switch (platform) {
    case 'github':
      useSyncStore.setState({ userInfo: snapshot?.github?.userInfo, syncRepoInfo: snapshot?.github?.repoInfo, syncRepoState: state, providerChecks })
      if (snapshot?.github?.userInfo) useSettingStore.setState({ githubUsername: snapshot.github.userInfo.login })
      break
    case 'gitee':
      useSyncStore.setState({ giteeUserInfo: snapshot?.gitee?.userInfo, giteeSyncRepoInfo: snapshot?.gitee?.repoInfo, giteeSyncRepoState: state, providerChecks })
      break
    case 'gitlab':
      useSyncStore.setState({ gitlabUserInfo: snapshot?.gitlab?.userInfo, gitlabSyncProjectInfo: snapshot?.gitlab?.repoInfo, gitlabSyncProjectState: state, providerChecks })
      if (snapshot?.gitlab?.userInfo) useSettingStore.setState({ gitlabUsername: snapshot.gitlab.userInfo.username })
      break
    case 'gitea':
      useSyncStore.setState({ giteaUserInfo: snapshot?.gitea?.userInfo, giteaSyncRepoInfo: snapshot?.gitea?.repoInfo, giteaSyncRepoState: state, providerChecks })
      if (snapshot?.gitea?.userInfo) useSettingStore.setState({ giteaUsername: snapshot.gitea.userInfo.login })
      break
  }
}

/** Restore the active workspace from the session cache; force is reserved for an explicit check. */
export async function restoreGitSyncProviderStatus(platform: SyncRepoPlatform, options: { force?: boolean; check?: boolean } = {}): Promise<void> {
  const [{ default: useSettingStore }, { default: useSyncStore }] = await Promise.all([
    import('@/stores/setting'),
    import('@/stores/sync'),
  ])
  const target = getSettingsProviderTarget(platform, useSettingStore.getState())
  const targetKey = getProviderTargetKey(target)
  if (activeProviderTargets.get(platform) !== targetKey || !useSyncStore.getState().providerChecks[platform] || options.force || options.check) {
    activeProviderTargets.set(platform, targetKey)
    useSyncStore.getState().setProviderChecking(platform)
  }
  const isCurrent = () => activeProviderTargets.get(platform) === targetKey
    && getProviderTargetKey(getSettingsProviderTarget(platform, useSettingStore.getState())) === targetKey
  try {
    const [repo, context] = await Promise.all([getOptionalSyncRepoName(platform), getCheckContext(platform)])
    if (!isCurrent() || repo !== target.repo || context.key !== target.context.key) return
    const snapshot = repo
      ? options.force || options.check
        ? await requestRepositoryCheck(context, repo, options.force)
        : await getCachedRepositoryCheckSnapshot(platform, repo)
      : await checkAccount(context)
    if (!isCurrent()) return
    const [currentRepo, currentContext] = await Promise.all([getOptionalSyncRepoName(platform), getCheckContext(platform)])
    if (!isCurrent() || currentRepo !== repo || currentContext.key !== context.key) return
    await applySnapshot(platform, repo ? snapshot : snapshot && { ...snapshot, result: 'not-found' }, target)
  } catch (error) {
    if (isCurrent()) await applySnapshot(platform, { result: 'error' }, target)
    throw error
  }
}

export async function refreshGitSyncProviderStatus(platform: SyncRepoPlatform): Promise<void> {
  await restoreGitSyncProviderStatus(platform, { force: true })
}

export async function createRepository(platform: SyncRepoPlatform, repo: string): Promise<RepositoryCreateResult> {
  const context = await getCheckContext(platform)
  if (!context.token) return 'missing-token'
  const account = await checkAccount(context)

  try {
    let snapshot: RepositoryCheckSnapshot
    switch (platform) {
      case 'github': {
        const { createSyncRepo } = await import('./github')
        const repoInfo = await createSyncRepo(repo, true) as GithubRepoInfo | undefined | false
        if (!repoInfo) return 'create-error'
        snapshot = { ...account, result: 'success', github: { ...account.github, repoInfo } }
        break
      }
      case 'gitee': {
        const { createSyncRepo } = await import('./gitee')
        const repoInfo = await createSyncRepo(repo, true)
        if (!repoInfo) return 'create-error'
        snapshot = { ...account, result: 'success', gitee: { ...account.gitee, repoInfo } }
        break
      }
      case 'gitlab': {
        const { createSyncProject } = await import('./gitlab')
        const repoInfo = await createSyncProject(repo, true)
        if (!repoInfo) return 'create-error'
        snapshot = { ...account, result: 'success', gitlab: { ...account.gitlab, repoInfo } }
        break
      }
      case 'gitea': {
        const { createSyncRepo } = await import('./gitea')
        const repoInfo = await createSyncRepo(repo, true)
        if (!repoInfo) return 'create-error'
        snapshot = { ...account, result: 'success', gitea: { ...account.gitea, repoInfo } }
        break
      }
    }
    if ((await getCheckContext(platform)).key === context.key) {
      repositoryChecks.set(getRepositoryKey(context, repo), { snapshot })
      notifyRepositoryChecks()
    }
    return 'created'
  } catch (error) {
    console.error(`Failed to create ${platform} repository:`, error)
    return 'create-error'
  }
}
export async function listRepositories(
  platform: SyncRepoPlatform,
): Promise<RepositoryListResult> {
  const store = await Store.load('store.json')
  const token = await store.get<string>(TOKEN_KEYS[platform])
  if (!token?.trim()) return { status: 'missing-token', repositories: [] }

  try {
    let repositories: string[] = []
    switch (platform) {
      case 'github': {
        const { listUserRepositories } = await import('./github')
        repositories = await listUserRepositories()
        break
      }
      case 'gitee': {
        const { listUserRepositories } = await import('./gitee')
        repositories = await listUserRepositories()
        break
      }
      case 'gitlab': {
        const { listUserRepositories } = await import('./gitlab')
        repositories = await listUserRepositories()
        break
      }
      case 'gitea': {
        const { listUserRepositories } = await import('./gitea')
        repositories = await listUserRepositories()
        break
      }
    }

    return {
      status: 'success',
      repositories: Array.from(new Set(repositories.map(repo => repo.trim()).filter(Boolean))),
    }
  } catch (error) {
    console.error(`Failed to list ${platform} repositories:`, error)
    return { status: 'error', repositories: [] }
  }
}
