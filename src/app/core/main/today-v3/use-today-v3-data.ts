'use client'

// Fork（almanac ALMNC-16.2）：v5「今天」畫面讀的資料。把既有來源（索引、今日日誌、行事曆、等你定、收集）
// 讀進來，交給 lib/today-v3/layout.ts 的純函式組成三欄資料。今天的行事曆沿用既有的 useCalendarEvents（唯讀）。
import { useEffect, useMemo, useState } from 'react'
import { useCalendarEvents } from '@/lib/calendar/calendar'
import { parseDailyNote } from '@/lib/daily/daily-note'
import { dailyNoteDateKeys } from '@/lib/daily/daily-nav'
import { dailyNotePath, toDateKey } from '@/lib/daily/format'
import { readNote } from '@/lib/daily/note-io'
import { useDecisions } from '@/lib/decide/use-decisions'
import { buildTodayLayout, isSameDay } from '@/lib/today-v3/layout'
import type { CalendarEvent } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'

/** 分鐘級的「現在」，讓現在線每分鐘前進。 */
function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: number | undefined
    const align = window.setTimeout(() => {
      setNow(new Date())
      timer = window.setInterval(() => setNow(new Date()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      window.clearTimeout(align)
      if (timer) window.clearInterval(timer)
    }
  }, [])
  return now
}

/** 今日日誌全文；檔案變動（mtime）時重讀。沒有檔案或讀不到（瀏覽器預覽）為 null。 */
function useJournalContent(path: string, mtime: number): string | null {
  const [content, setContent] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void readNote(path).then(text => { if (!cancelled) setContent(text) }).catch(() => { if (!cancelled) setContent(null) })
    return () => { cancelled = true }
  }, [path, mtime])
  return content
}

/**
 * 開發預覽用（不進 production）：瀏覽器沒有 Tauri，截圖時從頁面塞示範資料。
 * window.__almanacTodayDemo = { now, journalContent, events, tasks }；
 * 換日預覽另有 journalByDay / eventsByDay（key 為 YYYY-MM-DD，沒給的日子退回 journalContent / events）與 noteKeys（有日記的日期）。
 */
interface TodayDemo {
  now?: number
  journalContent?: string
  events?: CalendarEvent[]
  tasks?: TaskRef[]
  journalByDay?: Record<string, string | null>
  eventsByDay?: Record<string, CalendarEvent[]>
  noteKeys?: string[]
}
function readDemo(): TodayDemo | undefined {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return undefined
  return (window as unknown as { __almanacTodayDemo?: TodayDemo }).__almanacTodayDemo
}

/** day 是選中的那一天（省略 = 今天）；now 永遠是現在，現在線、記一筆、時段提案、右欄都以它為準。 */
export function useTodayV3Data(selectedDay?: Date) {
  const realNow = useMinuteNow()
  const demo = readDemo()
  const now = demo?.now ? new Date(demo.now) : realNow
  const day = selectedDay ?? now
  const viewingToday = isSameDay(day, now)
  const dayKey = toDateKey(day)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const indexedTasks = useMemo(() => selectAllTasks({ notes, revision }), [notes, revision])
  const tasks = demo?.tasks ?? indexedTasks

  const dailyFolder = useDailySettingsStore(state => state.dailyFolder)
  const dailyPattern = useDailySettingsStore(state => state.dailyPattern)
  const initDailySettings = useDailySettingsStore(state => state.initSettings)
  useEffect(() => { void initDailySettings() }, [initDailySettings])
  const todayPath = dailyNotePath(now, dailyFolder, dailyPattern)
  const dayPath = dailyNotePath(day, dailyFolder, dailyPattern)

  const readContent = useJournalContent(dayPath, notes.get(dayPath)?.mtime ?? 0)
  const demoJournal = demo?.journalByDay && dayKey in demo.journalByDay ? demo.journalByDay[dayKey] : demo?.journalByDay ? null : demo?.journalContent
  const journalContent = demoJournal !== undefined ? demoJournal : readContent
  const dailyNote = useMemo(() => (journalContent === null ? null : parseDailyNote(journalContent)), [journalContent])
  const calendar = useCalendarEvents(day)
  // 換日的瞬間 hook 還拿著上一天的事件：只留落在這一天的
  const calendarEvents = useMemo(() => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
    return calendar.events.filter(event => event.end > start && event.start < start + 86_400_000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.events, dayKey])
  const events = demo?.eventsByDay ? (demo.eventsByDay[dayKey] ?? []) : (demo?.events ?? calendarEvents)
  const noteKeys = useMemo(() => {
    const keys = dailyNoteDateKeys(notes.keys(), dailyFolder, dailyPattern)
    for (const key of demo?.noteKeys ?? []) keys.add(key)
    return keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, dailyFolder, dailyPattern, demo?.noteKeys])
  const decisions = useDecisions()
  const captures = useCollectStore(state => state.items)
  // 收集項目從 store.json 讀回、今日日誌給等你定預覽用：這兩件事 DecideScreen 一直掛著在做。

  const layout = useMemo(() => buildTodayLayout({
    now,
    day,
    journalContent,
    dailyNote,
    tasks,
    events,
    decisions,
    captures,
  }), [now, journalContent, dailyNote, tasks, events, decisions, captures])

  return { now, day, dayKey, viewingToday, tasks, todayPath, dayPath, noteKeys, journalExists: journalContent !== null, layout, calendarAccess: calendar.access }
}
