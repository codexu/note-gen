'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect } from "react";
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
import { ControlText } from "@/app/core/record/mark/control-text"
import { ControlRecording } from "@/app/core/record/mark/control-recording"
import { ControlImage } from "@/app/core/record/mark/control-image"
import { ControlLink } from "@/app/core/record/mark/control-link"
import { ControlFile } from "@/app/core/record/mark/control-file"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initSettingData } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  useEffect(() => {
    initSettingData()
    initMainHosting()
    initAllDatabases()
    initMcp()
    // 上报应用启动事件
    reportAppStart()
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
            <AppFootbar />
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
      </TextSizeProvider>
    </ThemeProvider>
  );
}
