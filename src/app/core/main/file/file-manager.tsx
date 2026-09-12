'use client'
import { PluginEmbeddedViews } from '@/components/plugins/plugin-embedded-views'
import React, { useEffect, useState, useMemo, useRef } from "react"
import type { ItemInstance } from '@headless-tree/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/enhanced-context-menu"
import useArticleStore, { DirTree } from "@/stores/article"
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs"
import { Store } from '@tauri-apps/plugin-store'
import { FileItem } from './file-item'
import { FolderItem } from "./folder-item"
import { writeDroppedFileToRoot } from "./root-drop"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"
import useClipboardStore from "@/stores/clipboard"
import { cloneDeep } from "lodash-es"
import { Files, FilePlus, FileSymlink, FolderPlus, Search, Upload, X } from "lucide-react"
import { pasteIntoFolder } from "./folder-item/paste-into-folder"
import { moveEntriesToSystemTrash } from './system-trash'
import {
  flattenFileTree,
  getFileSelectionEntries,
  getLocalDeletionEntries,
  getRemoteDeletionEntries,
  getSiblingSelectionPaths,
  isInteractiveSelectionTarget,
  rectsIntersect,
  type FileSelectionEntry,
  type SelectionBox,
} from "./file-selection"
import {
  clearFileManagerDragData,
  getFileManagerDragPaths,
  getPathAfterMove,
  hasExternalFilesDragData,
  hasFileManagerDragData,
  moveFileManagerEntries,
} from "./file-dnd"
import {
  activeEditorPathIsAffected,
  prepareActiveEditorPathMutationDurably,
} from '@/lib/editor-deactivation'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useMarkdownImport } from './use-markdown-import'
import { useShallow } from 'zustand/react/shallow'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  buildFileTreeSearchIndex,
  filterFileTreeByPathSet,
  filterFileTreeByVisibility,
  getFileTreeSearchMatches,
  searchFileTreeIndex,
  type FileTreeNode,
} from './file-tree-model'
import { useFileTree } from './use-file-tree'
import { useSyncAvailability } from './use-sync-availability'
import useSettingStore from '@/stores/setting'
import { buildFileTreeSyncStatusMap } from './file-tree-action-policy'
import { PluginFileMenuItems } from '@/components/plugins/plugin-file-menu-items'
import { PluginFileActions } from '@/components/plugins/plugin-file-actions'
import { deleteRemoteFile } from '@/lib/sync/remote-library'
import { getWritingAssetsFolderName } from '@/lib/writing-assets-path'
import {
  clearFolderRemoteState,
  deleteRemoteFolder,
} from './folder-item/delete-folder-utils'

type SearchPhase = 'idle' | 'local' | 'remote' | 'complete'

// 搜索结果按“本地优先、远程补充”展示。同一来源内保持文件树原有顺序，
// 避免远程结果到达后让已经展示的本地结果相互跳动。
function prioritizeLocalSearchResults(tree: DirTree[]): DirTree[] {
  return tree
    .map(item => ({
      ...item,
      children: item.children
        ? prioritizeLocalSearchResults(item.children)
        : undefined,
    }))
    .sort((left, right) => Number(right.isLocale) - Number(left.isLocale))
}

function getSelectionBox(startX: number, startY: number, currentX: number, currentY: number): SelectionBox {
  const left = Math.min(startX, currentX)
  const top = Math.min(startY, currentY)

  return {
    left,
    top,
    width: Math.abs(currentX - startX),
    height: Math.abs(currentY - startY),
  }
}

