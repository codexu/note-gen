'use client'

import { useEffect, useState } from 'react'

import { Sheet, SheetContent } from '@/components/ui/sheet'
import { loadActivityCalendarData } from '@/lib/activity'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'
import { ActivityPanel } from './activity-panel'

interface ActivityDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ActivityDrawer({ open, onOpenChange }: ActivityDrawerProps) {
  const [data, setData] = useState<ActivityCalendarData | null>(null)
  const [selectedDay, setSelectedDay] = useState<ActivityDaySummary | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  async function refreshData(resetSelection = false) {
    setLoading(true)
    try {
      const nextData = await loadActivityCalendarData()
      setData(nextData)

      setSelectedDay((currentSelectedDay) => {
        if (!resetSelection && currentSelectedDay) {
          return nextData.days.find((day) => day.day === currentSelectedDay.day) || currentSelectedDay
        }

        const today = nextData.days.find((day) => day.day === nextData.endDate)
        const fallback = [...nextData.days].reverse().find((day) => day.totalCount > 0)
        return today || fallback
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      refreshData(true)
    }
  }, [open])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideCloseButton className="top-[36px] w-[452px] p-4 sm:max-w-none">
        <div className="scrollbar-hide h-full overflow-y-auto">
          <ActivityPanel
            data={data}
            selectedDay={selectedDay}
            loading={loading}
            onSelectDay={setSelectedDay}
            mode="drawer"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
