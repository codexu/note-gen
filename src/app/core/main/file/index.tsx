'use client'

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { FileManager } from "./file-manager"
import useArticleStore from "@/stores/article"
import useClipboardStore from "@/stores/clipboard"
import { isMobileDevice } from "@/lib/check"
import { platform } from "@tauri-apps/plugin-os"
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target"
import { flattenFileTree, getFileSelectionEntries, toClipboardItems } from "./file-selection"
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceFileWatcher } from './use-workspace-file-watcher'
import useSettingStore from '@/stores/setting'
import { getWritingAssetsFolderName } from '@/lib/writing-assets-path'
import { filterFileTreeByVisibility } from './file-tree-model'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

/**
 * 统一的文件管理器快捷键处理
 * 只有当文件管理器区域获得焦点时才响应快捷键
 */
function useFileManagerShortcuts() {
  const { activeFilePath, fileTree, selectedFilePaths, showCloudFiles, showAssetsFolders } = useArticleStore(useShallow((state) => ({
    activeFilePath: state.activeFilePath,
    fileTree: state.fileTree,
    selectedFilePaths: state.selectedFilePaths,
    showCloudFiles: state.showCloudFiles,
    showAssetsFolders: state.showAssetsFolders,
  })))
  const assetsPath = useSettingStore(state => state.assetsPath)
  const assetsFolderName = getWritingAssetsFolderName(assetsPath)
  const visibleFileTree = useMemo(() => filterFileTreeByVisibility(fileTree, {
    showCloudFiles,
    showAssetsFolders,
    assetsFolderName,
  }), [assetsFolderName, fileTree, showAssetsFolders, showCloudFiles])
  const { setClipboardItem, setClipboardItems } = useClipboardStore()
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isFocused, setIsFocused] = useState(false)
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

  // 处理快捷键
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // 移动端不处理快捷键
    if (isMobileDevice()) {
      return
    }

    const editableTarget = isEditableKeyboardTarget(e.target)
    if (editableTarget) {
      return
    }

    // 只有文件管理器有焦点时才处理
    if (!isFocused) {
      return
    }

    const selectedEntries = getFileSelectionEntries(visibleFileTree, selectedFilePaths)
    const allSelectedEntriesAreLocal = selectedEntries.every(entry => entry.isLocale)
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

    if (selectedEntries.length === 0 && (!activeItem || !activeItem.isLocale)) {
      return
    }

    // 复制: Cmd+C / Ctrl+C
    if (modPressed && e.key === 'c') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        if (allSelectedEntriesAreLocal) {
          setClipboardItems(toClipboardItems(selectedEntries), 'copy')
        }
      } else if (activeItem) {
        setClipboardItem({
          path: activeItem.path,
          name: activeItem.name,
          isDirectory: activeItem.isDirectory,
          sha: activeItem.sha,
          isLocale: activeItem.isLocale
        }, 'copy')
      }
      return
    }

    // 剪切: Cmd+X / Ctrl+X
    if (modPressed && e.key === 'x') {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        if (allSelectedEntriesAreLocal) {
          setClipboardItems(toClipboardItems(selectedEntries), 'cut')
        }
      } else if (activeItem) {
        setClipboardItem({
          path: activeItem.path,
          name: activeItem.name,
          isDirectory: activeItem.isDirectory,
          sha: activeItem.sha,
          isLocale: activeItem.isLocale
        }, 'cut')
      }
      return
    }

    // 粘贴: Cmd+V / Ctrl+V
    if (modPressed && e.key === 'v') {
      e.preventDefault()
      e.stopPropagation()
      // 触发粘贴操作（通过事件或直接调用）
      const pasteTargetPath = selectedEntries.length === 1 ? selectedEntries[0].path : activeItem?.path
      if (pasteTargetPath) {
        const event = new CustomEvent('filemanager-paste', { detail: { targetPath: pasteTargetPath } })
        window.dispatchEvent(event)
      }
      return
    }

    // 删除: macOS 使用 Backspace，Windows/Linux 使用 Delete
    const isDeleteKey = currentPlatform === 'macos'
      ? e.key === 'Backspace'
      : e.key === 'Delete'

    if (isDeleteKey) {
      e.preventDefault()
      e.stopPropagation()
      if (selectedEntries.length > 0) {
        window.dispatchEvent(new CustomEvent('filemanager-delete-selection'))
      } else if (activeItem) {
        const event = new CustomEvent('filemanager-delete', { detail: { item: activeItem } })
        window.dispatchEvent(event)
      }
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
  }, [isFocused, getActiveItem, isModKey, currentPlatform, selectedFilePaths, setClipboardItem, setClipboardItems, visibleFileTree])

  // 注册全局快捷键
  useEffect(() => {
    if (isMobileDevice() || currentPlatform === 'unknown') {
      return
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown, currentPlatform])

  // 焦点处理
  const handleFocusIn = useCallback((e: FocusEvent) => {
    // 检查焦点是否在文件管理器区域内
    if (sidebarRef.current && sidebarRef.current.contains(e.target as Node)) {
      setIsFocused(true)
    }
  }, [])

  const handleFocusOut = useCallback((e: FocusEvent) => {
    // 检查焦点是否移到了 sidebar 外部
    // relatedTarget 是即将获得焦点的元素
    const newFocusedElement = e.relatedTarget as Node

    if (sidebarRef.current && newFocusedElement) {
      // 如果新焦点元素不在 sidebar 内，才设置 isFocused = false
      if (!sidebarRef.current.contains(newFocusedElement)) {
        setIsFocused(false)
      }
    } else if (!newFocusedElement) {
      // 如果 relatedTarget 为 null（焦点移到了文档外），设置 isFocused = false
      setIsFocused(false)
    }
    // 否则，焦点还在 sidebar 内，保持 isFocused = true
  }, [])

  useEffect(() => {
    if (sidebarRef.current) {
      sidebarRef.current.addEventListener('focusin', handleFocusIn)
      sidebarRef.current.addEventListener('focusout', handleFocusOut)

      return () => {
        sidebarRef.current?.removeEventListener('focusin', handleFocusIn)
        sidebarRef.current?.removeEventListener('focusout', handleFocusOut)
      }
    }
  }, [handleFocusIn, handleFocusOut])

  // 主动设置焦点到文件管理器
  const focusSidebar = useCallback(() => {
    setIsFocused(true)
    // 使用 requestAnimationFrame 确保 DOM 更新后再设置焦点
    requestAnimationFrame(() => {
      sidebarRef.current?.focus()
    })
  }, [])

  return { sidebarRef, isFocused, focusSidebar }
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
