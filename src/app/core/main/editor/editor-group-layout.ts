import type { OpenTabInfo } from '@/stores/article'
import {
  editorPathIsSameOrDescendant,
  editorPathsReferToSameFile,
} from '@/lib/editor-deactivation'

export type EditorSplitDirection = 'left' | 'right' | 'up' | 'down'
export type EditorSplitOrientation = 'horizontal' | 'vertical'

export const EDITOR_NAVIGATION_HISTORY_LIMIT = 100

export interface EditorNavigationEntry {
  path: string
  name: string
  isFolder: boolean
  kind: 'file'
}

export interface EditorNavigationTarget {
  entry: EditorNavigationEntry
  index: number
}

export interface EditorGroup {
  id: string
  tabIds: string[]
  activeTabId: string
  locked?: boolean
}

export interface EditorGroupNode {
  type: 'group'
  id: string
  groupId: string
}

export interface EditorSplitNode {
  type: 'split'
  id: string
  orientation: EditorSplitOrientation
  children: EditorLayoutNode[]
  sizes: number[]
}

export type EditorLayoutNode = EditorGroupNode | EditorSplitNode

export interface EditorWorkspaceLayout {
  version: 1
  root: EditorLayoutNode
  groups: Record<string, EditorGroup>
  activeGroupId: string
  maximizedGroupId?: string
  navigationHistory: EditorNavigationEntry[]
  navigationIndex: number
  workspaceKey?: string
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}

function isNonFileTabPath(path: string) {
  return path.startsWith('blank://')
    || path.startsWith('record://')
    || path.startsWith('canvas://')
}

function normalizeNavigationEntry(value: unknown): EditorNavigationEntry | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<EditorNavigationEntry>
  if (
    typeof candidate.path !== 'string'
    || !candidate.path
    || isNonFileTabPath(candidate.path)
    || (candidate.kind !== undefined && candidate.kind !== 'file')
  ) {
    return null
  }

  return {
    path: candidate.path,
    name: typeof candidate.name === 'string' && candidate.name
      ? candidate.name
      : candidate.path.split(/[\\/]/).pop() || candidate.path,
    isFolder: candidate.isFolder === true,
    kind: 'file',
  }
}

function navigationEntriesReferToSameTarget(
  left: EditorNavigationEntry,
  right: EditorNavigationEntry,
) {
  return left.path === right.path
}

function navigationEntriesEqual(
  left: EditorNavigationEntry,
  right: EditorNavigationEntry,
) {
  return left.path === right.path
    && left.name === right.name
    && left.isFolder === right.isFolder
}

function normalizeEditorNavigationState(
  historyValue: unknown,
  indexValue: unknown,
): Pick<EditorWorkspaceLayout, 'navigationHistory' | 'navigationIndex'> {
  const source = Array.isArray(historyValue) ? historyValue : []
  const requestedIndex = typeof indexValue === 'number' && Number.isFinite(indexValue)
    ? Math.trunc(indexValue)
    : -1
  const navigationHistory: EditorNavigationEntry[] = []
  let navigationIndex = -1

  source.forEach((value, sourceIndex) => {
    const entry = normalizeNavigationEntry(value)
    if (!entry) return

    const previousEntry = navigationHistory.at(-1)
    if (previousEntry && navigationEntriesReferToSameTarget(previousEntry, entry)) {
      navigationHistory[navigationHistory.length - 1] = entry
    } else {
      navigationHistory.push(entry)
    }
    if (sourceIndex <= requestedIndex) {
      navigationIndex = navigationHistory.length - 1
    }
  })

  const overflow = Math.max(0, navigationHistory.length - EDITOR_NAVIGATION_HISTORY_LIMIT)
  const limitedHistory = overflow > 0
    ? navigationHistory.slice(overflow)
    : navigationHistory
  if (requestedIndex < 0 || limitedHistory.length === 0) {
    navigationIndex = -1
  } else if (navigationIndex < overflow) {
    navigationIndex = 0
  } else {
    navigationIndex = Math.min(navigationIndex - overflow, limitedHistory.length - 1)
  }

  return {
    navigationHistory: limitedHistory,
    navigationIndex,
  }
}

