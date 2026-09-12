'use client'

import { Highlighter, MessageSquare, Palette, Plus, Square, SquarePen } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import {
  InteractiveMenu,
  type InteractiveMenuItem,
} from '@/components/ui/modern-mobile-menu'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { MobileRecordTools } from '@/components/mobile-record-tools'
import useRecordingStore from '@/stores/recording'
import emitter from '@/lib/emitter'
import useMarkStore from '@/stores/mark'
import useCanvasStore from '@/stores/canvas'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'

const OrganizeNotes = dynamic(
  () => import('@/app/core/main/mark/organize-notes').then(module => module.OrganizeNotes),
  { ssr: false },
)

type FootbarItem = InteractiveMenuItem & {
  url: string
  isQuickAction?: boolean
}

function RecordingDockIcon() {
  return (
    <span className="inline-flex size-5 items-center justify-center text-red-500">
      <Square className="size-4 animate-pulse fill-current" />
    </span>
  )
}

function formatRecordingDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function AppFootbar() {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations()
  const [quickActionOpen, setQuickActionOpen] = useState(false)
  const organizeRef = useRef<{ openOrganize: () => void }>(null)
  const pendingOrganizeRef = useRef(false)
  const { isRecording, recordingDuration } = useRecordingStore()
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const activeMarkId = useMarkStore(state => state.activeMarkId)
  const activeCanvasId = useCanvasStore(state => state.activeCanvasId)

  const items: FootbarItem[] = [
    {
      id: 'chat',
      label: t('navigation.mobileDock.chat'),
      url: '/mobile/chat',
      icon: MessageSquare,
    },
    {
      id: 'writing',
      label: t('navigation.mobileDock.write'),
      url: '/mobile/writing',
      icon: SquarePen,
    },
    {
      id: 'quick-action',
      label: isRecording
        ? formatRecordingDuration(recordingDuration)
        : t('navigation.mobileDock.quickRecord'),
      url: '#quick-action',
      icon: Plus,
      iconElement: isRecording ? <RecordingDockIcon /> : undefined,
      isQuickAction: true,
    },
    {
      id: 'record',
      label: t('navigation.mobileDock.record'),
      url: activeMarkId === null
        ? '/mobile/record'
        : `/mobile/record/detail?id=${encodeURIComponent(activeMarkId)}`,
      icon: Highlighter,
    },
    {
      id: 'canvas',
      label: t('navigation.mobileDock.canvas'),
      url: activeCanvasId
        ? `/mobile/canvas/editor?id=${encodeURIComponent(activeCanvasId)}`
        : '/mobile/canvas',
      icon: Palette,
    },
  ]

  const routeActiveIndex = items.findIndex(item => {
    if (item.id === 'chat' && pathname.startsWith('/mobile/setting')) return true
    if (item.id === 'record') return pathname.startsWith('/mobile/record')
    if (item.id === 'canvas') return pathname.startsWith('/mobile/canvas')
    return pathname === item.url
  })
  const quickActionIndex = items.findIndex(item => item.isQuickAction)
  const activeIndex =
    (isRecording || quickActionOpen) && quickActionIndex >= 0
      ? quickActionIndex
      : Math.max(routeActiveIndex, 0)

  async function menuHandler(item: FootbarItem) {
    pendingOrganizeRef.current = false
    if (item.isQuickAction) {
      if (isRecording) {
        setQuickActionOpen(false)
        emitter.emit('toolbar-shortcut-recording')
        return
      }
      setQuickActionOpen(open => !open)
      return
    }

    setQuickActionOpen(false)
    const chatState = useChatStore.getState()
    if (item.id === 'writing') {
      chatState.setMobileActiveContexts({ articlePath: activeFilePath || null })
    } else if (item.id === 'record') {
      chatState.setMobileActiveContexts({ markId: activeMarkId })
    } else if (item.id === 'canvas') {
      chatState.setMobileActiveContexts({ canvasId: activeCanvasId })
    }
    router.push(item.url)
    const store = await Store.load('store.json')
    await store.set('currentPage', item.url)
  }

  function handleMobileOrganize() {
    pendingOrganizeRef.current = true
    setQuickActionOpen(false)
  }

  return (
    <div className="flex h-full w-full items-center justify-center px-2 min-[380px]:px-3">
      <InteractiveMenu
        accentColor={isRecording ? 'rgb(239 68 68)' : undefined}
        activeIndex={activeIndex}
        aria-label={t('navigation.navigate')}
        className="w-full"
        items={items}
        onActiveIndexChange={index => {
          const item = items[index]
          if (item) void menuHandler(item)
        }}
      />
      <Drawer open={quickActionOpen} onOpenChange={setQuickActionOpen}>
        <DrawerContent
          onCloseAutoFocus={event => {
            if (!pendingOrganizeRef.current) return
            event.preventDefault()
            // Wait for the drawer's modal/focus locks to be released before
            // mounting the dialog. A frame after setOpen(false) is too early
            // because the drawer remains mounted during its exit animation.
            window.requestAnimationFrame(() => {
              if (!pendingOrganizeRef.current) return
              pendingOrganizeRef.current = false
              organizeRef.current?.openOrganize()
            })
          }}
        >
          <DrawerHeader className="sr-only">
            <DrawerTitle>{t('navigation.mobileDock.quickRecord')}</DrawerTitle>
          </DrawerHeader>
          <div className="px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <MobileRecordTools
              onClose={() => setQuickActionOpen(false)}
              onOrganize={handleMobileOrganize}
            />
          </div>
        </DrawerContent>
      </Drawer>
      <OrganizeNotes ref={organizeRef} />
    </div>
  )
}
