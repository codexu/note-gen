'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { TipTapEditor } from '@/app/core/main/editor/markdown/tiptap-editor'
import type { Editor } from '@tiptap/react'
import { Loader2 } from 'lucide-react'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import emitter, { type Events } from '@/lib/emitter'
import {
  editorPathsReferToSameFile,
  getCurrentEditorWorkspaceRoot,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'

interface MobileEditorProps {
  onEditorReady?: (editor: Editor | null) => void
  isActive: boolean
}

export interface MobileEditorHandle {
  flushPendingSave: () => Promise<void>
}

export const MobileEditor = forwardRef<MobileEditorHandle, MobileEditorProps>(function MobileEditor(
  { onEditorReady, isActive },
  ref,
) {
  const tEditor = useTranslations('editor')
  const workspacePath = useSettingStore((state) => state.workspacePath)
  const {
    saveCurrentArticle,
    activeFilePath,
    currentArticle,
    loading: articleLoading,
    aiGeneratingFilePath,
    aiTerminateFn,
  } = useArticleStore()

  const aiStreaming = Boolean(activeFilePath && aiGeneratingFilePath === activeFilePath)
  const [content, setContent] = useState('')
  const [isLoading, setIsLoading] = useState(Boolean(activeFilePath))
  const [isEditorReady, setIsEditorReady] = useState(false)

  const activePathRef = useRef<string>('')
  const contentRef = useRef<string>('')
  const awaitingInitialContentRef = useRef(Boolean(activeFilePath))
  const savePromiseRef = useRef<Promise<void> | null>(null)

  // 监听 activeFilePath 变化
  useEffect(() => {
    if (activeFilePath && activeFilePath !== activePathRef.current) {
      activePathRef.current = activeFilePath
      awaitingInitialContentRef.current = true
      setIsLoading(true)
      setIsEditorReady(false)
    } else if (!activeFilePath && activePathRef.current) {
      activePathRef.current = ''
      awaitingInitialContentRef.current = false
      setContent('')
      contentRef.current = ''
      setIsLoading(false)
      setIsEditorReady(false)
    }
  }, [activeFilePath])

  // The article store owns the single disk read. Wait for its completed value so
  // large-document detection never runs against a temporary empty string.
  useEffect(() => {
    if (
      !activeFilePath
      || activePathRef.current !== activeFilePath
      || !awaitingInitialContentRef.current
      || articleLoading
    ) {
      return
    }

    awaitingInitialContentRef.current = false
    setContent(currentArticle)
    contentRef.current = currentArticle
    setIsLoading(false)
  }, [activeFilePath, articleLoading, currentArticle])

  // TipTap consumes this event to replace the visible document. Mirror the
  // accepted snapshot into the mobile wrapper as well, otherwise its stale
  // contentRef can be written back when the editor is closed.
  useEffect(() => {
    let disposed = false
    let syncEventSequence = 0
    const currentWorkspaceRootPromise = getCurrentEditorWorkspaceRoot()
      .catch(() => null)
    const handleSyncContentUpdated = async (event: Events['sync-content-updated']) => {
      if (!event || typeof event.content !== 'string') return

      const eventSequence = ++syncEventSequence
      const contentBeforeRootCheck = contentRef.current
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
            contentRef.current !== contentBeforeRootCheck
            && contentRef.current !== event.content
          )
        ) {
          return
        }
      }
      if (!editorPathsReferToSameFile(
        event.path,
        activePathRef.current,
        event.workspaceRoot,
      )) {
        return
      }

      awaitingInitialContentRef.current = false
      contentRef.current = event.content
      setContent(event.content)
      setIsLoading(false)
      if (editorPathsReferToSameFile(
        useArticleStore.getState().activeFilePath,
        event.path,
        event.workspaceRoot,
      )) {
        useArticleStore.getState().setCurrentArticle(event.content)
      }
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated)
    return () => {
      disposed = true
      emitter.off('sync-content-updated', handleSyncContentUpdated)
    }
  }, [workspacePath])

  // External editor replacements suppress TipTap's onChange. Keep the mobile
  // save snapshot current even when a stream arrives before TipTap mounts.
  useEffect(() => {
    const handleExternalContentUpdate = (nextContent: string) => {
      const targetPath = useArticleStore.getState().activeFilePath
      if (!targetPath || targetPath !== activePathRef.current) return
      awaitingInitialContentRef.current = false
      contentRef.current = nextContent
      setContent(nextContent)
      setIsLoading(false)
    }
    emitter.on('external-content-update', handleExternalContentUpdate)
    return () => emitter.off('external-content-update', handleExternalContentUpdate)
  }, [])

  // 保存文件
  const doSave = useCallback(async () => {
    if (savePromiseRef.current) {
      await savePromiseRef.current
    }

    const path = activePathRef.current
    const newContent = contentRef.current
    if (!path || !isEditorReady) return

    const savePromise = saveCurrentArticle(newContent, path)
    savePromiseRef.current = savePromise
    try {
      await savePromise
    } finally {
      if (savePromiseRef.current === savePromise) {
        savePromiseRef.current = null
      }
    }
  }, [isEditorReady, saveCurrentArticle])

  useImperativeHandle(ref, () => ({
    flushPendingSave: async () => {
      if (savePromiseRef.current) {
        await savePromiseRef.current
      }
      await doSave()
      const path = activePathRef.current
      if (path) await useArticleStore.getState().flushPendingArticleSave(path)
    },
  }), [doSave])

  // 处理内容变化
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent)
    contentRef.current = newContent

    // The article store already owns the 500ms debounce and path write gate.
    // Queue there immediately so remote writes can observe or drain it.
    void doSave()
  }, [doSave])

  // 处理编辑器就绪
  const handleEditorReady = useCallback(() => {
    setIsEditorReady(true)
  }, [])

  // 清理定时器
  useEffect(() => {
    return () => {
      onEditorReady?.(null)
    }
  }, [onEditorReady])

  // 显示加载状态
  if (isLoading || articleLoading || activeFilePath !== activePathRef.current) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col">
      <TipTapEditor
        initialContent={content}
        onChange={handleContentChange}
        placeholder={tEditor('placeholder')}
        activeFilePath={activeFilePath}
        onReady={handleEditorReady}
        onEditorReady={onEditorReady}
        mobileMode
        applyLayoutPreferences
        isActive={isActive}
        editable={!aiStreaming}
        autoScroll={aiStreaming}
        showOverlay={aiStreaming}
        onTerminate={() => aiTerminateFn?.()}
      />
    </div>
  )
})

export default MobileEditor
