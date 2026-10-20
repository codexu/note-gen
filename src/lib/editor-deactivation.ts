import emitter from '@/lib/emitter'
import { getDefaultArticleAbsolutePath, getWorkspacePath } from '@/lib/workspace'

type ActiveEditorDurableSaveFlusher = (path: string) => Promise<void>
type EditorPathMutationFlusher = (
  changedPaths: string[],
  workspaceRoot?: string,
) => Promise<void>
export type EditorPathWriteTransactionContext = {
  hasQueuedSave: () => boolean
}
type EditorPathWriteTransactionRunner = (
  path: string,
  transaction: (context: EditorPathWriteTransactionContext) => Promise<boolean>,
  workspaceRoot?: string,
) => Promise<boolean>

let activeEditorDurableSaveFlusher: ActiveEditorDurableSaveFlusher | null = null
let editorPathMutationFlusher: EditorPathMutationFlusher | null = null
let editorPathWriteTransactionRunner: EditorPathWriteTransactionRunner | null = null
const editorPathMutationRevisions = new Map<string, number>()
const editorPathMutationLocks = new Set<{ paths: readonly string[]; workspaceRoot: string }>()

type NormalizedEditorPath = {
  kind: 'absolute' | 'relative' | 'opaque'
  value: string
  windows: boolean
}

type ComparableEditorPath = {
  namespace: 'absolute' | 'relative' | 'opaque'
  value: string
  caseInsensitive: boolean
}

function normalizePathSegments(
  value: string,
  kind: 'absolute' | 'relative',
  windows: boolean,
): string {
  const isUnc = windows && value.startsWith('//')
  const isDriveAbsolute = windows && /^[a-zA-Z]:\//.test(value)
  const prefix = isUnc ? '//' : isDriveAbsolute ? value.slice(0, 3) : kind === 'absolute' ? '/' : ''
  const source = isUnc
    ? value.slice(2)
    : isDriveAbsolute
      ? value.slice(3)
      : kind === 'absolute'
        ? value.slice(1)
        : value
  const segments: string[] = []
  const protectedSegments = isUnc ? 2 : 0

  for (const segment of source.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > protectedSegments && segments.at(-1) !== '..') {
        segments.pop()
      } else if (kind === 'relative') {
        segments.push(segment)
      }
      continue
    }
    segments.push(segment)
  }

  const normalized = `${prefix}${segments.join('/')}`
  return normalized || (kind === 'absolute' ? prefix : '')
}

function normalizeEditorPath(path: string): NormalizedEditorPath | null {
  const trimmed = path.normalize('NFC').trim()
  if (!trimmed) return null

  // File helpers must not reinterpret record:// and canvas:// tab identifiers
  // as filesystem paths. They can still be compared exactly.
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
    return { kind: 'opaque', value: trimmed, windows: false }
  }

  const hadWindowsSeparators = trimmed.includes('\\')
  let value = trimmed.replace(/\\/g, '/')
  const isUnc = value.startsWith('//')
  value = isUnc
    ? `//${value.slice(2).replace(/\/{2,}/g, '/')}`
    : value.replace(/\/{2,}/g, '/')

  const windows = isUnc || /^[a-zA-Z]:\//.test(value) || hadWindowsSeparators
  const kind = value.startsWith('/') || /^[a-zA-Z]:\//.test(value)
    ? 'absolute'
    : 'relative'
  value = normalizePathSegments(value, kind, windows)
  if (!value) return null

  return {
    kind,
    value: windows ? value.toLowerCase() : value,
    windows,
  }
}