function editorNavigationStateEquals(
  layout: EditorWorkspaceLayout,
  state: Pick<EditorWorkspaceLayout, 'navigationHistory' | 'navigationIndex'>,
) {
  return layout.navigationIndex === state.navigationIndex
    && Array.isArray(layout.navigationHistory)
    && layout.navigationHistory.length === state.navigationHistory.length
    && layout.navigationHistory.every((entry, index) => (
      navigationEntriesEqual(entry, state.navigationHistory[index])
    ))
}

function setEditorNavigationState(
  layout: EditorWorkspaceLayout,
  state: Pick<EditorWorkspaceLayout, 'navigationHistory' | 'navigationIndex'>,
) {
  return editorNavigationStateEquals(layout, state) ? layout : { ...layout, ...state }
}

function transformEditorNavigationState(
  layout: EditorWorkspaceLayout,
  transform: (entry: EditorNavigationEntry) => EditorNavigationEntry | null,
): Pick<EditorWorkspaceLayout, 'navigationHistory' | 'navigationIndex'> {
  const current = normalizeEditorNavigationState(
    layout.navigationHistory,
    layout.navigationIndex,
  )
  const navigationHistory: EditorNavigationEntry[] = []
  const mappedIndexes = current.navigationHistory.map((entry) => {
    const nextEntry = transform(entry)
    if (!nextEntry) return -1
    const previousEntry = navigationHistory.at(-1)
    if (previousEntry && navigationEntriesReferToSameTarget(previousEntry, nextEntry)) {
      navigationHistory[navigationHistory.length - 1] = nextEntry
    } else {
      navigationHistory.push(nextEntry)
    }
    return navigationHistory.length - 1
  })

  let navigationIndex = -1
  if (current.navigationIndex >= 0 && navigationHistory.length > 0) {
    navigationIndex = mappedIndexes[current.navigationIndex] ?? -1
    if (navigationIndex < 0) {
      for (let index = current.navigationIndex - 1; index >= 0; index -= 1) {
        if (mappedIndexes[index] >= 0) {
          navigationIndex = mappedIndexes[index]
          break
        }
      }
    }
    if (navigationIndex < 0) {
      for (let index = current.navigationIndex + 1; index < mappedIndexes.length; index += 1) {
        if (mappedIndexes[index] >= 0) {
          navigationIndex = mappedIndexes[index]
          break
        }
      }
    }
  }

  return { navigationHistory, navigationIndex }
}

function transformEditorNavigationHistory(
  layout: EditorWorkspaceLayout,
  transform: (entry: EditorNavigationEntry) => EditorNavigationEntry | null,
) {
  return setEditorNavigationState(
    layout,
    transformEditorNavigationState(layout, transform),
  )
}

export function createEditorNavigationEntry(tab: OpenTabInfo): EditorNavigationEntry | null {
  if (
    tab.kind === 'blank'
    || tab.kind === 'record'
    || tab.kind === 'canvas'
    || !tab.path
    || isNonFileTabPath(tab.path)
  ) {
    return null
  }
  return {
    path: tab.path,
    name: tab.name || tab.path.split(/[\\/]/).pop() || tab.path,
    isFolder: tab.isFolder,
    kind: 'file',
  }
}

