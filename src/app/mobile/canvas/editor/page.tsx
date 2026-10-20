'use client'

import dynamic from 'next/dynamic'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Redo2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'

import { MobileCanvasPage } from '@/app/mobile/canvas/page'
import { Button } from '@/components/ui/button'
import { SwipeBack, type SwipeBackHandle } from '@/components/ui/swipe-back'
import { MobileBackButton } from '@/components/mobile-back-button'
import emitter from '@/lib/emitter'
import useCanvasStore from '@/stores/canvas'
import useChatStore from '@/stores/chat'

const CanvasEditor = dynamic(
  () => import('@/app/core/main/canvas/canvas-editor').then(module => module.CanvasEditor),
  { ssr: false }
)

interface MobileCanvasEditorScreenProps {
  canvasId: string
}

export function MobileCanvasEditorScreen({ canvasId }: MobileCanvasEditorScreenProps) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTranslations('canvas')
  const project = useCanvasStore(state => state.projects.find(item => item.id === canvasId))
  const openProject = useCanvasStore(state => state.openProject)
  const setActiveCanvasId = useCanvasStore(state => state.setActiveCanvasId)
  const setSelectionContext = useCanvasStore(state => state.setSelectionContext)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const swipeBackRef = useRef<SwipeBackHandle>(null)

  useEffect(() => {
    if (!canvasId) return
    void openProject(canvasId).then(openedProject => {
      const mobileContexts = useChatStore.getState().mobileActiveContexts
      if (!openedProject && mobileContexts.canvasId === canvasId) {
        setActiveCanvasId(null)
        setSelectionContext(null)
        useChatStore.getState().setMobileActiveContexts({ canvasId: null })
      }
    })
  }, [canvasId, openProject, setActiveCanvasId, setSelectionContext])

  useEffect(() => {
    if (!canvasId || pathname !== '/mobile/canvas/editor') return
    useChatStore.getState().setMobileActiveContexts({ canvasId })
  }, [canvasId, pathname])

  const closeEditor = useCallback(() => {
    setActiveCanvasId(null)
    setSelectionContext(null)
    useChatStore.getState().setMobileActiveContexts({ canvasId: null })
    router.push('/mobile/canvas')
    void Store.load('store.json').then(store => store.set('currentPage', '/mobile/canvas'))
  }, [router, setActiveCanvasId, setSelectionContext])

  const queryCanUndoRedo = useCallback(() => {
    if (!canvasId) return
    emitter.emit('canvas-can-undo-redo', {
      canvasId,
      resolve: can => {
        setCanUndo(can.undo)
        setCanRedo(can.redo)
      },
    })
  }, [canvasId])

  useEffect(() => {
    setCanUndo(false)
    setCanRedo(false)

    const handleUndoRedoChanged = ({
      canvasId: changedCanvasId,
      undo,
      redo,
    }: {
      canvasId: string
      undo: boolean
      redo: boolean
    }) => {
      if (changedCanvasId !== canvasId) return
      setCanUndo(undo)
      setCanRedo(redo)
    }

    emitter.on('canvas-undo-redo-changed', handleUndoRedoChanged)
    const frame = window.requestAnimationFrame(queryCanUndoRedo)

    return () => {
      window.cancelAnimationFrame(frame)
      emitter.off('canvas-undo-redo-changed', handleUndoRedoChanged)
    }
  }, [canvasId, queryCanUndoRedo])

  if (!canvasId) {
    return (
      <div className="flex size-full items-center justify-center text-sm text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  return (
    <SwipeBack
      ref={swipeBackRef}
      onBack={closeEditor}
      backdrop={<MobileCanvasPage preview />}
    >
      <div id="mobile-canvas-editor" className="flex h-full min-h-0 w-full flex-col bg-background">
        <header className="mobile-page-header flex shrink-0 items-center gap-2 border-b px-2">
          <MobileBackButton
            label={t('manager.title')}
            onClick={() => swipeBackRef.current?.back()}
          />
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
            {project?.title || t('loading')}
          </h1>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('undo')}
            disabled={!canUndo}
            onClick={() => emitter.emit('canvas-undo', { canvasId })}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('redo')}
            disabled={!canRedo}
            onClick={() => emitter.emit('canvas-redo', { canvasId })}
          >
            <Redo2 />
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <CanvasEditor canvasId={canvasId} mobile />
        </div>
      </div>
    </SwipeBack>
  )
}

export default function MobileCanvasEditorPage() {
  const searchParams = useSearchParams()
  return <MobileCanvasEditorScreen canvasId={searchParams.get('id') || ''} />
}
