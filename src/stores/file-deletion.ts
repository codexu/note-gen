import { create } from 'zustand'
import useSettingStore from './setting'

interface FileDeletionProgress {
  completed: number
  total: number
  hasRemote: boolean
}

interface FileDeletionState {
  pendingPaths: string[]
  workspacePath: string
  workspaceRoot: string
  progress: FileDeletionProgress | null
  begin: (paths: string[], workspacePath: string, hasRemote: boolean, workspaceRoot?: string) => boolean
  advance: () => void
  finish: () => void
}

function normalizePath(path: string): string {
  const normalized = path.normalize('NFC').replace(/\\/g, '/').replace(/^\.\//, '')
  return normalized === '/' || /^[a-zA-Z]:\/$/.test(normalized)
    ? normalized
    : normalized.replace(/\/+$/, '')
}

function normalizeWorkspace(path: string): string {
  const normalized = normalizePath(path)
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized
}

function relativePath(path: string, workspaceRoot: string): string | null {
  const normalizedRoot = normalizePath(workspaceRoot)
  const windowsWorkspace = /^[a-zA-Z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//')
  const normalizedPath = windowsWorkspace ? normalizePath(path).toLowerCase() : normalizePath(path)
  if (!normalizedPath.startsWith('/') && !/^[a-zA-Z]:\//.test(normalizedPath)) return normalizedPath
  const comparableRoot = windowsWorkspace ? normalizedRoot.toLowerCase() : normalizedRoot
  const prefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`
  return comparableRoot && normalizedPath.startsWith(prefix)
    ? normalizedPath.slice(prefix.length)
    : null
}

function isSameOrDescendant(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`)
}

const deletionRevisions = new Map<string, { workspaceRoot: string; paths: Map<string, number> }>()
let nextDeletionRevision = 0

const useFileDeletionStore = create<FileDeletionState>((set, get) => ({
  pendingPaths: [],
  workspacePath: '',
  workspaceRoot: '',
  progress: null,
  begin: (paths, workspacePath, hasRemote, workspaceRoot = workspacePath) => {
    if (get().progress) return false
    const pendingPaths = [...new Set(paths.map(path => relativePath(path, workspaceRoot))
      .filter((path): path is string => Boolean(path)))]
    if (pendingPaths.length === 0) return false
    const workspaceKey = normalizeWorkspace(workspacePath)
    const revisions = deletionRevisions.get(workspaceKey)?.paths ?? new Map<string, number>()
    for (const path of pendingPaths) revisions.set(path, ++nextDeletionRevision)
    deletionRevisions.set(workspaceKey, { workspaceRoot, paths: revisions })
    set({
      pendingPaths,
      workspacePath,
      workspaceRoot,
      progress: { completed: 0, total: pendingPaths.length, hasRemote },
    })
    return true
  },
  advance: () => set(state => ({
    progress: state.progress ? {
      ...state.progress,
      completed: Math.min(state.progress.completed + 1, state.progress.total),
    } : null,
  })),
  finish: () => set({ pendingPaths: [], workspacePath: '', workspaceRoot: '', progress: null }),
}))

export function isFileDeletionPending(
  path: string,
  workspacePath = useSettingStore.getState().workspacePath || '',
): boolean {
  const state = useFileDeletionStore.getState()
  if (!state.progress || normalizeWorkspace(workspacePath) !== normalizeWorkspace(state.workspacePath)) {
    return false
  }
  const normalizedPath = relativePath(path, state.workspaceRoot)
  return normalizedPath !== null && state.pendingPaths.some(root => isSameOrDescendant(normalizedPath, root))
}

export function getFileDeletionRevision(
  path: string,
  workspacePath = useSettingStore.getState().workspacePath || '',
): number {
  const revisions = deletionRevisions.get(normalizeWorkspace(workspacePath))
  if (!revisions) return 0
  const normalizedPath = relativePath(path, revisions.workspaceRoot)
  if (normalizedPath === null) return 0
  let revision = 0
  for (const [root, value] of revisions.paths) {
    if (isSameOrDescendant(normalizedPath, root)) revision = Math.max(revision, value)
  }
  return revision
}

export default useFileDeletionStore