function getComparableEditorPath(
  path: string,
  workspaceRoot?: string,
): ComparableEditorPath | null {
  const normalizedPath = normalizeEditorPath(path)
  if (!normalizedPath) return null
  if (normalizedPath.kind === 'opaque') {
    return {
      namespace: 'opaque',
      value: normalizedPath.value,
      caseInsensitive: false,
    }
  }

  const normalizedRoot = workspaceRoot ? normalizeEditorPath(workspaceRoot) : null
  const hasAbsoluteRoot = normalizedRoot?.kind === 'absolute'
  const useWindowsCaseFold = Boolean(hasAbsoluteRoot && normalizedRoot.windows)

  if (normalizedPath.kind === 'relative') {
    return {
      namespace: 'relative',
      value: useWindowsCaseFold ? normalizedPath.value.toLowerCase() : normalizedPath.value,
      caseInsensitive: useWindowsCaseFold || normalizedPath.windows,
    }
  }

  if (
    hasAbsoluteRoot
    && normalizedRoot.kind === 'absolute'
    && normalizedPath.windows === normalizedRoot.windows
  ) {
    const rootValue = normalizedRoot.value
    const rootPrefix = rootValue.endsWith('/') ? rootValue : `${rootValue}/`
    if (normalizedPath.value === rootValue) {
      return {
        namespace: 'relative',
        value: '',
        caseInsensitive: useWindowsCaseFold,
      }
    }
    if (normalizedPath.value.startsWith(rootPrefix)) {
      const relativeValue = normalizedPath.value.slice(rootPrefix.length)
      return {
        namespace: 'relative',
        value: useWindowsCaseFold ? relativeValue.toLowerCase() : relativeValue,
        caseInsensitive: useWindowsCaseFold,
      }
    }
  }

  return {
    namespace: 'absolute',
    value: normalizedPath.value,
    caseInsensitive: normalizedPath.windows,
  }
}

function getEditorPathRevisionKey(path: string): string {
  return normalizeEditorPath(path)?.value ?? ''
}

export function editorPathsReferToSameFile(
  left: string,
  right: string,
  workspaceRoot?: string,
): boolean {
  const normalizedLeft = getComparableEditorPath(left, workspaceRoot)
  const normalizedRight = getComparableEditorPath(right, workspaceRoot)
  const caseInsensitive = Boolean(
    normalizedLeft?.caseInsensitive || normalizedRight?.caseInsensitive
  )
  return Boolean(
    normalizedLeft
    && normalizedRight
    && normalizedLeft.namespace === normalizedRight.namespace
    && (
      caseInsensitive
        ? normalizedLeft.value.toLowerCase() === normalizedRight.value.toLowerCase()
        : normalizedLeft.value === normalizedRight.value
    )
  )
}

export function workspaceRootsReferToSameLocation(left: string, right: string): boolean {
  const normalizedLeft = normalizeEditorPath(left)
  const normalizedRight = normalizeEditorPath(right)
  return Boolean(
    normalizedLeft?.kind === 'absolute'
    && normalizedRight?.kind === 'absolute'
    && editorPathsReferToSameFile(left, right)
  )
}

export function isEditorPathMutationLocked(path: string, workspaceRoot?: string): boolean {
  return [...editorPathMutationLocks].some(lock => (
    (!workspaceRoot || workspaceRootsReferToSameLocation(workspaceRoot.toLowerCase(), lock.workspaceRoot.toLowerCase()))
    && lock.paths.some(lockedPath => editorPathsCouldReferToSameFile(path, lockedPath, lock.workspaceRoot))
  ))
}

/** A conservative alias check for mutations on case-insensitive filesystems. */
export function editorPathsCouldReferToSameFile(left: string, right: string, workspaceRoot?: string): boolean {
  return editorPathsReferToSameFile(left, right, workspaceRoot)
    || editorPathsReferToSameFile(left.toLowerCase(), right.toLowerCase(), workspaceRoot?.toLowerCase())
}

/** Prevent a closed file from being opened while its plugin disk mutation is in progress. */
export function lockEditorPathsForMutation(paths: readonly string[], workspaceRoot: string): (() => void) | null {
  if (paths.some(path => isEditorPathMutationLocked(path, workspaceRoot))) return null
  const lock = { paths: [...paths], workspaceRoot }
  editorPathMutationLocks.add(lock)
  return () => { editorPathMutationLocks.delete(lock) }
}

export async function getCurrentEditorWorkspaceRoot(): Promise<string> {
  const workspace = await getWorkspacePath()
  return workspace.isCustom
    ? workspace.path
    : await getDefaultArticleAbsolutePath('')
}

export function editorPathIsSameOrDescendant(
  path: string,
  parentPath: string,
  workspaceRoot?: string,
): boolean {
  const normalizedPath = getComparableEditorPath(path, workspaceRoot)
  const normalizedParent = getComparableEditorPath(parentPath, workspaceRoot)
  if (
    !normalizedPath
    || !normalizedParent
    || normalizedPath.namespace !== normalizedParent.namespace
  ) {
    return false
  }
  const caseInsensitive = normalizedPath.caseInsensitive || normalizedParent.caseInsensitive
  const pathValue = caseInsensitive ? normalizedPath.value.toLowerCase() : normalizedPath.value
  const parentValue = caseInsensitive
    ? normalizedParent.value.toLowerCase()
    : normalizedParent.value
  if (pathValue === parentValue) return true
  if (!parentValue) return normalizedPath.namespace === 'relative'
  return pathValue.startsWith(`${parentValue}/`)
}

