'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TipTapEditor } from './tiptap-editor'
import { Loader2, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'

interface MdEditorProps {
  tabContentsRef: RefObject<Record<string, string>>
  filePath: string
}

export function MdEditor({ tabContentsRef, filePath }: MdEditorProps) {
  const {
    saveCurrentArticle,
    isPulling,
    setCurrentArticle,
    activeFilePath,
    currentArticle
  } = useArticleStore()

  const t = useTranslations('article.file.sync')
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path
  const loadedPathsRef = useRef<Set<string>>(new Set())
  // Force re-render when content needs update
  const contentVersionRef = useRef(0)

  // Load content from cache or disk - only on first mount per file
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return

    // Check cache first
    if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
      setInitialContent(tabContentsRef.current[filePath])
      loadedPathsRef.current.add(filePath)
      setIsLoading(false)
      return
    }

    // Check store content as fallback (set by readArticle for remote files)
    if (currentArticle && currentArticle.length > 0) {
      setInitialContent(currentArticle)
      loadedPathsRef.current.add(filePath)
      setIsLoading(false)
      return
    }

    // Load from disk directly (avoid using global currentArticle)
    const loadContent = async () => {
      setIsLoading(true)
      try {
        const { readTextFile } = await import('@tauri-apps/plugin-fs')
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')

        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(filePath)

        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        setInitialContent(content)
        // Update cache
        if (tabContentsRef.current) {
          tabContentsRef.current[filePath] = content
        }
      } catch {
        // File doesn't exist, start with empty content
        setInitialContent('')
      } finally {
        setIsLoading(false)
      }
    }

    loadContent()
    loadedPathsRef.current.add(filePath)
  }, [filePath, tabContentsRef, currentArticle])

  // Subscribe to currentArticle changes (for remote file pull results)
  useEffect(() => {
    // 当 currentArticle 有内容且不是初始的空值时，更新编辑器
    if (currentArticle && currentArticle.length > 0 && currentArticle !== initialContent) {
      setInitialContent(currentArticle)
      // Update cache
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
      setIsLoading(false)
      contentVersionRef.current++
    }
  }, [currentArticle, filePath, tabContentsRef, initialContent])

  // Handle content changes - only save if this is the active file
  const handleContentChange = useCallback((content: string) => {
    // Update cache
    if (filePath && tabContentsRef.current) {
      tabContentsRef.current[filePath] = content
    }

    // Save to disk - only if this is the active file
    if (filePath && filePath === activeFilePath) {
      saveCurrentArticle(content)
    } else if (!filePath && !isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      createUntitledFile(content)
      isCreatingFileRef.current = false
    }
  }, [saveCurrentArticle, filePath, tabContentsRef, activeFilePath])

  // Handle quote to chat - get selected text and emit event
  const handleQuoteToChat = useCallback(() => {
    // Get the selected text from the active editor
    emitter.emit('get-quote-from-editor')
  }, [])

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
    } catch {
    }
  }

  // Loading state - wait for content to be loaded
  // 如果 currentArticle 已经有内容，直接显示（拉取完成）
  const showContent = (currentArticle && currentArticle.length > 0) || initialContent !== null
  if (isLoading && !showContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col">
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
        initialContent={initialContent || ''}
        onChange={handleContentChange}
        placeholder="开始写作..."
        activeFilePath={activeFilePath}
        onQuoteToChat={handleQuoteToChat}
      />
    </div>
  )
}

export default MdEditor
