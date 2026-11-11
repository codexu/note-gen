'use client'

import { MobileEditor, type MobileEditorHandle } from './mobile-editor'
import { MobileFileBrowser } from './custom-header'
import { EditorHeader } from './editor-header'
import useArticleStore from '@/stores/article'
import { cn } from '@/lib/utils'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { editorPathsReferToSameFile, prepareActiveEditorDeactivation } from '@/lib/editor-deactivation'
import { useSelfHostedConflictStore } from '@/stores/self-hosted-conflicts'
import useChatStore from '@/stores/chat'
import useSettingStore from '@/stores/setting'
import useFileDeletionStore from '@/stores/file-deletion'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from 'next-intl'

type WritingView = 'files' | 'editor'

export function WritingScreen({ isActive }: { isActive: boolean }) {
  const pathname = usePathname()
  const t = useTranslations('article.file.context')
  const workspacePath = useSettingStore(state => state.workspacePath)
  const deletionProgress = useFileDeletionStore(state => (
    state.workspacePath === workspacePath ? state.progress : null
  ))
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const requestedConflictId = useSelfHostedConflictStore(state => state.requestedId)
  const initCollapsibleList = useArticleStore(state => state.initCollapsibleList)
  const initSortSettings = useArticleStore(state => state.initSortSettings)
  const [view, setView] = useState<WritingView>('files')
  const initializedRef = useRef(false)
  const wasWritingRouteRef = useRef(false)
  const editorRef = useRef<MobileEditorHandle>(null)
  const closingEditorRef = useRef(false)
  const isWritingRoute = pathname === '/mobile/writing'

  useEffect(() => {
    let cancelled = false
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement
      && activeElement.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    ) {
      activeElement.blur()
    }

    const initialize = async () => {
      await initCollapsibleList()
      await initSortSettings()
      if (cancelled) return
      initializedRef.current = true
      const restoredPath = useArticleStore.getState().activeFilePath
      setView(restoredPath ? 'editor' : 'files')
      if (isWritingRoute) {
        useChatStore.getState().setMobileActiveContexts({ articlePath: restoredPath || null })
      }
    }

    void initialize()
    return () => {
      cancelled = true
    }
  }, [initCollapsibleList, initSortSettings])

  useEffect(() => {
    const wasWritingRoute = wasWritingRouteRef.current
    wasWritingRouteRef.current = isWritingRoute

    if (!wasWritingRoute && isWritingRoute && initializedRef.current) {
      setView(activeFilePath ? 'editor' : 'files')
      useChatStore.getState().setMobileActiveContexts({ articlePath: activeFilePath || null })
    }
  }, [activeFilePath, isWritingRoute])

  useEffect(() => {
    if (!activeFilePath) {
      setView('files')
    }
  }, [activeFilePath])

  useEffect(() => {
    if (!requestedConflictId || !isWritingRoute) return
    const state = useSelfHostedConflictStore.getState()
    const conflict = state.conflicts.find(item => item.id === requestedConflictId)
    if (state.workspacePath === workspacePath && conflict
      && editorPathsReferToSameFile(activeFilePath, conflict.relativePath, conflict.localRoot)) {
      setView('editor')
      useChatStore.getState().setMobileActiveContexts({ articlePath: activeFilePath })
    }
  }, [activeFilePath, isWritingRoute, requestedConflictId, workspacePath])

  const closeEditor = useCallback(async () => {
    if (closingEditorRef.current) return

    const currentPath = useArticleStore.getState().activeFilePath
    if (!currentPath) {
      setView('files')
      return
    }

    const writingRoot = document.getElementById('mobile-writing')
    const activeElement = document.activeElement
    if (
      writingRoot
      && activeElement instanceof HTMLElement
      && writingRoot.contains(activeElement)
    ) {
      activeElement.blur()
    }
    if (!prepareActiveEditorDeactivation()) return

    closingEditorRef.current = true
    try {
      await editorRef.current?.flushPendingSave()
      await useArticleStore.getState().setActiveFilePath('', true, {
        deactivationAlreadyPrepared: true,
      })
      const chatState = useChatStore.getState()
      chatState.setLinkedResource(null)
      chatState.setLinkedResourcePreview(null)
      chatState.clearEditorSelectionQuote()
      chatState.setMobileActiveContexts({ articlePath: null })
      setView('files')
    } catch (error) {
      console.error('Failed to close the mobile editor:', error)
    } finally {
      closingEditorRef.current = false
    }
  }, [])

  // 安卓返回键：写作页的编辑器是同一路由内的视图切换，系统默认要么回到上一个路由、
  // 要么退出应用。编辑器打开期间接管返回键，让它和左上角返回按钮走同一条关闭流程；
  // 关闭后立即注销监听，返回键恢复系统默认行为。
  useEffect(() => {
    if (!isActive || view !== 'editor') return

    let disposed = false
    let unregister: (() => void) | null = null

    const listenToBackButton = async () => {
      try {
        const { addPluginListener, isTauri } = await import('@tauri-apps/api/core')
        if (!isTauri()) return
        const { platform } = await import('@tauri-apps/plugin-os')
        if (platform() !== 'android') return

        const listener = await addPluginListener('app', 'back-button', () => {
          void closeEditor()
        })
        if (disposed) {
          await listener.unregister()
          return
        }
        unregister = () => void listener.unregister()
      } catch (error) {
        console.error('Failed to intercept the Android back button in the mobile editor:', error)
      }
    }

    void listenToBackButton()

    return () => {
      disposed = true
      unregister?.()
    }
  }, [closeEditor, isActive, view])

  return (
    <div id="mobile-writing" className='w-full h-full min-h-0 flex flex-col overflow-clip'>
      {deletionProgress?.hasRemote ? (
        <div role="status" aria-live="polite" className="flex shrink-0 items-center gap-2 border-b bg-background px-4 py-2 text-xs text-muted-foreground">
          <Spinner aria-hidden="true" className="size-3.5 shrink-0 motion-reduce:animate-none" />
          <span>{t('deleting')}</span>
          <span className="ml-auto tabular-nums">{deletionProgress.completed}/{deletionProgress.total}</span>
        </div>
      ) : null}
      <div
        className={cn('min-h-0 flex-1', view !== 'files' && 'hidden')}
        aria-hidden={view !== 'files'}
      >
        <MobileFileBrowser
          active={isWritingRoute && view === 'files'}
          onOpenFile={() => {
            const path = useArticleStore.getState().activeFilePath
            useChatStore.getState().setMobileActiveContexts({ articlePath: path || null })
            setView('editor')
          }}
        />
      </div>
      <div
        className={cn('min-h-0 flex-1 flex-col overflow-clip', view === 'editor' ? 'flex' : 'hidden')}
        aria-hidden={view !== 'editor'}
      >
        <EditorHeader onBack={closeEditor} />
        <div className='min-h-0 flex-1 overflow-clip'>
          <MobileEditor ref={editorRef} isActive={isActive && view === 'editor'} />
        </div>
      </div>
    </div>
  )
}
