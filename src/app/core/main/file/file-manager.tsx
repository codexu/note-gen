'use client'
import React, { useEffect, useState, useMemo, useRef } from "react"
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/enhanced-context-menu"
import useArticleStore, { DirTree } from "@/stores/article"
import { remove, writeTextFile, writeFile } from "@tauri-apps/plugin-fs"
import { FileItem } from './file-item'
import { FolderItem } from "./folder-item"
import { computedParentPath } from "@/lib/path"
import { writeDroppedFileToRoot } from "./root-drop"
import { cn } from "@/lib/utils"
import { toast } from "@/hooks/use-toast"
import { useTranslations } from "next-intl"
import useClipboardStore from "@/stores/clipboard"
import { cloneDeep } from "lodash-es"
import { Files, FilePlus, FileSymlink, FolderPlus, Upload } from "lucide-react"
import { pasteIntoFolder } from "./folder-item/paste-into-folder"
import {
  collectFolderMarkdownPaths,
  deleteLocalFolderIfExists,
  deleteRemoteFolder,
  deleteVectorDocumentsByPaths,
  removeFolderFromTree,
} from "./folder-item/delete-folder-utils"
import {
  flattenFileTree,
  getFileSelectionEntries,
  getTopLevelSelectionEntries,
  isInteractiveSelectionTarget,
  rectsIntersect,
  type FileSelectionEntry,
  type SelectionBox,
} from "./file-selection"
import {
  getFileManagerDragPath,
  getPathAfterMove,
  hasExternalFilesDragData,
  hasFileManagerDragData,
  moveFileManagerEntry,
} from "./file-dnd"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useMarkdownImport } from './use-markdown-import'
import { useSiYuanImport } from './use-siyuan-import'
import { isMobileDevice } from '@/lib/check'
import { useShallow } from 'zustand/react/shallow'

// 递归过滤文件树，移除云端文件（如果 showCloudFiles 为 false）
function filterFileTree(tree: DirTree[], showCloud: boolean): DirTree[] {
  if (showCloud) return tree

  return tree
    .filter(item => item.isLocale)
    .map(item => ({
      ...item,
      children: item.children ? filterFileTree(item.children, showCloud) : undefined
    }))
}