export function recordEditorNavigation(
  layout: EditorWorkspaceLayout,
  tab: OpenTabInfo,
): EditorWorkspaceLayout {
  const entry = createEditorNavigationEntry(tab)
  if (!entry) return layout

  const current = normalizeEditorNavigationState(
    layout.navigationHistory,
    layout.navigationIndex,
  )
  const currentEntry = current.navigationHistory[current.navigationIndex]
  if (currentEntry && navigationEntriesReferToSameTarget(currentEntry, entry)) {
    const navigationHistory = [...current.navigationHistory]
    navigationHistory[current.navigationIndex] = entry
    return setEditorNavigationState(layout, {
      navigationHistory,
      navigationIndex: current.navigationIndex,
    })
  }

  const navigationHistory = current.navigationHistory.slice(0, current.navigationIndex + 1)
  const previousEntry = navigationHistory.at(-1)
  if (previousEntry && navigationEntriesReferToSameTarget(previousEntry, entry)) {
    navigationHistory[navigationHistory.length - 1] = entry
  } else {
    navigationHistory.push(entry)
  }
  const limitedHistory = navigationHistory.slice(-EDITOR_NAVIGATION_HISTORY_LIMIT)

  return setEditorNavigationState(layout, {
    navigationHistory: limitedHistory,
    navigationIndex: limitedHistory.length - 1,
  })
}

function getEditorNavigationTarget(
  layout: EditorWorkspaceLayout,
  offset: -1 | 1,
): EditorNavigationTarget | null {
  const current = normalizeEditorNavigationState(
    layout.navigationHistory,
    layout.navigationIndex,
  )
  const index = current.navigationIndex + offset
  const entry = current.navigationHistory[index]
  return entry ? { entry, index } : null
}

export function getEditorBackNavigationTarget(layout: EditorWorkspaceLayout) {
  return getEditorNavigationTarget(layout, -1)
}

export function getEditorForwardNavigationTarget(layout: EditorWorkspaceLayout) {
  return getEditorNavigationTarget(layout, 1)
}

export function setEditorNavigationIndex(
  layout: EditorWorkspaceLayout,
  index: number,
): EditorWorkspaceLayout {
  const current = normalizeEditorNavigationState(
    layout.navigationHistory,
    layout.navigationIndex,
  )
  const requestedIndex = Number.isFinite(index) ? Math.trunc(index) : -1
  const navigationIndex = current.navigationHistory.length === 0
    ? -1
    : Math.max(-1, Math.min(requestedIndex, current.navigationHistory.length - 1))
  return setEditorNavigationState(layout, {
    navigationHistory: current.navigationHistory,
    navigationIndex,
  })
}

export function removeEditorNavigationEntry(
  layout: EditorWorkspaceLayout,
  index: number,
  currentFallback: 'previous' | 'next',
): EditorWorkspaceLayout {
  const current = normalizeEditorNavigationState(
    layout.navigationHistory,
    layout.navigationIndex,
  )
  if (index < 0 || index >= current.navigationHistory.length) {
    return setEditorNavigationState(layout, current)
  }

  const navigationHistory = current.navigationHistory.filter((_, entryIndex) => (
    entryIndex !== index
  ))
  let navigationIndex = current.navigationIndex
  if (index < navigationIndex) {
    navigationIndex -= 1
  } else if (index === navigationIndex) {
    navigationIndex = currentFallback === 'previous'
      ? index - 1
      : Math.min(index, navigationHistory.length - 1)
  }

  return setEditorNavigationState(
    layout,
    normalizeEditorNavigationState(
      navigationHistory,
      navigationHistory.length
        ? navigationIndex < 0
          ? -1
          : Math.min(navigationIndex, navigationHistory.length - 1)
        : -1,
    ),
  )
}

export function resetEditorNavigation(
  layout: EditorWorkspaceLayout,
  workspaceKey = layout.workspaceKey,
): EditorWorkspaceLayout {
  if (
    layout.workspaceKey === workspaceKey
    && layout.navigationIndex === -1
    && Array.isArray(layout.navigationHistory)
    && layout.navigationHistory.length === 0
  ) return layout
  return {
    ...layout,
    workspaceKey,
    navigationHistory: [],
    navigationIndex: -1,
  }
}

export function mapEditorNavigationHistoryForPathChange(
  layout: EditorWorkspaceLayout,
  oldPath: string,
  newPath: string,
): EditorWorkspaceLayout {
  if (!oldPath || !newPath || oldPath === newPath) return layout
  return transformEditorNavigationHistory(layout, entry => {
    const nextPath = entry.path === oldPath
      ? newPath
      : entry.path.startsWith(`${oldPath}/`)
        ? `${newPath}${entry.path.slice(oldPath.length)}`
        : entry.path
    return nextPath === entry.path
      ? entry
      : {
          ...entry,
          path: nextPath,
          name: nextPath.split(/[\\/]/).pop() || nextPath,
        }
  })
}

