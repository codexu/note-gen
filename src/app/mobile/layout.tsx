'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { applyThemeColors } from "@/lib/theme-utils"
import { initAllDatabases } from "@/db"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import { AppFootbar } from "@/components/app-footbar"
import { TooltipProvider } from "@/components/ui/tooltip";
import './mobile-styles.css'
import useImageStore from "@/stores/imageHosting";
import { initMcp } from "@/lib/mcp/init"
import { reportAppStart } from "@/lib/event-report"
import { MobileStatusBar } from "@/components/mobile-statusbar"
import { TextSizeProvider } from "@/contexts/text-size-context"
import { SyncConfirmDialog } from "@/components/sync-confirm-dialog"
import { AutoDataSyncConflictDialog } from "@/components/auto-data-sync-conflict-dialog"
import { ControlText } from "@/app/core/main/mark/control-text"
import { ControlRecording } from "@/app/core/main/mark/control-recording"
import { ControlImage } from "@/app/core/main/mark/control-image"
import { ControlLink } from "@/app/core/main/mark/control-link"
import { ControlFile } from "@/app/core/main/mark/control-file"
import { initAutoDataSyncRuntime } from "@/lib/sync/auto-data-sync-queue"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pathname = usePathname()
  const { initSettingData, customThemeColors } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  useEffect(() => {
    let cancelled = false

    const initializeApp = async () => {
      try {
        initSettingData()
        initMainHosting()
        await initAllDatabases()
        if (cancelled) return
        await initAutoDataSyncRuntime()
        if (cancelled) return
        initMcp()
        reportAppStart()
      } catch (error) {
        console.error('Failed to initialize mobile app:', error)
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [])

  const { initVectorDb } = useVectorStore()
  
  // 初始化向量数据库
  useEffect(() => {
    initVectorDb()
  }, [])

  useEffect(() => {
    switch (currentLocale) {
      case 'zh':
        dayjs.locale(zh);
        break;
      case 'en':
        dayjs.locale(en);
        break;
      default:
        break;
    }
  }, [currentLocale])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

  const hideFootbar = pathname.startsWith('/mobile/setting/pages')

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TextSizeProvider>
        <MobileStatusBar />
        <TooltipProvider>
          <div className="flex flex-col h-full">
            <main className="flex flex-1 w-full overflow-hidden">
              {children}
            </main>
            {!hideFootbar ? <AppFootbar /> : null}
          </div>
          {/* 隐藏的记录工具组件，用于监听事件 */}
          <div className="absolute opacity-0 pointer-events-none -z-50">
            <ControlText />
            <ControlRecording />
            <ControlImage />
            <ControlLink />
            <ControlFile />
          </div>
        </TooltipProvider>
        <SyncConfirmDialog />
        <AutoDataSyncConflictDialog />
      </TextSizeProvider>
    </ThemeProvider>
  );
}
