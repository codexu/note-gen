'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import useArticleStore, { findFolderInTree } from '@/stores/article'
import emitter from '@/lib/emitter'
import { MdEditor } from './markdown/md-editor-wrapper'
import { TabBar, TabInfo } from './tab-bar'
import { ImageEditor } from './image/image-editor'
import { EmptyState } from './empty-state'
import { FolderView } from './folder'
import { UnsupportedFile } from './unsupported-file'

export function EditorLayout() {
  const {
    activeFilePath,
    fileTree,
    setActiveFilePath,
    openTabs,
    activeTabId,
    setOpenTabs,
    setActiveTabId,
    addTab,
    removeTab,
    initOpenTabs,
    initShowCloudFiles
  } = useArticleStore()

  const tabContentsRef = useRef<Record<string, string>>({})
  const [tabs, setLocalTabs] = useState<TabInfo[]>([])
  const [localActiveTabId, setLocalActiveTabId] = useState<string>('')
  const tabsRef = useRef<TabInfo[]>([])
  const isInitializedRef = useRef(false)

  // Initialize tabs from store on mount
  useEffect(() => {
    if (!isInitializedRef.current) {
      isInitializedRef.current = true
      initOpenTabs()
      initShowCloudFiles()
    }
  }, [initOpenTabs, initShowCloudFiles])

  // Sync with store
  useEffect(() => {
    setLocalTabs(openTabs)
    tabsRef.current = openTabs
  }, [openTabs])

  useEffect(() => {
    setLocalActiveTabId(activeTabId)
  }, [activeTabId])

  // Helper to check if path is a folder
  const isFolderPath = useCallback((path: string): boolean => {
    const fileName = path.split('/').pop() || ''
    return !fileName.includes('.')
  }, [])

  // Get item type based on path
  const getItemType = useCallback((path: string): 'markdown' | 'image' | 'folder' | 'unknown' => {
    if (!path) return 'unknown'

    // First check if it's a folder
    const folder = findFolderInTree(path, fileTree)
    if (folder) return 'folder'

    // Check file extension
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return 'unknown'

    if (['md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg', 'gitignore', 'env', 'example', 'template'].includes(extension)) {
      return 'markdown'
    }
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
      return 'image'
    }
    return 'unknown'
  }, [fileTree])

  // Check if file/folder exists
  const checkPathExists = useCallback(async (path: string): Promise<boolean> => {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const pathOptions = await getFilePathOptions(path)

    try {
      if (workspace.isCustom) {
        return await exists(pathOptions.path)
      } else {
        return await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      return false
    }
  }, [])

  // Check if path is a folder in fileTree
  const isFolderInTree = useCallback((path: string): boolean => {
    return !!findFolderInTree(path, fileTree)
  }, [fileTree])

  // Check if path is a file in fileTree
  const isFileInTree = useCallback((path: string): boolean => {
    const extension = path.split('.').pop()?.toLowerCase()
    if (!extension) return false

    const validExtensions = ['md', 'txt', 'markdown', 'py', 'js', 'ts', 'jsx', 'tsx', 'css', 'scss', 'less', 'html', 'xml', 'json', 'yaml', 'yml', 'sh', 'bash', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sql', 'rb', 'php', 'vue', 'svelte', 'astro', 'toml', 'ini', 'conf', 'cfg', 'gitignore', 'env', 'example', 'template', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg']

    if (!validExtensions.includes(extension)) return false

    // Check if file exists in fileTree
    const checkInTree = (items: typeof fileTree): boolean => {
      for (const item of items) {
        if (item.isFile && path.includes(item.name)) return true
        if (item.children) {
          if (checkInTree(item.children)) return true
        }
      }
      return false
    }
    return checkInTree(fileTree)
  }, [fileTree])

  // Clean up tabs that no longer exist
  useEffect(() => {
    const cleanupTabs = async () => {
      if (tabs.length === 0) return

      const validTabs: TabInfo[] = []
      let hasInvalid = false

      for (const tab of tabs) {
        if (tab.isFolder) {
          // Check if folder exists in fileTree
          if (isFolderInTree(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
          }
        } else {
          // Check if file exists in fileTree or on disk
          if (isFileInTree(tab.path) || await checkPathExists(tab.path)) {
            validTabs.push(tab)
          } else {
            hasInvalid = true
            // Clean up content cache
            delete tabContentsRef.current[tab.path]
          }
        }
      }

      if (hasInvalid) {
        setOpenTabs(validTabs)
      }
    }

    cleanupTabs()
  }, [fileTree, tabs.length, isFolderInTree, isFileInTree, checkPathExists, setOpenTabs])

  // Initialize and update tabs when active path changes
  useEffect(() => {
    if (!activeFilePath) return

    const name = activeFilePath.split('/').pop() || activeFilePath
    const isFolder = isFolderPath(activeFilePath)

    // Check if tab already exists
    const existingTab = tabsRef.current.find(tab => tab.path === activeFilePath)

    if (existingTab) {
      // Set as active
      if (activeTabId !== existingTab.id) {
        setActiveTabId(existingTab.id)
      }
    } else {
      // Add new tab
      const newTab: TabInfo = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        path: activeFilePath,
        name: name,
        isFolder: isFolder
      }
      addTab(newTab)
    }
  }, [activeFilePath, activeTabId, isFolderPath, addTab, setActiveTabId])

  // Handle tab switch
  const handleTabSwitch = useCallback((path: string) => {
    if (path) {
      setActiveFilePath(path)
    }
  }, [setActiveFilePath])

  // Handle new tab (create untitled file)
  const handleNewTab = useCallback(async () => {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let filePath = fileName

      while (true) {
        const pathOptions = await getFilePathOptions(fileName)
        let fileExists = false
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        if (!fileExists) break
        fileName = `untitled-${counter}.md`
        filePath = fileName
        counter++
      }

      const pathOptions = await getFilePathOptions(filePath)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, '')
      } else {
        await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
      }

      setActiveFilePath(filePath)
      useArticleStore.getState().loadFileTree()
    } catch (error) {
      console.error('Create untitled file error:', error)
    }
  }, [setActiveFilePath])

  // Handle close tab
  const handleCloseTab = useCallback((closedPath: string) => {
    // Bug fix: Emit event to clean up loadedPathsRef in MdEditor
    emitter.emit('editor-file-close', { path: closedPath })
    delete tabContentsRef.current[closedPath]

    // Bug fix: Get closedTab from the current ref value (updated synchronously in useEffect)
    const closedTab = tabsRef.current.find(t => t.path === closedPath)
    if (closedTab) {
      removeTab(closedTab.id)
    }

    // Bug fix: Only switch active tab if we're closing the currently active tab
    // Use localActiveTabId which is kept in sync via useEffect
    if (closedTab && localActiveTabId === closedTab.id) {
      if (tabsRef.current.length > 1) {
        const currentIndex = tabsRef.current.findIndex(t => t.id === closedTab.id)
        const targetTab = tabsRef.current[Math.max(0, currentIndex - 1)] || tabsRef.current[tabsRef.current.length - 1]
        setActiveTabId(targetTab.id)
        setActiveFilePath(targetTab.path)
      } else {
        setActiveTabId('')
        setActiveFilePath('')
      }
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close other tabs
  const handleCloseOtherTabs = useCallback((keepPath: string) => {
    const tabsToRemove = tabsRef.current.filter(t => t.path !== keepPath)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    const keptTab = tabsRef.current.find(t => t.path === keepPath)
    if (keptTab && localActiveTabId !== keptTab.id) {
      setActiveTabId(keptTab.id)
      setActiveFilePath(keptTab.path)
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close all tabs
  const handleCloseAllTabs = useCallback(() => {
    tabsRef.current.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
    setActiveTabId('')
    setActiveFilePath('')
  }, [removeTab, setActiveTabId, setActiveFilePath])

  // Handle close left tabs
  const handleCloseLeftTabs = useCallback((rightPath: string) => {
    const rightIndex = tabsRef.current.findIndex(t => t.path === rightPath)
    const tabsToRemove = tabsRef.current.slice(0, rightIndex)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })

    // Update active tab if needed
    if (rightIndex > 0) {
      const rightTab = tabsRef.current[rightIndex]
      if (rightTab && localActiveTabId !== rightTab.id) {
        setActiveTabId(rightTab.id)
        setActiveFilePath(rightTab.path)
      }
    }
  }, [localActiveTabId, removeTab, setActiveTabId, setActiveFilePath])

  // Handle close right tabs
  const handleCloseRightTabs = useCallback((leftPath: string) => {
    const leftIndex = tabsRef.current.findIndex(t => t.path === leftPath)
    const tabsToRemove = tabsRef.current.slice(leftIndex + 1)

    tabsToRemove.forEach(tab => {
      delete tabContentsRef.current[tab.path]
      removeTab(tab.id)
    })
  }, [removeTab])

  // Render content panel for a tab
  const renderContentPanel = useCallback((tab: TabInfo, isActive: boolean) => {
    const itemType = getItemType(tab.path)

    return (
      <div
        key={tab.id}
        className="w-full h-[calc(100%-48px)]"
        style={{ display: isActive ? 'flex' : 'none' }}
      >
        {itemType === 'folder' && (
          <FolderView folderPath={tab.path} />
        )}
        {itemType === 'image' && (
          <ImageEditor filePath={tab.path} />
        )}
        {itemType === 'markdown' && (
          <MdEditor
            key={tab.id}
            tabContentsRef={tabContentsRef}
            filePath={tab.path}
          />
        )}
        {itemType === 'unknown' && (
          <UnsupportedFile filePath={tab.path} />
        )}
      </div>
    )
  }, [getItemType])

  // No tabs - show empty state
  if (tabs.length === 0) {
    return (
      <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
        <TabBar
          tabs={tabs}
          activeTabId=""
          onTabSwitch={handleTabSwitch}
          onNewTab={handleNewTab}
          onCloseTab={handleCloseTab}
          onCloseOtherTabs={handleCloseOtherTabs}
          onCloseAllTabs={handleCloseAllTabs}
          onCloseLeftTabs={handleCloseLeftTabs}
          onCloseRightTabs={handleCloseRightTabs}
        />
        <EmptyState />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTabId={localActiveTabId}
        onTabSwitch={handleTabSwitch}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={handleCloseOtherTabs}
        onCloseAllTabs={handleCloseAllTabs}
        onCloseLeftTabs={handleCloseLeftTabs}
        onCloseRightTabs={handleCloseRightTabs}
      />

      {/* Content panels - all rendered, only active one visible */}
      {tabs.map(tab => renderContentPanel(tab, tab.id === localActiveTabId))}
    </div>
  )
}
