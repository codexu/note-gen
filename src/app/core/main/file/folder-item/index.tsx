import { ContextMenu, ContextMenuContent, ContextMenuSeparator, ContextMenuTrigger, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, mkdir, rename } from "@tauri-apps/plugin-fs";
import { ChevronRight, Folder, FolderDot, FolderDown, FolderOpen, FolderOpenDot, FolderUp, Loader2, LoaderCircle, Database, Sparkles } from "lucide-react"
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder, joinRelativePath } from "@/lib/path";
import useSettingStore from '@/stores/setting'
import { isSkillsFolder } from "@/lib/skills/utils"
import { cn } from "@/lib/utils"
import DownloadFolder from './sync-folder'
import { UploadFolder } from './upload-folder'
import { NewFile } from './new-file'
import { NewFolder } from './new-folder'
import { ViewDirectory } from './view-directory'
import { CutFolder } from './cut-folder'
import { CopyFolder } from './copy-folder'
import { DuplicateFolder } from './duplicate-folder'
import { PasteInFolder } from './paste-in-folder'
import { RenameFolder } from './rename-folder'
import { DeleteFolder } from './delete-folder'
import useClipboardStore from "@/stores/clipboard"
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "../mobile-action-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslations } from "next-intl"
import { FolderVectorMenu } from './folder-vector-menu'
import { pasteIntoFolder } from './paste-into-folder'
import emitter from '@/lib/emitter'
import { LinkedFolder } from '@/lib/files'
import {
  collectFolderMarkdownPaths,
  deleteLocalFolderIfExists,
  deleteRemoteFolder,
  deleteVectorDocumentsByPaths,
  removeFolderFromTree,
} from './delete-folder-utils'
import {
  getFileManagerDragPath,
  getPathAfterMove,
  hasFileManagerDragData,
  moveFileManagerEntry,
  setFileManagerDragData,
} from '../file-dnd'
import { debugSyncPath } from "@/lib/sync/remote-file";
import { BatchSelectionContextMenu } from "../batch-selection-context-menu";
import type { FileSelectionEntry } from "../file-selection";
import { useShallow } from 'zustand/react/shallow';