export function cleanEditorNavigationHistoryByDeletedFile(
  layout: EditorWorkspaceLayout,
  deletedPath: string,
  workspaceRoot?: string,
): EditorWorkspaceLayout {
  if (!deletedPath) return layout
  return transformEditorNavigationHistory(
    layout,
    entry => editorPathsReferToSameFile(entry.path, deletedPath, workspaceRoot)
      ? null
      : entry,
  )
}

export function cleanEditorNavigationHistoryByDeletedFolder(
  layout: EditorWorkspaceLayout,
  deletedFolderPath: string,
  workspaceRoot?: string,
): EditorWorkspaceLayout {
  if (!deletedFolderPath) return layout
  return transformEditorNavigationHistory(
    layout,
    entry => editorPathIsSameOrDescendant(entry.path, deletedFolderPath, workspaceRoot)
      ? null
      : entry,
  )
}

export function createEditorGroup(tabIds: string[] = []): EditorGroup {
  return {
    id: createId('editor-group'),
    tabIds,
    activeTabId: tabIds.at(-1) ?? '',
  }
}

export function createEditorWorkspaceLayout(
  tabs: OpenTabInfo[],
  workspaceKey?: string,
): EditorWorkspaceLayout {
  const group = createEditorGroup(tabs.map(tab => tab.id))
  return {
    version: 1,
    root: { type: 'group', id: createId('editor-node'), groupId: group.id },
    groups: { [group.id]: group },
    activeGroupId: group.id,
    navigationHistory: [],
    navigationIndex: -1,
    workspaceKey,
  }
}

export function getEditorGroupIds(node: EditorLayoutNode): string[] {
  if (node.type === 'group') return [node.groupId]
  return node.children.flatMap(getEditorGroupIds)
}

export function findEditorGroupForTab(
  layout: EditorWorkspaceLayout,
  tabId: string,
): EditorGroup | undefined {
  return Object.values(layout.groups).find(group => group.tabIds.includes(tabId))
}

function replaceLayoutNode(
  node: EditorLayoutNode,
  targetGroupId: string,
  replacement: EditorLayoutNode,
): EditorLayoutNode {
  if (node.type === 'group') {
    return node.groupId === targetGroupId ? replacement : node
  }
  return {
    ...node,
    children: node.children.map(child => replaceLayoutNode(child, targetGroupId, replacement)),
  }
}

function findEditorGroupNode(
  node: EditorLayoutNode,
  groupId: string,
): EditorGroupNode | undefined {
  if (node.type === 'group') return node.groupId === groupId ? node : undefined
  for (const child of node.children) {
    const match = findEditorGroupNode(child, groupId)
    if (match) return match
  }
  return undefined
}

function removeGroupNode(
  node: EditorLayoutNode,
  groupId: string,
): EditorLayoutNode | null {
  if (node.type === 'group') return node.groupId === groupId ? null : node

  const children = node.children
    .map(child => removeGroupNode(child, groupId))
    .filter((child): child is EditorLayoutNode => child !== null)

  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return {
    ...node,
    children,
    sizes: children.map(() => 100 / children.length),
  }
}

export function updateEditorSplitSizes(
  layout: EditorWorkspaceLayout,
  splitId: string,
  sizes: number[],
): EditorWorkspaceLayout {
  const update = (node: EditorLayoutNode): EditorLayoutNode => {
    if (node.type === 'group') return node
    if (node.id === splitId) {
      const unchanged = node.sizes.length === sizes.length
        && node.sizes.every((size, index) => Math.abs(size - sizes[index]) < 0.01)
      return unchanged ? node : { ...node, sizes }
    }
    const children = node.children.map(update)
    return children.every((child, index) => child === node.children[index])
      ? node
      : { ...node, children }
  }
  const root = update(layout.root)
  return root === layout.root ? layout : { ...layout, root }
}

