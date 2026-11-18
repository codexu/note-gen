'use client'

// Fork（#31）：載入首頁設定、註冊 ⌘⇧H、從左側欄開檔時收起首頁，並掛上首頁、Inbox 頁（#46）與提示詞庫頁（#53）。由 fork-services.tsx 掛一次。
import { useEffect } from 'react'
import useArticleStore from '@/stores/article'
import useCollectStore from '@/stores/collect'
import useHomeStore from '@/stores/home'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import useThreadsStore from '@/stores/threads'
import useDecideStore from '@/stores/decide'
import { hideAllOverlays, hideWhen, linkExclusiveOverlays, toggleWorkspace } from '@/lib/fork-overlays/exclusive'
import { isUiV3, useUiModeStore } from '@/lib/fork-ui'
import { useWeekOverlay } from '@/lib/week/overlay'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { KnowledgeScreen } from '../sidebar-v3/knowledge-screen'
import { SlotService } from '../week/slot-service'
import { WeekScreen } from '../week/week-screen'
import { CollectScreen } from '../collect/collect-screen'
import { DecideScreen } from '../decide/decide-screen'
import { InboxScreen } from '../inbox/inbox-screen'
import { PromptLibraryScreen } from '../prompt-library/prompt-library-screen'
import { ThreadsScreen } from '../threads/threads-screen'
import { HOME_CARDS } from './home-cards'
import { HomeScreen } from './home-screen'
import { ActivityTracker } from './cards/footprint-card'
import { ReportService } from './cards/report-card'
import { ReportDrawer } from './cards/report-drawer'

/** 碰過左側欄後多久內的開檔算是從左側欄打開（搜尋、讀檔是非同步的）。 */
const LEFT_SIDEBAR_OPEN_WINDOW_MS = 3000
const TOUCH_EVENTS = ['pointerdown', 'mousedown', 'click', 'keydown'] as const

/** 所有蓋在編輯器上的全頁畫面。 */
const ALL_OVERLAYS = [useHomeStore, useInboxStore, usePromptLibraryStore, useCollectStore, useDecideStore, useThreadsStore, useWeekOverlay, useKnowledgeOverlay]

export function HomeService() {
  const init = useHomeStore(state => state.init)

  useEffect(() => {
    void init(HOME_CARDS)
  }, [init])

  // Fork（almanac 段1）：全頁覆蓋層一次只開一個；切回 classic 時關掉 V3 專屬頁。
  useEffect(() => {
    const v3Only = [useCollectStore, useDecideStore, useThreadsStore, useWeekOverlay, useKnowledgeOverlay]
    const unlink = linkExclusiveOverlays([useHomeStore, useInboxStore, usePromptLibraryStore, ...v3Only])
    const unsubscribeMode = useUiModeStore.subscribe(state => hideWhen(() => state.mode !== 'v3', v3Only))
    return () => {
      unlink()
      unsubscribeMode()
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return
      // 注音等輸入法下 key 可能不是 h，所以也看實體鍵位。
      if (event.code !== 'KeyH' && event.key.toLowerCase() !== 'h' && event.keyCode !== 72) return
      event.preventDefault()
      // Fork（ALMNC-22）：新介面沒有「回到工作區」按鈕，⌘⇧H 負責在全頁畫面與編輯器之間切換
      if (isUiV3()) toggleWorkspace(ALL_OVERLAYS, () => useHomeStore.getState().show())
      else useHomeStore.getState().toggle()
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
    const unsubscribeWeek = useWeekOverlay.subscribe((state, prev) => {
      if (state.visible && !prev.visible) blurEditor()
    })
    return () => {
      unsubscribeHome()
      unsubscribeInbox()
      unsubscribePromptLibrary()
      unsubscribeCollect()
      unsubscribeWeek()
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
      // ALMNC-22：原本漏了等你定，改用同一份清單
      hideAllOverlays(ALL_OVERLAYS)
    })
    // ALMNC-22：新介面點檔案樹裡「已經開著的那篇」也回到編輯器（開著的檔案沒變，上面的訂閱不會觸發）
    function onActiveFileClick(event: MouseEvent) {
      if (!isUiV3() || !(event.target instanceof Element)) return
      if (event.target.closest('[data-left-sidebar] .file-manager-item.active')) hideAllOverlays(ALL_OVERLAYS)
    }
    document.addEventListener('click', onActiveFileClick, true)
    return () => {
      for (const type of TOUCH_EVENTS) document.removeEventListener(type, onTouch, true)
      document.removeEventListener('click', onActiveFileClick, true)
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
      <DecideScreen />
      <ThreadsScreen />
      <WeekScreen />
      <KnowledgeScreen />
      <SlotService />
    </>
  )
}
