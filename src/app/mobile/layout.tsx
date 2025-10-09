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
import './mobile-styles.scss'
import useImageStore from "@/stores/imageHosting";
import { initMcp } from "@/lib/mcp/init"

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
      <TooltipProvider>
        <div className="flex flex-col h-full">
          <main className="flex flex-1 w-full overflow-hidden">
            {children}
          </main>
          <AppFootbar />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}
