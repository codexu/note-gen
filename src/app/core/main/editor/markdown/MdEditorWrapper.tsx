'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef } from 'react'
import { TipTapEditor } from './TipTapEditor'
import { TabBar } from './TabBar'
import { Loader2, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function MdEditor() {
  const {
    saveCurrentArticle,
    loading,
    isPulling,
    activeFilePath,
    setCurrentArticle,
    readArticle
  } = useArticleStore()

  const t = useTranslations('article.file.sync')
  const [localContent, setLocalContent] = useState('')
  const tabContentsRef = useRef<Record<string, string>>({})
  const isCreatingFileRef = useRef(false)
  const activeFilePathRef = useRef(activeFilePath)

  // Sync activeFilePath to ref
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  // Initialize content from store (for initial load)
  useEffect(() => {
    if (activeFilePath && !tabContentsRef.current[activeFilePath]) {
      // Will be loaded via readArticle in the file switch effect
    }
  }, [activeFilePath])

  // Handle content changes
  const handleContentChange = useCallback((content: string) => {
    setLocalContent(content)

    // Also update cache
    if (activeFilePathRef.current) {
      tabContentsRef.current[activeFilePathRef.current] = content
    }

    // Content is now stored as Markdown
    if (activeFilePathRef.current) {
      saveCurrentArticle(content)
    } else if (!isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      createUntitledFile(content)
      isCreatingFileRef.current = false
    }
  }, [saveCurrentArticle])

  // Auto-create untitled.md file
  async function createUntitledFile(content: string) {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let filePath = fileName

      // Check if file exists
      while (true) {
        const pathOptions = await getFilePathOptions(filePath)
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

      // Create file
      const pathOptions = await getFilePathOptions(filePath)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      setCurrentArticle(content)
      useArticleStore.getState().setActiveFilePath(filePath)
      useArticleStore.getState().loadFileTree()
    } catch (error) {
      console.error('Create untitled file error:', error)
    }
  }

  // Handle file switch
  useEffect(() => {
    if (!activeFilePath) {
      setLocalContent('')
      setCurrentArticle('')
    } else {
      // Check cache first
      if (tabContentsRef.current[activeFilePath] !== undefined) {
        setLocalContent(tabContentsRef.current[activeFilePath])
      } else {
        readArticle(activeFilePath)
      }
    }
  }, [activeFilePath, readArticle, setCurrentArticle])

  // Tab switching handler
  const handleTabSwitch = useCallback((path: string) => {
    // Cache current content before switching
    if (activeFilePathRef.current && localContent) {
      tabContentsRef.current[activeFilePathRef.current] = localContent
    }

    // Switch to new file
    if (path) {
      useArticleStore.getState().setActiveFilePath(path)
    }
  }, [localContent])

  // New tab handler
  const handleNewTab = useCallback(() => {
    // Cache current content
    if (activeFilePathRef.current && localContent) {
      tabContentsRef.current[activeFilePathRef.current] = localContent
    }

    // Create new untitled file
    createUntitledFile('')
  }, [localContent])

  // Close tab handler
  const handleCloseTab = useCallback((path: string) => {
    // Remove from cache
    delete tabContentsRef.current[path]
  }, [])

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col overflow-hidden">
      {/* Pull loading overlay */}
      {isPulling && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="relative">
              <Loader2 className="size-8 animate-spin" />
              <Download className="size-4 absolute inset-0 m-auto" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">{t('syncingRemote')}</p>
              <p className="text-xs mt-1">{t('pullingRemote')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <TabBar
        onTabSwitch={handleTabSwitch}
        onNewTab={handleNewTab}
        onCloseTab={handleCloseTab}
      />

      {/* Editor */}
      <TipTapEditor
        content={localContent}
        onChange={handleContentChange}
        placeholder="开始写作..."
      />
    </div>
  )
}

export default MdEditor
