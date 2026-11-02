import { create } from 'zustand'
import type { WikiContext } from '@/types/wiki'

export interface WikiActivity {
  contextId: string
  workspaceKey: string
  jobId: string
  token: string
  /** Workspace-relative paths of the original articles used by this task. */
  articlePaths: string[]
}

interface WikiActivityState {
  active: WikiActivity | null
}

/** Runtime-only execution state. Persisted jobs can outlive a crashed worker. */
export const useWikiActivityStore = create<WikiActivityState>(() => ({ active: null }))

function normalizeArticlePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap(value => {
    const path = value.replace(/\\/g, '/')
    if (path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')) return []
    const parts = path.split('/').filter(part => part && part !== '.')
    if (!parts.length || parts.includes('..')) return []
    return [parts.join('/')]
  }))].sort()
}

export function beginWikiActivity(context: WikiContext, jobId: string, articlePaths: readonly string[] = []): string {
  const token = crypto.randomUUID()
  useWikiActivityStore.setState({ active: {
    contextId: context.id, workspaceKey: context.workspaceKey, jobId, token,
    articlePaths: normalizeArticlePaths(articlePaths),
  } })
  return token
}

/** Dependency discovery from an older task must not update a newer task. */
export function updateWikiActivityPaths(token: string, paths: readonly string[]): void {
  useWikiActivityStore.setState(state => {
    const active = state.active
    if (!active || active.token !== token) return state
    const articlePaths = normalizeArticlePaths(paths)
    if (articlePaths.length === active.articlePaths.length
      && articlePaths.every((path, index) => path === active.articlePaths[index])) return state
    return { active: { ...active, articlePaths } }
  })
}

/** A finished older task must not clear a newer task's indicator. */
export function endWikiActivity(token?: string): void {
  useWikiActivityStore.setState(state => {
    if (!state.active || (token !== undefined && state.active.token !== token)) return state
    return { active: null }
  })
}

export default useWikiActivityStore
