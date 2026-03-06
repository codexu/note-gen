'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TipTapEditor } from './tiptap-editor'
import { Outline } from './outline'
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
  const tEditor = useTranslations('editor')
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path - Bug fix: make this cleanup possible
  const loadedPathsRef = useRef<Set<string>>(new Set())
  // Bug fix: Track which file's content is currently in currentArticle
  const currentArticlePathRef = useRef<string | null>(null)
  // Bug fix: Track if editor content has been initialized to prevent saving empty content
  const contentInitializedRef = useRef(false)
  // Bug fix: Use ref to track loading state since state might be stale in callbacks
  const isLoadingRef = useRef(true)
  // Bug fix: Track expected content to detect if editor is behind
  const expectedContentRef = useRef<string | null>(null)
  // Outline panel state
  const [outlineOpen, setOutlineOpen] = useState(false)
  // State for editor instance (to trigger re-render when ready)
  const [editorInstance, setEditorInstance] = useState<any>(null)
  // Track if editor has called onEditorReady (meaning it's fully initialized)
  const [editorReady, setEditorReady] = useState(false)

  // Bug fix: Listen for file close events to clean up loaded state
  useEffect(() => {
    const handleFileClose = (event: { path: string }) => {
      if (event.path === filePath) {
        loadedPathsRef.current.delete(filePath)
      }
    }
    emitter.on('editor-file-close', handleFileClose as any)
    return () => {
      emitter.off('editor-file-close', handleFileClose as any)
      // Also clean up on component unmount
      loadedPathsRef.current.delete(filePath)
    }
  }, [filePath])

  // Bug fix: Listen for article opened events to track which file currentArticle belongs to
  useEffect(() => {
    const handleArticleOpened = (event: { path: string; content: string }) => {
      if (event.path === filePath) {
        currentArticlePathRef.current = filePath
      } else {
        // Bug fix: If a different file was opened, clear the reference
        currentArticlePathRef.current = null
      }
    }
    emitter.on('article-opened', handleArticleOpened as any)
    return () => {
      emitter.off('article-opened', handleArticleOpened as any)
    }
  }, [filePath])

  // Load content from cache or disk - only on first mount per file
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return

    // Bug fix: Check cache first
    if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
      setInitialContent(tabContentsRef.current[filePath])
      loadedPathsRef.current.add(filePath)
      setIsLoading(false)
      isLoadingRef.current = false
      return
    }

    // Bug fix: Also check if currentArticle belongs to this file (for store initialization)
    // This handles the case where app restarts and currentArticle is already set
    if (currentArticle && currentArticle.length > 0) {
      // Check if the current active file path matches
      const { activeFilePath: storeActivePath } = useArticleStore.getState()
      if (storeActivePath === filePath) {
        setInitialContent(currentArticle)
        loadedPathsRef.current.add(filePath)
        setIsLoading(false)
        isLoadingRef.current = false
        return
      }
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

        // Bug fix: Only set isLoading(false) if we have actual content
        // This prevents flickering when isLoading=false with empty content
        setInitialContent(content)
        // Update cache
        if (tabContentsRef.current) {
          tabContentsRef.current[filePath] = content
        }
        if (content) {
          setIsLoading(false)
          isLoadingRef.current = false
          // Mark content as initialized since we have actual content from disk
          // This is safe because the content came from disk, not an empty initialization
          contentInitializedRef.current = true
        }
        // If empty, wait for subscription
      } catch {
        // File doesn't exist
        setInitialContent('')
        // Don't set isLoading(false) here - wait for subscription
        // This prevents showing empty content briefly before subscription updates
      }
    }

    loadContent()
    loadedPathsRef.current.add(filePath)
  }, [filePath, tabContentsRef, currentArticle])

  // Subscribe to currentArticle changes (for remote file pull results)
  // Bug fix: Only update if currentArticle belongs to this file
  useEffect(() => {
    // Bug fix: Only process if currentArticle belongs to this file
    // Also check against store's activeFilePath as fallback
    const { activeFilePath: storeActivePath } = useArticleStore.getState()
    const isThisFile = currentArticlePathRef.current === filePath || storeActivePath === filePath

    if (currentArticle && currentArticle.length > 0 && currentArticle !== initialContent && isThisFile) {
      // Bug fix: Set expected content BEFORE updating initialContent
      // This ensures handleContentChange knows what to expect
      expectedContentRef.current = currentArticle
      setInitialContent(currentArticle)
      // Update cache
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
      // Bug fix: Don't set isLoadingRef.current = false here!
      // The editor needs to initialize first, and handleContentChange will
      // only save if content matches expectedContentRef
      // We'll set isLoading(false) but isLoadingRef remains true until editor confirms
      setIsLoading(false)
      // Mark as initialized so that subsequent saves are allowed
      contentInitializedRef.current = true
    } else if (currentArticle === '' && isThisFile && initialContent === '') {
      // Genuinely empty file - hide loading and mark as initialized
      // Bug fix: Set expected content for empty file
      expectedContentRef.current = ''
      setIsLoading(false)
      isLoadingRef.current = false
      // Mark as initialized for empty files so user can start typing
      contentInitializedRef.current = true
    }
  }, [currentArticle, filePath, tabContentsRef, initialContent])

  // Handle content changes - only save if this is the active file
  const handleContentChange = useCallback((content: string) => {
    // Bug fix: Don't save if content is empty
    if (content.length === 0) {
      return
    }
    // Bug fix: If expected content is set and incoming content doesn't match, skip save
    // This prevents saving stale content during editor initialization race
    // But clear expectedContentRef so subsequent edits can be saved
    if (expectedContentRef.current !== null && content !== expectedContentRef.current) {
      expectedContentRef.current = null
    }
    // Bug fix: Skip if content matches what we just loaded (first onUpdate after init)
    // The editor's onUpdate fires after setContent, so we skip that initial call
    if (expectedContentRef.current !== null && content === expectedContentRef.current) {
      // Clear expectedContentRef after first matching update
      expectedContentRef.current = null
      return
    }
    // Mark as initialized when we receive valid content
    if (!contentInitializedRef.current) {
      contentInitializedRef.current = true
    }
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

  // Handle editor ready - store editor instance
  const handleEditorReady = useCallback((editor: any) => {
    setEditorInstance(editor)
    setEditorReady(true)
  }, [])

  // Reset editor instance and ready state when file changes
  useEffect(() => {
    setEditorInstance(null)
    setEditorReady(false)
  }, [filePath])

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
  // 如果正在从远程拉取，优先显示拉取遮罩
  if (isPulling) {
    return (
      <div className="flex-1 flex items-center justify-center">
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
    )
  }

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
    <div className="flex-1 relative w-full h-full flex flex-row">
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
        placeholder={tEditor('placeholder')}
        activeFilePath={activeFilePath}
        onQuoteToChat={handleQuoteToChat}
        onEditorReady={handleEditorReady}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen(prev => !prev)}
        editable={!isPulling}
      />

      {/* Outline Panel - right sidebar - 只有在打开时才渲染 */}
      {outlineOpen && !isPulling && editorReady && editorInstance && (
        <Outline
          editor={editorInstance}
          isOpen={outlineOpen}
        />
      )}
    </div>
  )
}

export default MdEditor
