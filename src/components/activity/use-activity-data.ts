'use client'

import { useEffect, useState } from 'react'

import { loadActivityCalendarData } from '@/lib/activity'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'
import { useSettingsHydrationStore } from '@/stores/setting'

export function useActivityData(active = true) {
  const [data, setData] = useState<ActivityCalendarData | null>(null)
  const [selectedDay, setSelectedDay] = useState<ActivityDaySummary | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const settingsLoading = useSettingsHydrationStore(state => state.status === 'loading')

  useEffect(() => {
    if (!active || settingsLoading) return
    let disposed = false
    setLoading(true)
    void loadActivityCalendarData().then(nextData => {
      if (disposed) return
      setData(nextData)
      const today = nextData.days.find(day => day.day === nextData.endDate)
      const fallback = [...nextData.days].reverse().find(day => day.totalCount > 0)
      setSelectedDay(today || fallback)
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
    return () => { disposed = true }
  }, [active, settingsLoading])

  return { data, selectedDay, setSelectedDay, loading: active && (settingsLoading || loading) }
}
