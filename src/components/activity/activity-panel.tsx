'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { ActivityDayDetail } from '@/components/activity/activity-day-detail'
import { ActivityHeatmap } from '@/components/activity/activity-heatmap'
import { ActivityLegend } from '@/components/activity/activity-legend'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'

const HEATMAP_DAY_SIZE = 16
const HEATMAP_WEEK_GAP = 4
const HEATMAP_HORIZONTAL_PADDING = 8

interface ActivityPanelProps {
  data: ActivityCalendarData | null
  selectedDay?: ActivityDaySummary
  loading?: boolean
  onSelectDay: (day: ActivityDaySummary) => void
  showSummary?: boolean
  showHeatmap?: boolean
  showDetail?: boolean
}

export function ActivityPanel({
  data,
  selectedDay,
  loading = false,
  onSelectDay,
  showSummary = true,
  showHeatmap = true,
  showDetail = true,
}: ActivityPanelProps) {
  const t = useTranslations('activity')
  const heatmapContainerRef = useRef<HTMLDivElement>(null)
  const [visibleWeekCount, setVisibleWeekCount] = useState(0)

  const summaryLabels = useMemo(() => ({
    records: t('summary.records'),
    writing: t('summary.writing'),
    chats: t('summary.chats'),
    canvas: t('summary.canvas'),
    recordBadge: t('labels.record'),
    writingBadge: t('labels.writing'),
    chatBadge: t('labels.chat'),
    canvasBadge: t('labels.canvas'),
  }), [t])

  useEffect(() => {
    if (!showHeatmap || !data) return
    const container = heatmapContainerRef.current
    if (!container) return

    const updateVisibleWeekCount = (width: number) => {
      const availableWidth = Math.max(0, width - HEATMAP_HORIZONTAL_PADDING)
      const nextCount = Math.max(1, Math.floor(
        (availableWidth + HEATMAP_WEEK_GAP) / (HEATMAP_DAY_SIZE + HEATMAP_WEEK_GAP),
      ))
      setVisibleWeekCount(Math.min(data.weeks.length, nextCount))
    }

    updateVisibleWeekCount(container.clientWidth)
    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) updateVisibleWeekCount(entry.contentRect.width)
    })
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [data, showHeatmap])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  const metrics = [
    { label: summaryLabels.records, value: data.totals.recordCount },
    { label: summaryLabels.writing, value: data.totals.writingCount },
    { label: summaryLabels.chats, value: data.totals.chatCount },
    { label: summaryLabels.canvas, value: data.totals.canvasCount },
  ]
  const visibleWeeks = showHeatmap && visibleWeekCount > 0
    ? data.weeks.slice(-visibleWeekCount)
    : []
  const latestWeek = data.weeks[data.weeks.length - 1]
  const visibleStartDate = visibleWeeks[0]?.days[0]?.day || latestWeek?.days[0]?.day || data.startDate
  const lastVisibleWeek = visibleWeeks[visibleWeeks.length - 1] || latestWeek
  const visibleEndDate = lastVisibleWeek?.days[lastVisibleWeek.days.length - 1]?.day || data.endDate

  return (
    <section className="@container/activity flex w-full min-w-0 flex-col gap-6">
      {showSummary && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 @xs/activity:grid-cols-2 @xl/activity:grid-cols-4">
          {metrics.map(metric => (
            <div key={metric.label} className="flex flex-col items-center gap-1 text-center">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      {showHeatmap && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-start gap-3 @md/activity:flex-row @md/activity:items-center @md/activity:justify-between">
            <p className="text-sm font-medium">
              {t('heatmap.range', { startDate: visibleStartDate, endDate: visibleEndDate })}
            </p>
            <ActivityLegend
              lowLabel={t('heatmap.less')}
              highLabel={t('heatmap.more')}
            />
          </div>
          <div ref={heatmapContainerRef} className="min-w-0 overflow-hidden">
            <ActivityHeatmap
              weeks={visibleWeeks}
              selectedDay={selectedDay?.day}
              onSelectDay={onSelectDay}
              adaptive
              labels={{
                dayCount: t('heatmap.dayCount'),
                emptyDay: t('heatmap.emptyDay'),
              }}
            />
          </div>
        </div>
      )}

      {showDetail && (
        <ActivityDayDetail
          day={selectedDay}
          flat
          labels={{
            empty: t('detail.empty'),
            records: summaryLabels.recordBadge,
            writing: summaryLabels.writingBadge,
            chats: summaryLabels.chatBadge,
            canvas: summaryLabels.canvasBadge,
          }}
        />
      )}
    </section>
  )
}
