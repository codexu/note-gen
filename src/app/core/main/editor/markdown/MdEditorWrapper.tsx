'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TipTapEditor } from './TipTapEditor'
import { Loader2, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface MdEditorProps {
  tabContentsRef: RefObject<Record<string, string>>
  filePath: string
}

export function MdEditor({ tabContentsRef, filePath }: MdEditorProps) {
  const {
    saveCurrentArticle,
    loading,
    isPulling,
    setCurrentArticle,
    readArticle
  } = useArticleStore()

  const t = useTranslations('article.file.sync')
  const [initialContent, setInitialContent] = useState('')
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path
  const loadedPathsRef = useRef<Set<string>>(new Set())

  // Load content from cache or disk - only on first mount per file
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return

    // Check cache first
    if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
      setInitialContent(tabContentsRef.current[filePath])
      loadedPathsRef.current.add(filePath)
      return
    }

    // Load from disk via store (handles AI context, sync, etc.)
    readArticle(filePath)
    loadedPathsRef.current.add(filePath)
  }, [filePath, tabContentsRef])

  // Handle content changes
  const handleContentChange = useCallback((content: string) => {
    // Update cache
    if (filePath && tabContentsRef.current) {
      tabContentsRef.current[filePath] = content
    }

    // Save to disk
    if (filePath) {
      saveCurrentArticle(content)
    } else if (!isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      createUntitledFile(content)
      isCreatingFileRef.current = false
    }
  }, [saveCurrentArticle, filePath, tabContentsRef])

  // Auto-create untitled.md file
  async function createUntitledFile(content: string) {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let path = fileName

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
        path = fileName
        counter++
      }

      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      setCurrentArticle(content)
      useArticleStore.getState().setActiveFilePath(path)
      useArticleStore.getState().loadFileTree()
    } catch (error) {
      console.error('Create untitled file error:', error)
    }
  }

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

      {/* Editor - initialContent only set once on mount */}
      <TipTapEditor
        initialContent={initialContent}
        onChange={handleContentChange}
        placeholder="开始写作..."
      />
    </div>
  )
}

export default MdEditor
