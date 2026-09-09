'use client'

import useArticleStore from '@/stores/article'
import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
import { TipTapEditor } from './tiptap-editor'
import { Outline } from './outline'
import { Loader2, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import emitter, { type Events } from '@/lib/emitter'
import {
  DEFAULT_OUTLINE_WIDTH,
  getFileOutlineOpenStoreKey,
  normalizeOutlineWidth,
  OUTLINE_WIDTH_STORE_KEY,
} from '@/lib/outline-preferences'
import { Store } from '@tauri-apps/plugin-store'
import { useShallow } from 'zustand/react/shallow'
import useSettingStore from '@/stores/setting'
import {
  editorPathsReferToSameFile,
  getCurrentEditorWorkspaceRoot,
  prepareActiveEditorDeactivationDurably,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'
import { writeSelfHostedWorkspaceText } from '@/lib/self-hosted-sync/files'

interface MdEditorProps {
  tabContentsRef: RefObject<Record<string, string>>
  filePath: string
  isActive: boolean
  disabled?: boolean
}

export function MdEditor({ tabContentsRef, filePath, isActive, disabled = false }: MdEditorProps) {
  const {
    saveCurrentArticle,
    isPulling,
    activeFilePath,
    currentArticle,
    justPulledFile,
    articleLoading,
    setTabDisposition,
  } = useArticleStore(useShallow((state) => ({
    saveCurrentArticle: state.saveCurrentArticle,
    isPulling: state.isPulling,
    activeFilePath: state.activeFilePath,
    currentArticle: state.currentArticle,
    justPulledFile: state.justPulledFile,
    articleLoading: state.loading,
    setTabDisposition: state.setTabDisposition,
  })))
  const {
    enableOutline,
    outlinePosition,
    workspacePath,
  } = useSettingStore(useShallow((state) => ({
    enableOutline: state.enableOutline,
    outlinePosition: state.outlinePosition,
    workspacePath: state.workspacePath,
  })))

  const t = useTranslations('article.file.sync')
  const tEditor = useTranslations('editor')
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const isCreatingFileRef = useRef(false)
  // Track loaded state per file path - Bug fix: make this cleanup possible
  const loadedPathsRef = useRef<Set<string>>(new Set())
  // Bug fix: Track which file's content is currently in currentArticle
  const currentArticlePathRef = useRef<string | null>(null)
  // Bug fix: Track if editor content has been initialized to prevent saving empty content
  const contentInitializedRef = useRef(false)
  // Bug fix: Track expected content to detect if editor is behind
  const expectedContentRef = useRef<string | null>(null)
  // Outline panel state
  const [outlineOpen, setOutlineOpen] = useState(enableOutline)
  const [outlineWidth, setOutlineWidth] = useState(DEFAULT_OUTLINE_WIDTH)
  // State for editor instance (to trigger re-render when ready)
  const [editorInstance, setEditorInstance] = useState<any>(null)
  // Track if editor has called onEditorReady (meaning it's fully initialized)
  const [editorReady, setEditorReady] = useState(false)
  // AI streaming state
  const [aiStreaming, setAiStreaming] = useState(false)
  const terminateRef = useRef<(() => void) | undefined>(undefined)

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

  // Keep the wrapper-owned tab cache aligned with snapshots applied by the
  // sync runtime. TipTap handles the same path-scoped event itself; this
  // listener only updates the surrounding React/store caches and must not
  // schedule another save.
  useEffect(() => {
    let disposed = false
    let syncEventSequence = 0
    const currentWorkspaceRootPromise = getCurrentEditorWorkspaceRoot()
      .catch(() => null)
    const handleSyncContentUpdated = async (event: Events['sync-content-updated']) => {
      if (!event || typeof event.content !== 'string') return

      const eventSequence = ++syncEventSequence
      const cachedContentBeforeRootCheck = tabContentsRef.current?.[filePath]
      if (event.workspaceRoot) {
        const currentWorkspaceRoot = await currentWorkspaceRootPromise
        if (
          disposed
          || eventSequence !== syncEventSequence
          || !currentWorkspaceRoot
          || !workspaceRootsReferToSameLocation(
            currentWorkspaceRoot,
            event.workspaceRoot,
          )
          || (
            tabContentsRef.current?.[filePath] !== cachedContentBeforeRootCheck
            && tabContentsRef.current?.[filePath] !== event.content
          )
        ) {
          return
        }
      }
      if (!editorPathsReferToSameFile(event.path, filePath, event.workspaceRoot)) {
        return
      }

      expectedContentRef.current = event.content
      contentInitializedRef.current = true
      const targetIsActive = editorPathsReferToSameFile(
        useArticleStore.getState().activeFilePath,
        filePath,
        event.workspaceRoot,
      )
      currentArticlePathRef.current = targetIsActive ? filePath : null
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = event.content
      }
      if (targetIsActive) {
        useArticleStore.getState().setCurrentArticle(event.content)
      }
      setInitialContent(event.content)
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated)
    return () => {
      disposed = true
      emitter.off('sync-content-updated', handleSyncContentUpdated)
    }
  }, [filePath, tabContentsRef, workspacePath])

  // Listen for AI streaming state
  useEffect(() => {
    const handleAiStreaming = (event: { isStreaming: boolean; targetFilePath?: string; terminate?: () => void }) => {
      // Check if this event is for the current file
      if (event.targetFilePath && event.targetFilePath !== filePath) {
        // Event is for a different file, ignore
        return
      }
      if (!event.targetFilePath && !isActive) return
      setAiStreaming(event.isStreaming)
      if (event.terminate) {
        terminateRef.current = event.terminate
      }
    }
    emitter.on('editor-ai-streaming', handleAiStreaming as any)
    return () => {
      emitter.off('editor-ai-streaming', handleAiStreaming as any)
    }
  }, [filePath, isActive])

  // Check store for AI generating state on mount and when filePath changes
  useEffect(() => {
    // Check if this file is currently being generated by AI
    const { aiGeneratingFilePath, aiTerminateFn } = useArticleStore.getState()
    if (aiGeneratingFilePath === filePath) {
      setAiStreaming(true)
      if (aiTerminateFn) {
        terminateRef.current = aiTerminateFn
      }
    }
  }, [filePath])

  const loadOutlineWidth = useCallback(async () => {
    const store = await Store.load('store.json')
    setOutlineWidth(normalizeOutlineWidth(await store.get(OUTLINE_WIDTH_STORE_KEY)))
  }, [])

  useEffect(() => {
    loadOutlineWidth()
  }, [loadOutlineWidth])

  useEffect(() => {
    if (!isActive) return

    loadOutlineWidth()
  }, [isActive, loadOutlineWidth])

  useEffect(() => {
    let disposed = false
    const loadOutlineOpen = async () => {
      const store = await Store.load('store.json')
      const storedValue = await store.get<boolean>(getFileOutlineOpenStoreKey(workspacePath, filePath))
      if (!disposed) setOutlineOpen(typeof storedValue === 'boolean' ? storedValue : enableOutline)
    }
    void loadOutlineOpen()
    return () => { disposed = true }
  }, [enableOutline, filePath, workspacePath])

  const handleToggleOutline = useCallback(() => {
    setOutlineOpen(current => {
      const next = !current
      void Store.load('store.json').then(async store => {
        await store.set(getFileOutlineOpenStoreKey(workspacePath, filePath), next)
        await store.save()
      })
      return next
    })
  }, [filePath, workspacePath])

  const handleOutlineWidthChange = useCallback((width: number) => {
    setOutlineWidth(normalizeOutlineWidth(width))
  }, [])

  const handleOutlineWidthCommit = useCallback(async (width: number) => {
    const normalizedWidth = normalizeOutlineWidth(width)
    setOutlineWidth(normalizedWidth)
    const store = await Store.load('store.json')
    await store.set(OUTLINE_WIDTH_STORE_KEY, normalizedWidth)
  }, [])

  // Resolve initial content from the shared tab cache, the store's active file,
  // or the file itself. Split groups can restore several files at once, while
  // the article store intentionally has only one globally active document.
  useEffect(() => {
    if (!filePath || loadedPathsRef.current.has(filePath)) return
    let disposed = false

    // Bug fix: Check cache first
    if (tabContentsRef.current && tabContentsRef.current[filePath] !== undefined) {
      setInitialContent(tabContentsRef.current[filePath])
      loadedPathsRef.current.add(filePath)
      contentInitializedRef.current = true
      return
    }

    const { activeFilePath: storeActivePath } = useArticleStore.getState()
    if (storeActivePath === filePath) {
      if (articleLoading) return
      setInitialContent(currentArticle)
      if (tabContentsRef.current) {
        tabContentsRef.current[filePath] = currentArticle
      }
      loadedPathsRef.current.add(filePath)
      contentInitializedRef.current = true
      return
    }

    void (async () => {
      try {
        const [{ readTextFile }, { getFilePathOptions }] = await Promise.all([
          import('@tauri-apps/plugin-fs'),
          import('@/lib/workspace'),
        ])
        const pathOptions = await getFilePathOptions(filePath)
        const content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        if (disposed || loadedPathsRef.current.has(filePath)) return
        if (tabContentsRef.current) tabContentsRef.current[filePath] = content
        loadedPathsRef.current.add(filePath)
        contentInitializedRef.current = true
        setInitialContent(content)
      } catch {
        // The active-file store may still be resolving a remote pull. Its
        // currentArticle subscription below remains the fallback in that case.
      }
    })()

    return () => {
      disposed = true
    }
  }, [articleLoading, currentArticle, filePath, tabContentsRef])

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
      // Mark as initialized so that subsequent saves are allowed
      contentInitializedRef.current = true

      // Fix cursor jump: Only trigger remote content update if this is a remote pull
      // This prevents unnecessary setContent during local saves
      if (justPulledFile) {
        emitter.emit('editor-content-from-remote', { content: currentArticle })
      }
    } else if (currentArticle === '' && isThisFile && initialContent === '') {
      // Genuinely empty file - hide loading and mark as initialized
      // Bug fix: Set expected content for empty file
      expectedContentRef.current = ''
      // Mark as initialized for empty files so user can start typing
      contentInitializedRef.current = true
    }
  }, [currentArticle, filePath, tabContentsRef, initialContent, justPulledFile])

  // Handle content changes for this editor's document. Split groups may edit a
  // document before the global active-file transition has finished, so always
  // use the explicit path override instead of relying on the singleton state.
  const handleContentChange = useCallback((content: string) => {
    // Ignore only the initial empty update; clearing an initialized document must still save.
    if (content.length === 0 && !contentInitializedRef.current) {
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

    if (filePath) {
      const previewTab = useArticleStore.getState().openTabs.find(tab => (
        tab.path === filePath && tab.preview
      ))
      if (previewTab) void setTabDisposition(previewTab.id, 'regular')
      saveCurrentArticle(content, filePath)
    } else if (!filePath && !isCreatingFileRef.current) {
      // Auto-create untitled file
      isCreatingFileRef.current = true
      void createUntitledFile(content).finally(() => {
        isCreatingFileRef.current = false
      })
    }
  }, [saveCurrentArticle, setTabDisposition, filePath, tabContentsRef])

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
      const articleState = useArticleStore.getState()
      if (!await prepareActiveEditorDeactivationDurably(articleState.activeFilePath)) {
        return
      }
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
      if (await writeSelfHostedWorkspaceText(path, content)) {
        // Rust journal already persisted the file.
      } else if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      await articleState.setActiveFilePath(
        path,
        true,
        { deactivationAlreadyPrepared: true },
      )
      articleState.setCurrentArticle(content)
      await articleState.loadFileTree()
    } catch {
    }
  }

  const isThisEditorPulling = isPulling && activeFilePath === filePath

  // Loading state - wait for content to be loaded
  // 如果正在从远程拉取，优先显示拉取遮罩
  if (isThisEditorPulling) {
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

  // Never mount the editor against a temporary empty string.
  const showContent = initialContent !== null
  if (!showContent) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const showOutline = outlineOpen && !isThisEditorPulling && editorReady && editorInstance
  const renderOutline = () => editorInstance ? (
    <Outline
      editor={editorInstance}
      isOpen={outlineOpen}
      position={outlinePosition}
      documentKey={filePath}
      width={outlineWidth}
      onWidthChange={handleOutlineWidthChange}
      onWidthCommit={handleOutlineWidthCommit}
    />
  ) : null

  return (
    <div id={isActive ? "onboarding-target-editor-content" : undefined} className="relative flex h-full w-full flex-1 min-w-0">
      {/* Pull loading overlay */}
      {isThisEditorPulling && (
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

      {showOutline && outlinePosition === 'left' ? renderOutline() : null}

      <div className="relative h-full min-w-0 flex-1">
      {/* Editor - initialContent only set once on mount */}
      <TipTapEditor
        initialContent={initialContent ?? ''}
        onChange={handleContentChange}
        placeholder={tEditor('placeholder')}
        activeFilePath={filePath}
        onEditorReady={handleEditorReady}
          outlineOpen={outlineOpen}
        outlinePosition={outlinePosition}
        outlineWidth={outlineWidth}
        outlineInLayout
        onToggleOutline={handleToggleOutline}
        applyLayoutPreferences
        isActive={isActive}
        editable={!disabled && !isThisEditorPulling && !aiStreaming}
        autoScroll={aiStreaming}
        showOverlay={aiStreaming}
        onTerminate={() => {
          if (terminateRef.current) {
            terminateRef.current()
          } else {
            // If terminateRef is not set, emit abort event
            emitter.emit('abort-ai-streaming')
          }}
        }
      />
      </div>

      {showOutline && outlinePosition === 'right' ? renderOutline() : null}
    </div>
  )
}

export default MdEditor
