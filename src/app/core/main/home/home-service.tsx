'use client'

// Fork（#31）：載入首頁設定、註冊 ⌘⇧H、從左側欄開檔時收起首頁，並掛上首頁、Inbox 頁（#46）與提示詞庫頁（#53）。由 fork-services.tsx 掛一次。
import { useEffect } from 'react'
import useArticleStore from '@/stores/article'
import useCollectStore from '@/stores/collect'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import { CollectScreen } from '../collect/collect-screen'
import { InboxScreen } from '../inbox/inbox-screen'
import { PromptLibraryScreen } from '../prompt-library/prompt-library-screen'
import { HOME_CARDS } from './home-cards'
import { HomeScreen } from './home-screen'
import { ActivityTracker } from './cards/footprint-card'
import { ReportService } from './cards/report-card'
import { ReportDrawer } from './cards/report-drawer'

/** 碰過左側欄後多久內的開檔算是從左側欄打開（搜尋、讀檔是非同步的）。 */
const LEFT_SIDEBAR_OPEN_WINDOW_MS = 3000
const TOUCH_EVENTS = ['pointerdown', 'mousedown', 'click', 'keydown'] as const

export function HomeService() {
  const init = useHomeStore(state => state.init)

  useEffect(() => {
    void init(HOME_CARDS)
  }, [init])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
      // 注音等輸入法下 key 可能不是 h，所以也看實體鍵位。
      if (event.code !== 'KeyH' && event.key.toLowerCase() !== 'h' && event.keyCode !== 72) return
      event.preventDefault()
      useHomeStore.getState().toggle()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    // 編輯器的浮動選單（選取文字、表格）掛在 body 上、層級比首頁高；首頁或 Inbox 頁打開時讓編輯器失焦，選單就會收起。
    function blurEditor() {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.closest('.ProseMirror')) active.blur()
    }
    const unsubscribeHome = useHomeStore.subscribe((state, prev) => {
      if (state.visible && !prev.visible) blurEditor()
    })
    const unsubscribeInbox = useInboxStore.subscribe((state, prev) => {
      if (state.visible && !prev.visible) blurEditor()
    })
    const unsubscribePromptLibrary = usePromptLibraryStore.subscribe((state, prev) => {
      if (state.visible && !prev.visible) blurEditor()
    })
    const unsubscribeCollect = useCollectStore.subscribe((state, prev) => {
      if (state.visible && !prev.visible) blurEditor()
    })
    return () => {
      unsubscribeHome()
      unsubscribeInbox()
      unsubscribePromptLibrary()
      unsubscribeCollect()
    }
  }, [])

  useEffect(() => {
    // 在左側欄（檔案樹、搜尋、日曆⋯⋯）打開東西時收起首頁與 Inbox 頁。只認使用者剛碰過左側欄後的切換，
    // 啟動時還原分頁、自動打開今日日記不算，否則首頁一開就被收掉。
    let touchedAt = 0
    function onTouch(event: Event) {
      if (event.target instanceof Element && event.target.closest('[data-left-sidebar]')) touchedAt = Date.now()
    }
    for (const type of TOUCH_EVENTS) document.addEventListener(type, onTouch, true)
    const unsubscribe = useArticleStore.subscribe((state, prev) => {
      if (state.activeFilePath === prev.activeFilePath && state.activeTabId === prev.activeTabId) return
      if (Date.now() - touchedAt > LEFT_SIDEBAR_OPEN_WINDOW_MS) return
      if (useHomeStore.getState().visible) useHomeStore.getState().hide()
      if (useInboxStore.getState().visible) useInboxStore.getState().hide()
      if (usePromptLibraryStore.getState().visible) usePromptLibraryStore.getState().hide()
      if (useCollectStore.getState().visible) useCollectStore.getState().hide()
    })
    return () => {
      for (const type of TOUCH_EVENTS) document.removeEventListener(type, onTouch, true)
      unsubscribe()
    }
  }, [])

  return (
    <>
      <ActivityTracker />
      <ReportService />
      <ReportDrawer />
      <HomeScreen />
      <InboxScreen />
      <PromptLibraryScreen />
      <CollectScreen />
    </>
  )
}
