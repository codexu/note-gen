/**
 * macOS 行事曆（EventKit）讀取，D2 今日頁使用。
 * Rust 端指令在 src-tauri/src/calendar.rs，透過 Swift 小工具 notegen-calendar 讀取事件。
 * 只讀不寫：今日頁只顯示事件，不會修改行事曆。
 */

import { useCallback, useEffect, useState } from 'react'
import { localDay } from '@/lib/week/dates'
import type { CalendarEvent } from '@/lib/today/today-model'

export type CalendarAccess = 'granted' | 'denied' | 'notDetermined' | 'restricted' | 'unavailable'

export interface CalendarResponse {
  access: CalendarAccess
  events: CalendarEvent[]
}

export async function invokeCalendar(command: 'calendar_events' | 'calendar_request_access' | 'calendar_week', args: { start: number, end: number }): Promise<CalendarResponse> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke<CalendarResponse>(command, args)
  } catch {
    return { access: 'unavailable', events: [] }
  }
}

function dayRange(day: Date): { start: number, end: number } {
  return { start: localDay(day).getTime(), end: localDay(day, 1).getTime() }
}

export async function loadCalendarEvents(day: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_events', dayRange(day))
}

export async function requestCalendarAccess(day: Date): Promise<CalendarResponse> {
  return invokeCalendar('calendar_request_access', dayRange(day))
}

const REFRESH_MS = 5 * 60_000

/** 今天的行事曆事件；每 5 分鐘與切回視窗時重新讀取。 */
export function useCalendarEvents(day: Date) {
  const dayKey = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`
  const [state, setState] = useState<{ access: CalendarAccess | 'loading', events: CalendarEvent[] }>({ access: 'loading', events: [] })

  const load = useCallback(async (request = false) => {
    const target = new Date(day)
    const response = request ? await requestCalendarAccess(target) : await loadCalendarEvents(target)
    setState({ access: response.access, events: response.events })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  return { ...state, requestAccess: () => load(true), reload: () => load() }
}