export function FolderItem({
  item,
  focusSidebar,
  selectedPathSet,
  selectionEntries,
}: {
  item: DirTree
  focusSidebar?: () => void
  selectedPathSet: Set<string>
  selectionEntries: FileSelectionEntry[]
}) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [, setIsComposing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragExpandTimeoutRef = useRef<number | null>(null)

  const { assetsPath, fileManagerTextSize } = useSettingStore()
  const isMobile = useIsMobile()
  const t = useTranslations('article.file')

  // 检查路径是否在 skills 文件夹下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  // 根据文字大小映射图标大小
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5', 
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)

  const {
    activeFilePath,
    loadFileTree,
    setActiveFilePath,
    collapsibleList,
    setCollapsibleList,
    loadCollapsibleFiles,
    fileTree,
    setFileTree,
    vectorIndexedFiles,
    showKnowledgeBaseStatus,
    moveLocalEntry,
    syncOpenTabsForPathChange,
    cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder,
    selectedFilePaths,
    setSelectedFilePaths,
    clearSelectedFilePaths,
  } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    loadFileTree: state.loadFileTree,
    setActiveFilePath: state.setActiveFilePath,
    collapsibleList: state.collapsibleList,
    setCollapsibleList: state.setCollapsibleList,
    loadCollapsibleFiles: state.loadCollapsibleFiles,
    fileTree: state.fileTree,
    setFileTree: state.setFileTree,
    vectorIndexedFiles: state.vectorIndexedFiles,
    showKnowledgeBaseStatus: state.showKnowledgeBaseStatus,
    moveLocalEntry: state.moveLocalEntry,
    syncOpenTabsForPathChange: state.syncOpenTabsForPathChange,
    cleanTabsByDeletedFile: state.cleanTabsByDeletedFile,
    cleanTabsByDeletedFolder: state.cleanTabsByDeletedFolder,
    selectedFilePaths: state.selectedFilePaths,
    setSelectedFilePaths: state.setSelectedFilePaths,
    clearSelectedFilePaths: state.clearSelectedFilePaths,
  })))
  const { setClipboardItem, clipboardItem, clipboardItems, clipboardOperation } = useClipboardStore()

  const path = computedParentPath(item)
  const cacheTree = cloneDeep(fileTree)
  const currentFolder = getCurrentFolder(path, cacheTree)
  const parentFolder = currentFolder?.parent

  // 检查文件夹是否被剪切
  const isCut = clipboardOperation === 'cut' && clipboardItems.some(entry => entry.path === path)
  const isSelected = selectedPathSet.has(path)
  const useSelectionMenu = isSelected && selectionEntries.length > 1

  // 计算文件夹的向量状态
  const folderVectorStatus = useMemo(() => {
    let totalCount = 0
    let loadedIndexedCount = 0

    function countFiles(node: DirTree) {
      if (!node.children) {
        // 如果是文件（没有 children）
        if (node.name.endsWith('.md')) {
          totalCount++
          if (vectorIndexedFiles.has(computedParentPath(node))) {
            loadedIndexedCount++
          }
        }
        return
      }

      // 递归计算子节点
      node.children.forEach(child => countFiles(child))
    }

    countFiles(item)
    const pathPrefix = `${path}/`
    const indexedCount = Array.from(vectorIndexedFiles.keys())
      .filter(filePath => filePath.startsWith(pathPrefix))
      .length

    return {
      totalCount,
      indexedCount: totalCount > 0 ? loadedIndexedCount : indexedCount,
      hasVector: indexedCount > 0 || loadedIndexedCount > 0,
      isComplete: totalCount > 0 && loadedIndexedCount === totalCount
    }
  }, [item, path, vectorIndexedFiles])

  // 渲染文件夹的向量状态图标
  const renderFolderVectorIcon = () => {
    if (!showKnowledgeBaseStatus || isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus
    const vectorStatus = folderVectorStatus

    if (status === 'calculating') {
      return (
        <div className="mr-2 flex shrink-0 items-center">
          <LoaderCircle className={`${iconSize} shrink-0 animate-spin`} />
        </div>
      )
    } else if (status === 'completed' || vectorStatus.hasVector) {
      return (
        <div className="mr-2 flex shrink-0 items-center">
          <span className={`text-xs text-muted-foreground ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`}>
            {vectorStatus.totalCount > 0
              ? `${vectorStatus.indexedCount}/${vectorStatus.totalCount}`
              : vectorStatus.indexedCount}
          </span>
          <Database className={`${iconSize} ml-1 shrink-0 text-muted-foreground ${vectorStatus.isComplete ? 'opacity-100' : 'opacity-60'}`} />
        </div>
      )
    }
    return null
  }

  // 移动端处理函数
  function handleNewFile() {
    // 创建临时文件节点，并将其设为编辑状态
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // 如果文件夹中已经有一个空名称的文件，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return;
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
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
      };
      currentFolder.children?.unshift(newFile);
      setFileTree(cacheTree);
    }
  }

  function handleNewFolder() {
    // 创建临时文件夹节点
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // 如果文件夹中已经有一个空名称的文件夹，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isDirectory)) {
      return;
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFolder: DirTree = {
        name: '',
        isFile: false,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: true,
        isLocale: true,
        sha: '',
        children: []
      };
      currentFolder.children?.unshift(newFolder);
      setFileTree(cacheTree);
    }
  }

  function handleStartRename() {
    // 延迟执行，确保上下文菜单完全关闭
    setTimeout(() => {
      setIsEditing(true)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 只选中文件名，不包含扩展名
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  // 粘贴到文件夹
  async function handlePasteInFolder() {
    await pasteIntoFolder({
      clipboardItem,
      clipboardItems,
      clipboardOperation,
      folderPath: path,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
      cleanTabsByDeletedFile,
      cleanTabsByDeletedFolder,
    })
  }

  // 删除文件夹
  async function handleDeleteFolder() {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog')

      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      })

      if (!confirmed) return

      const markdownPaths = await collectFolderMarkdownPaths(path, item)
      const localDeleted = await deleteLocalFolderIfExists(path)
      const remoteResult = await deleteRemoteFolder(item, localDeleted)
      if (remoteResult.failedPaths.length > 0) {
        throw new Error(`Delete remote folder failed: ${remoteResult.failedPaths.join(', ')}`)
      }

      // 如果删除的文件夹包含当前活动文件，清除活动文件路径
      if (activeFilePath && activeFilePath.startsWith(path)) {
        setActiveFilePath('')
      }

      await cleanTabsByDeletedFolder(path)

      // 从文件树中移除该文件夹
      const cacheTree = cloneDeep(fileTree)
      removeFolderFromTree(cacheTree, path)
      setFileTree(cacheTree)

      // 删除向量数据库中该文件夹下所有文件的记录
      try {
        await deleteVectorDocumentsByPaths(markdownPaths, path)
      } catch (error) {
        console.error('删除文件夹向量数据失败:', error)
      }

      toast({ title: t('context.deleteSuccess') })
    } catch (error) {
      console.error('Delete folder failed:', error)
      toast({
        title: t('context.deleteFailed'),
        variant: 'destructive'
      })
    }
  }

  // 优化的输入处理，支持输入法
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value)
  }, [])

  // 输入法合成开始
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 输入法合成结束
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    setName(e.currentTarget.value)
  }, [])

  // 创建或修改文件夹名称
  async function handleRename() {
    const nextName = name
    setName(nextName)

    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()

    // 修改文件夹名称
    if (nextName && nextName !== item.name && item.name !== '') {
      // 更新缓存树中的名称
      if (parentFolder && parentFolder.children) {
        const folderIndex = parentFolder?.children?.findIndex(folder => folder.name === item.name)
        if (folderIndex !== undefined && folderIndex !== -1) {
          parentFolder.children[folderIndex].name = nextName
          parentFolder.children[folderIndex].isEditing = false
        }
      } else {
        const folderIndex = cacheTree.findIndex(folder => folder.name === item.name)
        cacheTree[folderIndex].name = nextName
        cacheTree[folderIndex].isEditing = false
      }
      
      // 获取源路径和目标路径
      const oldPathOptions = await getFilePathOptions(path)
      const parentPath = path.split('/').slice(0, -1).join('/')
      const targetRelativePath = joinRelativePath(parentPath, nextName)
      const newPathOptions = await getFilePathOptions(targetRelativePath)
      debugSyncPath('folder.renamePlan', {
        originalName: item.name,
        enteredName: nextName,
        sourcePath: path,
        targetRelativePath,
      })
      
      // 根据工作区类型执行重命名操作
      if (workspace.isCustom) {
        await rename(oldPathOptions.path, newPathOptions.path)
      } else {
        await rename(oldPathOptions.path, newPathOptions.path, { 
          newPathBaseDir: BaseDirectory.AppData, 
          oldPathBaseDir: BaseDirectory.AppData 
        })
      }
      const { renameVectorDocumentsByPrefix } = await import('@/db/vector')
      await renameVectorDocumentsByPrefix(path, targetRelativePath)
    } else {
      // 已有文件夹但名称未改变，直接取消编辑
      if (item.name !== '' && nextName === item.name) {
        setIsEditing(false)
        return
      }

      // 新建文件夹
      if (nextName !== '') {
        // 检查文件夹是否已存在
        const newFolderPath = joinRelativePath(path, nextName)
        const pathOptions = await getFilePathOptions(newFolderPath)
        
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          toast({ title: '文件夹名已存在' })
          return
        } else {
          // 创建新文件夹
          if (workspace.isCustom) {
            await mkdir(pathOptions.path)
          } else {
            await mkdir(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          
          // 更新缓存树
          if (parentFolder && parentFolder.children) {
            const index = parentFolder.children?.findIndex(item => item.name === '')
            parentFolder.children[index].name = nextName
            parentFolder.children[index].isEditing = false
          } else {
            const index = cacheTree?.findIndex(item => item.name === '')
            cacheTree[index].name = nextName
            cacheTree[index].isEditing = false
          }
        }
      } else {
        // 处理空名称情况（取消新建）
        if (currentFolder?.parent) {
          const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
            currentFolder.parent?.children?.splice(index, 1)
          }
        } else {
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
        }
      }
    } 
    setIsEditing(false)
    setFileTree(cacheTree)
  }



  function clearDragExpandTimer() {
    if (dragExpandTimeoutRef.current !== null) {
      window.clearTimeout(dragExpandTimeoutRef.current)
      dragExpandTimeoutRef.current = null
    }
  }

  function scheduleDragExpand() {
    if (collapsibleList.includes(path) || dragExpandTimeoutRef.current !== null) {
      return
    }

    dragExpandTimeoutRef.current = window.setTimeout(async () => {
      dragExpandTimeoutRef.current = null
      await setCollapsibleList(path, true)
      await loadCollapsibleFiles(path)
    }, 450)
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    clearDragExpandTimer()
    const renamePath = getFileManagerDragPath(e.dataTransfer)

    try {
      if (renamePath) {
        const result = await moveFileManagerEntry(renamePath, path)

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

        if (!collapsibleList.includes(path)) {
          await setCollapsibleList(path, true)
        }

        const nextActiveFilePath = getPathAfterMove(activeFilePath, result.sourcePath, result.targetPath)
        if (nextActiveFilePath !== activeFilePath) {
          setActiveFilePath(nextActiveFilePath)
        }

        await syncOpenTabsForPathChange(result.sourcePath, result.targetPath)
      }
    } catch (error) {
      console.error('Move entry into folder failed:', error)
      toast({
        title: t('context.moveFailed'),
        variant: 'destructive',
      })
    } finally {
      clearDragExpandTimer()
      setIsDragging(false)
    }
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    scheduleDragExpand()
    setIsDragging(true)
  }

  function handleDragleave(e: React.DragEvent<HTMLDivElement>) {
    if (!hasFileManagerDragData(e.dataTransfer)) {
      return
    }

    e.preventDefault()
    e.stopPropagation()
    const nextTarget = e.relatedTarget as Node | null
    if (nextTarget && e.currentTarget.contains(nextTarget)) {
      return
    }

    clearDragExpandTimer()
    setIsDragging(false)
  }

  function handleDragStart(ev: React.DragEvent<HTMLDivElement>) {
    if (!item.isLocale || isEditing) {
      ev.preventDefault()
      return
    }

    ev.stopPropagation()
    setFileManagerDragData(ev.dataTransfer, path)
  }

  function handleDragEnd() {
    clearDragExpandTimer()
    setIsDragging(false)
  }

  async function handleSelectFolder() {
    // 检查是否真的是目录（防止误将文件当作目录处理）
    if (!item.isDirectory) {
      return
    }

    // 让文件管理器获得焦点，以便响应快捷键
    focusSidebar?.()

    const folderName = path.split('/').pop() || path
    const folderDocPath = `${path}/${folderName}.md`
    const { getWorkspacePath } = await import('@/lib/workspace')
    const { appDataDir, join } = await import('@tauri-apps/api/path')
    const workspace = await getWorkspacePath()
    const folderDocAbsolutePath = workspace.isCustom
      ? await join(workspace.path, folderDocPath)
      : await join(await appDataDir(), 'article', folderDocPath)
    const hasFolderDocument = await exists(folderDocAbsolutePath)

    // 设置选中状态：若存在同名文件夹文档，则直接打开该 Markdown
    await setActiveFilePath(hasFolderDocument ? folderDocPath : path)

    // 自动展开文件夹（如果未展开）
    if (!collapsibleList.includes(path)) {
      await setCollapsibleList(path, true)
    }

    // 加载文件夹内容
    await loadCollapsibleFiles(path)

    if (hasFolderDocument) {
      return
    }

    // 触发文件夹选择事件
    let fullPath: string
    if (workspace.isCustom) {
      const pathParts = path.split('/')
      fullPath = workspace.path + '/' + pathParts.join('/')
    } else {
      fullPath = path
    }

    // 计算文件夹中的文件数量
    const { collectMarkdownFiles } = await import('@/lib/files')
    const files = await collectMarkdownFiles(path)

    // 获取向量索引状态
    const indexedCount = files.filter(f =>
      vectorIndexedFiles.has(f.path)
    ).length

    // 只有在有索引文件时才触发关联事件
    if (indexedCount > 0) {
      // 触发事件
      emitter.emit('folderSelected', {
        name: folderName,
        path: fullPath,
        relativePath: path,
        fileCount: files.length,
        indexedCount: indexedCount
      } as LinkedFolder)
    }
  }

  function handleFolderClick(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault()
      e.stopPropagation()
      focusSidebar?.()
      setSelectedFilePaths(
        isSelected
          ? selectedFilePaths.filter(selectedPath => selectedPath !== path)
          : [...selectedFilePaths, path]
      )
      return
    }

    clearSelectedFilePaths()
    void handleSelectFolder()
  }

  function handleFolderContextMenu(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation()
    focusSidebar?.()
    if (!isSelected) {
      setSelectedFilePaths([path])
    }
  }



  function handleEditEnd() {
    if (currentFolder?.parent) {
      const index = currentFolder?.parent?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.parent?.children) {
        currentFolder.parent?.children?.splice(index, 1)
      }
    } else {
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
    }
    setFileTree(cacheTree)
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  useEffect(() => {
    return () => {
      if (dragExpandTimeoutRef.current !== null) {
        window.clearTimeout(dragExpandTimeoutRef.current)
      }
    }
  }, [])

  // 监听文件管理器统一快捷键触发的自定义事件
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFolder()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 粘贴到当前文件夹
      if (customEvent.detail.targetPath === path) {
        handlePasteInFolder()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFolder, handlePasteInFolder])

  // 获取当前平台（用于显示快捷键）
  const [currentPlatform, setCurrentPlatform] = useState<'macos' | 'windows' | 'linux' | 'unknown'>('unknown')

  useEffect(() => {
    const detectPlatform = async () => {
      try {
        const { platform } = await import('@tauri-apps/plugin-os')
        const p = platform()
        if (p === 'macos') {
          setCurrentPlatform('macos')
        } else if (p === 'windows') {
          setCurrentPlatform('windows')
        } else if (p === 'linux') {
          setCurrentPlatform('linux')
        }
      } catch {
        setCurrentPlatform('unknown')
      }
    }
    detectPlatform()
  }, [])

  // 快捷键显示文本
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'
  const isExpanded = collapsibleList.includes(path)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-file-manager-item-path={path}
          data-file-manager-item-kind="folder"
          className={cn(
            "group file-manange-item flex min-w-0 select-none overflow-hidden",
            isDragging && "file-on-drop",
            path === activeFilePath && "active",
            isSelected && "file-selected"
          )}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e)}
          onDragOver={e => handleDragOver(e)}
          onDragLeave={(e) => handleDragleave(e)}
          onClick={handleFolderClick}
          onContextMenu={handleFolderContextMenu}
        >
          <button
            type="button"
            data-file-manager-toggle
            className="ml-1 inline-flex shrink-0 items-center justify-center bg-transparent"
            onClick={async (e) => {
              e.stopPropagation()
              const nextExpanded = !isExpanded
              await setCollapsibleList(path, nextExpanded)
              if (nextExpanded) {
                await loadCollapsibleFiles(path)
              }
            }}
          >
            <ChevronRight
              className={cn(
                "transition-transform size-4",
                isExpanded && "rotate-90"
              )}
            />
          </button>
            {
              isEditing ?
                <>
                  {
                    item.isLocale ?
                      <Folder className={`${iconSize} shrink-0`} /> :
                      <FolderDown className={`${iconSize} shrink-0`} />
                  }
                  <Input
                    ref={inputRef}
                    className={`h-5 min-w-0 flex-1 rounded-sm text-${fileManagerTextSize} px-1 font-normal mr-1`}
                    value={name}
                    onBlur={handleRename}
                    onChange={handleInputChange}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}
                    onKeyDown={(e) => {
                      // 阻止删除快捷键冒泡到全局快捷键处理器
                      if (e.key === 'Backspace' || e.key === 'Delete') {
                        e.stopPropagation()
                      }
                      if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                        handleRename()
                      } else if (e.code === 'Escape') {
                        handleEditEnd()
                      }
                    }}
                  />
                </> :
                <div
                  className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex min-w-0 flex-1 items-center justify-between gap-1 overflow-hidden select-none`}
                >
                  <div
                    data-file-manager-drag-handle
                    draggable={!isMobile && item.isLocale && !isEditing}
                    onDragStart={handleDragStart}
                    className="relative flex min-w-0 flex-1 cursor-default select-none items-center gap-1 overflow-hidden"
                  >
                    {item.loading ? (
                      <Loader2 className={`${iconSize} shrink-0 animate-spin text-primary`} />
                    ) : isSkillsFolder(item.name) ? (
                      <Sparkles className={`${iconSize} shrink-0 text-primary`} />
                    ) : collapsibleList.includes(path) ? (
                      assetsPath === item.name ? <FolderOpenDot className={`${iconSize} shrink-0`} /> : (!item.isLocale ? <FolderDown className={`${iconSize} shrink-0`} /> : (item.sha ? <FolderUp className={`${iconSize} shrink-0`} /> : <FolderOpen className={`${iconSize} shrink-0`} />))
                    ) : (
                      assetsPath === item.name ? <FolderDot className={`${iconSize} shrink-0`} /> : (!item.isLocale ? <FolderDown className={`${iconSize} shrink-0`} /> : (item.sha ? <FolderUp className={`${iconSize} shrink-0`} /> : <Folder className={`${iconSize} shrink-0`} />))
                    )}
                    <span className={`text-${fileManagerTextSize} min-w-0 flex-1 truncate ${item.loading ? 'text-muted-foreground' : ''}`}>{item.name}</span>
                  </div>
                  {/* 向量状态指示器 - 放在最右侧，skills 文件夹及其子内容不显示 */}
                  {renderFolderVectorIcon()}
                  {isMobile && (
                    <MobileActionMenu className="ml-1">
                      <MobileMenuItem onClick={handleNewFile} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFile')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={handleNewFolder} disabled={!!item.sha && !item.isLocale}>
                        {t('context.newFolder')}
                      </MobileMenuItem>
                      <MobileMenuItem onClick={() => {}}>
                        {t('context.viewDirectory')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <MobileMenuItem disabled>
                        {t('context.cut')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled>
                        {t('context.copy')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled>
                        {t('context.paste')}
                      </MobileMenuItem>
                      <MobileSeparator />
                      <UploadFolder item={item} mobile />
                      <DownloadFolder item={item} mobile />
                      <MobileSeparator />
                      <MobileMenuItem onClick={handleStartRename} disabled={!!item.sha && !item.isLocale}>
                        {t('context.rename')}
                      </MobileMenuItem>
                      <MobileMenuItem disabled className="text-red-600">
                        {t('context.delete')}
                      </MobileMenuItem>
                    </MobileActionMenu>
                  )}
                </div>
            }
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {useSelectionMenu ? (
          <BatchSelectionContextMenu entries={selectionEntries} modKey={modKey} deleteKey={deleteKey} />
        ) : (
          <>
            <NewFile item={item} />
            <NewFolder item={item} />
            <ViewDirectory item={item} />
            <ContextMenuSeparator />
            {/* skills 文件夹及其子内容不显示知识库选项 */}
            {!isInSkillsFolder(path) && (
              <>
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    <Database className="mr-2 h-4 w-4" />
                    {t('context.knowledgeBase')}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent>
                    <FolderVectorMenu item={item} />
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSeparator />
              </>
            )}
            <CutFolder item={item} shortcut={`${modKey}X`} />
            <CopyFolder item={item} shortcut={`${modKey}C`} />
            <DuplicateFolder item={item} />
            <PasteInFolder item={item} shortcut={`${modKey}V`} />
            <ContextMenuSeparator />
            <UploadFolder item={item} />
            <DownloadFolder item={item} />
            <ContextMenuSeparator />
            <RenameFolder item={item} onStartRename={handleStartRename} shortcut={renameKey} />
            <DeleteFolder item={item} shortcut={deleteKey} />
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
