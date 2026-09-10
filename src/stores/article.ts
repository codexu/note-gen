import { getFiles as getGithubFiles } from '@/lib/sync/github'
import { GithubContent } from '@/lib/sync/github.types'
import { getFiles as getGiteeFiles } from '@/lib/sync/gitee'
import { getFiles as getGiteaFiles } from '@/lib/sync/gitea'
import { getFiles as getGitlabFiles } from '@/lib/sync/gitlab'
import { GiteeFile } from '@/lib/sync/gitee'
import { GiteaDirectoryItem } from '@/lib/sync/gitea.types'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { s3ListObjects } from '@/lib/sync/s3'
import { webdavListObjects } from '@/lib/sync/webdav'
import { androidCloudFolderWorkspaceList, supportsCloudFolderWorkspace, type CloudFolderObject } from '@/lib/sync/cloud-folder'
import { CloudFolderConfig, S3Config, WebDAVConfig } from '@/types/sync'
import { hasNetworkConnection, ensureDirectoryExists, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { isSyncConfigured, syncOnOpen } from '@/lib/sync/sync-manager'
import { sanitizeFilePath, hasInvalidFileNameChars } from '@/lib/sync/filename-utils'
import { getCurrentFolder, computedParentPath } from '@/lib/path'
import useVectorStore from './vector'
import { join, appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, DirEntry, exists, mkdir, readDir, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep, uniq } from 'lodash-es'
import { create } from 'zustand'
import {
  getFilePathOptions,
  getWorkspacePath,
  isAbsoluteFsPath,
  toWorkspaceRelativePath,
} from '@/lib/workspace'
import emitter from '@/lib/emitter'
import type { Events } from '@/lib/emitter'
import { isSkillsFolder } from '@/lib/skills/utils'
import { buildVectorIndexedMap, getVectorDocumentKey } from '@/lib/vector-document-key'
import { buildRemotePathsToLoad } from './article-remote-sync'
import { debugSyncPath } from '@/lib/sync/remote-file'
import type { Mark } from '@/db/marks'
import { getRecordTabName } from '@/app/core/main/mark/mark-record-tab'
import { getCurrentSyncContext } from '@/lib/sync/sync-context'
import {
  getCloudFolderTreeCacheTargetKey,
  readCloudFolderTreeCache,
  writeCloudFolderTreeCache,
} from '@/lib/sync/cloud-folder-tree-cache'
import {
  editorPathsReferToSameFile,
  editorPathsCouldReferToSameFile,
  editorPathIsSameOrDescendant,
  getCurrentEditorWorkspaceRoot,
  getEditorPathMutationRevision,
  isEditorPathMutationLocked,
  prepareActiveEditorDeactivation,
  prepareActiveEditorDeactivationDurably,
  registerActiveEditorDurableSaveFlusher,
  registerEditorPathMutationFlusher,
  registerEditorPathWriteTransactionRunner,
  workspaceRootsReferToSameLocation,
  type EditorPathWriteTransactionContext,
} from '@/lib/editor-deactivation'
import { writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'
import type { EditorWorkspaceLayout } from '@/app/core/main/editor/editor-group-layout'

type SyncPushCompletedEvent = Events['sync-push-completed']
type SyncPushCompletedListener = (event: SyncPushCompletedEvent) => void

type ArticleSyncListenerGlobal = typeof globalThis & {
  __noteGenArticleSyncPushCompletedListener?: SyncPushCompletedListener
}

// 缓存 Store 实例，避免每次都重新加载
let storeInstance: Store | null = null
type PendingArticleSave = {
  timer: ReturnType<typeof setTimeout> | null
  content: string
  commit: () => Promise<void>
}

const pendingArticleSaves = new Map<string, PendingArticleSave>()
const inFlightArticleSaves = new Map<string, Promise<void>>()
let vectorCalculationTimer: ReturnType<typeof setTimeout> | null = null
let pendingVectorCalculation: { path: string; content: string } | null = null
let inFlightVectorCalculation: { path: string; promise: Promise<void> } | null = null
let fileTabOpenRequestSequence = 0
let fileActivationIntentSequence = 0
const EDITOR_WORKSPACE_LAYOUT_STORE_KEY = 'editorWorkspaceLayout:main'
let persistedEditorNavigationQueue: Promise<void> = Promise.resolve()

export function beginDeferredFileActivation() {
  return ++fileActivationIntentSequence
}

export function isDeferredFileActivationCurrent(intentId: number) {
  return intentId === fileActivationIntentSequence
}

function pathIsSameOrDescendant(
  path: string,
  parentPath: string,
  workspaceRoot?: string,
): boolean {
  return editorPathIsSameOrDescendant(path, parentPath, workspaceRoot)
}

function pathMatchesMutation(
  path: string,
  changedPath: string,
  workspaceRoot: string | undefined,
  includeDescendants: boolean,
): boolean {
  return includeDescendants
    ? pathIsSameOrDescendant(path, changedPath, workspaceRoot)
    : editorPathsReferToSameFile(path, changedPath, workspaceRoot)
}

function discardQueuedArticleSaves(
  path: string,
  workspaceRoot?: string,
  includeDescendants = true,
): void {
  for (const [savePath, pendingSave] of pendingArticleSaves) {
    if (!pathMatchesMutation(savePath, path, workspaceRoot, includeDescendants)) continue
    if (pendingSave.timer) clearTimeout(pendingSave.timer)
    pendingArticleSaves.delete(savePath)
  }
}

function discardPendingVectorCalculation(
  path: string,
  workspaceRoot?: string,
  includeDescendants = true,
): void {
  if (
    !pendingVectorCalculation
    || !pathMatchesMutation(
      pendingVectorCalculation.path,
      path,
      workspaceRoot,
      includeDescendants,
    )
  ) {
    return
  }
  if (vectorCalculationTimer) clearTimeout(vectorCalculationTimer)
  vectorCalculationTimer = null
  pendingVectorCalculation = null
}

let vectorIndexedFilesInitPromise: Promise<void> | null = null
const remoteFolderLoadPromises = new Map<string, Promise<void>>()
const REMOTE_FOLDER_TIMEOUT_MS = 20_000
const cloudFolderRemoteLoadPromises = new Map<string, Promise<CloudFolderObject[]>>()
let fileTreeWorkspaceKey: string | null = null
let fileTreeLoadGeneration = 0
let articleReadGeneration = 0
const pendingArticleReads = new Map<string, {
  generation: number
  promise: Promise<void>
}>()
let editorWorkspaceTransitionGeneration = 0
let editorWorkspaceTransitionInProgress = false

export async function beginEditorWorkspaceTransition(): Promise<void> {
  editorWorkspaceTransitionInProgress = true
  editorWorkspaceTransitionGeneration += 1
  beginDeferredFileActivation()
  articleReadGeneration += 1
  const reads = [...pendingArticleReads.values()].map(entry => entry.promise)
  pendingArticleReads.clear()
  await Promise.allSettled(reads)
}

export function finishEditorWorkspaceTransition(): void {
  editorWorkspaceTransitionGeneration += 1
  editorWorkspaceTransitionInProgress = false
}

function runArticleReadOnce(
  path: string,
  read: (generation: number) => Promise<void>
): Promise<void> {
  const pendingRead = pendingArticleReads.get(path)
  if (pendingRead?.generation === articleReadGeneration) {
    return pendingRead.promise
  }

  const generation = ++articleReadGeneration
  const readPromise = read(generation)
  pendingArticleReads.set(path, { generation, promise: readPromise })
  const clearPendingRead = () => {
    if (pendingArticleReads.get(path)?.promise === readPromise) {
      pendingArticleReads.delete(path)
    }
  }
  void readPromise.then(clearPendingRead, clearPendingRead)
  return readPromise
}

function hasCurrentPendingArticleRead(path: string): boolean {
  return pendingArticleReads.get(path)?.generation === articleReadGeneration
}

type FileTreeRequestContext = {
  workspaceKey: string
  generation: number
}

type RemoteFileTreeRequestContext = FileTreeRequestContext & {
  syncTargetKey: string
}

function normalizeWorkspacePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function getFileTreeWorkspaceKey(workspace: { path: string; isCustom: boolean }) {
  return workspace.isCustom ? normalizeWorkspacePath(workspace.path) : '__default__'
}

function isFileTreeRequestCurrent(context: FileTreeRequestContext) {
  return fileTreeWorkspaceKey === context.workspaceKey
    && fileTreeLoadGeneration === context.generation
}

async function canApplyFileTreeRequest(context: FileTreeRequestContext) {
  if (!isFileTreeRequestCurrent(context)) return false

  const workspace = await getWorkspacePath()
  return isFileTreeRequestCurrent(context)
    && getFileTreeWorkspaceKey(workspace) === context.workspaceKey
}

function getRemoteSyncTargetKey(context: { workspaceKey: string; provider: string; repo: string }) {
  return JSON.stringify([context.workspaceKey, context.provider, context.repo])
}

async function canApplyRemoteFileTreeRequest(context: RemoteFileTreeRequestContext) {
  if (!await canApplyFileTreeRequest(context)) return false

  const syncContext = await getCurrentSyncContext()
  return isFileTreeRequestCurrent(context)
    && getRemoteSyncTargetKey(syncContext) === context.syncTargetKey
}

async function withRemoteTimeout<T>(promise: Promise<T>, path: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Remote directory request timed out: ${path}`))
        }, REMOTE_FOLDER_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

async function updatePersistedEditorNavigation(
  transform: (
    layout: EditorWorkspaceLayout,
    helpers: typeof import('@/app/core/main/editor/editor-group-layout'),
  ) => EditorWorkspaceLayout,
): Promise<void> {
  const task = persistedEditorNavigationQueue.then(async () => {
    try {
      const workspaceKey = getFileTreeWorkspaceKey(await getWorkspacePath())
      const store = await getStore()
      const layout = await store.get<EditorWorkspaceLayout>(EDITOR_WORKSPACE_LAYOUT_STORE_KEY)
      if (!layout) return
      if (layout.workspaceKey !== undefined && layout.workspaceKey !== workspaceKey) return
      const helpers = await import('@/app/core/main/editor/editor-group-layout')
      const nextLayout = transform(layout, helpers)
      if (nextLayout === layout) return
      const latestWorkspaceKey = getFileTreeWorkspaceKey(await getWorkspacePath())
      if (latestWorkspaceKey !== workspaceKey) return
      await store.set(EDITOR_WORKSPACE_LAYOUT_STORE_KEY, nextLayout)
      await store.save()
    } catch (error) {
      console.error('Failed to update persisted editor navigation:', error)
    }
  })
  persistedEditorNavigationQueue = task
  return task
}

async function loadCloudFolderRemoteSnapshot(
  cacheTargetKey: string,
  config: CloudFolderConfig,
  forceRefresh: boolean,
): Promise<CloudFolderObject[]> {
  if (!forceRefresh) {
    const cached = await readCloudFolderTreeCache(cacheTargetKey)
    if (cached) return cached
  }

  const pending = cloudFolderRemoteLoadPromises.get(cacheTargetKey)
  if (pending) return pending

  const task = (async () => {
    const files = await withRemoteTimeout(
      androidCloudFolderWorkspaceList(config),
      '',
    )
    await writeCloudFolderTreeCache(cacheTargetKey, files)
    return files
  })()
  cloudFolderRemoteLoadPromises.set(cacheTargetKey, task)
  try {
    return await task
  } finally {
    if (cloudFolderRemoteLoadPromises.get(cacheTargetKey) === task) {
      cloudFolderRemoteLoadPromises.delete(cacheTargetKey)
    }
  }
}

async function getCollapsibleStoreKey(): Promise<string> {
  const workspace = await getWorkspacePath()
  return `collapsibleList:${workspace.isCustom ? workspace.path : '__default__'}`
}

async function getWorkspaceStoreKey(name: string): Promise<string> {
  const workspace = await getWorkspacePath()
  return `${name}:${workspace.isCustom ? workspace.path : '__default__'}`
}

export type SortType = 'name' | 'created' | 'modified' | 'none'
export type SortDirection = 'asc' | 'desc'

export interface DirTree extends DirEntry {
  children?: DirTree[]
  childrenLoaded?: boolean
  parent?: DirTree
  sha?: string
  size?: number
  isEditing?: boolean
  isLocale: boolean
  createdAt?: string
  modifiedAt?: string
  loading?: boolean  // 文件夹正在加载中
  syncDirty?: boolean
  syncError?: string
  vectorCalcStatus?: 'idle' | 'calculating' | 'completed'  // 向量计算状态
}

function mergeCloudFolderRemoteEntries(
  files: CloudFolderObject[],
  currentPath: string,
  entries: DirTree[],
  parent?: DirTree,
) {
  const normalizedPath = currentPath.replace(/^\/+|\/+$/g, '')
  const remoteEntries = new Map<string, DirTree>()

  for (const file of files) {
    const key = file.key.replace(/^\/+|\/+$/g, '')
    const relativePath = normalizedPath
      ? key.startsWith(`${normalizedPath}/`)
        ? key.slice(normalizedPath.length + 1)
        : ''
      : key
    if (!relativePath) continue

    const [name, ...remainingSegments] = relativePath.split('/')
    if (!name || name.startsWith('.')) continue

    const isDirectory = remainingSegments.length > 0
    const entryKey = `${isDirectory ? 'directory' : 'file'}:${name}`
    if (remoteEntries.has(entryKey)) continue
    remoteEntries.set(entryKey, {
      name,
      isFile: !isDirectory,
      isSymlink: false,
      parent,
      isEditing: false,
      isDirectory,
      sha: isDirectory ? '' : file.etag,
      size: isDirectory ? undefined : file.size,
      isLocale: false,
      modifiedAt: isDirectory ? undefined : new Date(file.modifiedAt).toISOString(),
      children: isDirectory ? [] : undefined,
      childrenLoaded: isDirectory ? false : undefined,
    })
  }

  const remoteEntryKeys = new Set(remoteEntries.keys())
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    const entryKey = `${entry.isDirectory ? 'directory' : 'file'}:${entry.name}`
    if (remoteEntryKeys.has(entryKey)) continue

    if (!entry.isLocale) {
      entries.splice(index, 1)
    } else if (entry.isFile) {
      entry.sha = ''
    }
  }

  for (const [entryKey, remoteEntry] of remoteEntries) {
    const existing = entries.find(entry => (
      `${entry.isDirectory ? 'directory' : 'file'}:${entry.name}` === entryKey
    ))
    if (!existing) {
      entries.push(remoteEntry)
      continue
    }

    existing.sha = remoteEntry.sha
    existing.size = remoteEntry.size
    existing.modifiedAt = remoteEntry.modifiedAt
  }
}

function mergeCloudFolderSnapshotIntoTree(
  files: CloudFolderObject[],
  paths: string[],
  tree: DirTree[],
) {
  for (const path of paths) {
    if (!path) {
      mergeCloudFolderRemoteEntries(files, '', tree)
      continue
    }

    const folder = getCurrentFolder(path, tree)
    if (!folder?.isDirectory) continue
    mergeCloudFolderRemoteEntries(
      files,
      path,
      folder.children ?? (folder.children = []),
      folder,
    )
  }
}

function copyCachedEntry(entry: DirTree, parent?: DirTree): DirTree {
  const copy: DirTree = {
    ...entry,
    parent,
  }
  if (copy.isDirectory) {
    copy.children = (entry.children ?? []).map(child => copyCachedEntry(child, copy))
  }
  return copy
}

function mergeRefreshedLocalEntries(
  localEntries: DirTree[],
  cachedEntries: DirTree[],
  parent?: DirTree
): DirTree[] {
  const cachedByKey = new Map(
    cachedEntries.map(entry => [`${entry.isDirectory ? 'directory' : 'file'}:${entry.name}`, entry])
  )
  const matchedKeys = new Set<string>()

  const mergedLocalEntries = localEntries.map(localEntry => {
    const key = `${localEntry.isDirectory ? 'directory' : 'file'}:${localEntry.name}`
    const cachedEntry = cachedByKey.get(key)
    if (cachedEntry) matchedKeys.add(key)

    const mergedEntry: DirTree = {
      ...cachedEntry,
      ...localEntry,
      parent,
      isLocale: true,
      sha: cachedEntry?.sha ?? localEntry.sha,
      size: cachedEntry?.size ?? localEntry.size,
      createdAt: localEntry.createdAt ?? cachedEntry?.createdAt,
      modifiedAt: localEntry.modifiedAt ?? cachedEntry?.modifiedAt,
      loading: cachedEntry?.loading,
      syncDirty: cachedEntry?.syncDirty,
      syncError: cachedEntry?.syncError,
    }

    if (mergedEntry.isDirectory) {
      if (localEntry.childrenLoaded) {
        mergedEntry.children = mergeRefreshedLocalEntries(
          localEntry.children ?? [],
          cachedEntry?.children ?? [],
          mergedEntry
        )
        mergedEntry.childrenLoaded = true
      } else if (cachedEntry?.childrenLoaded) {
        mergedEntry.children = (cachedEntry.children ?? [])
          .map(child => copyCachedEntry(child, mergedEntry))
        mergedEntry.childrenLoaded = true
      } else {
        mergedEntry.children = []
        mergedEntry.childrenLoaded = false
      }
    } else {
      mergedEntry.children = undefined
      mergedEntry.childrenLoaded = undefined
    }

    return mergedEntry
  })

  const remoteOnlyEntries = cachedEntries
    .filter(entry => !entry.isLocale)
    .filter(entry => !matchedKeys.has(`${entry.isDirectory ? 'directory' : 'file'}:${entry.name}`))
    .map(entry => copyCachedEntry(entry, parent))

  return [...mergedLocalEntries, ...remoteOnlyEntries]
}

export interface Article {
  article: string
  path: string
}

export interface EditorViewState {
  selectionFrom: number
  selectionTo: number
  scrollTop: number
  sectionId?: string
  sourceSelectionFrom?: number
  sourceSelectionTo?: number
  sourceScrollTop?: number
  largeDocumentVisualOverride?: boolean
}

export type EditorTabKind = 'file' | 'record' | 'canvas' | 'blank'
export type EditorTabDisposition = 'preview' | 'regular' | 'pinned'
export type FileTabOpenMode = 'preview' | 'pinned'

export interface OpenTabInfo {
  id: string
  path: string
  name: string
  isFolder: boolean
  kind?: EditorTabKind
  autoCreated?: boolean
  preview?: boolean
  pinned?: boolean
  markId?: number
  markType?: Mark['type']
  canvasId?: string
}

export interface FileTabOpenRequest {
  id: number
  path: string
  mode: FileTabOpenMode
  name: string
  isFolder: boolean
}

function normalizeOpenTabInfo(tab: OpenTabInfo): OpenTabInfo {
  const pinned = tab.pinned === true
  return {
    ...tab,
    preview: pinned ? false : tab.preview === true,
    pinned,
  }
}

type EditorStatePersistenceUpdate = {
  openTabs?: OpenTabInfo[]
  activeTabId?: string
  activeFilePath?: string
  persistWorkspaceActiveFilePath?: boolean
}

let editorStatePersistenceQueue: Promise<void> = Promise.resolve()
let editorStateMutationRevision = 0

export async function flushEditorStatePersistence(): Promise<void> {
  let pendingEditorState = editorStatePersistenceQueue
  let pendingNavigation = persistedEditorNavigationQueue
  while (true) {
    await Promise.all([pendingEditorState, pendingNavigation])
    if (
      pendingEditorState === editorStatePersistenceQueue
      && pendingNavigation === persistedEditorNavigationQueue
    ) return
    pendingEditorState = editorStatePersistenceQueue
    pendingNavigation = persistedEditorNavigationQueue
  }
}

function persistEditorState(update: EditorStatePersistenceUpdate): Promise<void> {
  editorStateMutationRevision += 1
  const workspaceTransitionGeneration = editorWorkspaceTransitionGeneration
  const snapshot = {
    ...update,
    openTabs: update.openTabs?.map(tab => ({ ...tab })),
  }
  const task = editorStatePersistenceQueue.then(async () => {
    if (
      editorWorkspaceTransitionInProgress
      || workspaceTransitionGeneration !== editorWorkspaceTransitionGeneration
    ) return
    const store = await getStore()
    if (snapshot.openTabs !== undefined) {
      await store.set('openTabs', snapshot.openTabs)
    }
    if (snapshot.activeTabId !== undefined) {
      await store.set('activeTabId', snapshot.activeTabId)
    }
    if (snapshot.activeFilePath !== undefined) {
      await store.set('activeFilePath', snapshot.activeFilePath)
      if (snapshot.persistWorkspaceActiveFilePath) {
        await store.set(
          await getWorkspaceStoreKey('activeFilePath'),
          snapshot.activeFilePath,
        )
      }
    }
  })
  editorStatePersistenceQueue = task.catch(error => {
    console.error('Failed to persist editor state:', error)
  })
  return task
}

const RECORD_TAB_PATH_PREFIX = 'record://mark/'
const BLANK_TAB_PATH_PREFIX = 'blank://'

function isRecordOpenTabPath(path: string): boolean {
  return path.startsWith(RECORD_TAB_PATH_PREFIX)
}

function isCanvasOpenTabPath(path: string): boolean {
  return path.startsWith('canvas://project/')
}

function isBlankOpenTabPath(path: string): boolean {
  return path.startsWith(BLANK_TAB_PATH_PREFIX)
}

function isVirtualOpenTabPath(path: string): boolean {
  return isBlankOpenTabPath(path) || isRecordOpenTabPath(path) || isCanvasOpenTabPath(path)
}

function isRecordOpenTab(tab?: OpenTabInfo | null): boolean {
  return !!tab && (tab.kind === 'record' || isRecordOpenTabPath(tab.path))
}

function getActiveFilePathForTab(tab?: OpenTabInfo | null): string {
  return tab && tab.kind !== 'blank' && !isRecordOpenTab(tab) && !isVirtualOpenTabPath(tab.path) ? tab.path : ''
}

// 查找文件夹节点
export const findFolderInTree = (path: string, tree: DirTree[]): DirTree | null => {
  for (const item of tree) {
    const itemPath = computedParentPath(item)
    if (itemPath === path && item.isDirectory) {
      return item
    }
    if (item.children && item.children.length > 0) {
      const found = findFolderInTree(path, item.children)
      if (found) return found
    }
  }
  return null
}

function isLikelyFilePath(path: string): boolean {
  const name = path.split('/').pop() || path
  return name.includes('.')
}

function getFolderPathsToExpand(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  const folderSegments = isLikelyFilePath(path) ? segments.slice(0, -1) : segments

  return folderSegments.map((_, index) => folderSegments.slice(0, index + 1).join('/'))
}

function createLocalTreeNode(name: string, isDirectory: boolean, parent?: DirTree): DirTree {
  return {
    name,
    isDirectory,
    isFile: !isDirectory,
    isSymlink: false,
    children: isDirectory ? [] : undefined,
    parent,
    isEditing: false,
    isLocale: true,
    sha: '',
    createdAt: undefined,
    modifiedAt: undefined,
  }
}

function insertNodeIntoTree(tree: DirTree[], relativePath: string, isDirectory: boolean): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    if (tree.some(item => item.name === name)) {
      return true
    }
    tree.unshift(createLocalTreeNode(name, isDirectory))
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  if (parentFolder.children.some(item => item.name === name)) {
    return true
  }

  parentFolder.children.unshift(createLocalTreeNode(name, isDirectory, parentFolder))
  return true
}

function removeNodeFromTree(tree: DirTree[], relativePath: string): DirTree | null {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    const index = tree.findIndex(item => item.name === name)
    if (index === -1) {
      return null
    }
    return tree.splice(index, 1)[0] || null
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder?.children) {
    return null
  }

  const index = parentFolder.children.findIndex(item => item.name === name)
  if (index === -1) {
    return null
  }

  return parentFolder.children.splice(index, 1)[0] || null
}

function attachNodeToTree(tree: DirTree[], relativePath: string, node: DirTree): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath
  node.name = name

  if (!parentPath) {
    node.parent = undefined
    if (!tree.some(item => item.name === name)) {
      tree.unshift(node)
    }
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  node.parent = parentFolder
  if (!parentFolder.children.some(item => item.name === name)) {
    parentFolder.children.unshift(node)
  }
  return true
}

function updateTreeEntryByPath(
  tree: DirTree[],
  relativePath: string,
  updater: (entry: DirTree) => DirTree | null,
  markAncestorsLocal = false
): DirTree[] | null {
  const segments = relativePath.split('/').filter(Boolean)
  if (segments.length === 0) return null

  function updateLevel(items: DirTree[], depth: number, parent?: DirTree): DirTree[] | null {
    const index = items.findIndex(item => item.name === segments[depth])
    if (index === -1) return null

    const current = items[index]
    const nextItems = [...items]
    if (depth === segments.length - 1) {
      const nextEntry = updater(current)
      if (nextEntry) {
        nextItems[index] = { ...nextEntry, parent }
      } else {
        nextItems.splice(index, 1)
      }
      return nextItems
    }

    if (!current.children) return null
    const nextParent: DirTree = {
      ...current,
      isLocale: markAncestorsLocal ? true : current.isLocale,
    }
    const nextChildren = updateLevel(current.children, depth + 1, nextParent)
    if (!nextChildren) return null

    nextParent.children = nextChildren
    nextItems[index] = nextParent
    return nextItems
  }

  return updateLevel(tree, 0)
}

interface NoteState {
  loading: boolean
  setLoading: (loading: boolean) => void

  activeFilePath: string
  setActiveFilePath: (
    name: string,
    autoSync?: boolean,
    options?: {
      deactivationAlreadyPrepared?: boolean
      tabOpenMode?: FileTabOpenMode
      tabMetadata?: Pick<OpenTabInfo, 'name' | 'isFolder'>
      createIfMissing?: boolean
      persistWorkspaceActiveFilePath?: boolean
      workspaceTransitionReset?: boolean
    }
  ) => Promise<void>
  selectedFilePaths: string[]
  setSelectedFilePaths: (paths: string[]) => void
  clearSelectedFilePaths: () => void

  // 当前正在读取的文件路径，用于避免竞态条件
  readFilePath: string
  setReadFilePath: (path: string) => void

  // Tabs for multi-file editing
  openTabs: OpenTabInfo[]
  setOpenTabs: (tabs: OpenTabInfo[]) => Promise<void>
  activeTabId: string
  setActiveTabId: (
    id: string,
    options?: { deactivationAlreadyPrepared?: boolean },
  ) => Promise<void>
  addTab: (
    tab: OpenTabInfo,
    options?: { deactivationAlreadyPrepared?: boolean },
  ) => Promise<void>
  replaceTab: (id: string, tab: OpenTabInfo) => Promise<void>
  setTabDisposition: (id: string, disposition: EditorTabDisposition) => Promise<void>
  pendingFileTabOpenRequest: FileTabOpenRequest | null
  consumeFileTabOpenRequest: (id: number) => void
  updateRecordTab: (mark: Mark) => Promise<void>
  removeTab: (
    id: string,
    options?: { deactivationAlreadyPrepared?: boolean },
  ) => Promise<void>
  editorViewStates: Record<string, EditorViewState>
  setEditorViewState: (path: string, state: Partial<EditorViewState>) => void
  getEditorViewState: (path: string) => EditorViewState | null
  removeEditorViewState: (path: string) => void
  moveEditorViewState: (oldPath: string, newPath: string) => void
  cleanTabsByDeletedFile: (
    deletedPath: string,
    workspaceRootOverride?: string,
    options?: { preservePendingSaves?: boolean },
  ) => Promise<void>
  cleanTabsByDeletedFolder: (
    deletedFolderPath: string,
    workspaceRootOverride?: string,
    options?: { preservePendingSaves?: boolean },
  ) => Promise<void>
  clearTabs: () => void

  matchPosition: number | null
  setMatchPosition: (position: number | null) => void
  pendingSearchKeyword: string
  setPendingSearchKeyword: (keyword: string) => void

  html2md: boolean
  initHtml2md: () => Promise<void>
  setHtml2md: (html2md: boolean) => Promise<void>

  showCloudFiles: boolean
  initShowCloudFiles: () => Promise<void>
  setShowCloudFiles: (show: boolean) => Promise<void>
  showAssetsFolders: boolean
  initShowAssetsFolders: () => Promise<void>
  setShowAssetsFolders: (show: boolean) => Promise<void>
  syncStaticAssets: boolean
  initSyncStaticAssets: () => Promise<void>
  setSyncStaticAssets: (enabled: boolean) => Promise<void>
  showKnowledgeBaseStatus: boolean
  initShowKnowledgeBaseStatus: () => Promise<void>
  setShowKnowledgeBaseStatus: (show: boolean) => Promise<void>

  // Initialize tabs from store
  initOpenTabs: () => Promise<void>

  sortType: SortType
  sortDirection: SortDirection
  initSortSettings: () => Promise<void>
  initEventListeners: () => void
  setSortType: (sortType: SortType) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  sortFileTree: (tree: DirTree[]) => DirTree[]
  updateFileStats: (path: string, tree: DirTree[]) => Promise<DirTree[]>
  loadFileStatsIfNeeded: () => Promise<void>

  fileTree: DirTree[]
  fileTreeLoading: boolean
  fileTreeInitialized: boolean
  fileTreeWorkspaceKey: string | null
  setFileTree: (tree: DirTree[]) => void
  setEntryLoading: (relativePath: string, loading: boolean) => boolean
  setEntrySyncError: (relativePath: string, error?: string) => boolean
  markFileRemote: (relativePath: string, sha: string) => boolean
  markFileLocal: (relativePath: string) => boolean
  markFileDirty: (relativePath: string) => boolean
  reconcileLocalFile: (relativePath: string, isPresent: boolean) => boolean
  clearFileRemoteState: (relativePath: string) => boolean
  addFile: (file: DirTree) => void
  ensurePathExpanded: (path: string) => Promise<void>
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => boolean
  removeLocalEntry: (relativePath: string) => boolean
  moveLocalEntry: (oldPath: string, newPath: string) => boolean
  syncOpenTabsForPathChange: (oldPath: string, newPath: string) => Promise<void>
  loadFileTree: (options?: { skipRemoteSync?: boolean }) => Promise<void>
  loadRemoteSyncFiles: (context?: FileTreeRequestContext) => Promise<void>
  loadCollapsibleFiles: (folderName: string, options?: { force?: boolean; skipRemoteSync?: boolean }) => Promise<void>
  loadFolderRemoteFiles: (folderName: string) => Promise<void>
  newFolder: () => void
  newFile: () => void
  newFileOnFolder: (path: string) => Promise<void>
  newFolderInFolder: (path: string) => void

  collapsibleList: string[]
  collapsibleListInitialized: boolean
  initCollapsibleList: () => Promise<void>
  setCollapsibleList: (name: string, value: boolean) => Promise<void>
  expandAllFolders: () => Promise<void>
  collapseAllFolders: () => Promise<void>
  toggleAllFolders: () => Promise<void>
  clearCollapsibleList: () => Promise<void>
  loadWorkspaceCollapsibleList: () => Promise<string>

  currentArticle: string
  isPulling: boolean // 新增：拉取状态
  justPulledFile: boolean // 标记是否刚从远程拉取文件（用于避免立即推送）
  skipSyncOnSave: boolean // 标记是否跳过同步（用于程序写入时）
  aiGeneratingFilePath: string | null // 标记当前正在 AI 生成的文件路径
  aiTerminateFn: (() => void) | null // AI 生成的终止函数
  readArticle: (
    path: string,
    sha?: string,
    autoSync?: boolean,
    options?: { createIfMissing?: boolean },
  ) => Promise<void>
  setCurrentArticle: (content: string) => void
  setIsPulling: (pulling: boolean) => void
  setJustPulledFile: (justPulled: boolean) => void
  setSkipSyncOnSave: (skip: boolean) => void
  setAiGeneratingFilePath: (path: string | null) => void
  setAiTerminateFn: (fn: (() => void) | null) => void
  saveCurrentArticle: (content: string, pathOverride?: string) => Promise<void>
  flushPendingArticleSave: (path: string) => Promise<void>
  flushPendingArticleSavesForPaths: (
    paths: string[],
    workspaceRoot?: string,
  ) => Promise<void>
  flushAllPendingArticleSaves: () => Promise<void>
  runPathWriteTransaction: (
    path: string,
    transaction: (context: EditorPathWriteTransactionContext) => Promise<boolean>,
    workspaceRoot?: string,
  ) => Promise<boolean>
  // 更新文件 sha 状态（推送成功后调用）
  updateFileSha: (path: string, sha: string) => void

  // 向量计算相关
  isVectorCalculating: boolean
  scheduleVectorCalculation: (path: string, content: string) => void
  executeVectorCalculation: (options?: { force?: boolean }) => Promise<void>
  cancelVectorCalculation: () => void
  settleVectorCalculationsForPaths: (
    paths: string[],
    workspaceRoot?: string,
  ) => Promise<void>
  settleAllVectorCalculations: () => Promise<void>
  triggerVectorCalculation: () => Promise<void> // 手动触发向量计算
  // 向量索引状态
  vectorIndexedFiles: Map<string, number> // 工作区相对路径 -> 向量索引时间戳
  checkFileVectorIndexed: (filePath: string) => Promise<boolean>
  clearFileVector: (filePath: string) => Promise<void>
  initVectorIndexedFiles: () => Promise<void> // 初始化向量索引状态
  // 向量计算状态更新
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => void

  allArticle: Article[]
  loadAllArticle: () => Promise<void>
}

const useArticleStore = create<NoteState>((set, get) => ({
  loading: false,

  setLoading: (loading: boolean) => { set({ loading }) },

  sortType: 'none',
  sortDirection: 'asc',
  initSortSettings: async () => {
    const store = await getStore()
    const sortType = await store.get<SortType>('sortType')
    const sortDirection = await store.get<SortDirection>('sortDirection')
    if (sortType) set({ sortType })
    if (sortDirection) set({ sortDirection })

    // 如果需要按时间排序，加载统计信息
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }

    // 初始化事件监听器
    get().initEventListeners()
  },

  // 初始化事件监听器
  initEventListeners: () => {
    const globalState = globalThis as ArticleSyncListenerGlobal
    if (globalState.__noteGenArticleSyncPushCompletedListener) {
      emitter.off('sync-push-completed', globalState.__noteGenArticleSyncPushCompletedListener)
    }

    // 监听同步推送完成事件，更新文件树的 sha 状态
    const syncPushCompletedListener: SyncPushCompletedListener = (event) => {
      const { path, success, sha } = event
      debugSyncPath('article.syncPushCompleted', {
        path,
        success,
        sha,
        hasSha: Boolean(sha),
      })
      if (success && sha) {
        get().updateFileSha(path, sha)
      }
    }

    emitter.on('sync-push-completed', syncPushCompletedListener)
    globalState.__noteGenArticleSyncPushCompletedListener = syncPushCompletedListener
  },
  setSortType: async (sortType: SortType) => {
    set({ sortType })
    const store = await getStore()
    await store.set('sortType', sortType)
    
    // 如果需要按时间排序，先加载统计信息
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  setSortDirection: async (direction: SortDirection) => {
    set({ sortDirection: direction })
    const store = await getStore()
    await store.set('sortDirection', direction)
    
    // 如果当前是按时间排序，确保统计信息已加载
    const sortType = get().sortType
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  
  sortFileTree: (tree: DirTree[]) => {
    const sortType = get().sortType
    const sortDirection = get().sortDirection

    // 复制树结构，避免直接修改原始数据
    const sortedTree = cloneDeep(tree)

    // skills 文件夹始终置顶（在任何排序方式下，包括 sortType 为 'none' 时）
    const sortFunction = (a: DirTree, b: DirTree) => {
      const aIsSkills = a.isDirectory && isSkillsFolder(a.name)
      const bIsSkills = b.isDirectory && isSkillsFolder(b.name)
      if (aIsSkills && !bIsSkills) return -1
      if (!aIsSkills && bIsSkills) return 1

      // 如果排序类型为 'none'，在 skills 置顶后，文件夹在文件上方
      if (sortType === 'none') {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return 0
      }

      // 文件夹始终在文件上方
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      // 同类型的进行排序
      let result = 0
      switch (sortType) {
        case 'name':
          result = a.name.localeCompare(b.name, undefined, { numeric: true })
          break
        case 'created':
          if (a.createdAt && b.createdAt) {
            result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        case 'modified':
          if (a.modifiedAt && b.modifiedAt) {
            result = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        default:
          result = 0
      }
      return sortDirection === 'asc' ? result : -result
    }

    sortedTree.sort(sortFunction)

    const sortChildren = (items: DirTree[]) => {
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          item.children.sort(sortFunction)
          sortChildren(item.children)
        }
      }
    }

    sortChildren(sortedTree)
    return sortedTree
  },

  activeFilePath: '',
  setActiveFilePath: async (path: string, autoSync = true, options) => {
    fileActivationIntentSequence += 1
    if (editorWorkspaceTransitionInProgress && !options?.workspaceTransitionReset) return
    const nextPath = isVirtualOpenTabPath(path) ? '' : path
    if (isEditorPathMutationLocked(nextPath)) return
    if (
      nextPath !== get().activeFilePath
      && !options?.deactivationAlreadyPrepared
      && !prepareActiveEditorDeactivation()
    ) {
      return
    }
    const currentFileTabOpenRequest = get().pendingFileTabOpenRequest
    const matchingFileTabOpenRequest = currentFileTabOpenRequest?.path === nextPath
      ? currentFileTabOpenRequest
      : null
    const matchingOpenTab = get().openTabs.find(tab => tab.path === nextPath)
    const requestedTabName = options?.tabMetadata?.name
      || matchingFileTabOpenRequest?.name
      || matchingOpenTab?.name
      || nextPath.split(/[\\/]/).pop()
      || nextPath
    const requestedTabIsFolder = options?.tabMetadata?.isFolder
      ?? matchingFileTabOpenRequest?.isFolder
      ?? matchingOpenTab?.isFolder
      ?? !(nextPath.split(/[\\/]/).pop() || '').includes('.')
    const pendingFileTabOpenRequest = options?.tabOpenMode && nextPath
      ? {
          id: ++fileTabOpenRequestSequence,
          path: nextPath,
          mode: options.tabOpenMode,
          name: requestedTabName,
          isFolder: requestedTabIsFolder,
        }
      : matchingFileTabOpenRequest
        ? matchingFileTabOpenRequest
        : null
    const fileName = nextPath.split(/[\\/]/).pop() || ''
    const shouldReadArticle = Boolean(
      !requestedTabIsFolder && fileName && fileName.includes('.')
    )
    const canReusePendingRead = shouldReadArticle
      && get().activeFilePath === nextPath
      && hasCurrentPendingArticleRead(nextPath)

    if (canReusePendingRead) {
      set({ selectedFilePaths: [], pendingFileTabOpenRequest })
      emitter.emit('article-opened', { path: nextPath })
      await persistEditorState({
        activeFilePath: get().activeFilePath,
        persistWorkspaceActiveFilePath: options?.persistWorkspaceActiveFilePath !== false,
      })
      return
    }

    if (!shouldReadArticle) {
      articleReadGeneration += 1
      pendingArticleReads.clear()
    }
    // 切换文件时，先清空 currentArticle，避免内容覆盖
    set({
      currentArticle: '',
      activeFilePath: nextPath,
      isPulling: false,
      justPulledFile: false,
      selectedFilePaths: [],
      loading: shouldReadArticle,
      pendingFileTabOpenRequest,
    })
    // 触发事件，让推送队列重置计时器
    emitter.emit('article-opened', { path: nextPath })

    // 触发读取文件内容（包括远程拉取）
    // 需要确保是文件而不是文件夹
    if (shouldReadArticle) {
      void get().readArticle(nextPath, undefined, autoSync, {
        createIfMissing: options?.createIfMissing,
      })
    }

    await persistEditorState({
      activeFilePath: get().activeFilePath,
      persistWorkspaceActiveFilePath: options?.persistWorkspaceActiveFilePath !== false,
    })
  },
  selectedFilePaths: [],
  setSelectedFilePaths: (paths: string[]) => {
    const nextPaths = Array.from(new Set(paths))
    set((state) => {
      const isSameSelection = state.selectedFilePaths.length === nextPaths.length
        && state.selectedFilePaths.every((path, index) => path === nextPaths[index])

      return isSameSelection ? state : { selectedFilePaths: nextPaths }
    })
  },
  clearSelectedFilePaths: () => {
    set((state) => state.selectedFilePaths.length === 0 ? state : { selectedFilePaths: [] })
  },

  // Tabs initialization - load from store
  openTabs: [],
  activeTabId: '',
  editorViewStates: {},
  pendingFileTabOpenRequest: null,
  consumeFileTabOpenRequest: (id) => {
    set(state => state.pendingFileTabOpenRequest?.id === id
      ? { pendingFileTabOpenRequest: null }
      : state)
  },
  setOpenTabs: async (tabs) => {
    if (tabs.some(tab => isEditorPathMutationLocked(tab.path))) return
    const normalizedTabs = tabs.map(normalizeOpenTabInfo)
    const activeTabId = get().activeTabId
    if (
      activeTabId
      && !normalizedTabs.some(tab => tab.id === activeTabId)
      && !prepareActiveEditorDeactivation()
    ) {
      return
    }
    const keptPaths = new Set(normalizedTabs.map(tab => tab.path))
    const nextEditorViewStates = Object.fromEntries(
      Object.entries(get().editorViewStates).filter(([path]) => keptPaths.has(path))
    )
    set({ openTabs: normalizedTabs, editorViewStates: nextEditorViewStates })
    await persistEditorState({ openTabs: normalizedTabs })
  },
  setActiveTabId: async (id, options) => {
    const tab = get().openTabs.find(candidate => candidate.id === id)
    if (tab && isEditorPathMutationLocked(tab.path)) return
    if (
      id !== get().activeTabId
      && !options?.deactivationAlreadyPrepared
      && !prepareActiveEditorDeactivation()
    ) return
    set({ activeTabId: id })
    await persistEditorState({ activeTabId: id })
  },
  addTab: async (tab, options) => {
    const normalizedTab = normalizeOpenTabInfo(tab)
    if (isEditorPathMutationLocked(tab.path)) return
    const currentTabs = get().openTabs
    // Check if tab already exists
    const existingTab = currentTabs.find(t => t.path === normalizedTab.path)
    if (existingTab) {
      await get().setActiveTabId(existingTab.id, options)
      return
    }
    if (
      normalizedTab.id !== get().activeTabId
      && !options?.deactivationAlreadyPrepared
      && !prepareActiveEditorDeactivation()
    ) return
    const newTabs = [...currentTabs, normalizedTab]
    set({ openTabs: newTabs, activeTabId: normalizedTab.id })
    await persistEditorState({
      openTabs: newTabs,
      activeTabId: normalizedTab.id,
    })
  },
  replaceTab: async (id, tab) => {
    const currentTabs = get().openTabs
    const replacedTab = currentTabs.find(item => item.id === id)
    if (!replacedTab) return
    const normalizedTab = normalizeOpenTabInfo({ ...tab, id })
    const newTabs = currentTabs.map(item => item.id === id ? normalizedTab : item)
    const nextEditorViewStates = { ...get().editorViewStates }
    if (replacedTab.path !== normalizedTab.path) {
      delete nextEditorViewStates[replacedTab.path]
    }
    set({
      openTabs: newTabs,
      activeTabId: id,
      editorViewStates: nextEditorViewStates,
    })
    await persistEditorState({ openTabs: newTabs, activeTabId: id })
  },
  setTabDisposition: async (id, disposition) => {
    const currentTabs = get().openTabs
    const target = currentTabs.find(tab => tab.id === id)
    if (!target) return
    const preview = disposition === 'preview'
    const pinned = disposition === 'pinned'
    if (target.preview === preview && target.pinned === pinned) return
    const newTabs = currentTabs.map(tab => tab.id === id
      ? { ...tab, preview, pinned }
      : tab)
    set({ openTabs: newTabs })
    await persistEditorState({ openTabs: newTabs })
  },
  updateRecordTab: async (mark) => {
    const currentTabs = get().openTabs
    const newTabs = currentTabs.map((tab) => {
      const isSameRecord = tab.markId === mark.id || tab.path === `${RECORD_TAB_PATH_PREFIX}${mark.id}`

      if (!isSameRecord) {
        return tab
      }

      return {
        ...tab,
        name: getRecordTabName(mark, mark.type),
        markType: mark.type,
      }
    })

    if (newTabs === currentTabs || newTabs.every((tab, index) => tab === currentTabs[index])) {
      return
    }

    set({ openTabs: newTabs })
    await persistEditorState({ openTabs: newTabs })
  },
  removeTab: async (id, options) => {
    if (
      id === get().activeTabId
      && !options?.deactivationAlreadyPrepared
      && !prepareActiveEditorDeactivation()
    ) return
    const currentTabs = get().openTabs
    const removedTab = currentTabs.find(t => t.id === id)
    const newTabs = currentTabs.filter(t => t.id !== id)
    const nextEditorViewStates = { ...get().editorViewStates }
    if (removedTab) {
      delete nextEditorViewStates[removedTab.path]
    }
    set({ openTabs: newTabs, editorViewStates: nextEditorViewStates })
    await persistEditorState({ openTabs: newTabs })
  },
  setEditorViewState: (path, state) => {
    if (!path) {
      return
    }
    set(current => ({
      editorViewStates: {
        ...current.editorViewStates,
        [path]: {
          ...(current.editorViewStates[path] ?? {
            selectionFrom: 0,
            selectionTo: 0,
            scrollTop: 0,
          }),
          ...state,
        },
      }
    }))
  },
  getEditorViewState: (path) => {
    if (!path) {
      return null
    }
    return get().editorViewStates[path] || null
  },
  removeEditorViewState: (path) => {
    if (!path) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[path]
    set({ editorViewStates: nextEditorViewStates })
  },
  moveEditorViewState: (oldPath, newPath) => {
    if (!oldPath || !newPath || oldPath === newPath) {
      return
    }
    const currentState = get().editorViewStates[oldPath]
    if (!currentState) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[oldPath]
    nextEditorViewStates[newPath] = currentState
    set({ editorViewStates: nextEditorViewStates })
  },

  // 清理已被删除的文件对应的 tabs（根据路径匹配）
  cleanTabsByDeletedFile: async (
    deletedPath: string,
    workspaceRootOverride?: string,
    options?: { preservePendingSaves?: boolean },
  ) => {
    const currentWorkspaceRoot = await getCurrentEditorWorkspaceRoot()
    if (
      workspaceRootOverride
      && !workspaceRootsReferToSameLocation(currentWorkspaceRoot, workspaceRootOverride)
    ) {
      return
    }
    const workspaceRoot = workspaceRootOverride ?? currentWorkspaceRoot
    const isDeletedFile = (path: string) => (
      editorPathsReferToSameFile(path, deletedPath, workspaceRoot)
    )
    if (options?.preservePendingSaves) {
      const latestState = get()
      if (
        isDeletedFile(latestState.activeFilePath)
        && !prepareActiveEditorDeactivation()
      ) return
      if (
        [...pendingArticleSaves.keys()].some(isDeletedFile)
        || [...inFlightArticleSaves.keys()].some(isDeletedFile)
      ) return
    }
    discardQueuedArticleSaves(deletedPath, workspaceRoot, false)
    discardPendingVectorCalculation(deletedPath, workspaceRoot, false)

    const currentState = get()
    const currentTabs = currentState.openTabs
    const currentActiveTabId = currentState.activeTabId
    const currentActiveFilePath = currentState.activeFilePath
    const currentSelectedFilePaths = currentState.selectedFilePaths
    const newTabs = currentTabs.filter(tab => !isDeletedFile(tab.path))
    const deletedTabIds = currentTabs
      .filter(tab => isDeletedFile(tab.path))
      .map(tab => tab.id)
    const nextSelectedFilePaths = currentSelectedFilePaths.filter(path => !isDeletedFile(path))
    const currentActiveTab = currentTabs.find(tab => tab.id === currentActiveTabId)
    const activeTabDeleted = Boolean(currentActiveTab && isDeletedFile(currentActiveTab.path))
    const tabsChanged = newTabs.length !== currentTabs.length
    const pendingRequestDeleted = Boolean(
      currentState.pendingFileTabOpenRequest
      && isDeletedFile(currentState.pendingFileTabOpenRequest.path)
    )

    let preferredFallbackTabId = ''
    let navigationHandled = false
    emitter.emit('editor-navigation-path-deleted', {
      path: deletedPath,
      isFolder: false,
      workspaceRoot,
      deletedTabIds,
      resolveFallbackTabId: tabId => { preferredFallbackTabId = tabId },
      markHandled: () => { navigationHandled = true },
    })
    const navigationNeedsPersistentUpdate = !navigationHandled

    let newActiveTabId = currentActiveTabId
    let newActiveFilePath = currentActiveFilePath
    if (activeTabDeleted && newTabs.length > 0) {
      const targetTab = newTabs.find(tab => tab.id === preferredFallbackTabId)
        ?? newTabs[newTabs.length - 1]
      newActiveTabId = targetTab.id
      newActiveFilePath = getActiveFilePathForTab(targetTab)
    } else if (activeTabDeleted) {
      newActiveTabId = ''
      newActiveFilePath = ''
    } else if (isDeletedFile(currentActiveFilePath)) {
      newActiveFilePath = ''
    }

    const activeChanged = newActiveTabId !== currentActiveTabId
      || newActiveFilePath !== currentActiveFilePath
    const selectionChanged = nextSelectedFilePaths.length !== currentSelectedFilePaths.length
    const nextEditorViewStates = { ...currentState.editorViewStates }
    let viewStatesChanged = false
    Object.keys(nextEditorViewStates).forEach(path => {
      if (!isDeletedFile(path)) return
      delete nextEditorViewStates[path]
      viewStatesChanged = true
    })
    if (!tabsChanged && !activeChanged && !selectionChanged && !viewStatesChanged && !pendingRequestDeleted) {
      if (navigationNeedsPersistentUpdate) {
        await updatePersistedEditorNavigation((layout, helpers) => (
          helpers.cleanEditorNavigationHistoryByDeletedFile(layout, deletedPath, workspaceRoot)
        ))
      }
      return
    }

    set({
      openTabs: newTabs,
      activeTabId: newActiveTabId,
      selectedFilePaths: nextSelectedFilePaths,
      editorViewStates: nextEditorViewStates,
      ...(pendingRequestDeleted ? { pendingFileTabOpenRequest: null } : {}),
      ...(activeChanged ? {
        activeFilePath: newActiveFilePath,
        currentArticle: '',
        readFilePath: '',
        isPulling: false,
        justPulledFile: false,
        loading: Boolean(newActiveFilePath && isLikelyFilePath(newActiveFilePath)),
      } : {}),
    })

    const persistencePromise = tabsChanged || activeChanged
      ? persistEditorState({
          ...(tabsChanged ? { openTabs: newTabs } : {}),
          ...(activeChanged ? { activeTabId: newActiveTabId } : {}),
        })
      : null
    const activatePromise = activeChanged
      ? get().setActiveFilePath(
        newActiveFilePath,
        true,
        { deactivationAlreadyPrepared: true, createIfMissing: false },
      )
      : null
    await persistencePromise
    if (activeChanged) {
      await activatePromise
    }
    if (navigationNeedsPersistentUpdate) {
      await updatePersistedEditorNavigation((layout, helpers) => (
        helpers.cleanEditorNavigationHistoryByDeletedFile(layout, deletedPath, workspaceRoot)
      ))
    }
  },

  // 清理已被删除的文件夹对应的 tabs（清理该文件夹下所有文件的 tabs）
  cleanTabsByDeletedFolder: async (
    deletedFolderPath: string,
    workspaceRootOverride?: string,
    options?: { preservePendingSaves?: boolean },
  ) => {
    const currentWorkspaceRoot = await getCurrentEditorWorkspaceRoot()
    if (
      workspaceRootOverride
      && !workspaceRootsReferToSameLocation(currentWorkspaceRoot, workspaceRootOverride)
    ) {
      return
    }
    const workspaceRoot = workspaceRootOverride ?? currentWorkspaceRoot
    const isInDeletedFolder = (path: string) => (
      pathIsSameOrDescendant(path, deletedFolderPath, workspaceRoot)
    )
    if (options?.preservePendingSaves) {
      const latestState = get()
      if (
        isInDeletedFolder(latestState.activeFilePath)
        && !prepareActiveEditorDeactivation()
      ) return
      if (
        [...pendingArticleSaves.keys()].some(isInDeletedFolder)
        || [...inFlightArticleSaves.keys()].some(isInDeletedFolder)
      ) return
    }
    discardQueuedArticleSaves(deletedFolderPath, workspaceRoot)
    discardPendingVectorCalculation(deletedFolderPath, workspaceRoot)

    const currentState = get()
    const currentTabs = currentState.openTabs
    const currentActiveTabId = currentState.activeTabId
    const currentActiveFilePath = currentState.activeFilePath
    const currentSelectedFilePaths = currentState.selectedFilePaths
    const newTabs = currentTabs.filter(
      tab => !isInDeletedFolder(tab.path)
    )
    const deletedTabIds = currentTabs
      .filter(tab => isInDeletedFolder(tab.path))
      .map(tab => tab.id)
    const currentActiveTab = currentTabs.find(tab => tab.id === currentActiveTabId)
    const activeTabDeleted = Boolean(
      currentActiveTab && isInDeletedFolder(currentActiveTab.path)
    )
    const activeFileDeleted = isInDeletedFolder(currentActiveFilePath)
    const nextSelectedFilePaths = currentSelectedFilePaths.filter(
      path => !isInDeletedFolder(path)
    )

    let preferredFallbackTabId = ''
    let navigationHandled = false
    emitter.emit('editor-navigation-path-deleted', {
      path: deletedFolderPath,
      isFolder: true,
      workspaceRoot,
      deletedTabIds,
      resolveFallbackTabId: tabId => { preferredFallbackTabId = tabId },
      markHandled: () => { navigationHandled = true },
    })
    const navigationNeedsPersistentUpdate = !navigationHandled

    let newActiveTabId = currentActiveTabId
    let newActiveFilePath = currentActiveFilePath
    if (activeTabDeleted && newTabs.length > 0) {
      const targetTab = newTabs.find(tab => tab.id === preferredFallbackTabId)
        ?? newTabs[newTabs.length - 1]
      newActiveTabId = targetTab.id
      newActiveFilePath = getActiveFilePathForTab(targetTab)
    } else if (activeTabDeleted) {
      newActiveTabId = ''
      newActiveFilePath = ''
    } else if (activeFileDeleted) {
      newActiveFilePath = ''
    }

    const tabsChanged = newTabs.length !== currentTabs.length
    const pendingRequestDeleted = Boolean(
      currentState.pendingFileTabOpenRequest
      && isInDeletedFolder(currentState.pendingFileTabOpenRequest.path)
    )
    const activeChanged = newActiveTabId !== currentActiveTabId
      || newActiveFilePath !== currentActiveFilePath
    const selectionChanged = nextSelectedFilePaths.length !== currentSelectedFilePaths.length
    const nextEditorViewStates = { ...currentState.editorViewStates }
    let viewStatesChanged = false
    Object.keys(nextEditorViewStates).forEach(path => {
      if (isInDeletedFolder(path)) {
        delete nextEditorViewStates[path]
        viewStatesChanged = true
      }
    })

    if (!tabsChanged && !activeChanged && !selectionChanged && !viewStatesChanged && !pendingRequestDeleted) {
      if (navigationNeedsPersistentUpdate) {
        await updatePersistedEditorNavigation((layout, helpers) => (
          helpers.cleanEditorNavigationHistoryByDeletedFolder(
            layout,
            deletedFolderPath,
            workspaceRoot,
          )
        ))
      }
      return
    }

    set({
      openTabs: newTabs,
      activeTabId: newActiveTabId,
      selectedFilePaths: nextSelectedFilePaths,
      editorViewStates: nextEditorViewStates,
      ...(pendingRequestDeleted ? { pendingFileTabOpenRequest: null } : {}),
      ...(activeChanged ? {
        activeFilePath: newActiveFilePath,
        currentArticle: '',
        readFilePath: '',
        isPulling: false,
        justPulledFile: false,
        loading: Boolean(newActiveFilePath && isLikelyFilePath(newActiveFilePath)),
      } : {}),
    })
    const persistencePromise = tabsChanged || activeChanged
      ? persistEditorState({
          ...(tabsChanged ? { openTabs: newTabs } : {}),
          ...(activeChanged ? { activeTabId: newActiveTabId } : {}),
        })
      : null
    const activatePromise = activeChanged
      ? get().setActiveFilePath(
        newActiveFilePath,
        true,
        { deactivationAlreadyPrepared: true, createIfMissing: false },
      )
      : null
    await persistencePromise
    if (activeChanged) {
      await activatePromise
    }
    if (navigationNeedsPersistentUpdate) {
      await updatePersistedEditorNavigation((layout, helpers) => (
        helpers.cleanEditorNavigationHistoryByDeletedFolder(
          layout,
          deletedFolderPath,
          workspaceRoot,
        )
      ))
    }
  },

  clearTabs: async () => {
    set({
      openTabs: [],
      activeTabId: '',
      editorViewStates: {},
      pendingFileTabOpenRequest: null,
    })
    await persistEditorState({ openTabs: [], activeTabId: '' })
  },

  matchPosition: null,
  setMatchPosition: (position: number | null) => {
    set({ matchPosition: position })
  },
  pendingSearchKeyword: '',
  setPendingSearchKeyword: (keyword: string) => {
    set({ pendingSearchKeyword: keyword })
  },

  html2md: false,
  initHtml2md: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('html2md')
    set({ html2md: res || false })
  },
  setHtml2md: async (html2md: boolean) => {
    set({ html2md })
    const store = await getStore();
    store.set('html2md', html2md)
  },

  showCloudFiles: true,
  initShowCloudFiles: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('showCloudFiles')
    set({ showCloudFiles: res ?? true })
  },

  // Initialize open tabs from store
  initOpenTabs: async () => {
    await flushEditorStatePersistence()
    const initializationRevision = editorStateMutationRevision
    const store = await getStore();
    const tabs = await store.get<OpenTabInfo[]>('openTabs')
    const activeTabId = await store.get<string>('activeTabId')
    if (editorStateMutationRevision !== initializationRevision) return
    const nextTabs = (tabs || []).map(normalizeOpenTabInfo)
    const nextActiveTabId = activeTabId && nextTabs.some(tab => tab.id === activeTabId)
      ? activeTabId
      : nextTabs.at(-1)?.id ?? ''
    const activeTab = nextTabs.find(tab => tab.id === nextActiveTabId)
    const nextActiveFilePath = getActiveFilePathForTab(activeTab)
    const shouldReadActiveArticle = Boolean(
      nextActiveFilePath && !activeTab?.isFolder && isLikelyFilePath(nextActiveFilePath)
    )
    const currentState = get()
    const canReuseActiveArticle = shouldReadActiveArticle
      && currentState.activeFilePath === nextActiveFilePath
      && (
        hasCurrentPendingArticleRead(nextActiveFilePath)
        || (!currentState.loading && currentState.readFilePath === '')
      )

    if (!shouldReadActiveArticle) {
      articleReadGeneration += 1
      pendingArticleReads.clear()
    }
    set({
      openTabs: nextTabs,
      activeTabId: nextActiveTabId,
      activeFilePath: nextActiveFilePath,
      currentArticle: canReuseActiveArticle ? currentState.currentArticle : '',
      isPulling: canReuseActiveArticle ? currentState.isPulling : false,
      justPulledFile: canReuseActiveArticle ? currentState.justPulledFile : false,
      loading: canReuseActiveArticle
        ? currentState.loading
        : shouldReadActiveArticle,
    })

    if (shouldReadActiveArticle && !canReuseActiveArticle) {
      void get().readArticle(nextActiveFilePath, undefined, true, {
        createIfMissing: false,
      })
    }

    const latestEditorState = get()
    await persistEditorState({
      openTabs: latestEditorState.openTabs,
      activeTabId: latestEditorState.activeTabId,
      activeFilePath: latestEditorState.activeFilePath,
    })
  },
  setShowCloudFiles: async (show: boolean) => {
    set({ showCloudFiles: show })
    const store = await getStore();
    await store.set('showCloudFiles', show)
  },
  showAssetsFolders: true,
  initShowAssetsFolders: async () => {
    const store = await getStore()
    const show = await store.get<boolean>('showAssetsFolders')
    set({ showAssetsFolders: show ?? true })
  },
  setShowAssetsFolders: async (show: boolean) => {
    set({ showAssetsFolders: show })
    const store = await getStore()
    await store.set('showAssetsFolders', show)
  },
  syncStaticAssets: true,
  initSyncStaticAssets: async () => {
    const store = await getStore()
    const enabled = await store.get<boolean>('syncStaticAssets')
    set({ syncStaticAssets: enabled ?? true })
  },
  setSyncStaticAssets: async (enabled: boolean) => {
    set({ syncStaticAssets: enabled })
    const store = await getStore()
    await store.set('syncStaticAssets', enabled)
  },
  showKnowledgeBaseStatus: true,
  initShowKnowledgeBaseStatus: async () => {
    const store = await getStore()
    const show = await store.get<boolean>('showKnowledgeBaseStatus')
    set({ showKnowledgeBaseStatus: show ?? true })
  },
  setShowKnowledgeBaseStatus: async (show: boolean) => {
    set({ showKnowledgeBaseStatus: show })
    const store = await getStore()
    await store.set('showKnowledgeBaseStatus', show)
  },

  fileTree: [],
  fileTreeInitialized: false,
  fileTreeWorkspaceKey: null,
  setFileTree: (tree: DirTree[]) => {
    const sortedTree = get().sortFileTree(tree)
    set({ fileTree: sortedTree, fileTreeInitialized: true })
  },
  setEntryLoading: (relativePath: string, loading: boolean) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      loading: loading || undefined,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  setEntrySyncError: (relativePath: string, error?: string) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      syncError: error,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileRemote: (relativePath: string, sha: string) => {
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => {
      if (!entry.isFile) return entry
      return {
        ...entry,
        sha,
        syncDirty: false,
        syncError: undefined,
      }
    })
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileLocal: (relativePath: string) => {
    const nextTree = updateTreeEntryByPath(
      get().fileTree,
      relativePath,
      entry => entry.isFile
        ? { ...entry, isLocale: true, loading: undefined }
        : entry,
      true
    )
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  markFileDirty: (relativePath: string) => {
    const current = getCurrentFolder(relativePath, get().fileTree)
    if (!current?.isFile || !current.sha || current.syncDirty) return false
    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => ({
      ...entry,
      syncDirty: true,
    }))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  reconcileLocalFile: (relativePath: string, isPresent: boolean) => {
    const currentTree = get().fileTree
    const current = getCurrentFolder(relativePath, currentTree)

    if (isPresent) {
      if (current) {
        if (!current.isFile) return false
        return get().markFileLocal(relativePath)
      }
      return get().insertLocalEntry(relativePath, false)
    }

    if (!current) return true
    if (!current.isFile) return false

    if (current.sha) {
      const nextTree = updateTreeEntryByPath(currentTree, relativePath, entry => ({
        ...entry,
        isLocale: false,
        loading: undefined,
        syncDirty: false,
      }))
      if (!nextTree) return false
      set({ fileTree: nextTree })
      return true
    }

    return get().removeLocalEntry(relativePath)
  },
  clearFileRemoteState: (relativePath: string) => {
    const current = getCurrentFolder(relativePath, get().fileTree)
    if (!current?.isFile) return false

    const nextTree = updateTreeEntryByPath(get().fileTree, relativePath, entry => (
      entry.isLocale
        ? {
            ...entry,
            sha: undefined,
            loading: undefined,
            syncDirty: false,
            syncError: undefined,
          }
        : null
    ))
    if (!nextTree) return false
    set({ fileTree: nextTree })
    return true
  },
  addFile: (file: DirTree) => {
    set({ fileTree: [file, ...get().fileTree] })
  },
  ensurePathExpanded: async (path: string) => {
    const folderPaths = getFolderPathsToExpand(path)
    if (folderPaths.length === 0) {
      return
    }

    const collapsibleList = uniq([...get().collapsibleList, ...folderPaths])
    const store = await getStore()
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList })
  },
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => {
    const cacheTree = cloneDeep(get().fileTree)
    const inserted = insertNodeIntoTree(cacheTree, relativePath, isDirectory)

    if (!inserted) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  removeLocalEntry: (relativePath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removed = removeNodeFromTree(cacheTree, relativePath)

    if (!removed) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  moveLocalEntry: (oldPath: string, newPath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removedNode = removeNodeFromTree(cacheTree, oldPath)

    if (!removedNode) {
      return false
    }

    const attached = attachNodeToTree(cacheTree, newPath, removedNode)
    if (!attached) {
      return false
    }

    get().setFileTree(cacheTree)
    void import('@/lib/self-hosted-sync/outbox').then(({ enqueuePathMove }) => (
      enqueuePathMove(oldPath, newPath)
    ))
    return true
  },
  syncOpenTabsForPathChange: async (oldPath: string, newPath: string) => {
    const mapMovedPath = (path: string) => {
      if (path === oldPath) {
        return newPath
      }

      if (path.startsWith(`${oldPath}/`)) {
        return `${newPath}${path.slice(oldPath.length)}`
      }

      return path
    }

    const queuedSavesToRebase: Array<{ path: string; content: string }> = []
    for (const [savePath, pendingSave] of pendingArticleSaves) {
      const nextSavePath = mapMovedPath(savePath)
      if (nextSavePath === savePath) continue
      if (pendingSave.timer) clearTimeout(pendingSave.timer)
      pendingArticleSaves.delete(savePath)
      queuedSavesToRebase.push({ path: nextSavePath, content: pendingSave.content })
    }

    if (pendingVectorCalculation) {
      const nextVectorPath = mapMovedPath(pendingVectorCalculation.path)
      if (nextVectorPath !== pendingVectorCalculation.path) {
        pendingVectorCalculation = {
          ...pendingVectorCalculation,
          path: nextVectorPath,
        }
      }
    }

    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const currentFileTabOpenRequest = get().pendingFileTabOpenRequest
    const nextActiveFilePath = mapMovedPath(currentActiveFilePath)
    const newTabs = currentTabs.map(tab => {
      if (isRecordOpenTab(tab)) {
        return tab
      }

      const nextPath = mapMovedPath(tab.path)
      if (nextPath === tab.path) {
        return tab
      }

      return {
        ...tab,
        path: nextPath,
        name: nextPath.split('/').pop() || nextPath,
      }
    })

    const nextActiveTabId = currentTabs.some(tab => mapMovedPath(tab.path) !== tab.path)
      ? currentActiveTabId
      : get().activeTabId

    const nextEditorViewStates = Object.entries(get().editorViewStates).reduce<Record<string, EditorViewState>>((states, [path, viewState]) => {
      states[mapMovedPath(path)] = viewState
      return states
    }, {})
    const nextSelectedFilePaths = get().selectedFilePaths.map(mapMovedPath)
    const nextFileTabOpenRequest = currentFileTabOpenRequest
      ? (() => {
          const nextPath = mapMovedPath(currentFileTabOpenRequest.path)
          return {
            ...currentFileTabOpenRequest,
            path: nextPath,
            name: nextPath === currentFileTabOpenRequest.path
              ? currentFileTabOpenRequest.name
              : nextPath.split(/[\\/]/).pop() || currentFileTabOpenRequest.name,
          }
        })()
      : null

    set({
      openTabs: newTabs,
      activeTabId: nextActiveTabId,
      editorViewStates: nextEditorViewStates,
      selectedFilePaths: nextSelectedFilePaths,
      pendingFileTabOpenRequest: nextFileTabOpenRequest,
    })
    const persistencePromise = persistEditorState({
      openTabs: newTabs,
      activeTabId: nextActiveTabId,
    })
    let navigationHandled = false
    emitter.emit('editor-navigation-path-moved', {
      oldPath,
      newPath,
      markHandled: () => { navigationHandled = true },
    })
    if (!navigationHandled) {
      await updatePersistedEditorNavigation((layout, helpers) => (
        helpers.mapEditorNavigationHistoryForPathChange(layout, oldPath, newPath)
      ))
    }
    if (nextActiveFilePath !== currentActiveFilePath) {
      await get().setActiveFilePath(
        nextActiveFilePath,
        true,
        { deactivationAlreadyPrepared: true, createIfMissing: false },
      )
    }
    await persistencePromise

    for (const queuedSave of queuedSavesToRebase) {
      await get().saveCurrentArticle(queuedSave.content, queuedSave.path)
      await get().flushPendingArticleSave(queuedSave.path)
    }
  },
  fileTreeLoading: false,
  updateFileStats: async (basePath: string, tree: DirTree[]) => {
    const workspace = await getWorkspacePath()
    
    for (const entry of tree) {
      // 跳过非本地文件（远程同步文件）
      if (entry.isFile && entry.isLocale) {
        const filePath = await join(basePath, entry.name)
        try {
          let fileStat
          if (workspace.isCustom) {
            // 自定义工作区，使用绝对路径
            fileStat = await stat(filePath)
          } else {
            // 默认工作区，使用AppData路径
            const relPath = await toWorkspaceRelativePath(filePath)
            const pathOptions = await getFilePathOptions(relPath)
            fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          entry.createdAt = fileStat.birthtime?.toISOString()
          entry.modifiedAt = fileStat.mtime?.toISOString()
          entry.size = fileStat.size
        } catch {
          // 静默失败，不阻塞排序功能
        }
      } else if (entry.isDirectory && entry.children) {
        const dirPath = await join(basePath, entry.name)
        await get().updateFileStats(dirPath, entry.children)
      }
    }
    return tree
  },
  
  // 按需加载文件统计信息（仅在需要排序时）
  loadFileStatsIfNeeded: async () => {
    const fileTree = get().fileTree
    
    // 检查是否已加载过统计信息（检查第一个文件）
    const hasStats = fileTree.some(entry => 
      entry.isFile && (entry.createdAt !== undefined || entry.modifiedAt !== undefined)
    )
    
    if (hasStats) {
      // 已经加载过，无需重复加载
      return
    }
    
    // 加载统计信息
    const workspace = await getWorkspacePath()
    // 使用正确的基础路径
    const basePath = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
    await get().updateFileStats(basePath, fileTree)
    set({ fileTree: [...fileTree] }) // 触发重新渲染
  },
  
  loadFileTree: async (options) => {
    set({ fileTreeLoading: true })
    // 知识库状态不应阻塞文件树展示；初始化函数会合并并发请求。
    void get().initVectorIndexedFiles()

    // 必须先解析目标工作区，再决定是否复用现有文件树。
    const workspace = await getWorkspacePath()
    const workspaceKey = getFileTreeWorkspaceKey(workspace)
    const workspaceChanged = fileTreeWorkspaceKey !== workspaceKey
    if (fileTreeWorkspaceKey !== null && workspaceChanged) {
      articleReadGeneration += 1
      pendingArticleReads.clear()
    }
    const requestContext: FileTreeRequestContext = {
      workspaceKey,
      generation: ++fileTreeLoadGeneration,
    }
    fileTreeWorkspaceKey = workspaceKey

    const cachedTree = workspaceChanged ? [] : get().fileTree
    if (workspaceChanged) {
      // 切换工作区时立即移除旧的本地树和仅远端节点。
      set({
        fileTree: [],
        fileTreeInitialized: false,
        fileTreeWorkspaceKey: workspaceKey,
      })
    } else {
      set({ fileTreeWorkspaceKey: workspaceKey })
    }

    // 确保 collapsibleList 已初始化
    if (!get().collapsibleListInitialized) {
      await get().initCollapsibleList()
    }
    
    // 确保工作区目录存在
    if (workspace.isCustom) {
      // 自定义工作区
      const isWorkspaceExists = await exists(workspace.path)
      if (!isWorkspaceExists) {
        await mkdir(workspace.path)
      }
    } else {
      // 默认工作区
      const isArticleDir = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!isArticleDir) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
    }

    // 读取工作区文件（仅根目录）
    let dirs: DirTree[] = []
    if (workspace.isCustom) {
      // 自定义工作区
      dirs = (await readDir(workspace.path))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined,
          childrenLoaded: file.isDirectory ? false : undefined
        }))
    } else {
      // 默认工作区
      dirs = (await readDir('article', { baseDir: BaseDirectory.AppData }))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined,
          childrenLoaded: file.isDirectory ? false : undefined
        }))
    }
    
    // 为已展开的文件夹加载子内容
    const collapsibleList = get().collapsibleList
    if (collapsibleList.length > 0) {
      // 只加载根级别已展开的文件夹
      const rootExpandedFolders = dirs.filter(dir => dir.isDirectory && collapsibleList.includes(dir.name))
      for (const folder of rootExpandedFolders) {
        await loadFolderChildren(workspace, folder)
      }
    }
    
    // 递归加载已展开文件夹的子内容
    async function loadFolderChildren(workspace: any, folder: DirTree, parentPath: string = '') {
      const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
      const fullPath = await join(workspace.path, folderPath)
      
      let children: DirTree[] = []
      
      // 检查目录是否存在
      let dirExists = false
      try {
        if (workspace.isCustom) {
          dirExists = await exists(fullPath)
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      } catch {
        dirExists = false
      }
      
      // 如果目录存在，加载本地文件
      if (dirExists) {
        try {
          if (workspace.isCustom) {
            children = (await readDir(fullPath))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined,
                childrenLoaded: file.isDirectory ? false : undefined
              })) as DirTree[]
          } else {
            const dirRelative = await toWorkspaceRelativePath(fullPath)
            const pathOptions = await getFilePathOptions(dirRelative)
            children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined,
                childrenLoaded: file.isDirectory ? false : undefined
              })) as DirTree[]
          }
        } catch {
          // 读取失败，使用空数组
        }
      }
      
      folder.children = children
      folder.childrenLoaded = true
      
      // 递归加载子文件夹中已展开的文件夹
      for (const child of children) {
        if (child.isDirectory && collapsibleList.includes(`${folderPath}/${child.name}`)) {
          await loadFolderChildren(workspace, child, folderPath)
        }
      }
    }
        
    // 排序文件树
    const sortedDirs = get().sortFileTree(
      mergeRefreshedLocalEntries(dirs, cachedTree)
    )
    if (!await canApplyFileTreeRequest(requestContext)) return

    // OneDrive 先恢复上次成功获取的远程清单，让文件树无需等待网络即可展示。
    // 随后的后台刷新会用最新结果覆盖缓存，并清理已经从远端移除的纯远程节点。
    const syncContext = await getCurrentSyncContext()
    if (syncContext.provider === 'cloudFolder') {
      const syncTargetKey = getRemoteSyncTargetKey(syncContext)
      const store = await getStore()
      const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (cloudFolderConfig?.provider === 'oneDrive' && cloudFolderConfig.path) {
        const cacheTargetKey = getCloudFolderTreeCacheTargetKey(syncTargetKey, cloudFolderConfig)
        const cachedRemoteFiles = await readCloudFolderTreeCache(cacheTargetKey)
        if (cachedRemoteFiles && await canApplyFileTreeRequest(requestContext)) {
          mergeCloudFolderSnapshotIntoTree(
            cachedRemoteFiles,
            buildRemotePathsToLoad(collapsibleList),
            sortedDirs,
          )
        }
      }
    }
    if (!await canApplyFileTreeRequest(requestContext)) return

    set({
      fileTree: sortedDirs,
      fileTreeInitialized: true,
      fileTreeLoading: false,
    })

    // 异步加载远程同步文件（不阻塞界面）
    if (!options?.skipRemoteSync) {
      void get().loadRemoteSyncFiles(requestContext).catch(() => undefined)
    }
  },
  
  // 加载远程同步文件（后台任务）
  loadRemoteSyncFiles: async (context) => {
    try {
      const syncContext = await getCurrentSyncContext()
      if (fileTreeWorkspaceKey === null) {
        fileTreeWorkspaceKey = syncContext.workspaceKey
        set({ fileTreeWorkspaceKey: syncContext.workspaceKey })
      }
      const requestContext: RemoteFileTreeRequestContext = {
        ...(context ?? {
          workspaceKey: syncContext.workspaceKey,
          generation: fileTreeLoadGeneration,
        }),
        syncTargetKey: getRemoteSyncTargetKey(syncContext),
      }
      if (!await canApplyRemoteFileTreeRequest(requestContext)) return
      if (!await isSyncConfigured()) return
      if (!await canApplyRemoteFileTreeRequest(requestContext)) return
      const store = await getStore();
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
      
      if (primaryBackupMethod === 'github') {
        const accessToken = await store.get<string>('accessToken')
        if (!accessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitee') {
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        if (!giteeAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitlab') {
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        if (!gitlabAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitea') {
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        if (!giteaAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 's3') {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) {
          return
        }
      } else if (primaryBackupMethod === 'webdav') {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
          return
        }
      } else if (primaryBackupMethod === 'cloudFolder') {
        const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
        if (!cloudFolderConfig?.path || !supportsCloudFolderWorkspace(cloudFolderConfig)) return
      }

    // 为根目录和已展开的目录加载远程文件。
    // 这样即使目录只存在于云端，只要用户已展开过，也能继续加载其远程内容。
    const collapsibleList = get().collapsibleList
    const pathsToLoad = buildRemotePathsToLoad(collapsibleList)
    let firstRemoteLoadError: unknown
    let cloudFolderSnapshot: CloudFolderObject[] | undefined
    
    // 目录树会在加载过程中逐步插入父级节点，因此这里必须按层级顺序加载。
    // 如果并发请求深层路径，远端子目录可能会在父目录节点尚未写入树时被跳过。
    for (const path of pathsToLoad) {
      if (!await canApplyRemoteFileTreeRequest(requestContext)) return
      try {
        let files;
        switch (primaryBackupMethod) {
          case 'github':
            const githubRepo = await getSyncRepoName('github');
            files = await withRemoteTimeout(getGithubFiles({ path, repo: githubRepo }), path);
            break;
          case 'gitee':
            const giteeRepo = await getSyncRepoName('gitee');
            files = await withRemoteTimeout(getGiteeFiles({ path, repo: giteeRepo }), path);
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab');
            files = await withRemoteTimeout(getGitlabFiles({ path, repo: gitlabRepo }), path);
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea');
            files = await withRemoteTimeout(getGiteaFiles({ path, repo: giteaRepo }), path);
            break;
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              files = await withRemoteTimeout(s3ListObjects(s3Config, path), path)
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              files = await withRemoteTimeout(webdavListObjects(webdavConfig, path), path)
            }
            break;
          }
          case 'cloudFolder': {
            const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
            if (cloudFolderConfig) {
              cloudFolderSnapshot ??= await loadCloudFolderRemoteSnapshot(
                getCloudFolderTreeCacheTargetKey(requestContext.syncTargetKey, cloudFolderConfig),
                cloudFolderConfig,
                true,
              )
              files = cloudFolderSnapshot
            }
            break
          }
        }

        if (!await canApplyRemoteFileTreeRequest(requestContext)) return
        if (files) {
          const dirs = get().fileTree

          // S3 或 WebDAV 文件处理
          if (primaryBackupMethod === 'cloudFolder') {
            if (path) {
              const currentFolder = getCurrentFolder(path, dirs)
              if (currentFolder) {
                mergeCloudFolderRemoteEntries(
                  files as CloudFolderObject[],
                  path,
                  currentFolder.children ?? (currentFolder.children = []),
                  currentFolder,
                )
              }
            } else {
              mergeCloudFolderRemoteEntries(files as CloudFolderObject[], path, dirs)
            }
          } else if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            if (!await canApplyRemoteFileTreeRequest(requestContext)) return
            const fullPrefix = prefix ? `${prefix}/${path}` : path

            s3Files.forEach((file) => {
              const fileName = file.key.split('/').pop() || file.key
              if (fileName.startsWith('.')) {
                return;
              }

              // 计算相对路径
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return
              }

              const isDirectory = file.key.endsWith('/')

              // 移除 pathPrefix 前缀，转换为本地相对路径
              let localItemPath = file.key
              if (prefix && localItemPath.startsWith(prefix + '/')) {
                localItemPath = localItemPath.substring(prefix.length + 1)
              }

              let currentFolder: DirTree | undefined
              if (isDirectory) {
                currentFolder = getCurrentFolder(localItemPath, dirs)?.parent
              } else {
                const filePath = localItemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }

              if (localItemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.etag
                  currentFolder.children[index].size = file.size
                  currentFolder.children[index].modifiedAt = file.lastModified
                } else {
                  currentFolder?.children?.push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.etag
                  dirs[index].size = file.size
                  dirs[index].modifiedAt = file.lastModified
                } else {
                  (dirs as any).push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              }
            })
          } else {
            // Git 平台处理逻辑
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // 过滤以"."开头的文件和文件夹
              if (file.name.startsWith('.')) {
                return;
              }

              // 只加载直接子项，不加载孙子项
              const relativePath = path ? file.path.substring(path.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳过非直接子项
              }

              const itemPath = file.path;
              let currentFolder: DirTree | undefined
              if (file.type === 'dir') {
                currentFolder = getCurrentFolder(itemPath, dirs)?.parent
              } else {
                const filePath = itemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }
              if (itemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.sha
                  currentFolder.children[index].size = (file as any).size
                } else {
                  currentFolder?.children?.push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.sha
                  dirs[index].size = (file as any).size
                } else {
                  (dirs as any).push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              }
            });
          }
          if (isFileTreeRequestCurrent(requestContext)) {
            set({ fileTree: [...dirs] })
          }
        }
      } catch (error) {
        if (!await canApplyRemoteFileTreeRequest(requestContext)) return
        firstRemoteLoadError ??= error
      }
    }
    if (firstRemoteLoadError) throw firstRemoteLoadError
  } catch (error) {
    throw error
  }
  },
  // 加载文件夹内部的本地和远程文件（按需加载）
  loadCollapsibleFiles: async (fullpath: string, options?: { force?: boolean; skipRemoteSync?: boolean }) => {
    const workspace = await getWorkspacePath()
    const requestContext: FileTreeRequestContext = {
      workspaceKey: getFileTreeWorkspaceKey(workspace),
      generation: fileTreeLoadGeneration,
    }
    if (!await canApplyFileTreeRequest(requestContext)) return

    const cacheTree: DirTree[] = get().fileTree
    const currentFolder = getCurrentFolder(fullpath, cacheTree)

    if (!currentFolder) {
      return
    }

    // 检查是否是目录（防止误将文件当作目录处理）
    if (!currentFolder.isDirectory) {
      return
    }

    // 如果已经加载过子内容，则跳过
    if (!options?.force && currentFolder.childrenLoaded) {
      // 仅异步更新远程同步状态
      if (!options?.skipRemoteSync) {
        void get().loadFolderRemoteFiles(fullpath).catch(() => undefined)
      }
      return
    }
    
    // 尝试加载本地子目录内容
    const fullFolderPath = await join(workspace.path, fullpath)
    
    let children: DirTree[] = []
    
    // 检查目录是否存在
    let dirExists = false
    try {
      if (workspace.isCustom) {
        dirExists = await exists(fullFolderPath)
      } else {
        const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
        const pathOptions = await getFilePathOptions(dirRelative)
        dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      dirExists = false
    }
    
    // 如果目录存在，加载本地文件
    if (dirExists) {
      try {
        if (workspace.isCustom) {
          children = (await readDir(fullFolderPath))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.'))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined,
              childrenLoaded: file.isDirectory ? false : undefined
            })) as DirTree[]
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.'))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined,
              childrenLoaded: file.isDirectory ? false : undefined
            })) as DirTree[]
        }
      } catch {
        // 读取失败，使用空数组
      }
    }

    // 文件监听触发的仅本地刷新也必须保留仅远程节点，否则下载一个远程文件后，
    // 同目录的其他远程文件会从列表中消失。
    if (!await canApplyFileTreeRequest(requestContext)) return
    currentFolder.children = get().sortFileTree(
      mergeRefreshedLocalEntries(children, currentFolder.children ?? [], currentFolder)
    )
    currentFolder.childrenLoaded = true
    set({ fileTree: [...cacheTree] })
    
    // 异步加载远程同步文件状态（不阻塞界面）
    // 这将会填充仅存在于云端的文件
    if (!options?.skipRemoteSync) {
      void get().loadFolderRemoteFiles(fullpath).catch(() => undefined)
    }
  },
  
  // 加载特定文件夹的远程同步文件（后台任务）
  loadFolderRemoteFiles: async (fullpath: string) => {
    const syncContext = await getCurrentSyncContext()
    if (fileTreeWorkspaceKey === null) {
      fileTreeWorkspaceKey = syncContext.workspaceKey
      set({ fileTreeWorkspaceKey: syncContext.workspaceKey })
    }
    const requestContext: RemoteFileTreeRequestContext = {
      workspaceKey: syncContext.workspaceKey,
      generation: fileTreeLoadGeneration,
      syncTargetKey: getRemoteSyncTargetKey(syncContext),
    }
    if (!await canApplyRemoteFileTreeRequest(requestContext)) return

    const pendingKey = JSON.stringify([
      syncContext.workspaceKey,
      syncContext.provider,
      syncContext.repo,
      fullpath,
    ])
    const pending = remoteFolderLoadPromises.get(pendingKey)
    if (pending) return pending

    const task = (async () => {
    if (!await isSyncConfigured()) return
    if (!await canApplyRemoteFileTreeRequest(requestContext)) return
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    // 检查是否配置了访问令牌
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      if (!accessToken) return
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      if (!giteeAccessToken) return
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      if (!gitlabAccessToken) return
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      if (!giteaAccessToken) return
    } else if (primaryBackupMethod === 's3') {
      const s3Config = await store.get<S3Config>('s3SyncConfig')
      if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) return
    } else if (primaryBackupMethod === 'webdav') {
      const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) return
    } else if (primaryBackupMethod === 'cloudFolder') {
      const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
      if (!cloudFolderConfig?.path || !supportsCloudFolderWorkspace(cloudFolderConfig)) return
    }

    // loading 只表示真实的远程目录请求。本地目录扫描（包括搜索第一阶段）
    // 不应改变这个状态。
    if (!await canApplyRemoteFileTreeRequest(requestContext)) return
    const loadingTree = get().fileTree
    const loadingFolder = getCurrentFolder(fullpath, loadingTree)
    if (loadingFolder && !loadingFolder.loading) {
      loadingFolder.loading = true
      set({ fileTree: [...loadingTree] })
    }

    try {
      let files;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo1 = await getSyncRepoName('github');
          files = await withRemoteTimeout(
            getGithubFiles({ path: fullpath, repo: githubRepo1 }),
            fullpath
          );
          break;
        case 'gitee':
          const giteeRepo1 = await getSyncRepoName('gitee');
          files = await withRemoteTimeout(
            getGiteeFiles({ path: fullpath, repo: giteeRepo1 }),
            fullpath
          );
          break;
        case 'gitlab':
          const gitlabRepo1 = await getSyncRepoName('gitlab');
          files = await withRemoteTimeout(
            getGitlabFiles({ path: fullpath, repo: gitlabRepo1 }),
            fullpath
          );
          break;
        case 'gitea':
          const giteaRepo1 = await getSyncRepoName('gitea');
          files = await withRemoteTimeout(
            getGiteaFiles({ path: fullpath, repo: giteaRepo1 }),
            fullpath
          );
          break;
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            files = await withRemoteTimeout(s3ListObjects(s3Config, fullpath), fullpath)
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            files = await withRemoteTimeout(webdavListObjects(webdavConfig, fullpath), fullpath)
          }
          break;
        }
        case 'cloudFolder': {
          const cloudFolderConfig = await store.get<CloudFolderConfig>('cloudFolderSyncConfig')
          if (cloudFolderConfig) {
            files = await loadCloudFolderRemoteSnapshot(
              getCloudFolderTreeCacheTargetKey(requestContext.syncTargetKey, cloudFolderConfig),
              cloudFolderConfig,
              false,
            )
          }
          break
        }
      }

      if (!await canApplyRemoteFileTreeRequest(requestContext)) return
      if (files) {
        const cacheTree = get().fileTree
        const currentFolder = getCurrentFolder(fullpath, cacheTree)

        if (currentFolder) {
          // S3 和 WebDAV 返回的文件格式相同，需要特殊处理
          if (primaryBackupMethod === 'cloudFolder') {
            mergeCloudFolderRemoteEntries(
              files as CloudFolderObject[],
              fullpath,
              currentFolder.children ?? (currentFolder.children = []),
              currentFolder,
            )
          } else if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            if (!await canApplyRemoteFileTreeRequest(requestContext)) return
            const fullPrefix = prefix ? `${prefix}/${fullpath}` : fullpath

            s3Files.forEach((file) => {
              // 提取文件名（key 的最后一部分）
              const fileName = file.key.split('/').pop() || file.key
              // 过滤以"."开头的文件和文件夹
              if (fileName.startsWith('.')) {
                return;
              }

              // 只加载直接子项，不加载孙子项
              // 例如: fullPrefix='test', file.key='test/file.md' → 加载
              //      fullPrefix='test', file.key='test/sub/file.md' → 跳过
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳过非直接子项
              }

              // S3 没有文件夹概念，检查 key 是否以 / 结尾来判断是否是"文件夹"
              const isDirectory = file.key.endsWith('/')

              const index = currentFolder.children?.findIndex(item => item.name === fileName)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.etag
                currentFolder.children[index].size = file.size
                currentFolder.children[index].modifiedAt = file.lastModified
              } else {
                currentFolder.children?.push({
                  name: fileName,
                  isFile: !isDirectory,
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: isDirectory,
                  sha: file.etag,
                  size: file.size,
                  isLocale: false,
                  modifiedAt: file.lastModified,
                  children: isDirectory ? [] : undefined
                })
              }
            })
          } else {
            // Git 平台处理逻辑
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // 过滤以"."开头的文件和文件夹
              if (file.name.startsWith('.')) {
                return;
              }

              // 只加载直接子项，不加载孙子项
              // 例如: fullpath='test', file.path='test/file.md' → 加载
              //      fullpath='test', file.path='test/sub/file.md' → 跳过
              const relativePath = fullpath ? file.path.substring(fullpath.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳过非直接子项
              }

              const index = currentFolder.children?.findIndex(item => item.name === file.name)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.sha
                currentFolder.children[index].size = (file as any).size
              } else {
                currentFolder.children?.push({
                  name: file.name,
                  isFile: file.type === 'file',
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: file.type === 'dir',
                  sha: file.sha,
                  size: (file as any).size,
                  isLocale: false,
                  children: file.type === 'file' ? undefined : []
                })
              }
            });
          }

          if (isFileTreeRequestCurrent(requestContext)) {
            set({ fileTree: [...cacheTree] })
          }
        }
      }
      if (isFileTreeRequestCurrent(requestContext)) {
        get().setEntrySyncError(fullpath, undefined)
      }
    } catch (error) {
      if (!await canApplyRemoteFileTreeRequest(requestContext)) return
      const message = error instanceof Error ? error.message : String(error)
      get().setEntrySyncError(fullpath, message)
      throw error
    } finally {
      // 成功、空结果或请求失败都必须结束该节点的加载状态。
      if (await canApplyRemoteFileTreeRequest(requestContext)) {
        const cacheTree = get().fileTree
        const currentFolder = getCurrentFolder(fullpath, cacheTree)
        if (currentFolder?.loading) {
          currentFolder.loading = false
          set({ fileTree: [...cacheTree] })
        }
      }
    }
    })()

    remoteFolderLoadPromises.set(pendingKey, task)
    try {
      await task
    } finally {
      if (remoteFolderLoadPromises.get(pendingKey) === task) {
        remoteFolderLoadPromises.delete(pendingKey)
      }
    }
  },
  newFolder: async () => {
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isDirectory)
    if (exists) {
      return
    }
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      children: [],
      childrenLoaded: true
    }

    try {
      cacheTree.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },
  newFile: async () => {
    // 检查现有树中是否已有空文件名的文件（正在编辑中）
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isFile)
    if (exists) {
      return
    }
  
    // 判断 activeFilePath 是否存在 parent
    const path = get().activeFilePath;
    if (path.includes('/')) {
      // 在当前活动文件的父文件夹下创建新文件
      const folderPath = path.split('/').slice(0, -1).join('/')
      const currentFolder = getCurrentFolder(folderPath, cacheTree)
      
      // 如果文件夹中已经有一个空名称的文件，不再创建新的
      if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
        return
      }
      
      // 确保文件夹是展开状态
      const collapsibleList = get().collapsibleList
      if (!collapsibleList.includes(folderPath)) {
        collapsibleList.push(folderPath)
        set({ collapsibleList })
      }
      
      if (currentFolder) {
        const newFile: DirTree = {
          name: '',
          isFile: true,
          isSymlink: false,
          parent: currentFolder,
          isEditing: true,
          isDirectory: false,
          isLocale: true,
          sha: '',
          children: []
        }
        currentFolder.children?.unshift(newFile)
        set({ fileTree: cacheTree })
      }
    } else {
      // 不存在 parent，直接在根目录下创建
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: undefined,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      }
      cacheTree.unshift(newFile)
      set({ fileTree: cacheTree })
    }
  },

  newFileOnFolder: async (path: string) => {
    if (!await prepareActiveEditorDeactivationDurably(get().activeFilePath)) {
      return
    }

    // 获取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 获取工作区路径信息
    const workspace = await getWorkspacePath()
    
    // 创建新文件
    const file = `新建文件-${new Date().getTime()}.md`
    const fullPath = `${path}/${file}`
    const pathOptions = await getFilePathOptions(fullPath)
    
    // 写入空文件
    if (await writeSelfHostedWorkspaceText(fullPath, '')) {
      // Rust journal already persisted the synchronized file.
    } else if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, '')
    } else {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    }

    // 更新树
    const node = {
      name: file,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isEditing: false,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: [],
      childrenLoaded: true
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
      await get().setActiveFilePath(
        fullPath,
        true,
        { deactivationAlreadyPrepared: true },
      )
    } catch {
    }
  },
  newFolderInFolder: async (path: string) => {
    // 获取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 如果文件夹中已存在未命名文件夹，不创建新的
    const hasEmptyFolder = currentFolder?.children?.find(item => item.name === '' && item.isDirectory)
    if (hasEmptyFolder) {
      return
    }

    // 更新树
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },

  collapsibleList: [],
  collapsibleListInitialized: false,
  initCollapsibleList: async () => {
    // 防止重复初始化
    if (get().collapsibleListInitialized) {
      return
    }

    const store = await getStore();
    const key = await getCollapsibleStoreKey()
    const scopedList = await store.get<string[]>(key)
    const legacyList = key.endsWith('__default__')
      ? await store.get<string[]>('collapsibleList')
      : undefined
    const res = scopedList ?? legacyList
    if (!scopedList && legacyList) {
      await store.set(key, legacyList)
    }
    const activeFilePathKey = await getWorkspaceStoreKey('activeFilePath')
    const storedActiveFilePath = await store.get<string>(activeFilePathKey)
      ?? await store.get<string>('activeFilePath')
    const activeFilePath = storedActiveFilePath && !isVirtualOpenTabPath(storedActiveFilePath)
      ? storedActiveFilePath
      : ''
    const collapsibleList = res
      ? uniq(res.filter(item => (
        !isVirtualOpenTabPath(item)
        && !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)
      )))
      : []
    set({
      collapsibleList,
      collapsibleListInitialized: true
    })

    if (storedActiveFilePath && isVirtualOpenTabPath(storedActiveFilePath)) {
      await persistEditorState({
        activeFilePath: '',
        persistWorkspaceActiveFilePath: true,
      })
    }
    if (res && collapsibleList.length !== res.length) {
      await store.set(key, collapsibleList)
    }

    if (activeFilePath) {
      const currentState = get()

      // 检查是否是文件夹（所有支持的文件扩展名都是文件，不是文件夹）
      if (!activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
        set({ activeFilePath })
        // 文件夹：确保展开并加载内容
        if (!get().collapsibleList.includes(activeFilePath)) {
          await get().setCollapsibleList(activeFilePath, true)
        }
        await get().loadCollapsibleFiles(activeFilePath)
      } else {
        const canReuseActiveArticle = currentState.activeFilePath === activeFilePath
          && (
            hasCurrentPendingArticleRead(activeFilePath)
            || (!currentState.loading && currentState.readFilePath === '')
          )
        if (!canReuseActiveArticle) {
          set({
            activeFilePath,
            currentArticle: '',
            loading: true,
            isPulling: false,
            justPulledFile: false,
          })
          void get().readArticle(activeFilePath, undefined, true, {
            createIfMissing: false,
          })
        }
      }
    }
  },
  
  setCollapsibleList: async (path: string, value: boolean) => {
    const collapsibleList = cloneDeep(get().collapsibleList)
    if (value) {
      collapsibleList.push(path)
    } else {
      const index = collapsibleList.indexOf(path)
      if (index !== -1) {
        collapsibleList.splice(index, 1)
      }
    }
    const store = await getStore();
    await store.set(await getCollapsibleStoreKey(), collapsibleList)
    set({ collapsibleList: uniq(collapsibleList).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) })
  },
  
  expandAllFolders: async () => {
    const getAllFolderPaths = (tree: DirTree[], parentPath: string = ''): string[] => {
      let paths: string[] = []
      for (const item of tree) {
        if (!item.isFile) {
          const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name
          paths.push(currentPath)
          if (item.children && item.children.length > 0) {
            paths = [...paths, ...getAllFolderPaths(item.children, currentPath)]
          }
        }
      }
      return paths
    }

    const loadedPaths = new Set<string>()
    while (true) {
      const pendingPaths = getAllFolderPaths(get().fileTree)
        .filter(path => !loadedPaths.has(path))
      if (pendingPaths.length === 0) break

      for (let index = 0; index < pendingPaths.length; index += 4) {
        const batch = pendingPaths.slice(index, index + 4)
        batch.forEach(path => loadedPaths.add(path))
        await Promise.all(batch.map(path => (
          get().loadCollapsibleFiles(path, { skipRemoteSync: true })
        )))
      }
    }

    const folderPaths = getAllFolderPaths(get().fileTree)
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), folderPaths)
    set({ collapsibleList: uniq(folderPaths) })
  },
  
  collapseAllFolders: async () => {
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), [])
    set({ collapsibleList: [] })
  },
  
  toggleAllFolders: async () => {
    // If there are any expanded folders, collapse all; otherwise, expand all
    if (get().collapsibleList.length > 0) {
      await get().collapseAllFolders()
    } else {
      await get().expandAllFolders()
    }
  },
  clearCollapsibleList: async () => {
    set({ collapsibleList: [] })
    const store = await getStore()
    await store.set(await getCollapsibleStoreKey(), [])
  },
  loadWorkspaceCollapsibleList: async () => {
    const store = await getStore()
    const key = await getCollapsibleStoreKey()
    const scopedList = await store.get<string[]>(key)
    set({
      collapsibleList: uniq(scopedList ?? []).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)),
      collapsibleListInitialized: true
    })
    return await store.get<string>(await getWorkspaceStoreKey('activeFilePath')) ?? ''
  },

  currentArticle: '',
  readFilePath: '',
  isPulling: false, // 新增：拉取状态
  justPulledFile: false, // 标记是否刚从远程拉取文件
  skipSyncOnSave: false, // 标记是否跳过同步
  aiGeneratingFilePath: null, // 标记当前正在 AI 生成的文件路径
  aiTerminateFn: null, // AI 生成的终止函数

  setReadFilePath: (path: string) => {
    set({ readFilePath: path })
  },

  readArticle: (path, sha, autoSync = true, options) => {
    // 处理文件名兼容性问题
    let actualPath = path
    if (!isAbsoluteFsPath(path) && hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
      if (get().activeFilePath !== actualPath) {
        const pendingOpenRequest = get().pendingFileTabOpenRequest
        const matchingOpenRequest = pendingOpenRequest?.path === path
          ? pendingOpenRequest
          : null
        // setActiveFilePath starts the canonical read for the sanitized path.
        return get().setActiveFilePath(actualPath, autoSync, {
          deactivationAlreadyPrepared: true,
          createIfMissing: options?.createIfMissing,
          ...(matchingOpenRequest ? {
            tabOpenMode: matchingOpenRequest.mode,
            tabMetadata: {
              name: actualPath.split(/[\\/]/).pop() || matchingOpenRequest.name,
              isFolder: matchingOpenRequest.isFolder,
            },
          } : {}),
        })
      }
    }

    // readArticle only owns the currently active document. A delayed caller
    // from a previous tab must not take over the shared loading/content state.
    if (get().activeFilePath !== actualPath) return Promise.resolve()

    return runArticleReadOnce(actualPath, async (requestGeneration) => {
      const isCurrentArticleRead = () => (
      articleReadGeneration === requestGeneration
      && get().activeFilePath === actualPath
      )

    set({
      loading: true,
      readFilePath: actualPath,
      isPulling: false,
      justPulledFile: false,
    })

    // 优先加载本地内容（快速响应）
    let localContent = ''

    // 辅助函数：查找文件信息
    const findFileInTree = (tree: DirTree[], targetPath: string): DirTree | null => {
      for (const item of tree) {
        const itemPath = computedParentPath(item)
        if (itemPath === targetPath && item.isFile) {
          return item
        }
        if (item.children && item.children.length > 0) {
          const found = findFileInTree(item.children, targetPath)
          if (found) return found
        }
      }
      return null
    }

    const pullMissingRemoteArticle = async () => {
      if (!isCurrentArticleRead()) return

      set({
        currentArticle: '',
        loading: true,
        isPulling: true,
        justPulledFile: true,
      })

      // Yield once so the pulling state can paint before network work starts,
      // while keeping this read request pending for same-path de-duplication.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (!isCurrentArticleRead()) return

      try {
        const remoteContent = await pullRemoteFile(actualPath)
        if (!isCurrentArticleRead()) return
        await saveLocalFile(actualPath, remoteContent)

        if (isCurrentArticleRead()) {
          set({ currentArticle: remoteContent })
          emitter.emit('editor-content-from-remote', { content: remoteContent })
        }

        const cacheTree = cloneDeep(get().fileTree)
        const fileNode = findFileInTree(cacheTree, actualPath)
        if (fileNode) {
          fileNode.isLocale = true
          set({ fileTree: cacheTree })
        }
      } catch {
        if (isCurrentArticleRead()) {
          set({ currentArticle: '' })
        }
      } finally {
        if (isCurrentArticleRead()) {
          set({ isPulling: false, loading: false, readFilePath: '' })
          setTimeout(() => {
            if (isCurrentArticleRead()) {
              get().setJustPulledFile(false)
            }
          }, 1000)
        }
      }
    }

    try {
      const pathOptions = await getFilePathOptions(actualPath)
      if (!pathOptions.baseDir) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      if (!isCurrentArticleRead()) return

      // 检查是否是远程文件且本地内容为空
      const fileTree = get().fileTree
      const fileInfo = findFileInTree(fileTree, actualPath)
      const isRemoteFile = fileInfo && !fileInfo.isLocale

      // 如果是远程文件且本地内容为空，先显示编辑器（禁用），再异步拉取
      if (isRemoteFile && (!localContent || localContent.trim() === '')) {
        await pullMissingRemoteArticle()
        return
      }

      // 正常的本地文件，显示内容（即使是空文件也正确显示）
      set({ currentArticle: localContent, loading: false })
      // 检查文件的向量索引状态
      if (!isAbsoluteFsPath(actualPath)) {
        get().checkFileVectorIndexed(actualPath)
      }
    } catch (error) {
      if (!isCurrentArticleRead()) return

      // 本地文件不存在，检查是否是远程文件

      // 先查找文件信息（可能 fileTree 还没加载完成）
      const fileInfo = findFileInTree(get().fileTree, actualPath)

      // 检查是否是"文件不存在"错误（兼容不同平台的大小写）
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isFileNotFound = errorMsg.toLowerCase().includes('no such file') ||
                            errorMsg.toLowerCase().includes('not found') ||
                            errorMsg.toLowerCase().includes('系统找不到指定的路径')

      if (isFileNotFound && fileInfo && !fileInfo.isLocale) {
        await pullMissingRemoteArticle()
        return
      } else if (isFileNotFound && options?.createIfMissing !== false) {
        // 本地文件，创建空白文件
        await ensureDirectoryExists(actualPath)
        const pathOptions = await getFilePathOptions(actualPath)

        try {
          if (await writeSelfHostedWorkspaceText(actualPath, '')) {
            // Rust journal already persisted the file.
          } else if (!pathOptions.baseDir) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
          if (isCurrentArticleRead()) {
            set({ currentArticle: '', loading: false })
          }
        } catch {
          if (isCurrentArticleRead()) {
            get().setLoading(false)
          }
        }
      } else {
        if (isCurrentArticleRead()) {
          set({
            currentArticle: '',
            loading: false,
            isPulling: false,
          })
        }
      }
    }

    // 异步检查远程更新（使用新的 SyncManager）
    // 只有当当前读取的文件路径仍然是 actualPath 时才执行同步
    // 同时检查 activeFilePath 是否仍然匹配，防止竞态条件
    const syncOpenMutationRevision = getEditorPathMutationRevision(actualPath)
    if (
      autoSync
      && isCurrentArticleRead()
      && !isAbsoluteFsPath(actualPath)
      && await hasNetworkConnection()
    ) {
      try {
        // 在执行同步前检查路径是否仍然匹配
        const currentReadPath = get().readFilePath
        const currentActivePath = get().activeFilePath
        if (
          isCurrentArticleRead()
          && currentReadPath === actualPath
          && currentActivePath === actualPath
        ) {
          const result = await syncOnOpen(actualPath, syncOpenMutationRevision)
          // 在设置 content 前再次确认路径没有变化
          if (result?.updated && result.content && isCurrentArticleRead()) {
            // 拉取了新内容，更新 Store 和已经挂载的源码/章节编辑器。
            set({ currentArticle: result.content, justPulledFile: true })
            emitter.emit('editor-content-from-remote', { content: result.content })
            setTimeout(() => {
              if (isCurrentArticleRead()) {
                get().setJustPulledFile(false)
              }
            }, 1000)
          }
        }
      } catch {
      }
    }

    // 读取完成后清除 readFilePath（仅当没有其他 readArticle 在执行时）
    // 通过检查 activeFilePath 是否变化来判断
    if (isCurrentArticleRead()) {
      set({ readFilePath: '' })
    }
    })
  },

  // 向量计算相关状态
  isVectorCalculating: false,
  // 向量索引状态
  vectorIndexedFiles: new Map<string, number>(), // 文件名 -> 向量索引时间戳

  setCurrentArticle: (content: string) => {
    set({ currentArticle: content })
  },

  setIsPulling: (pulling: boolean) => {
    set({ isPulling: pulling })
  },

  setJustPulledFile: (justPulled: boolean) => {
    set({ justPulledFile: justPulled })
  },

  setSkipSyncOnSave: (skip: boolean) => {
    set({ skipSyncOnSave: skip })
  },

  setAiGeneratingFilePath: (path: string | null) => {
    set({ aiGeneratingFilePath: path })
  },

  setAiTerminateFn: (fn: (() => void) | null) => {
    set({ aiTerminateFn: fn })
  },

  // 更新文件 sha 状态（推送成功后调用）
  updateFileSha: (path: string, sha: string) => {
    const cacheTree = cloneDeep(get().fileTree)

    // 递归查找并更新文件的 sha
    const updateShaInTree = (items: DirTree[], depth: number = 0): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path && item.isFile) {
          item.sha = sha
          debugSyncPath('article.updateFileSha.match', {
            path,
            itemPath,
            name: item.name,
            depth,
            sha,
          })
          return true
        }
        if (item.children && updateShaInTree(item.children, depth + 1)) {
          return true
        }
      }
      return false
    }

    if (updateShaInTree(cacheTree)) {
      const sortedTree = get().sortFileTree(cacheTree)
      set({ fileTree: sortedTree })
    } else {
      debugSyncPath('article.updateFileSha.miss', {
        path,
        sha,
      })
    }
  },

  saveCurrentArticle: async (content: string, pathOverride?: string) => {
    const path = pathOverride ?? get().activeFilePath
    const justPulled = get().justPulledFile

    if (path && content !== undefined && content !== null) {
      // 如果是从远程刚拉取的文件，不触发推送（避免 SHA 不匹配错误）
      if (justPulled) {
        // 清除标志
        get().setJustPulledFile(false)
        const pendingSave = pendingArticleSaves.get(path)
        if (pendingSave) {
          void pendingSave.commit().catch(() => undefined)
        }
        const previousSave = inFlightArticleSaves.get(path)
        const savePromise = (async () => {
          if (previousSave) await previousSave
          // 只保存本地文件，不触发同步推送
          const pathOptions = await getFilePathOptions(path)
          if (await writeSelfHostedWorkspaceText(path, content)) {
            // Rust journal already persisted the file.
          } else if (!pathOptions.baseDir) {
            await writeTextFile(pathOptions.path, content)
          } else {
            await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
          }
          if (get().activeFilePath === path) {
            set({ currentArticle: content })
          }
        })()
        inFlightArticleSaves.set(path, savePromise)
        try {
          await savePromise
        } finally {
          if (inFlightArticleSaves.get(path) === savePromise) {
            inFlightArticleSaves.delete(path)
          }
        }
        return
      }

      // 保存中的完整正文和定时器不属于 UI 状态，避免每次输入触发所有 store 订阅者。
      const existingSave = pendingArticleSaves.get(path)
      if (existingSave?.timer) {
        clearTimeout(existingSave.timer)
      }

      // 设置新的防抖定时器，500ms 后执行保存
      // 这样可以合并短时间内多次 content change
      const pendingSave: PendingArticleSave = {
        content,
        timer: null as ReturnType<typeof setTimeout> | null,
        commit: async () => {},
      }
      pendingSave.commit = async () => {
        if (pendingArticleSaves.get(path) !== pendingSave) {
          return
        }
        if (pendingSave.timer) {
          clearTimeout(pendingSave.timer)
          pendingSave.timer = null
        }
        pendingArticleSaves.delete(path)

        const previousSave = inFlightArticleSaves.get(path)
        const commitPromise = (async () => {
          if (previousSave) await previousSave

          // 执行实际保存操作
          const savePath = path
          const saveContent = pendingSave.content
          // 检查文件是否存在
          let isLocale = false
          const pathOptions = await getFilePathOptions(savePath)
          if (!pathOptions.baseDir) {
            isLocale = await exists(pathOptions.path)
          } else {
            isLocale = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          const wroteSelfHosted = await writeSelfHostedWorkspaceText(savePath, saveContent)
          if (!wroteSelfHosted) {
            // Ensure the fallback path exists before a regular filesystem write.
            if (savePath.includes('/')) {
              let dir = ''
              const dirPath = savePath.split('/')
              for (let index = 0; index < dirPath.length - 1; index += 1) {
                dir += `${dirPath[index]}/`
                const dirOptions = await getFilePathOptions(dir)
                let dirExists = false
                if (!dirOptions.baseDir) {
                  dirExists = await exists(dirOptions.path)
                } else {
                  dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
                }
                if (!dirExists) {
                  if (!dirOptions.baseDir) {
                    await mkdir(dirOptions.path)
                  } else {
                    await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir })
                  }
                }
              }
            }

            if (!pathOptions.baseDir) {
              await writeTextFile(pathOptions.path, saveContent)
            } else {
              await writeTextFile(pathOptions.path, saveContent, { baseDir: pathOptions.baseDir })
            }
          }
          get().markFileDirty(savePath)

          // 更新缓存树
          if (!isLocale) {
            const cacheTree = cloneDeep(get().fileTree)
            const current = savePath.includes('/')
              ? getCurrentFolder(savePath, cacheTree)
              : cacheTree.find(item => item.name === savePath)
            if (current) {
              current.isLocale = true

              // 更新父文件夹链的 isLocale 状态
              const updateParentFolders = async (node: DirTree | undefined) => {
                let parent = node
                const pathParts = savePath.split('/')
                let currentDepth = pathParts.length - 1

                while (parent && currentDepth > 0) {
                  if (parent.isLocale) {
                    break
                  }
                  const parentPath = pathParts.slice(0, currentDepth).join('/')
                  const parentOptions = await getFilePathOptions(parentPath)
                  let parentExists = false
                  try {
                    if (!parentOptions.baseDir) {
                      parentExists = await exists(parentOptions.path)
                    } else {
                      parentExists = await exists(parentOptions.path, { baseDir: parentOptions.baseDir })
                    }
                  } catch {
                    parentExists = false
                  }
                  if (parentExists) {
                    parent.isLocale = true
                    parent = parent.parent
                    currentDepth--
                  } else {
                    break
                  }
                }
              }

              await updateParentFolders(current.parent)
            }
            set({ fileTree: cacheTree })
          }

          // 触发防抖向量计算
          if (!isAbsoluteFsPath(savePath) && savePath.endsWith('.md')) {
            get().scheduleVectorCalculation(savePath, saveContent)
          }

          // currentArticle 只属于当前活动文件；后台完成的旧标签页保存
          // 不能覆盖已经切换后的共享正文。
          if (get().activeFilePath === savePath) {
            set({ currentArticle: saveContent })
          }

          // 记录写作活动（独立事件日志，不受后续删除影响）
          try {
            const { recordWritingActivity } = await import('@/db/activity')
            const fileName = savePath.split('/').pop() || savePath
            await recordWritingActivity({
              path: savePath,
              title: fileName,
              description: savePath,
            })
          } catch (error) {
            console.error('记录写作活动失败:', error)
          }

          // 通知文件已保存，触发同步推送（除非设置了 skipSyncOnSave）
          const shouldSkipSync = get().skipSyncOnSave
          if (!shouldSkipSync && !isAbsoluteFsPath(savePath)) {
            emitter.emit('article-saved', { path: savePath, content: saveContent })
          }
        })()

        inFlightArticleSaves.set(path, commitPromise)
        try {
          await commitPromise
        } finally {
          if (inFlightArticleSaves.get(path) === commitPromise) {
            inFlightArticleSaves.delete(path)
          }
        }
      }
      pendingSave.timer = setTimeout(() => {
        void pendingSave.commit().catch(error => {
          console.error(`保存文章失败: ${path}`, error)
        })
      }, 500)
      pendingArticleSaves.set(path, pendingSave)
    }
  },

  flushPendingArticleSave: async (path: string) => {
    if (!path) return

    // A save can be queued while an earlier save for the same path is still
    // committing. Keep draining until both queues are empty.
    while (true) {
      const pendingSave = pendingArticleSaves.get(path)
      if (pendingSave) {
        await pendingSave.commit()
        continue
      }

      const inFlightSave = inFlightArticleSaves.get(path)
      if (inFlightSave) {
        await inFlightSave
        continue
      }
      return
    }
  },

  flushPendingArticleSavesForPaths: async (paths: string[], workspaceRoot?: string) => {
    while (true) {
      const savePaths = new Set([
        ...pendingArticleSaves.keys(),
        ...inFlightArticleSaves.keys(),
      ])
      const matchingPaths = [...savePaths].filter(savePath => (
        paths.some(path => (
          pathIsSameOrDescendant(savePath, path, workspaceRoot)
          || editorPathsCouldReferToSameFile(savePath, path, workspaceRoot)
        ))
      ))
      if (matchingPaths.length === 0) return
      await Promise.all(matchingPaths.map(path => get().flushPendingArticleSave(path)))
    }
  },

  flushAllPendingArticleSaves: async () => {
    while (pendingArticleSaves.size > 0 || inFlightArticleSaves.size > 0) {
      const savePaths = new Set([
        ...pendingArticleSaves.keys(),
        ...inFlightArticleSaves.keys(),
      ])
      await Promise.all([...savePaths].map(path => get().flushPendingArticleSave(path)))
    }
  },

  runPathWriteTransaction: async (path, transaction, workspaceRoot) => {
    if (workspaceRoot) {
      const currentWorkspaceRoot = await getCurrentEditorWorkspaceRoot()
      if (!workspaceRootsReferToSameLocation(currentWorkspaceRoot, workspaceRoot)) {
        // Article save queues only belong to the workspace currently mounted
        // in the UI. A background library has no editor-local save to drain.
        return transaction({ hasQueuedSave: () => false })
      }
    }

    // Promote a queued debounce save into the in-flight chain before installing
    // the transaction gate. Do not call a durable flush from inside the
    // transaction callback: it would wait on this same gate.
    const transactionPaths = new Set<string>([path])
    const activeFilePath = get().activeFilePath
    if (editorPathsCouldReferToSameFile(activeFilePath, path, workspaceRoot)) {
      transactionPaths.add(activeFilePath)
    }
    for (const savePath of new Set([
      ...pendingArticleSaves.keys(),
      ...inFlightArticleSaves.keys(),
    ])) {
      if (editorPathsCouldReferToSameFile(savePath, path, workspaceRoot)) {
        transactionPaths.add(savePath)
      }
    }
    for (const transactionPath of transactionPaths) {
      const pendingSave = pendingArticleSaves.get(transactionPath)
      if (pendingSave) void pendingSave.commit().catch(() => undefined)
    }
    const previousSaves = [...transactionPaths]
      .map(transactionPath => inFlightArticleSaves.get(transactionPath))
      .filter((save): save is Promise<void> => Boolean(save))
    let releaseGate = () => {}
    const transactionGate = new Promise<void>((resolve) => {
      releaseGate = () => resolve()
    })
    for (const transactionPath of transactionPaths) {
      inFlightArticleSaves.set(transactionPath, transactionGate)
    }

    try {
      await Promise.all(previousSaves)
      return await transaction({
        hasQueuedSave: () => (
          [...pendingArticleSaves.keys()].some(savePath => (
            editorPathsCouldReferToSameFile(savePath, path, workspaceRoot)
          ))
          || [...inFlightArticleSaves.entries()].some(([savePath, save]) => (
            editorPathsCouldReferToSameFile(savePath, path, workspaceRoot)
            && save !== transactionGate
          ))
        ),
      })
    } finally {
      releaseGate()
      for (const transactionPath of transactionPaths) {
        if (inFlightArticleSaves.get(transactionPath) === transactionGate) {
          inFlightArticleSaves.delete(transactionPath)
        }
      }
    }
  },

  // 安排向量计算（防抖5秒）
  scheduleVectorCalculation: (path: string, content: string) => {
    if (!useVectorStore.getState().isAutoVectorEnabled) {
      get().cancelVectorCalculation()
      return
    }

    if (vectorCalculationTimer) {
      clearTimeout(vectorCalculationTimer)
    }

    pendingVectorCalculation = { path, content }
    
    // 设置5秒后自动执行向量计算
    vectorCalculationTimer = setTimeout(() => {
      vectorCalculationTimer = null
      void get().executeVectorCalculation()
    }, 5000)
  },

  // 执行向量计算
  executeVectorCalculation: async (options = {}) => {
    while (inFlightVectorCalculation) {
      await inFlightVectorCalculation.promise
    }
    if (!pendingVectorCalculation) return

    const calculation = pendingVectorCalculation
    set({ isVectorCalculating: true })
    const calculationPromise = (async () => {
      try {
        if (!options.force) {
          if (!useVectorStore.getState().isAutoVectorEnabled) {
            get().cancelVectorCalculation()
            return
          }

          const store = await getStore()
          const disabledFiles = await store.get<string[]>('vectorAutoCalcDisabled') || []
          if (disabledFiles.includes(calculation.path)) {
            get().cancelVectorCalculation()
            return
          }
        }

        const { path, content } = calculation
        const vectorStore = useVectorStore.getState()

        // 执行向量计算
        await vectorStore.processDocument(path, content)
        // 更新向量索引状态
        const vectorKey = getVectorDocumentKey(path)
        const newMap = new Map(get().vectorIndexedFiles)
        newMap.set(vectorKey, Date.now())
        set({ vectorIndexedFiles: newMap })

        if (pendingVectorCalculation === calculation) {
          pendingVectorCalculation = null
        }
      } catch {
      }
    })()
    inFlightVectorCalculation = {
      path: calculation.path,
      promise: calculationPromise,
    }
    try {
      await calculationPromise
    } finally {
      if (inFlightVectorCalculation?.promise === calculationPromise) {
        inFlightVectorCalculation = null
      }
      set({ isVectorCalculating: false })
    }
  },

  // 取消向量计算
  cancelVectorCalculation: () => {
    if (vectorCalculationTimer) {
      clearTimeout(vectorCalculationTimer)
      vectorCalculationTimer = null
    }
    pendingVectorCalculation = null
  },

  settleVectorCalculationsForPaths: async (paths: string[], workspaceRoot?: string) => {
    paths.forEach(path => discardPendingVectorCalculation(path, workspaceRoot))
    const inFlightCalculation = inFlightVectorCalculation
    if (
      inFlightCalculation
      && paths.some(path => (
        pathIsSameOrDescendant(inFlightCalculation.path, path, workspaceRoot)
      ))
    ) {
      await inFlightCalculation.promise
    }
    paths.forEach(path => discardPendingVectorCalculation(path, workspaceRoot))
  },

  settleAllVectorCalculations: async () => {
    get().cancelVectorCalculation()
    const inFlightCalculation = inFlightVectorCalculation
    if (inFlightCalculation) {
      await inFlightCalculation.promise
    }
    get().cancelVectorCalculation()
  },

  // 检查文件是否已被向量索引
  checkFileVectorIndexed: async (filePath: string) => {
    const { checkVectorDocumentExists, getVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    const hasVector = await checkVectorDocumentExists(vectorKey)
    if (hasVector) {
      // 获取向量文档记录更新时间
      const docs = await getVectorDocumentsByFilename(vectorKey)
      if (docs.length > 0) {
        const latestTime = Math.max(...docs.map(d => d.updated_at))
        const newMap = new Map(get().vectorIndexedFiles)
        newMap.set(vectorKey, latestTime)
        set({ vectorIndexedFiles: newMap })
        return true
      }
    }
    // 如果没有向量，从映射中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
    return false
  },

  // 清除文件的向量数据
  clearFileVector: async (filePath: string) => {
    const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    await deleteVectorDocumentsByFilename(vectorKey)
    // 从映射中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
  },

  // 初始化向量索引状态 - 加载所有已索引的文件
  initVectorIndexedFiles: async () => {
    if (!vectorIndexedFilesInitPromise) {
      vectorIndexedFilesInitPromise = (async () => {
        const { getVectorIndexSummaries } = await import('@/db/vector')
        const vectorIndexedDocs = await getVectorIndexSummaries()
        const vectorIndexedMap = buildVectorIndexedMap(vectorIndexedDocs)

        set({ vectorIndexedFiles: vectorIndexedMap })
      })().catch(() => {
      }).finally(() => {
        vectorIndexedFilesInitPromise = null
      })
    }

    await vectorIndexedFilesInitPromise
  },

  // 手动触发向量计算（使用当前文章内容）
  triggerVectorCalculation: async () => {
    const state = get()
    if (!state.activeFilePath || state.isVectorCalculating) {
      return
    }

    // 使用当前文章内容
    const content = state.currentArticle
    if (!content) {
      return
    }

    pendingVectorCalculation = {
      path: state.activeFilePath,
      content
    }

    await get().executeVectorCalculation({ force: true })
  },

  // 设置向量计算状态
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => {
    const fileTree = get().fileTree

    // 递归查找并更新文件/文件夹的状态
    const updateStatus = (items: DirTree[]): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path) {
          item.vectorCalcStatus = status
          return true
        }
        if (item.children && updateStatus(item.children)) {
          return true
        }
      }
      return false
    }

    updateStatus(fileTree)
    set({ fileTree: [...fileTree] })
  },

  allArticle: [],
  loadAllArticle: async () => {
    const workspace = await getWorkspacePath()
    let allArticle: Article[] = []
    
    const readDirRecursively = async (dirPath: string, basePath: string, isCustomWorkspace: boolean): Promise<Article[]> => {
      let allArticles: Article[] = []
      
      // 读取当前目录内容
      const res = isCustomWorkspace 
        ? await readDir(dirPath)
        : await readDir(dirPath, { baseDir: BaseDirectory.AppData })
      
      // 过滤文件
      const files = res.filter(file => 
        file.isFile && 
        file.name !== '.DS_Store' && 
        !file.name.startsWith('.') && 
        file.name.endsWith('.md')
      )
      
      // 添加文件到结果列表
      for (const file of files) {
        // 构建相对路径
        const relativePath = await join(basePath, file.name)
        
        // 读取文件内容
        let article = ''
        if (isCustomWorkspace) {
          const fullPath = await join(dirPath, file.name)
          article = await readTextFile(fullPath)
        } else {
          article = await readTextFile(`${dirPath}/${file.name}`, { baseDir: BaseDirectory.AppData })
        }
        
        allArticles.push({ article, path: relativePath })
      }
      
      // 递归处理子目录
      const directories = res.filter(entry => 
        entry.isDirectory && 
        !entry.name.startsWith('.')
      )
      
      for (const dir of directories) {
        const newDirPath = await join(dirPath, dir.name)
        const newBasePath = await join(basePath, dir.name)
        const subDirArticles = await readDirRecursively(newDirPath, newBasePath, isCustomWorkspace)
        allArticles = [...allArticles, ...subDirArticles]
      }
      
      return allArticles
    }

    if (workspace.isCustom) {
      // 自定义工作区
      allArticle = await readDirRecursively(workspace.path, '', true)
    } else {
      // 默认工作区
      allArticle = await readDirRecursively('article', '', false)
    }

    set({ allArticle })
  }
}))

registerActiveEditorDurableSaveFlusher(async (path) => {
  await useArticleStore.getState().flushPendingArticleSave(path)
})

registerEditorPathMutationFlusher(async (paths, workspaceRoot) => {
  const articleState = useArticleStore.getState()
  await articleState.flushPendingArticleSavesForPaths(paths, workspaceRoot)
  await articleState.settleVectorCalculationsForPaths(paths, workspaceRoot)
})

registerEditorPathWriteTransactionRunner((path, transaction, workspaceRoot) => (
  useArticleStore.getState().runPathWriteTransaction(path, transaction, workspaceRoot)
))

export default useArticleStore