export function splitEditorGroup(
  layout: EditorWorkspaceLayout,
  targetGroupId: string,
  direction: EditorSplitDirection,
  tabId: string,
  options: { moveFromGroupId?: string } = {},
): EditorWorkspaceLayout {
  const targetGroup = layout.groups[targetGroupId]
  if (!targetGroup || !tabId) return layout
  if (options.moveFromGroupId === targetGroupId && targetGroup.tabIds.length < 2) return layout

  const nextGroups = { ...layout.groups }
  if (options.moveFromGroupId) {
    const sourceGroup = nextGroups[options.moveFromGroupId]
    if (sourceGroup) {
      const nextTabIds = sourceGroup.tabIds.filter(id => id !== tabId)
      nextGroups[sourceGroup.id] = {
        ...sourceGroup,
        tabIds: nextTabIds,
        activeTabId: sourceGroup.activeTabId === tabId
          ? nextTabIds.at(-1) ?? ''
          : sourceGroup.activeTabId,
      }
    }
  }

  const newGroup = createEditorGroup([tabId])
  nextGroups[newGroup.id] = newGroup
  const existingNode = findEditorGroupNode(layout.root, targetGroupId)
  if (!existingNode) return layout
  const newNode: EditorGroupNode = {
    type: 'group',
    id: createId('editor-node'),
    groupId: newGroup.id,
  }
  const newFirst = direction === 'left' || direction === 'up'
  const replacement: EditorSplitNode = {
    type: 'split',
    id: createId('editor-split'),
    orientation: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical',
    children: newFirst ? [newNode, existingNode] : [existingNode, newNode],
    sizes: [50, 50],
  }

  return {
    ...layout,
    root: replaceLayoutNode(layout.root, targetGroupId, replacement),
    groups: nextGroups,
    activeGroupId: newGroup.id,
    maximizedGroupId: undefined,
  }
}

export function moveEditorTab(
  layout: EditorWorkspaceLayout,
  tabId: string,
  sourceGroupId: string,
  targetGroupId: string,
  targetIndex?: number,
  copy = false,
): EditorWorkspaceLayout {
  const source = layout.groups[sourceGroupId]
  const target = layout.groups[targetGroupId]
  if (!source || !target || !source.tabIds.includes(tabId)) return layout

  let nextSourceIds = [...source.tabIds]
  const nextTargetIds = target.tabIds.filter(id => id !== tabId)
  if (!copy) nextSourceIds = nextSourceIds.filter(id => id !== tabId)

  const insertionIndex = Math.max(0, Math.min(targetIndex ?? nextTargetIds.length, nextTargetIds.length))
  nextTargetIds.splice(insertionIndex, 0, tabId)
  const groups = {
    ...layout.groups,
    [sourceGroupId]: {
      ...source,
      tabIds: nextSourceIds,
      activeTabId: source.activeTabId === tabId && !copy
        ? nextSourceIds.at(-1) ?? ''
        : source.activeTabId,
    },
    [targetGroupId]: {
      ...target,
      tabIds: nextTargetIds,
      activeTabId: tabId,
    },
  }

  return {
    ...layout,
    groups,
    activeGroupId: targetGroupId,
  }
}

export function setActiveEditorGroupTab(
  layout: EditorWorkspaceLayout,
  groupId: string,
  tabId: string,
): EditorWorkspaceLayout {
  const group = layout.groups[groupId]
  if (!group || (tabId && !group.tabIds.includes(tabId))) return layout
  return {
    ...layout,
    activeGroupId: groupId,
    groups: {
      ...layout.groups,
      [groupId]: { ...group, activeTabId: tabId },
    },
  }
}