export function FileManager({
  focusSidebar,
  showSearch = true,
}: {
  focusSidebar: () => void
  showSearch?: boolean
}) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragItemCount, setDragItemCount] = useState(0)
  const [filterQuery, setFilterQuery] = useState('')
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle')
  const [localSearchMatchCount, setLocalSearchMatchCount] = useState(0)
  const [remoteSearchUnavailable, setRemoteSearchUnavailable] = useState(false)
  const [remoteSearchError, setRemoteSearchError] = useState(false)
  const [searchRetryNonce, setSearchRetryNonce] = useState(0)
  const [searchProgress, setSearchProgress] = useState({ loaded: 0, total: 0 })
  const [treeScrollMargin, setTreeScrollMargin] = useState(44)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const dragDepthRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const treeContainerRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const suppressNextClickRef = useRef(false)
  const searchLoadGenerationRef = useRef(0)
  const remoteSearchRootLoadedRef = useRef(false)
  const remoteSearchLoadedPathsRef = useRef(new Set<string>())
  const scrollSaveTimerRef = useRef<number | null>(null)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const assetsPath = useSettingStore(state => state.assetsPath)
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)
  const assetsFolderName = getWritingAssetsFolderName(assetsPath)
  const t = useTranslations('article.file')
  const tRecordToolbar = useTranslations('record.mark.toolbar')
  const {
    configurationRevision: syncConfigurationRevision,
    refresh: refreshSyncAvailability,
  } = useSyncAvailability()

  useEffect(() => {
    if (primaryBackupMethod !== 'selfHosted') return
    void (async () => {
      const { refreshSelfHostedSyncRuntime } = await import('@/lib/self-hosted-sync/lifecycle')
      await refreshSelfHostedSyncRuntime()
      await refreshSyncAvailability()
    })().catch(error => {
      console.warn('[self-hosted-sync] Unable to prepare the current workspace', error)
    })
  }, [primaryBackupMethod, refreshSyncAvailability, workspacePath])

  const {
    activeFilePath,
    fileTree,
    loadFileTree,
    setActiveFilePath,
    addFile,
    newFolder,
    setFileTree,
    showCloudFiles,
    showAssetsFolders,
    moveLocalEntry,
    syncOpenTabsForPathChange,
    selectedFilePaths,
    setSelectedFilePaths,
    clearSelectedFilePaths,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    fileTreeLoading,
    fileTreeInitialized,
    collapsibleList,
    setCollapsibleList,
    loadCollapsibleFiles,
    loadFolderRemoteFiles,
  } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    loadFileTree: state.loadFileTree,
    setActiveFilePath: state.setActiveFilePath,
    addFile: state.addFile,
    newFolder: state.newFolder,
    setFileTree: state.setFileTree,
    showCloudFiles: state.showCloudFiles,
    showAssetsFolders: state.showAssetsFolders,
    moveLocalEntry: state.moveLocalEntry,
    syncOpenTabsForPathChange: state.syncOpenTabsForPathChange,
    selectedFilePaths: state.selectedFilePaths,
    setSelectedFilePaths: state.setSelectedFilePaths,
    clearSelectedFilePaths: state.clearSelectedFilePaths,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    fileTreeLoading: state.fileTreeLoading,
    fileTreeInitialized: state.fileTreeInitialized,
    collapsibleList: state.collapsibleList,
    setCollapsibleList: state.setCollapsibleList,
    loadCollapsibleFiles: state.loadCollapsibleFiles,
    loadFolderRemoteFiles: state.loadFolderRemoteFiles,
  })))
  const { isImporting, importMarkdown } = useMarkdownImport()
  const { clipboardItem, clipboardItems, clipboardOperation, setClipboardItem } = useClipboardStore()

  const selectedEntries = useMemo(
    () => getFileSelectionEntries(fileTree, selectedFilePaths),
    [fileTree, selectedFilePaths]
  )
  const selectedPathSet = useMemo(
    () => new Set(selectedFilePaths),
    [selectedFilePaths]
  )

  function resetRootDropState() {
    dragDepthRef.current = 0
    setIsDragging(false)
    setDragItemCount(0)
  }

  function isRootBlankDropTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest('[data-file-manager-root-blank]'))
  }

  function canDropOnRoot(dataTransfer: DataTransfer, target: EventTarget | null) {
    if (hasFileManagerDragData(dataTransfer)) {
      return isRootBlankDropTarget(target)
    }

    return hasExternalFilesDragData(dataTransfer)
  }

  function createRootFile() {
    const cacheTree = cloneDeep(fileTree)
    const existing = cacheTree.find(entry => entry.name === '' && entry.isFile)
    if (existing) {
      return
    }

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
    setFileTree(cacheTree)
  }

  async function pasteIntoRoot() {
    await pasteIntoFolder({
      clipboardItem,
      clipboardItems,
      clipboardOperation,
      folderPath: '',
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
      cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder,
    })
  }

  function updateSelectionFromPointer(currentX: number, currentY: number) {
    const start = selectionStartRef.current
    const container = containerRef.current
    if (!start || !container) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const contentBox = getSelectionBox(
      start.x,
      start.y,
      currentX - containerRect.left + container.scrollLeft,
      currentY - containerRect.top + container.scrollTop,
    )
    setSelectionBox(contentBox)

    const selectedPaths: string[] = []
    const treeContainer = treeContainerRef.current
    if (!treeContainer) return
    const contentHitBox = {
      left: contentBox.left,
      right: contentBox.left + contentBox.width,
      top: contentBox.top,
      bottom: contentBox.top + contentBox.height,
    }
    const treeRect = treeContainer.getBoundingClientRect()
    const treeContentTop = treeRect.top - containerRect.top + container.scrollTop
    treeItems.forEach((treeItem, index) => {
      const node = treeItem.getItemData()
      if (!node.item) return
      const rowTop = treeContentTop + index * 28
      const rowRect = {
        left: 0,
        right: container.clientWidth,
        top: rowTop,
        bottom: rowTop + 28,
      }
      if (rectsIntersect(contentHitBox, rowRect)) selectedPaths.push(node.path)
    })
    setSelectedFilePaths(selectedPaths)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || isInteractiveSelectionTarget(e.target)) {
      return
    }

    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    focusSidebar()
    const containerRect = e.currentTarget.getBoundingClientRect()
    selectionStartRef.current = {
      x: e.clientX - containerRect.left + e.currentTarget.scrollLeft,
      y: e.clientY - containerRect.top + e.currentTarget.scrollTop,
    }
    selectingRef.current = false
    pointerIdRef.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const start = selectionStartRef.current
    if (!start || pointerIdRef.current !== e.pointerId) {
      return
    }

    const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (!selectingRef.current && distance < 4) {
      return
    }

    selectingRef.current = true
    e.preventDefault()
    const containerRect = e.currentTarget.getBoundingClientRect()
    const edgeSize = 36
    if (e.clientY < containerRect.top + edgeSize) {
      e.currentTarget.scrollBy({ top: -14 })
    } else if (e.clientY > containerRect.bottom - edgeSize) {
      e.currentTarget.scrollBy({ top: 14 })
    }
    updateSelectionFromPointer(e.clientX, e.clientY)
  }

  function resetPointerSelection(e?: React.PointerEvent<HTMLDivElement>) {
    if (e && pointerIdRef.current === e.pointerId && e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    if (selectingRef.current) {
      suppressNextClickRef.current = true
    } else if (selectionStartRef.current) {
      clearSelectedFilePaths()
    }

    selectionStartRef.current = null
    selectingRef.current = false
    pointerIdRef.current = null
    setSelectionBox(null)
  }

  function handleClickCapture(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (!suppressNextClickRef.current) {
      return
    }

    suppressNextClickRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  function handleFileManagerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (showSearch && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
      return
    }

    if (event.key === 'Escape' && filterQuery) {
      event.preventDefault()
      event.stopPropagation()
      setFilterQuery('')
      focusSidebar()
    }
  }

  async function cleanDeletedLocalEntryTabs(entry: FileSelectionEntry) {
    if (entry.isDirectory) {
      await cleanTabsByDeletedFolder(entry.path)
      return
    }
    await cleanTabsByDeletedFile(entry.path)
  }

  async function handleDeleteSelectedEntries() {
    const entries = getLocalDeletionEntries(selectedEntries)
    if (entries.length === 0) {
      return
    }

    const { ask } = await import('@tauri-apps/plugin-dialog')
    const confirmed = await ask(tRecordToolbar('deleteSelected', { count: entries.length }), {
      title: t('context.delete'),
      kind: 'warning',
    })

    if (!confirmed) {
      return
    }

    if (!await prepareActiveEditorPathMutationDurably(
      activeFilePath,
      entries.map(entry => entry.path),
    )) return

    try {
      const trashedCount = await moveEntriesToSystemTrash(entries.map(entry => entry.path))
      const cleanupEntries = [...entries].sort((left, right) => (
        Number(activeEditorPathIsAffected(activeFilePath, left.path))
        - Number(activeEditorPathIsAffected(activeFilePath, right.path))
      ))
      for (const entry of cleanupEntries) {
        await cleanDeletedLocalEntryTabs(entry)
      }

      const nextVectorIndexedFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
      for (const path of nextVectorIndexedFiles.keys()) {
        if (entries.some(entry => path === entry.path || path.startsWith(`${entry.path}/`))) {
          nextVectorIndexedFiles.delete(path)
        }
      }
      useArticleStore.setState({ vectorIndexedFiles: nextVectorIndexedFiles })

      await loadFileTree({ skipRemoteSync: true })
      clearSelectedFilePaths()
      toast({
        title: t('context.movedToTrash', { count: trashedCount }),
      })
    } catch (error) {
      console.error('Delete selected entries failed:', error)
      toast({
        title: t('context.deleteFailed'),
        variant: 'destructive',
      })
      await loadFileTree()
    }
  }

  async function handleDeleteSelectedRemoteEntries() {
    const entries = getRemoteDeletionEntries(selectedEntries)
    if (entries.length === 0) {
      return
    }

    const { ask } = await import('@tauri-apps/plugin-dialog')
    const confirmed = await ask(t('context.confirmDeleteSelectedRemote', { count: entries.length }), {
      title: t('context.delete'),
      kind: 'warning',
    })

    if (!confirmed) {
      return
    }

    const deletedEntries: FileSelectionEntry[] = []
    let failedCount = 0

    for (const entry of entries) {
      try {
        if (entry.isDirectory) {
          const result = await deleteRemoteFolder(entry.item, false)
          if (!result.attempted || result.failedPaths.length > 0) {
            throw new Error(result.failedPaths.join(', ') || entry.path)
          }
        } else {
          const deleted = await deleteRemoteFile(entry.path)
          if (!deleted) {
            throw new Error(entry.path)
          }
        }
        deletedEntries.push(entry)
      } catch (error) {
        failedCount += 1
        console.error(`Delete remote entry failed: ${entry.path}`, error)
      }
    }

    if (deletedEntries.length > 0) {
      const nextTree = cloneDeep(useArticleStore.getState().fileTree)
      deletedEntries.forEach(entry => clearFolderRemoteState(nextTree, entry.path))
      setFileTree(nextTree)
      const remainingPaths = new Set(flattenFileTree(nextTree).map(entry => entry.path))
      setSelectedFilePaths(selectedFilePaths.filter(path => remainingPaths.has(path)))
    }

    toast({
      title: failedCount === 0
        ? t('context.deleteSelectedRemoteSuccess', { count: deletedEntries.length })
        : t('context.deleteSelectedRemoteResult', {
            deleted: deletedEntries.length,
            failed: failedCount,
          }),
      variant: failedCount > 0 ? 'destructive' : undefined,
    })
  }

  async function moveEntriesToRoot(sourcePaths: string[]) {
    const movesActiveFile = sourcePaths.some(sourcePath => (
      activeEditorPathIsAffected(activeFilePath, sourcePath)
    ))
    if (!await prepareActiveEditorPathMutationDurably(activeFilePath, sourcePaths)) return

    const batchResult = await moveFileManagerEntries(sourcePaths, '')
    if (batchResult.failed.length > 0) {
      if (batchResult.failed.some(failure => (
        failure.reason === 'conflict' || failure.reason === 'rollback-failed'
      ))) {
        await loadFileTree({ skipRemoteSync: true })
      }
      toast({
        title: t('context.moveFailed'),
        description: t(`context.moveFailure.${batchResult.failed[0].reason}`),
        variant: 'destructive',
      })
      return
    }

    let nextActiveFilePath = activeFilePath
    let requiresReload = false
    for (const result of batchResult.moved) {
      requiresReload = !moveLocalEntry(result.sourcePath, result.targetPath) || requiresReload
      nextActiveFilePath = getPathAfterMove(nextActiveFilePath, result.sourcePath, result.targetPath)
      await syncOpenTabsForPathChange(result.sourcePath, result.targetPath)
    }
    if (requiresReload) await loadFileTree({ skipRemoteSync: true })
    if (nextActiveFilePath !== activeFilePath) {
      setActiveFilePath(
        nextActiveFilePath,
        true,
        movesActiveFile ? { deactivationAlreadyPrepared: true } : undefined,
      )
    }
    setSelectedFilePaths(batchResult.moved.map(result => result.targetPath))
    if (batchResult.moved.length > 1) {
      toast({
        title: t('context.moveComplete'),
        description: t('context.moveResult', {
          moved: batchResult.moved.length,
          failed: 0,
        }),
      })
    }
  }

  async function handleDrop (e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const isFileManagerDrag = hasFileManagerDragData(e.dataTransfer)
    const renamePaths = isFileManagerDrag
      ? getFileManagerDragPaths(e.dataTransfer)
      : []

    if (isFileManagerDrag && !isRootBlankDropTarget(e.target)) {
      resetRootDropState()
      return
    }

    try {
      if (renamePaths.length > 0) {
        await moveEntriesToRoot(renamePaths)
      } else {
        const files = e.dataTransfer.files
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]
          // 接受 markdown 和图片文件
          if (file.name.endsWith('.md')) {
            const text = await file.text()
            const { getFilePathOptions } = await import('@/lib/workspace')
            const sanitizedFileName = await writeDroppedFileToRoot({
              fileName: file.name,
              getFilePathOptions,
              writeTextFile,
            }, {
              kind: 'text',
              content: text,
            })

            addFile({
              name: sanitizedFileName,
              isEditing: false,
              isLocale: true,
              isDirectory: false,
              isFile: true,
              isSymlink: false
            })
          } else if (file.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
            // 处理图片文件，同样需要处理文件名以保持一致性
            const arrayBuffer = await file.arrayBuffer()
            const uint8Array = new Uint8Array(arrayBuffer)
            const { getFilePathOptions } = await import('@/lib/workspace')
            const sanitizedImageFileName = await writeDroppedFileToRoot({
              fileName: file.name,
              getFilePathOptions,
              writeFile,
            }, {
              kind: 'binary',
              content: uint8Array,
            })

            addFile({
              name: sanitizedImageFileName,
              isEditing: false,
              isLocale: true,
              isDirectory: false,
              isFile: true,
              isSymlink: false
            })
          }
        }
      }
    } catch (error) {
      console.error('File manager drop failed:', error)
      toast({
        title: renamePaths.length > 0 ? t('context.moveFailed') : t('toolbar.importError'),
        variant: 'destructive',
      })
    } finally {
      resetRootDropState()
    }
  }
  
  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!canDropOnRoot(e.dataTransfer, e.target)) {
      if (hasFileManagerDragData(e.dataTransfer)) {
        resetRootDropState()
      }
      return
    }

    e.preventDefault()
    dragDepthRef.current += 1
    setDragItemCount(hasExternalFilesDragData(e.dataTransfer)
      ? e.dataTransfer.files.length
      : getFileManagerDragPaths(e.dataTransfer).length)
    setIsDragging(true)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!canDropOnRoot(e.dataTransfer, e.target)) {
      if (hasFileManagerDragData(e.dataTransfer)) {
        e.dataTransfer.dropEffect = 'none'
        resetRootDropState()
      }
      return
    }

    e.preventDefault()
    e.dataTransfer.dropEffect = hasExternalFilesDragData(e.dataTransfer) ? 'copy' : 'move'
    setDragItemCount(hasExternalFilesDragData(e.dataTransfer)
      ? e.dataTransfer.files.length
      : getFileManagerDragPaths(e.dataTransfer).length)
    const container = containerRef.current
    if (container) {
      const bounds = container.getBoundingClientRect()
      const edgeSize = 40
      if (e.clientY < bounds.top + edgeSize) {
        container.scrollTop -= 14
      } else if (e.clientY > bounds.bottom - edgeSize) {
        container.scrollTop += 14
      }
    }
    setIsDragging(true)
  }

  function handleDragleave(e: React.DragEvent<HTMLDivElement>) {
    if (!canDropOnRoot(e.dataTransfer, e.target)) {
      return
    }

    e.preventDefault()
    const nextTarget = e.relatedTarget as Node | null
    if (nextTarget && e.currentTarget.contains(nextTarget)) {
      return
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragging(false)
    }
  }

  useEffect(() => {
    function handleGlobalDragFinish() {
      dragDepthRef.current = 0
      clearFileManagerDragData()
      setIsDragging(false)
      setDragItemCount(0)
    }

    window.addEventListener('drop', handleGlobalDragFinish)
    window.addEventListener('dragend', handleGlobalDragFinish)

    return () => {
      window.removeEventListener('drop', handleGlobalDragFinish)
      window.removeEventListener('dragend', handleGlobalDragFinish)
    }
  }, [])

  useEffect(() => {
    if (!fileTreeInitialized && !fileTreeLoading) {
      void loadFileTree()
    }
  }, [fileTreeInitialized, fileTreeLoading, loadFileTree])

  useEffect(() => {
    let disposed = false
    const key = `fileTreeScrollTop:${workspacePath || '__default__'}`
    remoteSearchRootLoadedRef.current = false
    remoteSearchLoadedPathsRef.current.clear()

    void Store.load('store.json').then(async store => {
      const scrollTop = await store.get<number>(key) ?? 0
      if (!disposed && containerRef.current) {
        containerRef.current.scrollTop = scrollTop
      }
    })

    return () => {
      disposed = true
      if (scrollSaveTimerRef.current !== null) {
        window.clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
    }
  }, [workspacePath])

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) {
      setTreeScrollMargin(0)
      return
    }
    const updateMargin = () => setTreeScrollMargin(toolbar.offsetHeight)
    updateMargin()
    const observer = new ResizeObserver(updateMargin)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [showSearch])

  useEffect(() => {
    remoteSearchRootLoadedRef.current = false
    remoteSearchLoadedPathsRef.current.clear()
  }, [syncConfigurationRevision])

  useEffect(() => {
    setFilterQuery('')
    setSelectionBox(null)
    clearSelectedFilePaths()
    clearFileManagerDragData()
    resetRootDropState()
  }, [workspacePath])

  function handleScroll() {
    if (scrollSaveTimerRef.current !== null) {
      window.clearTimeout(scrollSaveTimerRef.current)
    }
    scrollSaveTimerRef.current = window.setTimeout(() => {
      const scrollTop = containerRef.current?.scrollTop ?? 0
      const key = `fileTreeScrollTop:${workspacePath || '__default__'}`
      void Store.load('store.json').then(async store => {
        await store.set(key, scrollTop)
        await store.save()
      })
    }, 200)
  }

  useEffect(() => {
    const query = filterQuery.trim()
    const generation = ++searchLoadGenerationRef.current

    if (!query) {
      setIsSearchLoading(false)
      setSearchPhase('idle')
      setLocalSearchMatchCount(0)
      setRemoteSearchUnavailable(false)
      setRemoteSearchError(false)
      setSearchProgress({ loaded: 0, total: 0 })
      return
    }

    setIsSearchLoading(true)
    setSearchPhase('local')
    setLocalSearchMatchCount(0)
    setRemoteSearchUnavailable(false)
    setRemoteSearchError(false)
    const timer = window.setTimeout(async () => {
      const locallyLoadedPaths = new Set<string>()

      // 第一阶段只读取本地目录。fileTree 会在每个批次完成后立即更新，
      // 因此用户无需等待远程请求即可看到本地匹配结果。
      while (generation === searchLoadGenerationRef.current) {
        const folderPaths = flattenFileTree(useArticleStore.getState().fileTree)
          .filter(entry => entry.isDirectory && !locallyLoadedPaths.has(entry.path))
          .map(entry => entry.path)

        if (folderPaths.length === 0) {
          break
        }

        setSearchProgress({
          loaded: locallyLoadedPaths.size,
          total: locallyLoadedPaths.size + folderPaths.length,
        })
        for (let index = 0; index < folderPaths.length; index += 4) {
          if (generation !== searchLoadGenerationRef.current) return
          const batch = folderPaths.slice(index, index + 4)
          batch.forEach(path => locallyLoadedPaths.add(path))
          await Promise.all(batch.map(path => (
            useArticleStore.getState().loadCollapsibleFiles(path, { skipRemoteSync: true })
          )))
          setSearchProgress(current => ({ ...current, loaded: locallyLoadedPaths.size }))
        }
      }

      if (generation !== searchLoadGenerationRef.current) return

      const localTree = filterFileTreeByVisibility(useArticleStore.getState().fileTree, {
        showCloudFiles: false,
        showAssetsFolders,
        assetsFolderName,
      })
      const localIndex = buildFileTreeSearchIndex(localTree)
      const localMatchCount = getFileTreeSearchMatches(localIndex, query).size
      setLocalSearchMatchCount(localMatchCount)

      let canSearchRemote = false
      if (showCloudFiles) {
        try {
          canSearchRemote = (await refreshSyncAvailability()).configured
        } catch {
          canSearchRemote = false
        }
      }

      if (generation !== searchLoadGenerationRef.current) return

      setRemoteSearchUnavailable(showCloudFiles && !canSearchRemote)

      if (canSearchRemote) {
        setSearchPhase('remote')
        try {

        // 先更新远程根目录，保证此前尚未出现在本地树中的远程文件夹
        // 也能进入后续搜索。
        if (!remoteSearchRootLoadedRef.current) {
          await useArticleStore.getState().loadRemoteSyncFiles()
          remoteSearchRootLoadedRef.current = true
        }

        // 第二阶段再逐层加载远程目录。每批远程结果合并进 fileTree 后会
        // 自动参与当前搜索，新发现的远程文件夹也会在下一轮继续加载。
        const remotelyLoadedPaths = remoteSearchLoadedPathsRef.current
        while (generation === searchLoadGenerationRef.current) {
          const folderPaths = flattenFileTree(useArticleStore.getState().fileTree)
            .filter(entry => entry.isDirectory && !remotelyLoadedPaths.has(entry.path))
            .map(entry => entry.path)

          if (folderPaths.length === 0) {
            break
          }

          setSearchProgress({
            loaded: remotelyLoadedPaths.size,
            total: remotelyLoadedPaths.size + folderPaths.length,
          })
          for (let index = 0; index < folderPaths.length; index += 4) {
            if (generation !== searchLoadGenerationRef.current) return
            const batch = folderPaths.slice(index, index + 4)
            batch.forEach(path => remotelyLoadedPaths.add(path))
            await Promise.all(batch.map(path => loadFolderRemoteFiles(path)))
            setSearchProgress(current => ({ ...current, loaded: remotelyLoadedPaths.size }))
          }
        }
        } catch {
          if (generation === searchLoadGenerationRef.current) {
            setRemoteSearchError(true)
          }
        }
      }

      if (generation === searchLoadGenerationRef.current) {
        setSearchPhase('complete')
        setIsSearchLoading(false)
      }
    }, 180)

    return () => {
      window.clearTimeout(timer)
      if (searchLoadGenerationRef.current === generation) {
        searchLoadGenerationRef.current += 1
      }
    }
  }, [assetsFolderName, filterQuery, loadFolderRemoteFiles, refreshSyncAvailability, searchRetryNonce, showAssetsFolders, showCloudFiles])

  useEffect(() => {
    function handleDeleteSelection() {
      void handleDeleteSelectedEntries()
    }

    window.addEventListener('filemanager-delete-selection', handleDeleteSelection)
    return () => {
      window.removeEventListener('filemanager-delete-selection', handleDeleteSelection)
    }
  }, [handleDeleteSelectedEntries])

  useEffect(() => {
    function handleDeleteRemoteSelection() {
      void handleDeleteSelectedRemoteEntries()
    }

    window.addEventListener('filemanager-delete-remote-selection', handleDeleteRemoteSelection)
    return () => {
      window.removeEventListener('filemanager-delete-remote-selection', handleDeleteRemoteSelection)
    }
  }, [handleDeleteSelectedRemoteEntries])

  // 根据开关状态过滤文件树 - 使用 useMemo 缓存结果
  const filteredFileTree = useMemo(
    () => filterFileTreeByVisibility(fileTree, {
      showCloudFiles,
      showAssetsFolders,
      assetsFolderName,
    }),
    [assetsFolderName, fileTree, showAssetsFolders, showCloudFiles]
  )
  const syncStatusByPath = useMemo(
    () => buildFileTreeSyncStatusMap(fileTree),
    [fileTree]
  )
  const searchIndex = useMemo(
    () => buildFileTreeSearchIndex(filteredFileTree),
    [filteredFileTree]
  )
  const visibleFileTree = useMemo(
    () => filterQuery.trim()
      ? prioritizeLocalSearchResults(
          filterFileTreeByPathSet(filteredFileTree, searchFileTreeIndex(searchIndex, filterQuery))
        )
      : filteredFileTree,
    [filteredFileTree, filterQuery, searchIndex]
  )
  const showEmptyState = fileTreeInitialized && filteredFileTree.length === 0
  const { model: treeModel, tree } = useFileTree({
    items: visibleFileTree,
    expandedPaths: collapsibleList,
    selectedPaths: selectedFilePaths,
    filterActive: Boolean(filterQuery.trim()),
    setExpandedPath: setCollapsibleList,
    loadExpandedFolder: loadCollapsibleFiles,
    setSelectedPaths: setSelectedFilePaths,
  })
  const showNoResults = Boolean(filterQuery.trim())
    && !isSearchLoading
    && treeModel.rootChildren.length === 0
  const treeItems = tree.getItems()

  useEffect(() => {
    function handleSelectAll(event: Event) {
      const { anchorPath } = (event as CustomEvent<{ anchorPath?: string }>).detail
      setSelectedFilePaths(getSiblingSelectionPaths(filteredFileTree, anchorPath ?? ''))
    }

    window.addEventListener('filemanager-select-all', handleSelectAll)
    return () => {
      window.removeEventListener('filemanager-select-all', handleSelectAll)
    }
  }, [filteredFileTree, setSelectedFilePaths])

  const rowVirtualizer = useVirtualizer({
    count: treeItems.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 28,
    getItemKey: index => treeItems[index]?.getId() ?? index,
    overscan: 12,
    scrollMargin: treeScrollMargin,
  })
  const visibleResultCount = useMemo(
    () => filterQuery.trim()
      ? getFileTreeSearchMatches(searchIndex, filterQuery).size
      : flattenFileTree(visibleFileTree).filter(entry => entry.name !== '').length,
    [filterQuery, searchIndex, visibleFileTree]
  )
  const searchStatusLabel = searchPhase === 'local'
    ? t('search.searchingLocal')
    : searchPhase === 'remote'
      ? localSearchMatchCount === 0
        ? t('search.localNotFoundSearchingRemote')
        : t('search.localFoundSearchingRemote', { count: localSearchMatchCount })
      : ''

  useEffect(() => {
    const availablePaths = new Set(flattenFileTree(filteredFileTree).map(entry => entry.path))
    const nextSelectedPaths = selectedFilePaths.filter(path => availablePaths.has(path))
    if (nextSelectedPaths.length !== selectedFilePaths.length) {
      setSelectedFilePaths(nextSelectedPaths)
    }
  }, [filteredFileTree, selectedFilePaths, setSelectedFilePaths])

  return (
    <div
      ref={containerRef}
      className={cn(
        "app-panel-scrollbar relative h-full min-h-full min-w-0 flex-1 select-none overflow-x-hidden overflow-y-auto bg-background transition-colors",
        isDragging && "bg-accent/60 outline-2 outline-dashed -outline-offset-4 outline-ring/60"
      )}
      onDrop={(e) => handleDrop(e)}
      onDragEnter={(e) => handleDragEnter(e)}
      onDragOver={e => handleDragOver(e)}
      onDragLeave={(e) => handleDragleave(e)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={resetPointerSelection}
      onPointerCancel={resetPointerSelection}
      onClickCapture={handleClickCapture}
      onKeyDown={handleFileManagerKeyDown}
      onScroll={handleScroll}
    >
      <div className="flex h-full min-h-full min-w-0 flex-col p-0">
        <PluginEmbeddedViews location="file-panel" />
        {isDragging && dragItemCount > 0 ? (
          <Badge variant="outline" className="pointer-events-none absolute right-2 top-12">
            {t('context.dropTarget', { name: t('mobile.root'), count: dragItemCount })}
          </Badge>
        ) : null}
        {showSearch ? <div ref={toolbarRef} className="sticky top-0 z-10 select-none bg-background/95 px-2 py-2 backdrop-blur-sm">
          <PluginFileActions />
          <div className="flex min-w-0 items-center gap-1.5">
              <InputGroup
                focusRing="subtle"
                className="h-7 min-w-0 flex-1 rounded-md border-sidebar-border/80 bg-background/55 shadow-none transition-colors focus-within:bg-background"
              >
                <InputGroupAddon className="text-muted-foreground/80">
                  {isSearchLoading
                    ? <Spinner className="size-3.5" />
                    : <Search className="size-3.5" />}
                </InputGroupAddon>
                <InputGroupInput
                  ref={searchInputRef}
                  className={cn('text-xs', filterQuery ? 'select-text' : 'select-none')}
                  value={filterQuery}
                  onChange={event => setFilterQuery(event.target.value)}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.label')}
                  onKeyDown={event => {
                    if (event.key === 'Escape' && filterQuery) {
                      event.preventDefault()
                      event.stopPropagation()
                      setFilterQuery('')
                    }
                  }}
                />
                {filterQuery && (
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={t('search.clear')}
                      title={t('search.clear')}
                      onClick={() => setFilterQuery('')}
                    >
                      <X className="size-3" />
                    </InputGroupButton>
                  </InputGroupAddon>
                )}
              </InputGroup>
              {selectedFilePaths.length > 1 && (
                <Badge variant="secondary" className="pointer-events-none shrink-0 tabular-nums">
                  {tRecordToolbar('selectedCount', { count: selectedFilePaths.length })}
                </Badge>
              )}
              {isSearchLoading && searchProgress.total > 0 && (
                <Badge variant="outline" className="pointer-events-none shrink-0 tabular-nums">
                  {t('search.folderProgress', {
                    loaded: Math.min(searchProgress.loaded, searchProgress.total),
                    total: searchProgress.total,
                  })}
                </Badge>
              )}
              {!isSearchLoading && filterQuery.trim() && (
                <Badge variant="outline" className="pointer-events-none shrink-0 tabular-nums">
                  {t('search.resultCount', { count: visibleResultCount })}
                </Badge>
              )}
          </div>
          {searchStatusLabel && (
              <Badge
                variant="secondary"
                className="pointer-events-none mt-1.5 max-w-full justify-start"
                role="status"
                aria-live="polite"
              >
                <span className="truncate">{searchStatusLabel}</span>
              </Badge>
          )}
          {remoteSearchError && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Badge variant="destructive" role="status">
                  {t('search.remoteError')}
                </Badge>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    remoteSearchRootLoadedRef.current = false
                    remoteSearchLoadedPathsRef.current.clear()
                    setSearchRetryNonce(value => value + 1)
                  }}
                >
                  {t('search.retry')}
                </Button>
              </div>
          )}
        </div> : null}
        <div
          {...tree.getContainerProps(t('treeLabel'))}
          ref={treeContainerRef}
          className="relative min-w-0 shrink-0 px-1.5 outline-none"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const treeItem = treeItems[virtualRow.index] as ItemInstance<FileTreeNode>
            const node = treeItem.getItemData()
            if (!node.item) return null

            const treeItemProps = treeItem.getProps() as React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
            const level = Math.max(0, treeItem.getItemMeta().level)

            return node.isFolder ? (
              <div
                key={node.id}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)` }}
              >
                <FolderItem
                  item={node.item}
                  focusSidebar={focusSidebar}
                  selectedPathSet={selectedPathSet}
                  selectionEntries={selectedEntries}
                  treeItemProps={treeItemProps}
                  level={level}
                  expanded={treeItem.isExpanded()}
                  expandable={!node.childrenLoaded || node.children.length > 0 || !node.item.isLocale}
                  expansionLocked={Boolean(filterQuery.trim())}
                  syncStatus={syncStatusByPath.get(node.path)}
                />
              </div>
            ) : (
              <div
                key={node.id}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)` }}
              >
                <FileItem
                  item={node.item}
                  focusSidebar={focusSidebar}
                  selectedPathSet={selectedPathSet}
                  selectionEntries={selectedEntries}
                  treeItemProps={treeItemProps}
                  level={level}
                  syncStatus={syncStatusByPath.get(node.path)}
                />
              </div>
            )
          })}
        </div>
        {showNoResults && (
          <Empty className="min-h-44 justify-start pt-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search />
              </EmptyMedia>
              <EmptyTitle>{t('search.emptyTitle')}</EmptyTitle>
              <EmptyDescription className="text-xs">
                {t(remoteSearchUnavailable
                  ? 'search.localNotFoundRemoteUnavailable'
                  : 'search.emptyDescription')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              aria-label={t('mobile.root')}
              data-file-manager-root-blank
              className={cn(
                "min-h-24 flex-1 transition-colors",
                showEmptyState && "flex",
                isDragging && "bg-accent/50"
              )}
              onClick={clearSelectedFilePaths}
              onContextMenu={(e) => {
                e.stopPropagation()
                clearSelectedFilePaths()
              }}
            >
              {showEmptyState ? (
                <Empty className="min-h-48 justify-start pt-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Files />
                    </EmptyMedia>
                    <EmptyTitle>{t('empty.title')}</EmptyTitle>
                    <EmptyDescription className="whitespace-pre-line text-xs">
                      {t('empty.description')}
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="flex-row justify-center">
                    <Button size="sm" onClick={createRootFile}>
                      <FilePlus data-icon="inline-start" />
                      {t('toolbar.newArticle')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isImporting}
                      onClick={() => void importMarkdown()}
                    >
                      {isImporting ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />}
                      {isImporting ? t('toolbar.importing') : t('toolbar.importMarkdown')}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : null}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem inset onClick={createRootFile} menuType="file">
              <FilePlus className="mr-2 h-4 w-4" />
              {t('context.newFile')}
            </ContextMenuItem>
            <ContextMenuItem inset onClick={newFolder} menuType="file">
              <FolderPlus className="mr-2 h-4 w-4" />
              {t('context.newFolder')}
            </ContextMenuItem>
            <PluginFileMenuItems context={{ kind: 'root', selectedPaths: [] }} />
            <ContextMenuSeparator />
            <ContextMenuItem
              inset
              disabled={!clipboardItem && clipboardItems.length === 0}
              onClick={pasteIntoRoot}
              menuType="file"
            >
              <FileSymlink className="mr-2 h-4 w-4" />
              {t('context.paste')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {selectionBox && (
        <div
          className="pointer-events-none absolute rounded-sm border border-primary/70 bg-primary/10"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
          }}
        />
      )}
    </div>
  )
}
