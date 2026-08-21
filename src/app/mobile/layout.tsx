'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { applyThemeColors } from "@/lib/theme-utils"
import { applyAppFontFamily } from "@/lib/font-settings"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import de from "dayjs/locale/de";
import ja from "dayjs/locale/ja";
import ptBR from "dayjs/locale/pt-br";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import { TooltipProvider } from "@/components/ui/tooltip";
import './mobile-styles.css'
import useImageStore from "@/stores/imageHosting";
import { AppFootbar } from "@/components/app-footbar"
import { MobileStatusBar } from "@/components/mobile-statusbar"
import { TextSizeProvider } from "@/contexts/text-size-context"
import { MobileViewport } from "@/components/mobile-viewport"
import useArticleStore from "@/stores/article"
import { MobileModeProvider } from "@/hooks/use-mobile"
import { Skeleton } from "@/components/ui/skeleton"
import AppStatus from "@/components/app-status"
import useMarkStore from "@/stores/mark"
import useCanvasStore from "@/stores/canvas"

const WritingScreen = dynamic(
  () => import('./writing/writing-screen').then(module => module.WritingScreen),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full flex-col gap-3 p-3" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    ),
  },
)
const MobileRecordDetail = dynamic(
  () => import('./record/mobile-record-detail').then(module => module.MobileRecordDetail),
  { ssr: false },
)
const MobileCanvasEditorScreen = dynamic(
  () => import('./canvas/editor/page').then(module => module.MobileCanvasEditorScreen),
  { ssr: false },
)
const MemoryAutoNotifications = dynamic(
  () => import('@/components/memories/memory-auto-notifications').then(module => module.MemoryAutoNotifications),
  { ssr: false },
)
const SyncConfirmDialog = dynamic(
  () => import('@/components/sync-confirm-dialog').then(module => module.SyncConfirmDialog),
  { ssr: false },
)
const MobileUpdateChecker = dynamic(
  () => import('./components/mobile-update-prompt').then(module => module.MobileUpdateChecker),
  { ssr: false },
)
const ControlText = dynamic(
  () => import('@/app/core/main/mark/control-text').then(module => module.ControlText),
  { ssr: false },
)
const ControlRecording = dynamic(
  () => import('@/app/core/main/mark/control-recording').then(module => module.ControlRecording),
  { ssr: false },
)
const ControlImage = dynamic(
  () => import('@/app/core/main/mark/control-image').then(module => module.ControlImage),
  { ssr: false },
)
const ControlLink = dynamic(
  () => import('@/app/core/main/mark/control-link').then(module => module.ControlLink),
  { ssr: false },
)
const ControlFile = dynamic(
  () => import('@/app/core/main/mark/control-file').then(module => module.ControlFile),
  { ssr: false },
)
const ControlTodo = dynamic(
  () => import('@/app/core/main/mark/control-todo').then(module => module.ControlTodo),
  { ssr: false },
)

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isWritingRoute = pathname === '/mobile/writing'
  const isRecordDetailRoute = pathname === '/mobile/record/detail'
  const isCanvasEditorRoute = pathname === '/mobile/canvas/editor'
  const routeMarkId = Number(searchParams.get('id'))
  const routeCanvasId = searchParams.get('id') || ''
  const activeMarkId = useMarkStore(state => state.activeMarkId)
  const activeCanvasId = useCanvasStore(state => state.activeCanvasId)
  const cachedMarkId = activeMarkId ?? (
    isRecordDetailRoute && Number.isFinite(routeMarkId) ? routeMarkId : null
  )
  const cachedCanvasId = activeCanvasId || (isCanvasEditorRoute ? routeCanvasId : '')
  const [hasWritingCache, setHasWritingCache] = useState(isWritingRoute)
  const { initSettingData, customThemeColors, appFontFamily } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { initCollapsibleList } = useArticleStore()
  const { initVectorDb } = useVectorStore()
  const { currentLocale } = useI18n()
  useEffect(() => {
    if (isWritingRoute) {
      setHasWritingCache(true)
    }
  }, [isWritingRoute])

  useEffect(() => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof HTMLElement)) return

    const hiddenRootIds = [
      !isRecordDetailRoute ? 'mobile-record-detail' : null,
      !isCanvasEditorRoute ? 'mobile-canvas-editor' : null,
    ].filter((id): id is string => Boolean(id))

    for (const hiddenRootId of hiddenRootIds) {
      const hiddenRoot = document.getElementById(hiddenRootId)
      if (hiddenRoot?.contains(activeElement)) {
        activeElement.blur()
        return
      }
    }
  }, [isCanvasEditorRoute, isRecordDetailRoute])

  useEffect(() => {
    if (isWritingRoute) {
      return
    }

    const writingRoot = document.getElementById('mobile-writing')
    const activeElement = document.activeElement
    if (writingRoot && activeElement instanceof HTMLElement && writingRoot.contains(activeElement)) {
      activeElement.blur()
    }
  }, [isWritingRoute])

  useEffect(() => {
    let cancelled = false

    void import('@/lib/event-report').then(({ reportAppStart }) => reportAppStart())

    const initializeApp = async () => {
      try {
        const [
          { initAllDatabases },
          { initAutoDataSyncRuntime },
          { initMcp },
          { getSyncPushQueue },
        ] = await Promise.all([
          import('@/db'),
          import('@/lib/sync/auto-data-sync-queue'),
          import('@/lib/mcp/init'),
          import('@/lib/sync/sync-push-queue'),
        ])
        const { platform } = await import('@tauri-apps/plugin-os')
        if (platform() === 'ios') {
          try {
            const { restoreSavedIOSFolderAccess } = await import('@/lib/sync/cloud-folder')
            await restoreSavedIOSFolderAccess()
          } catch (error) {
            console.error('Failed to restore the iOS cloud folder authorization:', error)
          }
        }
        await initSettingData()
        getSyncPushQueue()
        initMainHosting()
        await initAllDatabases()
        if (cancelled) return
        const { runMemoryMaintenance } = await import('@/lib/memory/auto-memory')
        void runMemoryMaintenance()
        const {
          reconcileMemoryEmbeddingModel,
          reindexPendingMemories,
        } = await import('@/db/memories')
        await reconcileMemoryEmbeddingModel()
        void reindexPendingMemories()
        await initCollapsibleList()
        if (cancelled) return
        await initAutoDataSyncRuntime()
        if (cancelled) return
        await initVectorDb()
        if (cancelled) return
        await useArticleStore.getState().initVectorIndexedFiles()
        if (cancelled) return
        initMcp()
      } catch (error) {
        console.error('Failed to initialize mobile app:', error)
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    switch (currentLocale) {
      case 'zh':
        dayjs.locale(zh);
        break;
      case 'en':
        dayjs.locale(en);
        break;
      case 'de':
        dayjs.locale(de);
        break;
      case 'ja':
        dayjs.locale(ja);
        break;
      case 'pt-BR':
        dayjs.locale(ptBR);
        break;
      default:
        break;
    }
  }, [currentLocale])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  // 应用字体
  useEffect(() => {
    applyAppFontFamily(appFontFamily)
  }, [appFontFamily])

  const hideFootbar =
    pathname.startsWith('/mobile/setting/pages')

  const usesCachedRoute = isWritingRoute
    || (isRecordDetailRoute && cachedMarkId !== null)
    || (isCanvasEditorRoute && Boolean(cachedCanvasId))

  return (
    <MobileModeProvider mobile>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <TextSizeProvider>
          <MobileViewport />
          <MobileStatusBar />
          <AppStatus />
          <TooltipProvider>
            <div className="mobile-app-shell flex flex-col">
              <main className="mobile-app-main flex flex-1 w-full overflow-hidden">
                {hasWritingCache ? (
                  <div
                    className={isWritingRoute ? "h-full w-full min-w-0" : "hidden"}
                    aria-hidden={!isWritingRoute}
                  >
                    <WritingScreen />
                  </div>
                ) : null}
                {cachedMarkId !== null ? (
                  <div
                    className={isRecordDetailRoute ? "h-full w-full min-w-0" : "hidden"}
                    aria-hidden={!isRecordDetailRoute}
                  >
                    <MobileRecordDetail markId={cachedMarkId} />
                  </div>
                ) : null}
                {cachedCanvasId ? (
                  <div
                    className={isCanvasEditorRoute ? "h-full w-full min-w-0" : "hidden"}
                    aria-hidden={!isCanvasEditorRoute}
                  >
                    <MobileCanvasEditorScreen canvasId={cachedCanvasId} />
                  </div>
                ) : null}
                {!usesCachedRoute ? children : null}
              </main>
              {!hideFootbar ? (
                <div className="mobile-footbar">
                  <AppFootbar />
                </div>
              ) : null}
            </div>
            {/* 隐藏的记录工具组件，用于监听事件 */}
            <div className="absolute opacity-0 pointer-events-none -z-50">
              <ControlText />
              <ControlRecording />
              <ControlImage />
              <ControlLink />
              <ControlFile />
              <ControlTodo />
            </div>
          </TooltipProvider>
          <SyncConfirmDialog />
          <MobileUpdateChecker />
          <MemoryAutoNotifications />
        </TextSizeProvider>
      </ThemeProvider>
    </MobileModeProvider>
  );
}
