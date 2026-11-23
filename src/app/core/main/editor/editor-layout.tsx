'use client'

import { PluginEmbeddedViews } from '@/components/plugins/plugin-embedded-views'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { Store } from '@tauri-apps/plugin-store'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { Layout } from 'react-resizable-panels'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/utils'
import { checkIsTauri } from '@/lib/check'
import { listenTauriEvent } from '@/lib/tauri-event-listener'
import emitter, { type Events } from '@/lib/emitter'
import useArticleStore, { findFolderInTree, type DirTree } from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useCanvasStore from '@/stores/canvas'
import useSettingStore from '@/stores/setting'
import { useInitialSetupStore } from '@/stores/initial-setup'
import { useSidebarStore } from '@/stores/sidebar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { OnboardingSpotlight } from '@/components/onboarding-spotlight'
import { TabContentErrorBoundary } from '@/components/tab-content-error-boundary'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { MdEditor } from './markdown/md-editor-wrapper'
import { TabBar, type TabInfo } from './tab-bar'
import { BrowserPanel } from './browser-panel'
import { ImageEditor } from './image/image-editor'
import { EmptyState } from './empty-state'
import { FolderView } from './folder'
import { PluginDocumentPreview } from '@/components/plugins/plugin-document-preview'
import { PluginViewSurface } from '@/components/plugins/plugin-view-surface'
import { parsePluginEditorTabPath } from '@/lib/plugins/editor-tab'
import { UnsupportedFile } from './unsupported-file'
import { MarkDetailPanel } from '../mark/mark-detail-panel'
import { getRecordIdFromTabPath, isRecordTabPath } from '../mark/mark-record-tab'
import { getRecordTabCloseGuards, type RecordTabCloseGuard } from '../mark/record-detail-tab-guard'
import { createCanvasTab, getCanvasIdFromTabPath, isCanvasTabPath } from '../canvas/canvas-tab'
import { canOpenInEditorWindow, focusEditorWindowForPath, openEditorWindow } from '@/lib/editor-windows'
import {
  editorPathIsSameOrDescendant,
  editorPathsReferToSameFile,
  getCurrentEditorWorkspaceRoot,
  prepareActiveEditorDeactivationDurably,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'
import { computedParentPath } from '@/lib/path'
import {
  getDefaultArticleAbsolutePath,
  getWorkspacePath,
  isAbsoluteFsPath,
} from '@/lib/workspace'
import {
  cleanEditorNavigationHistoryByDeletedFile,
  cleanEditorNavigationHistoryByDeletedFolder,
  closeEditorGroup,
  createEditorWorkspaceLayout,
  getEditorBackNavigationTarget,
  getEditorForwardNavigationTarget,
  getEditorGroupIds,
  mapEditorNavigationHistoryForPathChange,
  moveEditorTab,
  normalizeEditorWorkspaceLayout,
  recordEditorNavigation,
  removeEditorNavigationEntry,
  removeTabFromEditorGroup,
  setActiveEditorGroupTab,
  resetEditorNavigation,
  setEditorNavigationIndex,
  splitEditorGroup,
  tabIsReferenced,
  updateEditorSplitSizes,
  type EditorGroup,
  type EditorLayoutNode,
  type EditorSplitDirection,
  type EditorWorkspaceLayout,
} from './editor-group-layout'
import { useDesktopOnboarding } from './use-desktop-onboarding'
import type { OnboardingStepId } from './onboarding-state'

const MARKDOWN_EXTENSIONS = new Set([
  'md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less',
  'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go',
  'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg',
  'gitignore', 'env', 'example', 'template',
])
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'])
const EDITOR_LAYOUT_STORE_KEY = 'editorWorkspaceLayout:main'
const ONBOARDING_TARGETS: Record<OnboardingStepId, string> = {
  'create-record': 'onboarding-target-record-text',
  'organize-note': 'onboarding-target-organize-notes',
  'ai-polish': 'onboarding-chat-composer',
}
type PendingEditorNavigationMutation =
  | { type: 'move'; oldPath: string; newPath: string }
  | { type: 'delete'; path: string; isFolder: boolean; workspaceRoot?: string }
type PendingEditorNavigation = {
  operationId: number
  workspaceKey?: string
  groupId: string
  activeTabId: string
  activeFilePath: string
}
type BrowserNewWindow = { sourceTabId: string; url: string }
const CanvasEditor = dynamic(
  () => import('../canvas/canvas-editor').then(module => module.CanvasEditor),
  { ssr: false },
)

function getEditorWorkspaceKey(workspace: { path: string; isCustom: boolean }) {
  return workspace.isCustom
    ? workspace.path.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    : '__default__'
}

function applyEditorNavigationMutation(
  layout: EditorWorkspaceLayout,
  mutation: PendingEditorNavigationMutation,
) {
  if (mutation.type === 'move') {
    return mapEditorNavigationHistoryForPathChange(
      layout,
      mutation.oldPath,
      mutation.newPath,
    )
  }
  return mutation.isFolder
    ? cleanEditorNavigationHistoryByDeletedFolder(
        layout,
        mutation.path,
        mutation.workspaceRoot,
      )
    : cleanEditorNavigationHistoryByDeletedFile(
        layout,
        mutation.path,
        mutation.workspaceRoot,
      )
}

const editorCollisionDetection: CollisionDetection = args => {
  if (!args.pointerCoordinates) return closestCenter(args)
  const collisions = pointerWithin(args)
  const priority = (id: string | number) => {
    const value = String(id)
    if (value.startsWith('editor-drop:')) return 0
    if (value.startsWith('editor-tab:')) return 1
    if (value.startsWith('editor-tab-list:')) return 2
    return 3
  }
  return [...collisions].sort((left, right) => priority(left.id) - priority(right.id))
}

function findPathInTree(path: string, tree: DirTree[]): DirTree | null {
  for (const item of tree) {
    if (computedParentPath(item) === path) return item
    const nested = item.children ? findPathInTree(path, item.children) : null
    if (nested) return nested
  }
  return null
}

interface DropZoneProps {
  groupId: string
  direction: EditorSplitDirection | 'center'
  className: string
  visible: boolean
}

function EditorDropZone({ groupId, direction, className, visible }: DropZoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `editor-drop:${groupId}:${direction}`,
    data: { type: 'editor-drop-zone', groupId, direction },
  })
  if (!visible) return null
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'pointer-events-none absolute bg-primary/10 transition-colors',
        isOver && 'bg-primary/25 ring-2 ring-inset ring-primary/60',
        className,
      )}
    />
  )
}

interface EditorGroupPaneProps {
  group: EditorGroup
  tabs: TabInfo[]
  activeLayout: EditorWorkspaceLayout
  dragging: boolean
  onActivateGroup: (groupId: string, tabId?: string) => void
  onNewTab: (groupId: string) => void
  onNewBrowser: (groupId: string) => void
  onCloseTab: (groupId: string, tabId: string) => void
  onKeepTabs: (groupId: string, keptTabIds: string[]) => void
  onSplitTab: (groupId: string, tabId: string, direction: EditorSplitDirection) => void
  onMoveToNewWindow: (groupId: string, tabId: string) => void
  onPinTab: (tabId: string) => void
  onUnpinTab: (tabId: string) => void
  onRestartPluginTab: (tabId: string) => void
  onToggleMaximize: (groupId: string) => void
  onCloseGroup: (groupId: string) => void
  renderActiveContent: (tab: TabInfo, active: boolean, groupId: string) => React.ReactNode
  renderEmpty: (mode: 'new-tab' | 'empty-group', enableShortcuts?: boolean) => React.ReactNode
}

function EditorGroupPane({
  group, tabs, activeLayout, dragging, onActivateGroup, onNewTab, onNewBrowser, onCloseTab,
  onKeepTabs, onSplitTab, onMoveToNewWindow, onPinTab, onUnpinTab, onRestartPluginTab,
  onToggleMaximize, onCloseGroup,
  renderActiveContent, renderEmpty,
}: EditorGroupPaneProps) {
  const tCanvas = useTranslations('canvas')
  const newFile = useArticleStore(state => state.newFile)
  const addTab = useArticleStore(state => state.addTab)
  const setLeftSidebarTab = useSidebarStore(state => state.setLeftSidebarTab)
  const createProject = useCanvasStore(state => state.createProject)
  const groupTabs = group.tabIds
    .map(tabId => tabs.find(tab => tab.id === tabId))
    .filter((tab): tab is TabInfo => Boolean(tab))
  const activeTab = groupTabs.find(tab => tab.id === group.activeTabId)
  const isActiveGroup = activeLayout.activeGroupId === group.id

  return (
    <section
      className={cn('relative flex h-full w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background', isActiveGroup && 'editor-group-active')}
    >
      <TabBar
        groupId={group.id}
        tabs={groupTabs}
        activeTabId={group.activeTabId}
        isActiveGroup={isActiveGroup}
        isMaximized={activeLayout.maximizedGroupId === group.id}
        onTabSwitch={tabId => onActivateGroup(group.id, tabId)}
        onNewTab={() => onNewTab(group.id)}
        onNewBrowser={() => onNewBrowser(group.id)}
        onNewNote={() => { void setLeftSidebarTab('files').then(() => newFile()) }}
        onNewRecord={() => emitter.emit('quickRecordTextHandler')}
        onNewCanvas={() => { void createProject('blank', tCanvas('templates.blank')).then(project => { if (project) void addTab(createCanvasTab(project)) }) }}
        onCloseTab={tabId => onCloseTab(group.id, tabId)}
        onCloseOtherTabs={tabId => onKeepTabs(group.id, [tabId])}
        onCloseAllTabs={() => onKeepTabs(group.id, [])}
        onCloseLeftTabs={tabId => {
          const index = group.tabIds.indexOf(tabId)
          onKeepTabs(group.id, group.tabIds.slice(index))
        }}
        onCloseRightTabs={tabId => {
          const index = group.tabIds.indexOf(tabId)
          onKeepTabs(group.id, group.tabIds.slice(0, index + 1))
        }}
        onSplitTab={(tabId, direction) => onSplitTab(group.id, tabId, direction)}
        onMoveToNewWindow={tabId => onMoveToNewWindow(group.id, tabId)}
        onPinTab={onPinTab}
        onUnpinTab={onUnpinTab}
        onRestartPluginTab={onRestartPluginTab}
        onToggleMaximize={() => onToggleMaximize(group.id)}
        canCloseGroup={!groupTabs.some(tab => tab.pinned)}
        onCloseGroup={() => onCloseGroup(group.id)}
      />
      <div className="relative flex min-h-0 flex-1" onPointerDownCapture={() => onActivateGroup(group.id, group.activeTabId)}>
        {groupTabs.map(tab => (
          <div
            key={`${tab.id}:${tab.path}`}
            className="min-h-0 min-w-0 w-full flex-1 overflow-hidden"
            style={{ display: tab.id === activeTab?.id ? 'flex' : 'none' }}
          >
            {tab.kind !== 'blank'
              && renderActiveContent(tab, isActiveGroup && tab.id === activeTab?.id, group.id)}
            {tab.kind === 'blank' && tab.id === activeTab?.id
              && renderEmpty('new-tab', isActiveGroup)}
          </div>
        ))}
        {!activeTab && renderEmpty(groupTabs.length > 0 ? 'new-tab' : 'empty-group', isActiveGroup)}
        <EditorDropZone groupId={group.id} direction="left" visible={dragging} className="inset-y-0 left-0 z-20 w-1/4" />
        <EditorDropZone groupId={group.id} direction="right" visible={dragging} className="inset-y-0 right-0 z-20 w-1/4" />
        <EditorDropZone groupId={group.id} direction="up" visible={dragging} className="inset-x-1/4 top-0 z-20 h-1/4" />
        <EditorDropZone groupId={group.id} direction="down" visible={dragging} className="inset-x-1/4 bottom-0 z-20 h-1/4" />
        <EditorDropZone groupId={group.id} direction="center" visible={dragging} className="inset-1/4 z-10" />
      </div>
    </section>
  )
}