export function markEditorPathMutation(path: string, workspaceRoot?: string): void {
  const key = getEditorPathRevisionKey(path)
  if (!key) return
  const matchingKeys = [...editorPathMutationRevisions.keys()].filter(candidate => (
    editorPathsReferToSameFile(candidate, key, workspaceRoot)
  ))
  const nextRevision = Math.max(
    0,
    ...matchingKeys.map(candidate => editorPathMutationRevisions.get(candidate) ?? 0),
  ) + 1
  editorPathMutationRevisions.set(key, nextRevision)
  for (const matchingKey of matchingKeys) {
    editorPathMutationRevisions.set(matchingKey, nextRevision)
  }
}

export function getEditorPathMutationRevision(path: string, workspaceRoot?: string): number {
  const key = getEditorPathRevisionKey(path)
  if (!key) return 0
  return Math.max(
    editorPathMutationRevisions.get(key) ?? 0,
    ...[...editorPathMutationRevisions.entries()]
      .filter(([candidate]) => editorPathsReferToSameFile(candidate, key, workspaceRoot))
      .map(([, revision]) => revision),
  )
}

export function registerActiveEditorDurableSaveFlusher(
  flusher: ActiveEditorDurableSaveFlusher,
): void {
  activeEditorDurableSaveFlusher = flusher
}

export function registerEditorPathMutationFlusher(
  flusher: EditorPathMutationFlusher,
): void {
  editorPathMutationFlusher = flusher
}

export function registerEditorPathWriteTransactionRunner(
  runner: EditorPathWriteTransactionRunner,
): void {
  editorPathWriteTransactionRunner = runner
}

export async function runEditorPathWriteTransaction(
  path: string,
  transaction: (context: EditorPathWriteTransactionContext) => Promise<boolean>,
  workspaceRoot?: string,
): Promise<boolean> {
  if (!editorPathWriteTransactionRunner) {
    throw new Error('The article path write transaction runner is not registered')
  }
  return editorPathWriteTransactionRunner(path, transaction, workspaceRoot)
}

/**
 * Gives the active editor a synchronous chance to flush stable content or
 * reject an action that would unmount it while an asynchronous edit is active.
 */
export function prepareActiveEditorDeactivation(): boolean {
  let canDeactivate = true
  emitter.emit('editor-prepare-deactivate', {
    resolve: (nextValue) => {
      canDeactivate = canDeactivate && nextValue
    },
  })
  return canDeactivate
}

export function activeEditorPathIsAffected(
  activeFilePath: string,
  changedPath: string,
  workspaceRoot?: string,
): boolean {
  return editorPathIsSameOrDescendant(activeFilePath, changedPath, workspaceRoot)
}

export function prepareActiveEditorPathMutation(
  activeFilePath: string,
  changedPaths: string[],
  workspaceRoot?: string,
): boolean {
  if (!changedPaths.some(path => (
    activeEditorPathIsAffected(activeFilePath, path, workspaceRoot)
  ))) {
    return true
  }
  return prepareActiveEditorDeactivation()
}

async function flushActiveEditorSave(path: string): Promise<boolean> {
  if (!path || !activeEditorDurableSaveFlusher) return true

  try {
    await activeEditorDurableSaveFlusher(path)
    return true
  } catch (error) {
    console.error('Failed to durably flush the active editor before changing files:', error)
    return false
  }
}

export async function prepareActiveEditorDeactivationDurably(
  activeFilePath: string,
): Promise<boolean> {
  if (!prepareActiveEditorDeactivation()) return false
  return flushActiveEditorSave(activeFilePath)
}

export async function prepareActiveEditorPathMutationDurably(
  activeFilePath: string,
  changedPaths: string[],
  workspaceRoot?: string,
): Promise<boolean> {
  const activeEditorIsAffected = changedPaths.some(
    path => activeEditorPathIsAffected(activeFilePath, path, workspaceRoot)
  )
  if (
    activeEditorIsAffected
    && !await prepareActiveEditorDeactivationDurably(activeFilePath)
  ) {
    return false
  }

  if (!editorPathMutationFlusher) return true
  try {
    await editorPathMutationFlusher(changedPaths, workspaceRoot)
    return true
  } catch (error) {
    console.error('Failed to durably flush pending saves before mutating file paths:', error)
    return false
  }
}
