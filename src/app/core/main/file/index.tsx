'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { FileManager } from "./file-manager"
import useArticleStore from "@/stores/article"
import useClipboardStore from "@/stores/clipboard"
import { isMobileDevice } from "@/lib/check"
import { platform } from "@tauri-apps/plugin-os"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import { flattenFileTree, getFileSelectionEntries, toClipboardItems } from "./file-selection"
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { pasteIntoFolder } from './folder-item/paste-into-folder'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceFileWatcher } from './use-workspace-file-watcher'
import useSettingStore from '@/stores/setting'
import { getWritingAssetsFolderName } from '@/lib/writing-assets-path'
import { filterFileTreeByVisibility } from './file-tree-model'
import { useFileDeletion } from './use-file-deletion'
import useFileDeletionStore, { isFileDeletionPending } from '@/stores/file-deletion'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

/**
 * 统一的文件管理器快捷键处理
 * 只有当文件管理器区域获得焦点时才响应快捷键
 */
function useFileManagerShortcuts() {
  const deleteEntries = useFileDeletion()
  const { activeFilePath, fileTree, selectedFilePaths, showCloudFiles, showAssetsFolders } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    selectedFilePaths: state.selectedFilePaths,
    showCloudFiles: state.showCloudFiles,
    showAssetsFolders: state.showAssetsFolders,
  })))
  const assetsPath = useSettingStore(state => state.assetsPath)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const pendingDeletionPaths = useFileDeletionStore(state => state.pendingPaths)
  const assetsFolderName = getWritingAssetsFolderName(assetsPath)
  const visibleFileTree = useMemo(() => filterFileTreeByVisibility(fileTree, {
    showCloudFiles,
    showAssetsFolders,
    assetsFolderName,
    isPathHidden: pendingDeletionPaths.length > 0
      ? path => isFileDeletionPending(path, workspacePath) : undefined,
  }), [assetsFolderName, fileTree, showAssetsFolders, showCloudFiles, pendingDeletionPaths, workspacePath])
  const { setClipboardItem, setClipboardItems } = useClipboardStore()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const t = useTranslations('article.file')
  const pastingRef = useRef(false)
  const sidebarRef = useRef<HTMLDivElement>(null)

  // 检测当前平台
  useEffect(() => {
    try {
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
  }, [])

  // 检查是否按下了正确的修饰键
  const isModKey = useCallback((e: KeyboardEvent): boolean => {
    if (currentPlatform === 'macos') {
      return e.metaKey && !e.ctrlKey
    } else {
      return e.ctrlKey && !e.metaKey
    }
  }, [currentPlatform])

  // 获取当前激活的 item（文件或文件夹）
  const getActiveItem = useCallback((): { path: string; isDirectory: boolean; isLocale: boolean; name: string; sha?: string } | null => {
    if (!activeFilePath) return null

    // 递归查找文件树中匹配的项
    function findInTree(tree: typeof visibleFileTree, targetPath: string): ReturnType<typeof getActiveItem> {
      const entry = flattenFileTree(tree).find(item => item.path === targetPath)
      if (!entry) return null
      return {
        path: entry.path,
        isDirectory: entry.isDirectory,
        isLocale: entry.isLocale,
        name: entry.name,
        sha: entry.sha
      }
    }

    return findInTree(visibleFileTree, activeFilePath)
  }, [activeFilePath, visibleFileTree])

  // 直接检查实际焦点，避免焦点状态与文件树 DOM 不同步。
  const canHandleEvent = useCallback((event: Event) => {
    const sidebar = sidebarRef.current
    return !isMobileDevice()
      && !event.defaultPrevented
      && !!sidebar
      && sidebar.contains(document.activeElement)
      && !isEditableKeyboardTarget(event.target)
  }, [])

  const handleClipboard = useCallback((event: Event, operation: 'copy' | 'cut' | 'paste') => {
    if (!canHandleEvent(event)) return

    const selectedEntries = getFileSelectionEntries(visibleFileTree, selectedFilePaths)
    const activeItem = getActiveItem()

    if (operation === 'paste') {
      const target = selectedEntries.length === 1 ? selectedEntries[0] : activeItem
      if (target && !target.isLocale) return

      event.preventDefault()
      event.stopPropagation()
      if (pastingRef.current) return
      const folderPath = !target ? '' : target.isDirectory
        ? target.path : target.path.split('/').slice(0, -1).join('/')
      pastingRef.current = true
      const clipboard = useClipboardStore.getState()
      void pasteIntoFolder({
        clipboardItem: clipboard.clipboardItem,
        clipboardItems: clipboard.clipboardItems,
        clipboardOperation: clipboard.clipboardOperation,
        folderPath,
        emptyToastTitle: t('clipboard.empty'),
        pastedToastTitle: t('clipboard.pasted'),
        pasteFailedToastTitle: t('clipboard.pasteFailed'),
        loadFileTree: useArticleStore.getState().loadFileTree,
        setClipboardItem,
      }).catch(error => {
        console.error('File manager paste failed:', error)
        toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' })
      }).finally(() => {
        pastingRef.current = false
      })
      return
    }

    if (selectedEntries.length > 0) {
      if (!selectedEntries.every(entry => entry.isLocale)) return
      setClipboardItems(toClipboardItems(selectedEntries), operation)
    } else if (activeItem?.isLocale) {
      setClipboardItem(activeItem, operation)
    } else {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    toast({ title: t(operation === 'copy' ? 'clipboard.copied' : 'clipboard.cut') })
  }, [canHandleEvent, getActiveItem, selectedFilePaths, setClipboardItem, setClipboardItems, t, visibleFileTree])

  // 处理快捷键
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!canHandleEvent(e) || e.isComposing) return

    const selectedEntries = getFileSelectionEntries(visibleFileTree, selectedFilePaths)
    const activeItem = getActiveItem()

    const modPressed = isModKey(e)

    // 全选: Cmd+A / Ctrl+A
    // 以最后选中的项目为锚点，选择它所在父文件夹下的全部直接子项。
    if (modPressed && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new CustomEvent('filemanager-select-all', {
        detail: {
          anchorPath: selectedEntries.at(-1)?.path ?? activeItem?.path ?? '',
        },
      }))
      return
    }

    // Run deletion directly: virtualized rows may not be mounted to receive events.
    const isDeleteKey = currentPlatform === 'macos' ? e.key === 'Backspace' : e.key === 'Delete'
    if (isDeleteKey) {
      e.preventDefault()
      e.stopPropagation()
      const entries = selectedEntries.length > 0 ? selectedEntries
        : getFileSelectionEntries(visibleFileTree, activeItem ? [activeItem.path] : [])
      void deleteEntries(entries)
      return
    }

    const key = e.key.toLowerCase()
    if (modPressed && !e.altKey && !e.shiftKey && (key === 'c' || key === 'x' || key === 'v')) {
      handleClipboard(e, key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste')
      return
    }

    if (selectedEntries.length === 0 && (!activeItem || !activeItem.isLocale)) {
      return
    }

    // 重命名: macOS 使用 Enter 键，Windows/Linux 使用 F2 键
    const isRenameKey = currentPlatform === 'macos'
      ? e.key === 'Enter'
      : e.key === 'F2'

    if (isRenameKey) {
      e.preventDefault()
      e.stopPropagation()
      const renamePath = selectedEntries.length === 1 ? selectedEntries[0].path : activeItem?.path
      if (renamePath && selectedEntries.length <= 1) {
        const event = new CustomEvent('filemanager-rename', { detail: { path: renamePath } })
        window.dispatchEvent(event)
      }
      return
    }
  }, [canHandleEvent, getActiveItem, isModKey, currentPlatform, selectedFilePaths, visibleFileTree, deleteEntries, handleClipboard])

  // 注册全局快捷键
  useEffect(() => {
    if (isMobileDevice() || currentPlatform === 'unknown') {
      return
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [handleKeyDown, currentPlatform])

  // 原生菜单可能直接触发剪贴板事件；已处理的 keydown 会取消默认行为，避免重复执行。
  useEffect(() => {
    if (isMobileDevice()) return
    const onCopy = (event: ClipboardEvent) => handleClipboard(event, 'copy')
    const onCut = (event: ClipboardEvent) => handleClipboard(event, 'cut')
    const onPaste = (event: ClipboardEvent) => handleClipboard(event, 'paste')
    window.addEventListener('copy', onCopy, true)
    window.addEventListener('cut', onCut, true)
    window.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('copy', onCopy, true)
      window.removeEventListener('cut', onCut, true)
      window.removeEventListener('paste', onPaste, true)
    }
  }, [handleClipboard])

  // 主动设置焦点到文件管理器
  const focusSidebar = useCallback(() => {
    sidebarRef.current?.focus({ preventScroll: true })
  }, [])

  return { sidebarRef, focusSidebar }
}

