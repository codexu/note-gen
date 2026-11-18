'use client'

import { useEffect, useState } from 'react'
import { loadCalendarWeek, requestCalendarWeekAccess } from './calendar'
import type { CalendarResponse } from '@/lib/calendar/calendar'

export function useWeekCalendar(start: Date) {
  const [result, setResult] = useState<{ start: Date, response: CalendarResponse }>()
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let sequence = 0
    let cancelled = false
    async function load() {
      const ticket = ++sequence
      const response = await (requesting ? requestCalendarWeekAccess(start) : loadCalendarWeek(start))
      if (cancelled || ticket !== sequence) return
      setResult({ start, response })
      if (requesting) setRequesting(false)
    }
    void load()
    if (requesting) return () => { cancelled = true }
    const timer = window.setInterval(load, 5 * 60_000)
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [start, requesting])

  return { response: result?.start === start ? result.response : undefined, requesting, request: () => setRequesting(true) }
}