export function removeTabFromEditorGroup(
  layout: EditorWorkspaceLayout,
  groupId: string,
  tabId: string,
): EditorWorkspaceLayout {
  const group = layout.groups[groupId]
  if (!group) return layout
  const tabIndex = group.tabIds.indexOf(tabId)
  if (tabIndex < 0) return layout
  const tabIds = group.tabIds.filter(id => id !== tabId)
  const activeTabId = group.activeTabId === tabId
    ? tabIds[Math.max(0, tabIndex - 1)] ?? tabIds.at(-1) ?? ''
    : group.activeTabId
  const groups = {
    ...layout.groups,
    [groupId]: { ...group, tabIds, activeTabId },
  }
  return { ...layout, groups }
}

export function closeEditorGroup(
  layout: EditorWorkspaceLayout,
  groupId: string,
): EditorWorkspaceLayout {
  const groupIds = getEditorGroupIds(layout.root)
  if (!layout.groups[groupId] || groupIds.length === 1) {
    const group = layout.groups[groupId]
    return group
      ? {
          ...layout,
          groups: { ...layout.groups, [groupId]: { ...group, tabIds: [], activeTabId: '' } },
          maximizedGroupId: undefined,
        }
      : layout
  }

  const root = removeGroupNode(layout.root, groupId)
  if (!root) return layout
  const groups = { ...layout.groups }
  delete groups[groupId]
  const remainingIds = getEditorGroupIds(root)
  const activeGroupId = layout.activeGroupId === groupId
    ? remainingIds.at(-1) ?? remainingIds[0]
    : layout.activeGroupId
  return {
    ...layout,
    root,
    groups,
    activeGroupId,
    maximizedGroupId: undefined,
  }
}

export function normalizeEditorWorkspaceLayout(
  value: EditorWorkspaceLayout | null | undefined,
  tabs: OpenTabInfo[],
): EditorWorkspaceLayout {
  if (!value || value.version !== 1 || !value.root || !value.groups) {
    return createEditorWorkspaceLayout(tabs)
  }

  const validTabIds = new Set(tabs.map(tab => tab.id))
  const nodeGroupIds = getEditorGroupIds(value.root)
  if (nodeGroupIds.length === 0) return createEditorWorkspaceLayout(tabs)

  const groups: Record<string, EditorGroup> = {}
  const assigned = new Set<string>()
  for (const groupId of nodeGroupIds) {
    const group = value.groups[groupId]
    if (!group) return createEditorWorkspaceLayout(tabs)
    const tabIds = group.tabIds.filter(id => {
      if (!validTabIds.has(id) || assigned.has(id)) return false
      assigned.add(id)
      return true
    })
    groups[groupId] = {
      ...group,
      tabIds,
      activeTabId: tabIds.includes(group.activeTabId)
        ? group.activeTabId
        : tabIds.at(-1) ?? '',
    }
  }

  const unassigned = tabs.map(tab => tab.id).filter(id => !assigned.has(id))
  const activeGroupId = groups[value.activeGroupId]
    ? value.activeGroupId
    : nodeGroupIds[0]
  if (unassigned.length > 0) {
    const target = groups[activeGroupId]
    groups[activeGroupId] = {
      ...target,
      tabIds: [...target.tabIds, ...unassigned],
      activeTabId: unassigned.at(-1) ?? target.activeTabId,
    }
  }

  let normalized: EditorWorkspaceLayout = {
    ...value,
    groups,
    activeGroupId,
    ...normalizeEditorNavigationState(
      value.navigationHistory,
      value.navigationIndex,
    ),
    maximizedGroupId: value.maximizedGroupId && groups[value.maximizedGroupId]
      ? value.maximizedGroupId
      : undefined,
  }

  for (const groupId of nodeGroupIds) {
    if (getEditorGroupIds(normalized.root).length === 1) break
    if (normalized.groups[groupId]?.tabIds.length === 0) {
      normalized = closeEditorGroup(normalized, groupId)
    }
  }

  return normalized
}

export function tabIsReferenced(
  layout: EditorWorkspaceLayout,
  tabId: string,
  excludingGroupId?: string,
) {
  return Object.values(layout.groups).some(group => (
    group.id !== excludingGroupId && group.tabIds.includes(tabId)
  ))
}