export function EditorLayout({
  revealEditorPanel,
  revealRecordPanel,
  revealAgentPanel,
}: {
  revealEditorPanel: () => Promise<void>
  revealRecordPanel: () => Promise<void>
  revealAgentPanel: () => Promise<void>
}) {
  const {
    activeFilePath, fileTree, fileTreeInitialized, fileTreeWorkspaceKey,
    setActiveFilePath, openTabs, activeTabId,
    setActiveTabId, setOpenTabs, addTab, replaceTab,
    setTabDisposition, pendingFileTabOpenRequest, consumeFileTabOpenRequest,
    removeTab, cleanTabsByDeletedFile, cleanTabsByDeletedFolder,
    initOpenTabs, initShowCloudFiles,
  } = useArticleStore(useShallow(state => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    fileTreeInitialized: state.fileTreeInitialized,
    fileTreeWorkspaceKey: state.fileTreeWorkspaceKey,
    setActiveFilePath: state.setActiveFilePath,
    openTabs: state.openTabs,
    activeTabId: state.activeTabId,
    setActiveTabId: state.setActiveTabId,
    setOpenTabs: state.setOpenTabs,
    addTab: state.addTab,
    replaceTab: state.replaceTab,
    setTabDisposition: state.setTabDisposition,
    pendingFileTabOpenRequest: state.pendingFileTabOpenRequest,
    consumeFileTabOpenRequest: state.consumeFileTabOpenRequest,
    removeTab: state.removeTab,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    initOpenTabs: state.initOpenTabs,
    initShowCloudFiles: state.initShowCloudFiles,
  })))
  const workspacePath = useSettingStore(state => state.workspacePath)
  const setActiveMarkId = useMarkStore(state => state.setActiveMarkId)
  const clearActiveMark = useMarkStore(state => state.clearActiveMark)
  const setActiveCanvasId = useCanvasStore(state => state.setActiveCanvasId)
  const tOnboarding = useTranslations('article.emptyState.onboarding')
  const tGroups = useTranslations('tabContext')
  const tRecordDetail = useTranslations('record.mark.detail')
  const tCommon = useTranslations('common')

  const tabContentsRef = useRef<Record<string, string>>({})
  const tabContentsWorkspacePathRef = useRef(workspacePath)
  if (tabContentsWorkspacePathRef.current !== workspacePath) {
    tabContentsWorkspacePathRef.current = workspacePath
    tabContentsRef.current = {}
  }
  const [layout, setLayoutState] = useState<EditorWorkspaceLayout>(() => createEditorWorkspaceLayout([]))
  const layoutRef = useRef<EditorWorkspaceLayout>(layout)
  const layoutPersistQueueRef = useRef<Promise<void>>(Promise.resolve())
  const suppressPanelLayoutUntilRef = useRef(0)
  const navigationOperationRef = useRef(0)
  const pendingEditorNavigationRef = useRef<PendingEditorNavigation | null>(null)
  const pendingNavigationMutationsRef = useRef<PendingEditorNavigationMutation[]>([])
  const layoutReadyRef = useRef(false)
  const restoredTabValidationRef = useRef<{
    sequence: number
    status: 'idle' | 'running' | 'done'
  }>({ sequence: 0, status: 'idle' })
  const initializedRef = useRef(false)
  const [layoutReady, setLayoutReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [detachingTabId, setDetachingTabId] = useState('')
  const [confirmRecordTabClose, setConfirmRecordTabClose] = useState<(() => void) | null>(null)
  const recordCloseFocusRef = useRef<HTMLElement | null>(null)
  const [pluginTabRevisions, setPluginTabRevisions] = useState<Record<string, number>>({})
  const handleRestartPluginTab = useCallback((tabId: string) => {
    setPluginTabRevisions(current => ({ ...current, [tabId]: (current[tabId] ?? 0) + 1 }))
  }, [])
  const [onboardingReveal, setOnboardingReveal] = useState<{ tabId: string } | null>(null)
  const dismissOnboardingReveal = useCallback(() => setOnboardingReveal(null), [])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const setLayout = useCallback((next: EditorWorkspaceLayout | ((current: EditorWorkspaceLayout) => EditorWorkspaceLayout)) => {
    const resolved = typeof next === 'function' ? next(layoutRef.current) : next
    layoutRef.current = resolved
    setLayoutState(resolved)
  }, [])

  const applyPendingNavigationMutations = useCallback((current: EditorWorkspaceLayout) => {
    const pendingMutations = pendingNavigationMutationsRef.current
    pendingNavigationMutationsRef.current = []
    return pendingMutations.reduce(applyEditorNavigationMutation, current)
  }, [])

  const canDeactivateActiveEditor = useCallback(() => {
    let canDeactivate = true
    emitter.emit('editor-prepare-deactivate', {
      resolve: nextValue => { canDeactivate = canDeactivate && nextValue },
    })
    return canDeactivate
  }, [])

  const canCloseRecordTabs = useCallback((
    groupId: string,
    tabIds: readonly string[],
    confirmed: readonly RecordTabCloseGuard[],
    resume: (guards: readonly RecordTabCloseGuard[]) => void,
  ) => {
    const dirty: RecordTabCloseGuard[] = []
    for (const guard of getRecordTabCloseGuards(groupId, tabIds)) {
      const status = guard()
      if (status === 'saving') {
        toast.info(tCommon('saving'))
        return false
      }
      if (status === 'dirty' && !confirmed.includes(guard)) dirty.push(guard)
    }
    if (!dirty.length) return true

    if (!recordCloseFocusRef.current && document.activeElement instanceof HTMLElement) {
      recordCloseFocusRef.current = document.activeElement
    }
    setConfirmRecordTabClose(current => current ?? (() => resume([...confirmed, ...dirty])))
    return false
  }, [tCommon])

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    void (async () => {
      await Promise.all([initOpenTabs(), initShowCloudFiles()])
      const articleState = useArticleStore.getState()
      const tabs = articleState.openTabs
      const store = await Store.load('store.json')
      const storedLayout = await store.get<EditorWorkspaceLayout>(EDITOR_LAYOUT_STORE_KEY)
      const workspaceKey = getEditorWorkspaceKey(await getWorkspacePath())
      let restoredLayout = normalizeEditorWorkspaceLayout(storedLayout, tabs)
      if (restoredLayout.workspaceKey !== workspaceKey) {
        restoredLayout = resetEditorNavigation(restoredLayout, workspaceKey)
      }
      const restoredGroup = Object.values(restoredLayout.groups)
        .find(group => group.tabIds.includes(articleState.activeTabId))
      if (restoredGroup && articleState.activeTabId) {
        restoredLayout = setActiveEditorGroupTab(restoredLayout, restoredGroup.id, articleState.activeTabId)
      }
      restoredLayout = applyPendingNavigationMutations(restoredLayout)
      setLayout(restoredLayout)
      layoutReadyRef.current = true
      setLayoutReady(true)
    })().catch(error => {
      console.error('Failed to restore editor layout:', error)
      setLayout(applyPendingNavigationMutations(
        createEditorWorkspaceLayout(useArticleStore.getState().openTabs),
      ))
      layoutReadyRef.current = true
      setLayoutReady(true)
    })
  }, [applyPendingNavigationMutations, initOpenTabs, initShowCloudFiles, setLayout])

  useEffect(() => {
    if (!layoutReady) return
    let disposed = false
    void getWorkspacePath().then(workspace => {
      if (disposed) return
      const workspaceKey = getEditorWorkspaceKey(workspace)
      setLayout(current => current.workspaceKey === workspaceKey
        ? current
        : resetEditorNavigation(current, workspaceKey))
    }).catch(error => {
      console.error('Failed to resolve editor workspace history:', error)
    })
    return () => { disposed = true }
  }, [layoutReady, setLayout, workspacePath])

  useEffect(() => {
    if (!layoutReady) return
    setLayout(current => normalizeEditorWorkspaceLayout(current, openTabs))
  }, [layoutReady, openTabs, setLayout])

  useEffect(() => {
    if (!layoutReady) return
    const timer = window.setTimeout(() => {
      layoutPersistQueueRef.current = layoutPersistQueueRef.current.catch(() => undefined).then(async () => {
        const store = await Store.load('store.json')
        await store.set(EDITOR_LAYOUT_STORE_KEY, layout)
        await store.save()
      }).catch(error => {
        console.error('Failed to persist editor layout:', error)
      })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [layout, layoutReady])

  useEffect(() => {
    const handleFileContentUpdated = (event: Events['editor-file-content-updated']) => {
      tabContentsRef.current[event.path] = event.content
      const previewTab = useArticleStore.getState().openTabs.find(tab => (
        tab.path === event.path && tab.preview
      ))
      if (previewTab) {
        void useArticleStore.getState().setTabDisposition(previewTab.id, 'regular')
      }
      queueMicrotask(() => emitter.emit('sync-content-updated', event))
    }
    const handleFilePathChanged = (event: Events['editor-file-path-changed']) => {
      const content = event.content ?? tabContentsRef.current[event.oldPath]
      delete tabContentsRef.current[event.oldPath]
      if (typeof content === 'string') tabContentsRef.current[event.newPath] = content
    }
    const handleNavigationPathMoved = (event: Events['editor-navigation-path-moved']) => {
      const layoutIsReady = layoutReadyRef.current
      if (!layoutIsReady) {
        pendingNavigationMutationsRef.current.push({
          type: 'move',
          oldPath: event.oldPath,
          newPath: event.newPath,
        })
      } else {
        event.markHandled?.()
      }
      const movedContents: Array<[string, string]> = []
      for (const [path, content] of Object.entries(tabContentsRef.current)) {
        const nextPath = path === event.oldPath
          ? event.newPath
          : path.startsWith(`${event.oldPath}/`)
            ? `${event.newPath}${path.slice(event.oldPath.length)}`
            : path
        if (nextPath === path) continue
        delete tabContentsRef.current[path]
        movedContents.push([nextPath, content])
      }
      for (const [path, content] of movedContents) {
        tabContentsRef.current[path] = content
      }
      if (!layoutIsReady) return
      setLayout(current => mapEditorNavigationHistoryForPathChange(
        current,
        event.oldPath,
        event.newPath,
      ))
    }
    const handleNavigationPathDeleted = (event: Events['editor-navigation-path-deleted']) => {
      const layoutIsReady = layoutReadyRef.current
      if (!layoutIsReady) {
        pendingNavigationMutationsRef.current.push({
          type: 'delete',
          path: event.path,
          isFolder: event.isFolder,
          workspaceRoot: event.workspaceRoot,
        })
      } else {
        event.markHandled?.()
      }
      if (layoutIsReady && event.deletedTabIds?.length && event.resolveFallbackTabId) {
        const deletedTabIds = new Set(event.deletedTabIds)
        const validTabIds = new Set(useArticleStore.getState().openTabs.map(tab => tab.id))
        const currentLayout = layoutRef.current
        const activeGroup = currentLayout.groups[currentLayout.activeGroupId]
        const activeIndex = activeGroup?.tabIds.indexOf(activeGroup.activeTabId) ?? -1
        if (activeGroup && activeIndex >= 0 && deletedTabIds.has(activeGroup.activeTabId)) {
          const previousTabId = activeGroup.tabIds
            .slice(0, activeIndex)
            .reverse()
            .find(tabId => validTabIds.has(tabId) && !deletedTabIds.has(tabId))
          const nextTabId = activeGroup.tabIds
            .slice(activeIndex + 1)
            .find(tabId => validTabIds.has(tabId) && !deletedTabIds.has(tabId))
          const fallbackTabId = previousTabId ?? nextTabId
          if (fallbackTabId) event.resolveFallbackTabId(fallbackTabId)
        }
      }
      for (const path of Object.keys(tabContentsRef.current)) {
        const deleted = event.isFolder
          ? editorPathIsSameOrDescendant(path, event.path, event.workspaceRoot)
          : editorPathsReferToSameFile(path, event.path, event.workspaceRoot)
        if (deleted) delete tabContentsRef.current[path]
      }
      if (!layoutIsReady) return
      setLayout(current => event.isFolder
        ? cleanEditorNavigationHistoryByDeletedFolder(current, event.path, event.workspaceRoot)
        : cleanEditorNavigationHistoryByDeletedFile(current, event.path, event.workspaceRoot))
    }
    emitter.on('editor-file-content-updated', handleFileContentUpdated)
    emitter.on('editor-file-path-changed', handleFilePathChanged)
    emitter.on('editor-navigation-path-moved', handleNavigationPathMoved)
    emitter.on('editor-navigation-path-deleted', handleNavigationPathDeleted)
    return () => {
      emitter.off('editor-file-content-updated', handleFileContentUpdated)
      emitter.off('editor-file-path-changed', handleFilePathChanged)
      emitter.off('editor-navigation-path-moved', handleNavigationPathMoved)
      emitter.off('editor-navigation-path-deleted', handleNavigationPathDeleted)
    }
  }, [setLayout])

  const isRecordEditorTab = useCallback((tab: TabInfo) => tab.kind === 'record' || isRecordTabPath(tab.path), [])
  const isCanvasEditorTab = useCallback((tab: TabInfo) => tab.kind === 'canvas' || isCanvasTabPath(tab.path), [])
  const isBlankEditorTab = useCallback((tab: TabInfo) => tab.kind === 'blank', [])
  const isPluginEditorTab = useCallback((tab: TabInfo) => tab.kind === 'plugin' || parsePluginEditorTabPath(tab.path) !== null, [])
  const isBrowserEditorTab = useCallback((tab: TabInfo) => tab.kind === 'browser' || tab.path.startsWith('browser://'), [])
  const previousBrowserTabsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const current = new Set(openTabs.filter(isBrowserEditorTab).map(tab => tab.id))
    for (const tabId of previousBrowserTabsRef.current) {
      if (!current.has(tabId)) void import('@tauri-apps/api/core').then(({ invoke }) => invoke('browser_close', { tabId })).catch(() => {})
    }
    previousBrowserTabsRef.current = current
  }, [isBrowserEditorTab, openTabs])

  useEffect(() => () => {
    for (const tabId of previousBrowserTabsRef.current) {
      void import('@tauri-apps/api/core').then(({ invoke }) => invoke('browser_close', { tabId })).catch(() => {})
    }
  }, [])
  const getRecordIdForTab = useCallback((tab: TabInfo) => tab.markId ?? getRecordIdFromTabPath(tab.path), [])
  const isFolderPath = useCallback((path: string) => !(path.split(/[\\/]/).pop() || '').includes('.'), [])

  const getItemType = useCallback((path: string): 'markdown' | 'image' | 'folder' | 'unknown' => {
    if (!path) return 'unknown'
    if (findFolderInTree(path, fileTree)) return 'folder'
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return 'unknown'
    if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
    if (IMAGE_EXTENSIONS.has(extension)) return 'image'
    return 'unknown'
  }, [fileTree])

  const checkPathExists = useCallback(async (
    path: string,
    workspaceRoot?: string,
  ): Promise<boolean | null> => {
    try {
      const { exists } = await import('@tauri-apps/plugin-fs')
      if (workspaceRoot) {
        const resolvedPath = isAbsoluteFsPath(path)
          ? path
          : await (await import('@tauri-apps/api/path')).join(workspaceRoot, path)
        return await exists(resolvedPath)
      }
      const { getFilePathOptions } = await import('@/lib/workspace')
      const options = await getFilePathOptions(path)
      return options.baseDir
        ? await exists(options.path, { baseDir: options.baseDir })
        : await exists(options.path)
    } catch {
      return null
    }
  }, [])

  const activeFileTabReady = !activeFilePath || openTabs.some(tab => (
    tab.path === activeFilePath
  ))

  useEffect(() => {
    const validationState = restoredTabValidationRef.current
    if (!fileTreeInitialized) {
      validationState.sequence += 1
      validationState.status = 'idle'
      return
    }
    if (!layoutReady || !activeFileTabReady || validationState.status !== 'idle') return

    const validationSequence = ++validationState.sequence
    validationState.status = 'running'
    let disposed = false
    const validationWorkspacePath = useSettingStore.getState().workspacePath
    const restoredState = useArticleStore.getState()
    const restoredTabs = [...restoredState.openTabs]
    const restoredFileTree = restoredState.fileTree

    void (async () => {
      const validationWorkspaceRoot = await getCurrentEditorWorkspaceRoot().catch(() => null)
      const expectedWorkspaceRoot = validationWorkspacePath
        ? validationWorkspacePath
        : await getDefaultArticleAbsolutePath('').catch(() => null)
      if (
        !validationWorkspaceRoot
        || !expectedWorkspaceRoot
        || !workspaceRootsReferToSameLocation(
          validationWorkspaceRoot,
          expectedWorkspaceRoot,
        )
        || disposed
        || useSettingStore.getState().workspacePath !== validationWorkspacePath
      ) return

      const missingCandidates: TabInfo[] = []
      for (const tab of restoredTabs) {
        if (isRecordEditorTab(tab) || isCanvasEditorTab(tab) || isBlankEditorTab(tab) || isPluginEditorTab(tab) || isBrowserEditorTab(tab)) continue
        const treeItem = findPathInTree(tab.path, restoredFileTree)
        if (treeItem?.isLocale === false) continue
        const existsOnDisk = await checkPathExists(tab.path, validationWorkspaceRoot)
        if (disposed || useSettingStore.getState().workspacePath !== validationWorkspacePath) return
        if (existsOnDisk === false) missingCandidates.push(tab)
      }
      if (!missingCandidates.length) return

      let syncConfigured: boolean | null = null
      if (missingCandidates.some(tab => !isAbsoluteFsPath(tab.path))) {
        try {
          const { isSyncConfigured } = await import('@/lib/sync/sync-manager')
          syncConfigured = await isSyncConfigured({ throwOnError: true })
        } catch {
          // A configuration read failure is not proof that a remote-only file is gone.
          syncConfigured = null
        }
      }
      if (disposed || useSettingStore.getState().workspacePath !== validationWorkspacePath) return

      const invalidTabs = missingCandidates.filter(tab => (
        isAbsoluteFsPath(tab.path) || syncConfigured === false
      ))
      const currentActiveTabId = useArticleStore.getState().activeTabId
      invalidTabs.sort((left, right) => (
        Number(left.id === currentActiveTabId) - Number(right.id === currentActiveTabId)
      ))

      for (const tab of invalidTabs) {
        if (disposed || useSettingStore.getState().workspacePath !== validationWorkspacePath) return
        const currentState = useArticleStore.getState()
        const currentTab = currentState.openTabs.find(item => item.id === tab.id)
        if (
          !currentTab
          || currentTab.isFolder !== tab.isFolder
          || !editorPathsReferToSameFile(
            currentTab.path,
            tab.path,
            validationWorkspaceRoot,
          )
          || findPathInTree(currentTab.path, currentState.fileTree)?.isLocale === false
        ) {
          continue
        }
        const stillMissing = await checkPathExists(currentTab.path, validationWorkspaceRoot)
        if (disposed || useSettingStore.getState().workspacePath !== validationWorkspacePath) return
        if (stillMissing !== false) continue
        if (
          currentState.activeTabId === currentTab.id
          && !canDeactivateActiveEditor()
        ) continue
        if (tabContentsRef.current[currentTab.path]) continue

        if (currentTab.isFolder) {
          await cleanTabsByDeletedFolder(
            currentTab.path,
            validationWorkspaceRoot,
            { preservePendingSaves: true },
          )
        } else {
          await cleanTabsByDeletedFile(
            currentTab.path,
            validationWorkspaceRoot,
            { preservePendingSaves: true },
          )
        }
      }
    })().catch(error => {
      console.error('Failed to clean invalid restored editor tabs:', error)
    }).finally(() => {
      const currentValidation = restoredTabValidationRef.current
      if (currentValidation.sequence !== validationSequence) return
      currentValidation.status = disposed ? 'idle' : 'done'
    })

    return () => {
      disposed = true
      const currentValidation = restoredTabValidationRef.current
      if (
        currentValidation.sequence === validationSequence
        && currentValidation.status === 'running'
      ) {
        currentValidation.sequence += 1
        currentValidation.status = 'idle'
      }
    }
  }, [
    activeFilePath,
    activeFileTabReady,
    checkPathExists,
    canDeactivateActiveEditor,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    fileTreeInitialized,
    isBlankEditorTab,
    isCanvasEditorTab,
    isRecordEditorTab,
    isPluginEditorTab,
    isBrowserEditorTab,
    layoutReady,
  ])

  useEffect(() => {
    const restoredActiveTab = openTabs.find(tab => tab.id === activeTabId)
    setActiveCanvasId(
      restoredActiveTab && isCanvasEditorTab(restoredActiveTab)
        ? getCanvasIdFromTabPath(restoredActiveTab.path)
        : null
    )
  }, [activeTabId, isCanvasEditorTab, openTabs, setActiveCanvasId])

  const activateTab = useCallback(async (
    groupId: string,
    tab?: TabInfo | null,
    options?: { deactivationAlreadyPrepared?: boolean },
  ) => {
    const currentGlobalTab = useArticleStore.getState().activeTabId
    if (
      tab?.id !== currentGlobalTab
      && !options?.deactivationAlreadyPrepared
      && !canDeactivateActiveEditor()
    ) return false
    setLayout(current => setActiveEditorGroupTab(current, groupId, tab?.id ?? ''))
    const preparedOptions = {
      deactivationAlreadyPrepared: true,
      createIfMissing: false,
    }
    if (!tab) {
      clearActiveMark()
      setActiveCanvasId(null)
      await Promise.all([
        setActiveTabId('', preparedOptions),
        setActiveFilePath('', true, preparedOptions),
      ])
      return true
    }
    const persistActiveTab = setActiveTabId(tab.id, preparedOptions)
    if (isBlankEditorTab(tab) || isPluginEditorTab(tab) || isBrowserEditorTab(tab)) {
      clearActiveMark()
      setActiveCanvasId(null)
      await Promise.all([persistActiveTab, setActiveFilePath('', true, preparedOptions)])
    } else if (isRecordEditorTab(tab)) {
      setActiveMarkId(getRecordIdForTab(tab))
      setActiveCanvasId(null)
      await Promise.all([persistActiveTab, setActiveFilePath('', true, preparedOptions)])
    } else if (isCanvasEditorTab(tab)) {
      clearActiveMark()
      setActiveCanvasId(getCanvasIdFromTabPath(tab.path))
      await Promise.all([persistActiveTab, setActiveFilePath('', true, preparedOptions)])
    } else {
      clearActiveMark()
      setActiveCanvasId(null)
      await Promise.all([persistActiveTab, setActiveFilePath(tab.path, true, preparedOptions)])
    }
    return true
  }, [canDeactivateActiveEditor, clearActiveMark, getRecordIdForTab, isBlankEditorTab, isCanvasEditorTab, isRecordEditorTab, isPluginEditorTab, isBrowserEditorTab, setActiveCanvasId, setActiveFilePath, setActiveMarkId, setActiveTabId, setLayout])

  useEffect(() => {
    if (!layoutReady || !activeFilePath || isRecordTabPath(activeFilePath)) return
    const openRequest = pendingFileTabOpenRequest?.path === activeFilePath
      ? pendingFileTabOpenRequest
      : null
    const existing = openTabs.find(tab => tab.path === activeFilePath)
    if (existing) {
      if (openRequest?.mode === 'pinned' && !existing.pinned) {
        void setTabDisposition(existing.id, 'pinned')
      }
      if (activeTabId !== existing.id) {
        const activeGroup = layoutRef.current.groups[layoutRef.current.activeGroupId]
        const targetGroup = activeGroup?.tabIds.includes(existing.id)
          ? activeGroup
          : Object.values(layoutRef.current.groups).find(group => group.tabIds.includes(existing.id))
        if (targetGroup) {
          void activateTab(targetGroup.id, existing, {
            deactivationAlreadyPrepared: Boolean(openRequest),
          }).finally(() => {
            if (openRequest) consumeFileTabOpenRequest(openRequest.id)
          })
          return
        }
      }
      if (openRequest) consumeFileTabOpenRequest(openRequest.id)
      return
    }
    const requestedGroupId = layoutRef.current.activeGroupId
    let disposed = false
    void (async () => {
      const requestIsCurrent = () => {
        const articleState = useArticleStore.getState()
        return !disposed
          && articleState.activeFilePath === activeFilePath
          && (
            !openRequest
            || articleState.pendingFileTabOpenRequest?.id === openRequest.id
          )
      }
      const ownedByStandaloneWindow = await focusEditorWindowForPath(activeFilePath, {
        shouldFocus: requestIsCurrent,
      }).catch(error => {
        console.error('Failed to resolve standalone editor ownership:', error)
        return false
      })
      const currentArticleState = useArticleStore.getState()
      if (!requestIsCurrent()) return
      if (ownedByStandaloneWindow) {
        if (openRequest) consumeFileTabOpenRequest(openRequest.id)
        const currentTab = currentArticleState.openTabs.find(tab => (
          tab.id === currentArticleState.activeTabId
        ))
        await setActiveFilePath(
          currentTab?.path ?? '',
          true,
          { deactivationAlreadyPrepared: true, createIfMissing: false },
        )
        return
      }
      const existingAfterOwnershipCheck = currentArticleState.openTabs.find(tab => (
        tab.path === activeFilePath
      ))
      if (existingAfterOwnershipCheck) {
        if (openRequest?.mode === 'pinned' && !existingAfterOwnershipCheck.pinned) {
          void setTabDisposition(existingAfterOwnershipCheck.id, 'pinned')
        }
        const currentLayout = layoutRef.current
        const targetGroup = Object.values(currentLayout.groups).find(group => (
          group.tabIds.includes(existingAfterOwnershipCheck.id)
        ))
        if (targetGroup) {
          await activateTab(targetGroup.id, existingAfterOwnershipCheck, {
            deactivationAlreadyPrepared: Boolean(openRequest),
          })
        }
        if (openRequest) consumeFileTabOpenRequest(openRequest.id)
        return
      }
      const latestLayout = layoutRef.current
      const targetGroupId = latestLayout.groups[requestedGroupId]
        ? requestedGroupId
        : latestLayout.activeGroupId
      const targetGroup = latestLayout.groups[targetGroupId]
      if (!targetGroup) {
        if (openRequest) consumeFileTabOpenRequest(openRequest.id)
        return
      }
      const treeItem = findPathInTree(activeFilePath, fileTree)
      const tab: TabInfo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        path: activeFilePath,
        name: openRequest?.name || activeFilePath.split(/[\\/]/).pop() || activeFilePath,
        isFolder: treeItem?.isDirectory ?? openRequest?.isFolder ?? isFolderPath(activeFilePath),
        kind: 'file',
        preview: openRequest?.mode === 'preview',
        pinned: openRequest?.mode === 'pinned',
      }

      if (openRequest?.mode === 'preview') {
        const currentTabs = useArticleStore.getState().openTabs
        const previewTab = targetGroup.tabIds
          .map(tabId => currentTabs.find(item => item.id === tabId))
          .find(item => item?.preview)
        if (previewTab) {
          emitter.emit('editor-file-close', { path: previewTab.path })
          delete tabContentsRef.current[previewTab.path]
          void replaceTab(previewTab.id, { ...tab, id: previewTab.id })
          setLayout(current => setActiveEditorGroupTab(current, targetGroupId, previewTab.id))
          consumeFileTabOpenRequest(openRequest.id)
          return
        }
      }

      void addTab(tab, { deactivationAlreadyPrepared: true })
      if (!useArticleStore.getState().openTabs.some(item => item.id === tab.id)) {
        if (openRequest) consumeFileTabOpenRequest(openRequest.id)
        return
      }
      setLayout(current => {
        const resolvedGroupId = current.groups[targetGroupId]
          ? targetGroupId
          : current.activeGroupId
        const resolvedGroup = current.groups[resolvedGroupId]
        if (!resolvedGroup) return current
        const groups = Object.fromEntries(Object.entries(current.groups).map(([groupId, group]) => {
          if (groupId === resolvedGroupId) {
            return [groupId, {
              ...group,
              tabIds: group.tabIds.includes(tab.id)
                ? group.tabIds
                : [...group.tabIds, tab.id],
              activeTabId: tab.id,
            }]
          }
          if (!group.tabIds.includes(tab.id)) return [groupId, group]
          const tabIds = group.tabIds.filter(id => id !== tab.id)
          return [groupId, {
            ...group,
            tabIds,
            activeTabId: group.activeTabId === tab.id
              ? tabIds.at(-1) ?? ''
              : group.activeTabId,
          }]
        }))
        return { ...current, groups, activeGroupId: resolvedGroupId }
      })
      if (openRequest) consumeFileTabOpenRequest(openRequest.id)
    })()
    return () => { disposed = true }
  }, [activateTab, activeFilePath, activeTabId, addTab, consumeFileTabOpenRequest, fileTree, isFolderPath, layoutReady, openTabs, pendingFileTabOpenRequest, replaceTab, setActiveFilePath, setLayout, setTabDisposition])

  useEffect(() => {
    if (
      !layoutReady
      || !activeTabId
      || fileTreeWorkspaceKey === null
      || layout.workspaceKey !== fileTreeWorkspaceKey
    ) return
    const activeTab = openTabs.find(tab => tab.id === activeTabId)
    if (!activeTab) return
    const tabUsesEmptyPath = isBlankEditorTab(activeTab) || isRecordEditorTab(activeTab) || isCanvasEditorTab(activeTab) || isPluginEditorTab(activeTab) || isBrowserEditorTab(activeTab)
    if (activeFilePath ? activeTab.path !== activeFilePath : !tabUsesEmptyPath) return
    setLayout(current => {
      const activeGroup = current.groups[current.activeGroupId]
      const targetGroup = activeGroup?.tabIds.includes(activeTabId)
        ? activeGroup
        : Object.values(current.groups).find(group => group.tabIds.includes(activeTabId))
      if (!targetGroup) return current
      return recordEditorNavigation(
        setActiveEditorGroupTab(current, targetGroup.id, activeTabId),
        activeTab,
      )
    })
  }, [activeFilePath, activeTabId, fileTreeWorkspaceKey, isBlankEditorTab, isCanvasEditorTab, isRecordEditorTab, isPluginEditorTab, isBrowserEditorTab, layout.activeGroupId, layout.workspaceKey, layoutReady, openTabs, setLayout])

  const handleActivateGroup = useCallback((groupId: string, tabId?: string) => {
    const tab = openTabs.find(item => item.id === tabId)
    const tabActiveFilePath = tab && (
      isBlankEditorTab(tab) || isRecordEditorTab(tab) || isCanvasEditorTab(tab) || isPluginEditorTab(tab) || isBrowserEditorTab(tab)
    )
      ? ''
      : tab?.path ?? ''
    if (
      layoutRef.current.activeGroupId === groupId
      && (!tabId || (activeTabId === tabId && activeFilePath === tabActiveFilePath))
    ) {
      if (
        tab
        && layoutRef.current.workspaceKey === fileTreeWorkspaceKey
        && layoutRef.current.navigationHistory[layoutRef.current.navigationIndex]?.path !== tab.path
      ) {
        setLayout(current => recordEditorNavigation(current, tab))
      }
      return
    }
    void activateTab(groupId, tab)
  }, [activateTab, activeFilePath, activeTabId, fileTreeWorkspaceKey, isBlankEditorTab, isCanvasEditorTab, isRecordEditorTab, isPluginEditorTab, isBrowserEditorTab, openTabs, setLayout])

  const removeGlobalTabIfUnused = useCallback((nextLayout: EditorWorkspaceLayout, tabId: string) => {
    if (!tabIsReferenced(nextLayout, tabId)) {
      const tab = useArticleStore.getState().openTabs.find(item => item.id === tabId)
      if (tab) {
        emitter.emit('editor-file-close', { path: tab.path })
        delete tabContentsRef.current[tab.path]
      }
      void removeTab(tabId, { deactivationAlreadyPrepared: true })
    }
  }, [removeTab])

  const handleCloseTab = useCallback((
    groupId: string,
    tabId: string,
    confirmed: readonly RecordTabCloseGuard[] = [],
  ): void => {
    const group = layoutRef.current.groups[groupId]
    if (!group?.tabIds.includes(tabId)) return
    const { openTabs: currentTabs, activeTabId: currentActiveTabId } = useArticleStore.getState()
    const tab = currentTabs.find(item => item.id === tabId)
    if (
      group.tabIds.length === 1
      && tab?.kind === 'blank'
      && tab.autoCreated
      && getEditorGroupIds(layoutRef.current.root).length === 1
    ) return
    if (!canCloseRecordTabs(groupId, [tabId], confirmed, guards => handleCloseTab(groupId, tabId, guards))) return
    const wasActiveGroup = layoutRef.current.activeGroupId === groupId
    if (group.activeTabId === tabId && layoutRef.current.activeGroupId === groupId && !canDeactivateActiveEditor()) return
    let next = removeTabFromEditorGroup(layoutRef.current, groupId, tabId)
    if (next.groups[groupId]?.tabIds.length === 0 && getEditorGroupIds(next.root).length > 1) {
      next = closeEditorGroup(next, groupId)
    }
    setLayout(next)
    removeGlobalTabIfUnused(next, tabId)
    const nextGroup = next.groups[next.activeGroupId]
    const nextTab = currentTabs.find(tab => tab.id === nextGroup?.activeTabId)
    if (wasActiveGroup || currentActiveTabId === tabId) {
      void activateTab(next.activeGroupId, nextTab)
    }
  }, [activateTab, canCloseRecordTabs, canDeactivateActiveEditor, removeGlobalTabIfUnused, setLayout])

  const handleCloseTabRef = useRef(handleCloseTab)
  handleCloseTabRef.current = handleCloseTab

  useEffect(() => {
    if (!checkIsTauri()) return

    let disposed = false
    const unlistenPromise = listenTauriEvent('editor-close-tab-requested', () => {
      if (disposed) return
      const currentLayout = layoutRef.current
      const group = currentLayout.groups[currentLayout.activeGroupId]
      const tab = useArticleStore.getState().openTabs.find(item => item.id === group?.activeTabId)
      const onlyPlaceholder = group?.tabIds.length === 1
        && tab?.kind === 'blank'
        && tab.autoCreated
        && getEditorGroupIds(currentLayout.root).length === 1
      if (!group || !tab || onlyPlaceholder) {
        void getCurrentWindow().hide()
        return
      }
      handleCloseTabRef.current(group.id, group.activeTabId)
    })
    void unlistenPromise.catch(error => console.error('Failed to listen for editor close requests:', error))

    return () => {
      disposed = true
      void unlistenPromise.then(unlisten => unlisten()).catch(() => undefined)
    }
  }, [])

  const handleKeepTabs = useCallback((
    groupId: string,
    keptTabIds: string[],
    confirmed: readonly RecordTabCloseGuard[] = [],
  ): void => {
    const group = layoutRef.current.groups[groupId]
    if (!group) return
    const { openTabs: currentTabs } = useArticleStore.getState()
    const protectedTabIds = group.tabIds.filter(tabId => (
      currentTabs.find(tab => tab.id === tabId)?.pinned
    ))
    const effectiveKeptTabIds = new Set([...keptTabIds, ...protectedTabIds])
    const removedIds = group.tabIds.filter(id => !effectiveKeptTabIds.has(id))
    if (!canCloseRecordTabs(groupId, removedIds, confirmed, guards => handleKeepTabs(groupId, keptTabIds, guards))) return
    if (removedIds.includes(group.activeTabId) && layoutRef.current.activeGroupId === groupId && !canDeactivateActiveEditor()) return
    let next = layoutRef.current
    for (const tabId of removedIds) next = removeTabFromEditorGroup(next, groupId, tabId)
    if (!effectiveKeptTabIds.size && getEditorGroupIds(next.root).length > 1) next = closeEditorGroup(next, groupId)
    setLayout(next)
    removedIds.forEach(tabId => removeGlobalTabIfUnused(next, tabId))
    const nextGroup = next.groups[next.activeGroupId]
    void activateTab(next.activeGroupId, currentTabs.find(tab => tab.id === nextGroup?.activeTabId))
  }, [activateTab, canCloseRecordTabs, canDeactivateActiveEditor, removeGlobalTabIfUnused, setLayout])

  const handlePinTab = useCallback((tabId: string) => {
    void setTabDisposition(tabId, 'pinned')
  }, [setTabDisposition])

  const handleUnpinTab = useCallback((tabId: string) => {
    void setTabDisposition(tabId, 'regular')
  }, [setTabDisposition])

  const handleCloseGroup = useCallback((groupId: string, confirmed: readonly RecordTabCloseGuard[] = []): void => {
    const group = layoutRef.current.groups[groupId]
    if (!group) return
    const { openTabs: currentTabs } = useArticleStore.getState()
    const pinnedTabIds = group.tabIds.filter(tabId => (
      currentTabs.find(tab => tab.id === tabId)?.pinned
    ))
    if (pinnedTabIds.length) {
      handleKeepTabs(groupId, pinnedTabIds, confirmed)
      return
    }
    if (!canCloseRecordTabs(groupId, group.tabIds, confirmed, guards => handleCloseGroup(groupId, guards))) return
    if (!canDeactivateActiveEditor()) return
    const next = closeEditorGroup(layoutRef.current, groupId)
    setLayout(next)
    group.tabIds.forEach(tabId => removeGlobalTabIfUnused(next, tabId))
    const activeGroup = next.groups[next.activeGroupId]
    void activateTab(next.activeGroupId, currentTabs.find(tab => tab.id === activeGroup?.activeTabId))
  }, [activateTab, canCloseRecordTabs, canDeactivateActiveEditor, handleKeepTabs, removeGlobalTabIfUnused, setLayout])

  const handleSplitTab = useCallback((groupId: string, tabId: string, direction: EditorSplitDirection) => {
    const group = layoutRef.current.groups[groupId]
    if (!group || group.tabIds.length < 2 || !group.tabIds.includes(tabId)) return
    if (!canDeactivateActiveEditor()) return
    if (openTabs.find(tab => tab.id === tabId)?.preview) {
      void setTabDisposition(tabId, 'regular')
    }
    const next = splitEditorGroup(layoutRef.current, groupId, direction, tabId, {
      moveFromGroupId: groupId,
    })
    setLayout(next)
    void activateTab(next.activeGroupId, openTabs.find(tab => tab.id === tabId))
  }, [activateTab, canDeactivateActiveEditor, openTabs, setLayout, setTabDisposition])

  const handleMoveToNewWindow = useCallback(async (
    groupId: string,
    tabId: string,
    confirmed: readonly RecordTabCloseGuard[] = [],
  ): Promise<void> => {
    const tab = openTabs.find(item => item.id === tabId)
    if (!tab || !canOpenInEditorWindow(tab)) return
    if (!canCloseRecordTabs(groupId, [tabId], confirmed, guards => void handleMoveToNewWindow(groupId, tabId, guards))) return
    setDetachingTabId(tabId)
    try {
      const currentActivePath = useArticleStore.getState().activeFilePath
      if (currentActivePath && !await prepareActiveEditorDeactivationDurably(currentActivePath)) return
      const detachedTab = tab.preview
        ? { ...tab, preview: false, pinned: false }
        : tab
      if (tab.preview) await setTabDisposition(tab.id, 'regular')
      await useArticleStore.getState().flushPendingArticleSavesForPaths([tab.path])
      const opened = await openEditorWindow(detachedTab)
      if (!opened) {
        toast.error(tGroups('openWindowFailed'))
        return
      }

      let next = layoutRef.current
      for (const currentGroupId of getEditorGroupIds(next.root)) {
        next = removeTabFromEditorGroup(next, currentGroupId, tabId)
      }
      for (const currentGroupId of [...getEditorGroupIds(next.root)]) {
        if (getEditorGroupIds(next.root).length <= 1) break
        if (!next.groups[currentGroupId]?.tabIds.length) {
          next = closeEditorGroup(next, currentGroupId)
        }
      }
      setLayout(next)
      emitter.emit('editor-file-close', { path: tab.path })
      delete tabContentsRef.current[tab.path]
      await setOpenTabs(useArticleStore.getState().openTabs.filter(item => item.id !== tabId))
      const nextGroup = next.groups[next.activeGroupId]
      await activateTab(next.activeGroupId, openTabs.find(item => item.id === nextGroup?.activeTabId))
    } catch (error) {
      console.error('Failed to move editor tab into a standalone window:', error)
      toast.error(tGroups('openWindowFailed'))
    } finally {
      setDetachingTabId('')
    }
  }, [activateTab, canCloseRecordTabs, openTabs, setLayout, setOpenTabs, setTabDisposition, tGroups])

  const handleToggleMaximize = useCallback((groupId: string) => {
    suppressPanelLayoutUntilRef.current = Date.now() + 200
    setLayout(current => ({
      ...current,
      maximizedGroupId: current.maximizedGroupId === groupId ? undefined : groupId,
      activeGroupId: groupId,
    }))
  }, [setLayout])

  const handleNewTab = useCallback((groupId: string, autoCreated = false) => {
    if (!canDeactivateActiveEditor()) return
    const id = `blank-${crypto.randomUUID()}`
    const tab: TabInfo = {
      id,
      path: `blank://${id}`,
      name: tGroups('newTab'),
      isFolder: false,
      kind: 'blank',
      autoCreated,
    }
    void addTab(tab)
    if (!useArticleStore.getState().openTabs.some(item => item.id === id)) return
    setLayout(current => {
      const group = current.groups[groupId]
      if (!group || group.tabIds.includes(id)) return current
      return {
        ...current,
        activeGroupId: groupId,
        groups: {
          ...current.groups,
          [groupId]: {
            ...group,
            tabIds: [...group.tabIds, id],
            activeTabId: id,
          },
        },
      }
    })
    void activateTab(groupId, tab)
    return id
  }, [activateTab, addTab, canDeactivateActiveEditor, setLayout, tGroups])

  const handleNewBrowser = useCallback((groupId: string, initialUrl?: string) => {
    if (!canDeactivateActiveEditor()) return
    const id = `browser-${crypto.randomUUID()}`
    const tab: TabInfo = {
      id,
      path: `browser://${id}`,
      name: tGroups('newBrowser'),
      isFolder: false,
      kind: 'browser',
      ...(initialUrl ? { url: initialUrl, name: new URL(initialUrl).hostname } : {}),
    }
    void addTab(tab)
    if (!useArticleStore.getState().openTabs.some(item => item.id === id)) return
    setLayout(current => {
      const group = current.groups[groupId]
      if (!group || group.tabIds.includes(id)) return current
      return {
        ...current,
        activeGroupId: groupId,
        groups: {
          ...current.groups,
          [groupId]: { ...group, tabIds: [...group.tabIds, id], activeTabId: id },
        },
      }
    })
    void activateTab(groupId, tab)
  }, [activateTab, addTab, canDeactivateActiveEditor, setLayout, tGroups])

  const handleNewBrowserRef = useRef(handleNewBrowser)
  handleNewBrowserRef.current = handleNewBrowser

  useEffect(() => {
    if (!layoutReady || !checkIsTauri()) return
    let disposed = false
    let unlisten: (() => void) | undefined
    void listenTauriEvent<BrowserNewWindow>('browser:new-window', event => {
      if (disposed) return
      const { sourceTabId, url } = event.payload
      try {
        const target = new URL(url)
        if (!['http:', 'https:'].includes(target.protocol) || !target.hostname) return
      } catch {
        return
      }
      if (!useArticleStore.getState().openTabs.some(tab => tab.id === sourceTabId && tab.kind === 'browser')) return
      const current = layoutRef.current
      const group = current.groups[current.activeGroupId]?.tabIds.includes(sourceTabId)
        ? current.groups[current.activeGroupId]
        : Object.values(current.groups).find(item => item.tabIds.includes(sourceTabId))
      if (group) handleNewBrowserRef.current(group.id, url)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(error => console.error('Failed to listen for browser new-window requests:', error))
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [layoutReady])

  useEffect(() => {
    if (!layoutReady || openTabs.length > 0) return
    handleNewTab(layoutRef.current.activeGroupId, true)
  }, [handleNewTab, layoutReady, openTabs.length])

  useEffect(() => {
    if (!layoutReady || !openTabs.some(tab => tab.kind !== 'blank')) return
    const nextTabs = openTabs.filter(tab => tab.kind !== 'blank' || !tab.autoCreated)
    if (nextTabs.length === openTabs.length) return
    void setOpenTabs(nextTabs)
  }, [layoutReady, openTabs, setOpenTabs])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setDragging(false)
    const source = event.active.data.current as { type?: string; groupId?: string; tabId?: string } | undefined
    const target = event.over?.data.current as { type?: string; groupId?: string; tabId?: string; direction?: EditorSplitDirection | 'center' } | undefined
    if (!source?.groupId || !source.tabId) return
    if (!target?.groupId) {
      const rect = event.active.rect.current.translated
      const droppedOutsideWindow = rect
        ? (rect.left + rect.right) / 2 < 0
          || (rect.left + rect.right) / 2 > window.innerWidth
          || (rect.top + rect.bottom) / 2 < 0
          || (rect.top + rect.bottom) / 2 > window.innerHeight
        : false
      const sourceTab = openTabs.find(tab => tab.id === source.tabId)
      if (droppedOutsideWindow && sourceTab && canOpenInEditorWindow(sourceTab)) {
        void handleMoveToNewWindow(source.groupId, source.tabId)
      }
      return
    }
    if (!canDeactivateActiveEditor()) return

    const movesBetweenGroups = target.groupId !== source.groupId
    const createsSplit = target.type === 'editor-drop-zone'
      && target.direction !== undefined
      && target.direction !== 'center'
    if (
      (movesBetweenGroups || createsSplit)
      && openTabs.find(tab => tab.id === source.tabId)?.preview
    ) {
      void setTabDisposition(source.tabId, 'regular')
    }

    let next = layoutRef.current
    if (target.type === 'editor-tab' && target.tabId) {
      const targetGroup = next.groups[target.groupId]
      const targetIndex = targetGroup?.tabIds.indexOf(target.tabId) ?? -1
      next = moveEditorTab(next, source.tabId, source.groupId, target.groupId, targetIndex < 0 ? undefined : targetIndex)
    } else if (target.type === 'editor-tab-list') {
      next = moveEditorTab(next, source.tabId, source.groupId, target.groupId)
    } else if (target.type === 'editor-drop-zone') {
      if (target.direction === 'center') {
        next = moveEditorTab(next, source.tabId, source.groupId, target.groupId)
      } else if (target.direction) {
        next = splitEditorGroup(next, target.groupId, target.direction, source.tabId, {
          moveFromGroupId: source.groupId,
        })
      }
    } else {
      return
    }

    const keepEmptySource = target.type === 'editor-drop-zone'
      && target.direction !== 'center'
      && source.groupId === target.groupId
    const sourceGroup = next.groups[source.groupId]
    if (!keepEmptySource && sourceGroup && !sourceGroup.tabIds.length && getEditorGroupIds(next.root).length > 1) {
      next = closeEditorGroup(next, source.groupId)
    }
    setLayout(next)
    void activateTab(next.activeGroupId, openTabs.find(tab => tab.id === source.tabId))
  }, [activateTab, canDeactivateActiveEditor, handleMoveToNewWindow, openTabs, setLayout, setTabDisposition])

  const handleNavigateHistory = useCallback(async (direction: 'back' | 'forward') => {
    const currentOperationId = navigationOperationRef.current
    const initialLayout = layoutRef.current
    const groupId = initialLayout.activeGroupId
    const initialGroup = initialLayout.groups[groupId]
    if (!initialGroup) return
    const initialArticleState = useArticleStore.getState()
    const initialActiveTabId = initialArticleState.activeTabId
    const initialActiveFilePath = initialArticleState.activeFilePath
    const initialActiveTab = initialArticleState.openTabs.find(tab => (
      tab.id === initialActiveTabId
    ))
    const initialNavigationEntry = initialLayout.navigationHistory[initialLayout.navigationIndex]
    const pendingNavigation = pendingEditorNavigationRef.current
    const navigationIsAligned = Boolean(
      initialActiveFilePath
      && initialGroup.activeTabId === initialActiveTabId
      && initialActiveTab?.path === initialActiveFilePath
      && initialNavigationEntry?.path === initialActiveFilePath
    )
    const continuesPendingNavigation = Boolean(
      pendingNavigation
      && pendingNavigation.operationId === currentOperationId
      && pendingNavigation.workspaceKey === initialLayout.workspaceKey
      && pendingNavigation.groupId === groupId
      && pendingNavigation.activeTabId === initialActiveTabId
      && pendingNavigation.activeFilePath === initialActiveFilePath
      && initialGroup.activeTabId === initialActiveTabId
    )
    if (!navigationIsAligned && !continuesPendingNavigation) return

    const target = direction === 'back'
      ? getEditorBackNavigationTarget(initialLayout)
      : getEditorForwardNavigationTarget(initialLayout)
    if (!target) return
    const latestGroup = layoutRef.current.groups[groupId]
    if (
      navigationOperationRef.current !== currentOperationId
      || layoutRef.current.workspaceKey !== initialLayout.workspaceKey
      || layoutRef.current.activeGroupId !== groupId
      || latestGroup?.activeTabId !== initialGroup.activeTabId
      || !canDeactivateActiveEditor()
    ) return

    const operationId = ++navigationOperationRef.current
    pendingEditorNavigationRef.current = {
      operationId,
      workspaceKey: initialLayout.workspaceKey,
      groupId,
      activeTabId: initialActiveTabId,
      activeFilePath: initialActiveFilePath,
    }
    let retainPendingNavigation = false
    const navigationIsCurrent = () => {
      const articleState = useArticleStore.getState()
      return navigationOperationRef.current === operationId
        && articleState.activeTabId === initialActiveTabId
        && articleState.activeFilePath === initialActiveFilePath
    }

    try {
      if (
        !navigationIsCurrent()
        || layoutRef.current.workspaceKey !== initialLayout.workspaceKey
        || layoutRef.current.activeGroupId !== groupId
        || layoutRef.current.groups[groupId]?.activeTabId !== initialGroup.activeTabId
      ) return

      setLayout(current => setEditorNavigationIndex(current, target.index))

    const navigationContextIsCurrent = () => {
      const currentLayout = layoutRef.current
      const currentGroup = currentLayout.groups[groupId]
      return navigationIsCurrent()
        && currentLayout.workspaceKey === initialLayout.workspaceKey
        && currentLayout.activeGroupId === groupId
        && currentGroup?.activeTabId === initialGroup.activeTabId
    }
    const navigationTargetIsCurrent = (expectedPath: string) => {
      const currentLayout = layoutRef.current
      return navigationContextIsCurrent()
        && currentLayout.navigationHistory[currentLayout.navigationIndex]?.path === expectedPath
    }
    const restoreNavigationCursor = () => {
      if (navigationOperationRef.current !== operationId) return
      setLayout(current => {
        const currentGroup = current.groups[groupId]
        if (
          !navigationIsCurrent()
          || current.workspaceKey !== initialLayout.workspaceKey
          || current.activeGroupId !== groupId
          || currentGroup?.activeTabId !== initialGroup.activeTabId
        ) return current
        if (
          initialLayout.navigationIndex >= 0
          && current.navigationHistory[initialLayout.navigationIndex]?.path === initialActiveFilePath
        ) {
          return setEditorNavigationIndex(current, initialLayout.navigationIndex)
        }
        const matchingIndexes = current.navigationHistory
          .map((entry, index) => entry.path === initialActiveFilePath ? index : -1)
          .filter(index => index >= 0)
        if (!matchingIndexes.length) return current
        const nearestIndex = matchingIndexes.reduce((nearest, index) => {
          const distance = Math.abs(index - current.navigationIndex)
          const nearestDistance = Math.abs(nearest - current.navigationIndex)
          if (distance < nearestDistance) return index
          if (distance > nearestDistance) return nearest
          return direction === 'back'
            ? Math.max(nearest, index)
            : Math.min(nearest, index)
        })
        return setEditorNavigationIndex(current, nearestIndex)
      })
    }
    const persistedWorkspaceIsCurrent = async () => {
      try {
        return getEditorWorkspaceKey(await getWorkspacePath()) === initialLayout.workspaceKey
      } catch {
        return false
      }
    }

    let navigationWorkspaceRoot = ''
    try {
      const navigationWorkspace = await getWorkspacePath()
      if (!navigationContextIsCurrent()) return
      if (getEditorWorkspaceKey(navigationWorkspace) !== initialLayout.workspaceKey) {
        restoreNavigationCursor()
        return
      }
      navigationWorkspaceRoot = navigationWorkspace.isCustom
        ? navigationWorkspace.path
        : await getDefaultArticleAbsolutePath('')
    } catch {
      restoreNavigationCursor()
      return
    }
    if (!navigationContextIsCurrent()) return

    while (navigationContextIsCurrent()) {
      const resolvedEntry = layoutRef.current.navigationHistory[layoutRef.current.navigationIndex]
      if (!resolvedEntry) return
      if (resolvedEntry.path === initialActiveFilePath) {
        const nextTarget = direction === 'back'
          ? getEditorBackNavigationTarget(layoutRef.current)
          : getEditorForwardNavigationTarget(layoutRef.current)
        if (!nextTarget) return
        setLayout(current => setEditorNavigationIndex(current, nextTarget.index))
        continue
      }
      const checkedTargetPath = resolvedEntry.path
      let focusTargetPath = ''
      try {
        focusTargetPath = isAbsoluteFsPath(checkedTargetPath)
          ? checkedTargetPath
          : await (await import('@tauri-apps/api/path')).join(
              navigationWorkspaceRoot,
              checkedTargetPath,
            )
      } catch {
        restoreNavigationCursor()
        return
      }
      if (!navigationTargetIsCurrent(checkedTargetPath)) continue
      const ownedByStandaloneWindow = await focusEditorWindowForPath(focusTargetPath, {
        shouldFocus: () => navigationTargetIsCurrent(checkedTargetPath),
      }).catch(error => {
        console.error('Failed to resolve standalone editor ownership:', error)
        return false
      })
      if (!navigationContextIsCurrent()) return
      if (!navigationTargetIsCurrent(checkedTargetPath)) continue
      if (!await persistedWorkspaceIsCurrent()) {
        restoreNavigationCursor()
        return
      }
      if (ownedByStandaloneWindow) {
        // The history cursor now represents the focused standalone editor,
        // while the main window still owns its previous active tab. Preserve
        // the context so another back/forward action can cross that boundary.
        retainPendingNavigation = true
        return
      }

      const currentArticleState = useArticleStore.getState()
      const treeItem = findPathInTree(checkedTargetPath, currentArticleState.fileTree)
      if (treeItem?.isLocale !== false) {
        const existsOnDisk = await checkPathExists(
          checkedTargetPath,
          navigationWorkspaceRoot,
        )
        if (!navigationContextIsCurrent()) return
        if (!navigationTargetIsCurrent(checkedTargetPath)) continue

        let definitelyMissing = isAbsoluteFsPath(checkedTargetPath) && existsOnDisk === false
        if (existsOnDisk === false && !isAbsoluteFsPath(checkedTargetPath)) {
          try {
            const { isSyncConfigured } = await import('@/lib/sync/sync-manager')
            definitelyMissing = !await isSyncConfigured({ throwOnError: true })
          } catch {
            // Preserve the target when remote availability cannot be determined safely.
            definitelyMissing = false
          }
        }
        if (!navigationContextIsCurrent()) return
        if (!navigationTargetIsCurrent(checkedTargetPath)) continue

        if (definitelyMissing) {
          const stillMissing = await checkPathExists(
            checkedTargetPath,
            navigationWorkspaceRoot,
          )
          if (!navigationContextIsCurrent()) return
          if (!navigationTargetIsCurrent(checkedTargetPath)) continue
          if (stillMissing !== false) continue
          const workspaceStillCurrent = await persistedWorkspaceIsCurrent()
          if (!navigationContextIsCurrent()) return
          if (!navigationTargetIsCurrent(checkedTargetPath)) continue
          if (!workspaceStillCurrent) {
            restoreNavigationCursor()
            return
          }
          let removed = false
          setLayout(current => {
            const currentGroup = current.groups[groupId]
            if (
              navigationOperationRef.current !== operationId
              || !navigationIsCurrent()
              || current.workspaceKey !== initialLayout.workspaceKey
              || current.activeGroupId !== groupId
              || currentGroup?.activeTabId !== initialGroup.activeTabId
              || current.navigationHistory[current.navigationIndex]?.path !== checkedTargetPath
            ) {
              return current
            }
            removed = true
            return removeEditorNavigationEntry(
              current,
              current.navigationIndex,
              direction === 'back' ? 'next' : 'previous',
            )
          })
          if (!removed) continue
          const nextTarget = direction === 'back'
            ? getEditorBackNavigationTarget(layoutRef.current)
            : getEditorForwardNavigationTarget(layoutRef.current)
          if (nextTarget) {
            setLayout(current => setEditorNavigationIndex(current, nextTarget.index))
            continue
          }
          // A rapid sequence can cancel an earlier activation after its cursor
          // already moved. If no further entry exists, activate the nearest
          // valid reserved position instead of leaving cursor and editor apart.
          const fallbackEntry = layoutRef.current.navigationHistory[layoutRef.current.navigationIndex]
          if (fallbackEntry && fallbackEntry.path !== initialActiveFilePath) continue
          return
        }
      }

      if (!await persistedWorkspaceIsCurrent()) {
        restoreNavigationCursor()
        return
      }
      if (!navigationTargetIsCurrent(checkedTargetPath)) continue
      if (!canDeactivateActiveEditor()) {
        restoreNavigationCursor()
        return
      }
      const existing = useArticleStore.getState().openTabs.find(tab => (
        tab.path === checkedTargetPath
      ))
      if (existing) {
        const sourceGroup = layoutRef.current.groups[groupId]
        const targetGroup = sourceGroup?.tabIds.includes(existing.id)
          ? sourceGroup
          : Object.values(layoutRef.current.groups).find(group => group.tabIds.includes(existing.id))
        if (targetGroup) {
          await activateTab(targetGroup.id, existing, { deactivationAlreadyPrepared: true })
          return
        }
        restoreNavigationCursor()
        return
      }

      await setActiveFilePath(checkedTargetPath, true, {
        deactivationAlreadyPrepared: true,
        createIfMissing: false,
        tabOpenMode: 'preview',
        tabMetadata: {
          name: resolvedEntry.name,
          isFolder: resolvedEntry.isFolder,
        },
      })
      return
    }
    } finally {
      if (
        !retainPendingNavigation
        && pendingEditorNavigationRef.current?.operationId === operationId
      ) {
        pendingEditorNavigationRef.current = null
      }
    }
  }, [activateTab, canDeactivateActiveEditor, checkPathExists, setActiveFilePath, setLayout])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (useInitialSetupStore.getState().visible) return
      if (event.defaultPrevented || event.isComposing) return
      let currentPlatform = ''
      try { currentPlatform = platform() } catch { currentPlatform = '' }
      const isMac = currentPlatform === 'macos'
      const navigationDirection = isMac
        ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
          ? event.code === 'BracketLeft'
            ? 'back'
            : event.code === 'BracketRight'
              ? 'forward'
              : null
          : null
        : event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey
          ? event.key === 'ArrowLeft'
            ? 'back'
            : event.key === 'ArrowRight'
              ? 'forward'
              : null
          : null
      if (navigationDirection) {
        event.preventDefault()
        const target = navigationDirection === 'back'
          ? getEditorBackNavigationTarget(layoutRef.current)
          : getEditorForwardNavigationTarget(layoutRef.current)
        if (!target) return
        void handleNavigateHistory(navigationDirection)
        return
      }
      if (event.ctrlKey && event.key === 'Tab') {
        const group = layoutRef.current.groups[layoutRef.current.activeGroupId]
        if (!group || group.tabIds.length < 2) return
        const currentIndex = group.tabIds.indexOf(group.activeTabId)
        const offset = event.shiftKey ? -1 : 1
        const nextIndex = (currentIndex + offset + group.tabIds.length) % group.tabIds.length
        event.preventDefault()
        handleActivateGroup(group.id, group.tabIds[nextIndex])
        return
      }
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.key === '\\') {
        const group = layoutRef.current.groups[layoutRef.current.activeGroupId]
        if (!group?.activeTabId) return
        event.preventDefault()
        handleSplitTab(group.id, group.activeTabId, 'right')
        return
      }
      const groupIndex = Number(event.key) - 1
      if (groupIndex < 0 || groupIndex > 8) return
      const groupId = getEditorGroupIds(layoutRef.current.root)[groupIndex]
      const group = layoutRef.current.groups[groupId]
      if (!group) return
      event.preventDefault()
      handleActivateGroup(group.id, group.activeTabId)
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [handleActivateGroup, handleNavigateHistory, handleSplitTab])

  const renderContentPanel = useCallback((tab: TabInfo, active: boolean, groupId: string) => {
    if (isBrowserEditorTab(tab)) {
      const visible = layout.groups[groupId]?.activeTabId === tab.id
        && (!layout.maximizedGroupId || layout.maximizedGroupId === groupId)
        && !dragging
      return <BrowserPanel tabId={tab.id} url={tab.url} visible={visible} />
    }
    if (isPluginEditorTab(tab)) {
      const view = parsePluginEditorTabPath(tab.path)
      return <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">{view ? <PluginViewSurface key={`${tab.id}:${pluginTabRevisions[tab.id] ?? 0}`} viewKey={`${view.pluginId}:${view.viewId}`} active={active} fill /> : <UnsupportedFile filePath={tab.path} />}</div>
    }
    if (isRecordEditorTab(tab)) {
      const markId = getRecordIdForTab(tab)
      return (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {markId !== null ? (
            <MarkDetailPanel markId={markId} groupId={groupId} tabId={tab.id} onClose={() => handleCloseTab(groupId, tab.id)} isActive={active} />
          ) : <UnsupportedFile filePath={tab.path} />}
        </div>
      )
    }
    if (isCanvasEditorTab(tab)) {
      const canvasId = tab.canvasId || getCanvasIdFromTabPath(tab.path)
      return <div className="flex min-h-0 flex-1 overflow-hidden">{canvasId ? <CanvasEditor canvasId={canvasId} isActive={active} /> : <UnsupportedFile filePath={tab.path} />}</div>
    }
    const itemType = tab.isFolder ? 'folder' : getItemType(tab.path)
    return (
      <TabContentErrorBoundary key={`${workspacePath || '__default__'}:${tab.id}:${tab.path}`} tabName={tab.name} onClose={() => handleCloseTab(groupId, tab.id)}>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PluginEmbeddedViews location="document-top" active={active && layout.activeGroupId === groupId && itemType !== 'folder'} contextKey={`${groupId}:${tab.id}:${tab.path}`} />
          <PluginEmbeddedViews location="editor-toolbar" active={active && layout.activeGroupId === groupId && itemType === 'markdown'} contextKey={`${groupId}:${tab.id}:${tab.path}`} compact />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            {itemType === 'folder' && <FolderView folderPath={tab.path} />}
            {itemType === 'image' && <ImageEditor filePath={tab.path} isActive={active} />}
            {itemType === 'markdown' && <MdEditor tabContentsRef={tabContentsRef} filePath={tab.path} isActive={active} disabled={detachingTabId === tab.id} />}
            {itemType === 'unknown' && <PluginDocumentPreview path={tab.path} isActive={active} />}
          </div>
          <PluginEmbeddedViews location="document-bottom" active={active && layout.activeGroupId === groupId && itemType !== 'folder'} contextKey={`${groupId}:${tab.id}:${tab.path}`} />
        </div>
      </TabContentErrorBoundary>
    )
  }, [layout.activeGroupId, layout.groups, layout.maximizedGroupId, dragging, detachingTabId, getItemType, getRecordIdForTab, handleCloseTab, isCanvasEditorTab, isRecordEditorTab, isPluginEditorTab, isBrowserEditorTab, pluginTabRevisions, workspacePath])

  const revealOnboardingChecklist = useCallback(async () => {
    await revealEditorPanel()
    const { activeGroupId, groups } = layoutRef.current
    const groupTabs = groups[activeGroupId]?.tabIds ?? []
    const existing = useArticleStore.getState().openTabs.find(tab =>
      isBlankEditorTab(tab) && !tab.autoCreated && groupTabs.includes(tab.id),
    )
    if (existing) {
      if (!await activateTab(activeGroupId, existing)) return false
      setOnboardingReveal({ tabId: existing.id })
      return true
    }
    const tabId = handleNewTab(activeGroupId)
    if (!tabId) return false
    setOnboardingReveal({ tabId })
    return true
  }, [activateTab, handleNewTab, isBlankEditorTab, revealEditorPanel])

  const onboarding = useDesktopOnboarding({
    ready: layoutReady,
    revealChecklist: revealOnboardingChecklist,
    revealRecordPanel,
    revealAgentPanel,
  })

  useEffect(() => {
    if (!onboardingReveal) return
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>('.editor-group-active [data-onboarding-checklist]')
      const focused = document.activeElement
      if (focused === document.body || focused?.closest('[aria-hidden="true"]')) {
        heading?.scrollIntoView({ block: 'nearest' })
        heading?.focus({ preventScroll: true })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [onboardingReveal])

  const renderEmpty = useCallback((mode: 'new-tab' | 'empty-group', enableShortcuts = true) => {
    const isOnlyGroup = getEditorGroupIds(layout.root).length === 1
    if (mode === 'empty-group' && !isOnlyGroup) {
      return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">{tGroups('emptyGroup')}</div>
    }
    return (
      <EmptyState
        enableShortcuts={enableShortcuts}
        contextKey={`${layout.activeGroupId}:${layout.groups[layout.activeGroupId]?.activeTabId ?? 'empty'}`}
        onboardingProgress={onboarding.progress}
        onboardingActionLabel={onboarding.actionLabel}
        onboardingNotice={onboarding.notice}
        onboardingBusy={onboarding.busy}
        revealOnboarding={enableShortcuts && onboardingReveal !== null
          && layout.groups[layout.activeGroupId]?.activeTabId === onboardingReveal.tabId}
        onDismissOnboardingReveal={dismissOnboardingReveal}
        onStartOnboardingStep={onboarding.startCurrentStep}
        onResetOnboarding={onboarding.reset}
      />
    )
  }, [
    dismissOnboardingReveal, layout.root, layout.activeGroupId, layout.groups, onboarding.actionLabel, onboarding.busy,
    onboarding.notice, onboarding.progress, onboarding.reset, onboarding.startCurrentStep,
    onboardingReveal, tGroups,
  ])

  const renderLayoutNode = useCallback((node: EditorLayoutNode): React.ReactNode => {
    if (node.type === 'group') {
      const group = layout.groups[node.groupId]
      if (!group) return null
      return (
        <EditorGroupPane
          key={node.id}
          group={group}
          tabs={openTabs}
          activeLayout={layout}
          dragging={dragging}
          onActivateGroup={handleActivateGroup}
          onNewTab={handleNewTab}
          onNewBrowser={handleNewBrowser}
          onCloseTab={handleCloseTab}
          onKeepTabs={handleKeepTabs}
          onSplitTab={handleSplitTab}
          onMoveToNewWindow={handleMoveToNewWindow}
          onPinTab={handlePinTab}
          onUnpinTab={handleUnpinTab}
          onRestartPluginTab={handleRestartPluginTab}
          onToggleMaximize={handleToggleMaximize}
          onCloseGroup={handleCloseGroup}
          renderActiveContent={renderContentPanel}
          renderEmpty={renderEmpty}
        />
      )
    }
    return (
      <ResizablePanelGroup
        key={node.id}
        orientation={node.orientation}
        onLayoutChanged={(nextLayout: Layout) => {
          if (layout.maximizedGroupId || Date.now() < suppressPanelLayoutUntilRef.current) return
          const sizes = node.children.map(child => nextLayout[child.id] ?? 0)
          setLayout(current => updateEditorSplitSizes(current, node.id, sizes))
        }}
      >
        {node.children.map((child, index) => {
          const visible = !layout.maximizedGroupId
            || getEditorGroupIds(child).includes(layout.maximizedGroupId)
          return (
            <Fragment key={child.id}>
              {index > 0 && <ResizableHandle className={layout.maximizedGroupId ? 'hidden' : undefined} />}
              <ResizablePanel
                id={child.id}
                defaultSize={`${node.sizes[index] ?? 100 / node.children.length}%`}
                style={visible
                  ? layout.maximizedGroupId ? { flex: '1 1 100%' } : undefined
                  : { display: 'none' }}
              >
                {renderLayoutNode(child)}
              </ResizablePanel>
            </Fragment>
          )
        })}
      </ResizablePanelGroup>
    )
  }, [dragging, handleActivateGroup, handleCloseGroup, handleCloseTab, handleKeepTabs, handleMoveToNewWindow, handleNewTab, handleNewBrowser, handlePinTab, handleRestartPluginTab, handleSplitTab, handleToggleMaximize, handleUnpinTab, layout, openTabs, renderContentPanel, renderEmpty, setLayout])

  if (!layoutReady) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{tGroups('loadingLayout')}</div>

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={editorCollisionDetection}
      onDragStart={() => setDragging(true)}
      onDragCancel={() => setDragging(false)}
      onDragEnd={handleDragEnd}
    >
      <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
        {renderLayoutNode(layout.root)}
      </div>
      <AlertDialog open={confirmRecordTabClose !== null} onOpenChange={open => {
        if (!open) setConfirmRecordTabClose(null)
      }}>
        <AlertDialogContent onCloseAutoFocus={event => {
          event.preventDefault()
          const target = recordCloseFocusRef.current
          recordCloseFocusRef.current = null
          if (target?.isConnected) target.focus({ preventScroll: true })
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{tRecordDetail('discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{tRecordDetail('discardDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={event => {
              event.preventDefault()
              setConfirmRecordTabClose(null)
              confirmRecordTabClose?.()
            }}>
              {tRecordDetail('discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {onboarding.hintedStep && (
        <OnboardingSpotlight
          targetId={ONBOARDING_TARGETS[onboarding.hintedStep]}
          title={tOnboarding(`spotlight.${onboarding.hintedStep}.title`)}
          description={tOnboarding(`spotlight.${onboarding.hintedStep}.desc`)}
          dismissLabel={tOnboarding('dismissHint')}
          onDismiss={onboarding.dismissHint}
        />
      )}
      <Dialog open={onboarding.showOrganizeCompletion} onOpenChange={open => {
        if (!open) onboarding.dismissOrganizeCompletion()
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tOnboarding('afterOrganizeDialog.title')}</DialogTitle>
            <DialogDescription>{tOnboarding('afterOrganizeDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onboarding.dismissOrganizeCompletion}>
              {tOnboarding('afterOrganizeDialog.cancel')}
            </Button>
            <Button onClick={() => void onboarding.startCurrentStep()}>
              {tOnboarding('afterOrganizeDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  )
}