function Tree({
  item,
  focusSidebar,
  selectedPathSet,
  selectionEntries,
}: {
  item: DirTree
  focusSidebar: () => void
  selectedPathSet: Set<string>
  selectionEntries: FileSelectionEntry[]
}) {
  const collapsibleList = useArticleStore((state) => state.collapsibleList)
  const path = computedParentPath(item)

  return (
    item.isFile ?
    <FileItem
      item={item}
      focusSidebar={focusSidebar}
      selectedPathSet={selectedPathSet}
      selectionEntries={selectionEntries}
    /> :
    <li className="min-w-0">
      <Collapsible
        className="group/collapsible"
        open={collapsibleList.includes(path)}
      >
        <FolderItem
          item={item}
          focusSidebar={focusSidebar}
          selectedPathSet={selectedPathSet}
          selectionEntries={selectionEntries}
        />
        <CollapsibleContent className="min-w-0 pl-1">
          <ul className="min-w-0 pl-2">
            {item.children?.map((subItem) => (
              <Tree
                key={`${subItem.name}-${subItem.parent?.name}-${subItem.sha || ''}-${subItem.isLocale}`}
                item={subItem}
                focusSidebar={focusSidebar}
                selectedPathSet={selectedPathSet}
                selectionEntries={selectionEntries}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
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

function removeFileFromTree(tree: DirTree[], filePath: string) {
  const parentPath = filePath.split('/').slice(0, -1).join('/')
  const fileName = filePath.split('/').pop() || filePath
  const siblings = parentPath
    ? flattenFileTree(tree).find(entry => entry.path === parentPath)?.item.children
    : tree

  if (!siblings) {
    return false
  }

  const index = siblings.findIndex(entry => entry.name === fileName && entry.isFile)
  if (index === -1) {
    return false
  }

  const current = siblings[index]
  if (current.sha) {
    current.isLocale = false
    current.loading = undefined
  } else {
    siblings.splice(index, 1)
  }

  return true
}

export function FileManager({ focusSidebar }: { focusSidebar: () => void }) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null)
  const dragDepthRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectingRef = useRef(false)
  const pointerIdRef = useRef<number | null>(null)
  const suppressNextClickRef = useRef(false)
  const t = useTranslations('article.file')
  const tRecordToolbar = useTranslations('record.mark.toolbar')
  const {
    activeFilePath,
    fileTree,
    loadFileTree,
    setActiveFilePath,
    addFile,
    newFolder,
    setFileTree,
    showCloudFiles,
    moveLocalEntry,
    syncOpenTabsForPathChange,
    selectedFilePaths,
    setSelectedFilePaths,
    clearSelectedFilePaths,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    fileTreeLoading,
    fileTreeInitialized,
  } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    loadFileTree: state.loadFileTree,
    setActiveFilePath: state.setActiveFilePath,
    addFile: state.addFile,
    newFolder: state.newFolder,
    setFileTree: state.setFileTree,
    showCloudFiles: state.showCloudFiles,
    moveLocalEntry: state.moveLocalEntry,
    syncOpenTabsForPathChange: state.syncOpenTabsForPathChange,
    selectedFilePaths: state.selectedFilePaths,
    setSelectedFilePaths: state.setSelectedFilePaths,
    clearSelectedFilePaths: state.clearSelectedFilePaths,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    fileTreeLoading: state.fileTreeLoading,
    fileTreeInitialized: state.fileTreeInitialized,
  })))
  const { importSiYuan } = useSiYuanImport()
  const { isImporting, importMarkdown } = useMarkdownImport({
    onImportSiYuanArchive: isMobileDevice() ? undefined : importSiYuan,
  })
  const setArticleState = useArticleStore.setState
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

    const clientBox = getSelectionBox(start.x, start.y, currentX, currentY)
    const containerRect = container.getBoundingClientRect()
    setSelectionBox({
      left: clientBox.left - containerRect.left + container.scrollLeft,
      top: clientBox.top - containerRect.top + container.scrollTop,
      width: clientBox.width,
      height: clientBox.height,
    })

    const selectedPaths: string[] = []
    const itemElements = container.querySelectorAll<HTMLElement>('[data-file-manager-item-path]')
    const clientHitBox = {
      left: clientBox.left,
      right: clientBox.left + clientBox.width,
      top: clientBox.top,
      bottom: clientBox.top + clientBox.height,
    }
    const listHitBox = {
      ...clientHitBox,
      left: containerRect.left,
      right: containerRect.right,
    }
    itemElements.forEach(element => {
      const itemPath = element.dataset.fileManagerItemPath
      if (!itemPath) {
        return
      }

      const rect = element.getBoundingClientRect()
      if (rectsIntersect(listHitBox, rect)) {
        selectedPaths.push(itemPath)
      }
    })
    setSelectedFilePaths(selectedPaths)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || isInteractiveSelectionTarget(e.target)) {
      return
    }

    focusSidebar()
    selectionStartRef.current = { x: e.clientX, y: e.clientY }
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

  async function deleteLocalFile(entry: FileSelectionEntry, tree: DirTree[]) {
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(entry.path)

    if (workspace.isCustom) {
      await remove(pathOptions.path)
    } else {
      await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
    }

    removeFileFromTree(tree, entry.path)

    try {
      const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
      await deleteVectorDocumentsByFilename(entry.path)
      const nextVectorIndexedFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
      nextVectorIndexedFiles.delete(entry.path)
      setArticleState({ vectorIndexedFiles: nextVectorIndexedFiles })
    } catch (error) {
      console.error(`删除文件 ${entry.path} 的向量数据失败:`, error)
    }

    await cleanTabsByDeletedFile(entry.path)
  }

  async function deleteFolder(entry: FileSelectionEntry, tree: DirTree[]) {
    const markdownPaths = await collectFolderMarkdownPaths(entry.path, entry.item)
    const localDeleted = await deleteLocalFolderIfExists(entry.path)
    const remoteResult = await deleteRemoteFolder(entry.item, localDeleted)
    if (remoteResult.failedPaths.length > 0) {
      throw new Error(`Delete remote folder failed: ${remoteResult.failedPaths.join(', ')}`)
    }

    await cleanTabsByDeletedFolder(entry.path)
    removeFolderFromTree(tree, entry.path)

    try {
      await deleteVectorDocumentsByPaths(markdownPaths, entry.path)
    } catch (error) {
      console.error('删除文件夹向量数据失败:', error)
    }

    if (activeFilePath === entry.path || activeFilePath.startsWith(`${entry.path}/`)) {
      setActiveFilePath('')
    }
  }

  async function handleDeleteSelectedEntries() {
    const entries = getTopLevelSelectionEntries(selectedEntries).filter(entry => entry.isLocale && entry.name !== '')
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

    const nextTree = cloneDeep(fileTree)
    try {
      for (const entry of entries) {
        if (entry.isDirectory) {
          await deleteFolder(entry, nextTree)
        } else {
          await deleteLocalFile(entry, nextTree)
        }
      }

      setFileTree(nextTree)
      clearSelectedFilePaths()
      toast({ title: t('context.deleteSuccess') })
    } catch (error) {
      console.error('Delete selected entries failed:', error)
      toast({
        title: t('context.deleteFailed'),
        variant: 'destructive',
      })
      await loadFileTree()
    }
  }

  async function moveEntryToRoot(sourcePath: string) {
    const result = await moveFileManagerEntry(sourcePath, '')

    if (!result.moved) {
      if (result.reason === 'invalid-target') {
        toast({
          title: t('context.invalidMoveTarget'),
          variant: 'destructive',
        })
      }
      return
    }

    const movedInTree = moveLocalEntry(result.sourcePath, result.targetPath)
    if (!movedInTree) {
      await loadFileTree()
    }

    const nextActiveFilePath = getPathAfterMove(activeFilePath, result.sourcePath, result.targetPath)
    if (nextActiveFilePath !== activeFilePath) {
      setActiveFilePath(nextActiveFilePath)
    }

    await syncOpenTabsForPathChange(result.sourcePath, result.targetPath)
  }

  async function handleDrop (e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const isFileManagerDrag = hasFileManagerDragData(e.dataTransfer)
    const renamePath = isFileManagerDrag
      ? getFileManagerDragPath(e.dataTransfer)
      : ''

    if (isFileManagerDrag && !isRootBlankDropTarget(e.target)) {
      resetRootDropState()
      return
    }

    try {
      if (renamePath) {
        await moveEntryToRoot(renamePath)
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
        title: renamePath ? t('context.moveFailed') : t('toolbar.importError'),
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
      setIsDragging(false)
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
    function handleDeleteSelection() {
      void handleDeleteSelectedEntries()
    }

    window.addEventListener('filemanager-delete-selection', handleDeleteSelection)
    return () => {
      window.removeEventListener('filemanager-delete-selection', handleDeleteSelection)
    }
  }, [handleDeleteSelectedEntries])

  // 根据开关状态过滤文件树 - 使用 useMemo 缓存结果
  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, showCloudFiles),
    [fileTree, showCloudFiles]
  )
  const showEmptyState = fileTreeInitialized && filteredFileTree.length === 0

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
        "relative h-full min-h-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto transition-colors",
        isDragging && "bg-primary/5 outline-2 outline-dashed -outline-offset-4 outline-primary/60"
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
    >
      {selectedFilePaths.length > 1 && (
        <div className="pointer-events-none sticky top-2 left-2 z-10 ml-2 w-fit rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
          {tRecordToolbar('selectedCount', { count: selectedFilePaths.length })}
        </div>
      )}
      <div className="flex h-full min-h-full min-w-0 flex-col p-0">
        <ul className="min-w-0 shrink-0">
          {filteredFileTree.map((item) => (
            <Tree
              key={`${item.name}-${item.parent?.name || ''}-${item.sha || ''}-${item.isLocale}`}
              item={item}
              focusSidebar={focusSidebar}
              selectedPathSet={selectedPathSet}
              selectionEntries={selectedEntries}
            />
          ))}
        </ul>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              aria-label={t('mobile.root')}
              data-file-manager-root-blank
              className={cn(
                "min-h-24 flex-1 transition-colors",
                showEmptyState && "flex",
                isDragging && "bg-primary/5"
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
