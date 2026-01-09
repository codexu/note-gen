'use client'

import { ThemeProvider } from "@/components/theme-provider"
import useSettingStore from "@/stores/setting"
import { useEffect, useState } from "react";
import { initAllDatabases } from "@/db"
import dayjs from "dayjs"
import zh from "dayjs/locale/zh-cn";
import en from "dayjs/locale/en";
import { useI18n } from "@/hooks/useI18n"
import useVectorStore from "@/stores/vector"
import useImageStore from "@/stores/imageHosting"
import useShortcutStore from "@/stores/shortcut"
import useChatStore from "@/stores/chat"
import useUpdateStore from "@/stores/update"
import initQuickRecordText from "@/lib/shortcut/quick-record-text"
import { useRouter, usePathname } from "next/navigation"
import initShowWindow from "@/lib/shortcut/show-window"
import { initMcp } from "@/lib/mcp/init"
import { SearchDialog } from "@/components/search-dialog"
import { reportAppStart } from "@/lib/event-report"
import { TitleBar } from "@/components/title-bar"
import { Store } from '@tauri-apps/plugin-store'
import { TextSizeProvider } from "@/contexts/text-size-context"
import { SyncConfirmDialog } from "@/components/sync-confirm-dialog"
import { applyThemeColors } from "@/lib/theme-utils"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { initSettingData, uiScale, customThemeColors } = useSettingStore()
  const { initMainHosting } = useImageStore()
  const { currentLocale } = useI18n()
  const { initShortcut } = useShortcutStore()
  const { initVectorDb } = useVectorStore()
  const { initIsLinkMark } = useChatStore()
  const { initUpdateStore, checkForUpdates } = useUpdateStore()
  const router = useRouter()
  const pathname = usePathname()
  const [searchOpen, setSearchOpen] = useState(false)

  // 重定向旧路径到新的 /core/main
  useEffect(() => {
    async function redirectOldPaths() {
      if (pathname === '/core/article' || pathname === '/core/record') {
        const store = await Store.load('store.json')
        await store.set('currentPage', '/core/main')
        await store.save()
        router.replace('/core/main')
      }
    }
    redirectOldPaths()
  }, [pathname, router])

  useEffect(() => {
    initSettingData()
    initMainHosting()
    initAllDatabases()
    initShortcut()
    initVectorDb()
    initIsLinkMark()
    initQuickRecordText()
    initShowWindow()
    initMcp()
    // 上报应用启动事件
    reportAppStart()
    // 初始化更新检查
    initUpdateStore().then(() => {
      checkForUpdates()
    })
  }, [])

  // 应用界面缩放
  useEffect(() => {
    if (uiScale && uiScale !== 100) {
      document.documentElement.style.fontSize = `${uiScale}%`
    }
  }, [uiScale])

  // 应用自定义主题颜色
  useEffect(() => {
    applyThemeColors(customThemeColors)
  }, [customThemeColors])

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

  // 禁用浏览器后退快捷键（Backspace）和添加搜索快捷键（Cmd/Ctrl+F）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 搜索快捷键：Cmd+F (macOS) 或 Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        return
      }

      // 如果按下 Backspace 键，且不在可编辑元素中
      if (e.key === 'Backspace') {
        const target = e.target as HTMLElement
        const isEditable = 
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('contenteditable') === 'true'
        
        // 如果在可编辑元素中，允许正常删除
        if (isEditable) {
          return
        }
        
        // 否则阻止默认的后退行为
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TextSizeProvider>
        <TitleBar onSearchClick={() => setSearchOpen(true)} />
        <main className="flex flex-1 flex-col overflow-hidden w-full h-[calc(100vh-36px)] mt-9">
          {children}
        </main>
        <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
        <SyncConfirmDialog />
      </TextSizeProvider>
    </ThemeProvider>
  );
}