export function FileSidebar() {
  useWorkspaceFileWatcher()
  const {
    initCollapsibleList,
    initSortSettings,
    initShowCloudFiles,
    initShowAssetsFolders,
    initSyncStaticAssets,
    initShowKnowledgeBaseStatus,
  } = useArticleStore(useShallow((state) => ({
    initCollapsibleList: state.initCollapsibleList,
    initSortSettings: state.initSortSettings,
    initShowCloudFiles: state.initShowCloudFiles,
    initShowAssetsFolders: state.initShowAssetsFolders,
    initSyncStaticAssets: state.initSyncStaticAssets,
    initShowKnowledgeBaseStatus: state.initShowKnowledgeBaseStatus,
  })))
  const { sidebarRef, focusSidebar } = useFileManagerShortcuts()

  useEffect(() => {
    initCollapsibleList()
    initSortSettings()
    initShowCloudFiles()
    initShowAssetsFolders()
    initSyncStaticAssets()
    initShowKnowledgeBaseStatus()
  }, [])

  return (
    <div
      ref={sidebarRef}
      id="article-sidebar"
      className="flex h-full w-full flex-col bg-background text-foreground outline-none"
      tabIndex={-1}
    >
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileManager focusSidebar={focusSidebar} showSearch={false} />
      </div>
    </div>
  )
}
