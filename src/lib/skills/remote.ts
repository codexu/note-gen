import { invoke } from '@tauri-apps/api/core'
import { Store } from '@tauri-apps/plugin-store'
import { v4 as uuid } from 'uuid'
import { getWorkspacePath } from '@/lib/workspace'
import type { SkillScope } from './types'

export interface RemoteSkillSearchResult {
  name: string
  description: string
  repository: string
  path: string
  sourceUrl: string
  stars: number
  provider: string
  cached?: boolean
}

export interface RemoteSkillWarning {
  code: string
  actual: number
  recommended: number
  paths: string[]
}

export interface RemoteSkillPreview {
  previewId: string
  name: string
  description: string
  provider: string
  sourceUrl: string
  repository?: string
  revision: string
  skillPath?: string
  files: string[]
  totalBytes: number
  hasScripts: boolean
  skippedSymlinks: string[]
  warnings: RemoteSkillWarning[]
  archiveSha256: string
}

export interface RemoteSkillInstallResult {
  name: string
  scope: SkillScope
  provider: string
  sourceUrl: string
  revision: string
  archiveSha256: string
  replaced: boolean
  hasScripts: boolean
  skippedSymlinks: string[]
  warnings: RemoteSkillWarning[]
}

interface RemoteCredentials {
  githubToken?: string
  gitlabToken?: string
  giteeToken?: string
  proxyUrl?: string
}

interface RemoteSkillSearchCacheEntry {
  updatedAt: number
  results: RemoteSkillSearchResult[]
}

const REMOTE_SKILL_SEARCH_CACHE_KEY = 'remoteSkills.searchCache'
const REMOTE_SKILL_SEARCH_CACHE_LIMIT = 20

async function loadRemoteCredentials(): Promise<RemoteCredentials> {
  const store = await Store.load('store.json')
  const [githubToken, gitlabToken, giteeToken, proxyUrl] = await Promise.all([
    store.get<string>('accessToken'),
    store.get<string>('gitlabAccessToken'),
    store.get<string>('giteeAccessToken'),
    store.get<string>('proxy'),
  ])
  return {
    githubToken: githubToken?.trim() || undefined,
    gitlabToken: gitlabToken?.trim() || undefined,
    giteeToken: giteeToken?.trim() || undefined,
    proxyUrl: proxyUrl?.trim() || undefined,
  }
}

export async function searchRemoteSkills(
  query: string,
  limit = 8,
): Promise<RemoteSkillSearchResult[]> {
  const store = await Store.load('store.json')
  const credentials = await loadRemoteCredentials()
  const normalizedKey = `${query.trim().toLocaleLowerCase()}:${limit}`
  const cache = await store.get<Record<string, RemoteSkillSearchCacheEntry>>(
    REMOTE_SKILL_SEARCH_CACHE_KEY,
  ) ?? {}
  try {
    const results = await invoke<RemoteSkillSearchResult[]>('search_remote_skills', {
      request: {
        query,
        limit,
        githubToken: credentials.githubToken,
        proxyUrl: credentials.proxyUrl,
      },
    })
    cache[normalizedKey] = {
      updatedAt: Date.now(),
      results,
    }
    const compactCache = Object.fromEntries(
      Object.entries(cache)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, REMOTE_SKILL_SEARCH_CACHE_LIMIT),
    )
    await store.set(REMOTE_SKILL_SEARCH_CACHE_KEY, compactCache)
    await store.save()
    return results
  } catch (error) {
    const cached = cache[normalizedKey]
    if (cached?.results.length) {
      return cached.results.map(result => ({ ...result, cached: true }))
    }
    throw error
  }
}

export async function inspectRemoteSkill(
  source: string,
  signal?: AbortSignal,
): Promise<RemoteSkillPreview> {
  const requestId = uuid()
  const credentials = await loadRemoteCredentials()
  const cancel = () => {
    void cancelRemoteSkillDownload(requestId)
  }
  if (signal?.aborted) {
    cancel()
    throw new DOMException('Remote Skill inspection was cancelled', 'AbortError')
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await invoke<RemoteSkillPreview>('inspect_remote_skill', {
      request: {
        source,
        requestId,
        ...credentials,
      },
    })
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export async function installRemoteSkill(input: {
  previewId: string
  scope: SkillScope
  replaceExisting?: boolean
}): Promise<RemoteSkillInstallResult> {
  const workspace = input.scope === 'project' ? await getWorkspacePath() : null
  return await invoke<RemoteSkillInstallResult>('install_remote_skill', {
    request: {
      previewId: input.previewId,
      scope: input.scope,
      workspaceRoot: workspace?.isCustom ? workspace.path : null,
      replaceExisting: input.replaceExisting === true,
    },
  })
}

export async function cancelRemoteSkillDownload(requestId: string): Promise<void> {
  await invoke('cancel_remote_skill_download', { requestId })
}
