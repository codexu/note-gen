import { Store } from '@tauri-apps/plugin-store'

import type { SyncRepoPlatform } from './workspace-repos'

export type RepositoryCheckResult = 'success' | 'not-found' | 'missing-token' | 'error'
export type RepositoryCreateResult = 'created' | 'missing-token' | 'create-error'
export type RepositoryListResult = {
  status: 'success' | 'missing-token' | 'error'
  repositories: string[]
}

const TOKEN_KEYS: Record<SyncRepoPlatform, string> = {
  github: 'accessToken',
  gitee: 'giteeAccessToken',
  gitlab: 'gitlabAccessToken',
  gitea: 'giteaAccessToken',
}

export async function checkRepository(
  platform: SyncRepoPlatform,
  repo: string,
): Promise<RepositoryCheckResult> {
  const store = await Store.load('store.json')
  const token = await store.get<string>(TOKEN_KEYS[platform])
  if (!token?.trim()) return 'missing-token'

  try {
    switch (platform) {
      case 'github': {
        const { checkSyncRepoState, getUserInfo } = await import('./github')
        if (!await getUserInfo()) return 'error'
        return await checkSyncRepoState(repo) ? 'success' : 'not-found'
      }
      case 'gitee': {
        const { checkSyncRepoState, getUserInfo } = await import('./gitee')
        await getUserInfo()
        return await checkSyncRepoState(repo) ? 'success' : 'not-found'
      }
      case 'gitlab': {
        const { checkSyncProjectState, getUserInfo } = await import('./gitlab')
        await getUserInfo()
        return await checkSyncProjectState(repo) ? 'success' : 'not-found'
      }
      case 'gitea': {
        const { checkSyncRepoState, getUserInfo } = await import('./gitea')
        await getUserInfo()
        return await checkSyncRepoState(repo) ? 'success' : 'not-found'
      }
    }
  } catch (error) {
    console.error(`Failed to check ${platform} repository:`, error)
    return 'error'
  }

  return 'error'
}

export async function createRepository(
  platform: SyncRepoPlatform,
  repo: string,
): Promise<RepositoryCreateResult> {
  const store = await Store.load('store.json')
  const token = await store.get<string>(TOKEN_KEYS[platform])
  if (!token?.trim()) return 'missing-token'

  try {
    switch (platform) {
      case 'github': {
        const { createSyncRepo } = await import('./github')
        return await createSyncRepo(repo, true) ? 'created' : 'create-error'
      }
      case 'gitee': {
        const { createSyncRepo } = await import('./gitee')
        return await createSyncRepo(repo, true) ? 'created' : 'create-error'
      }
      case 'gitlab': {
        const { createSyncProject } = await import('./gitlab')
        return await createSyncProject(repo, true) ? 'created' : 'create-error'
      }
      case 'gitea': {
        const { createSyncRepo } = await import('./gitea')
        return await createSyncRepo(repo, true) ? 'created' : 'create-error'
      }
    }
  } catch (error) {
    console.error(`Failed to create ${platform} repository:`, error)
    return 'create-error'
  }

  return 'create-error'
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
