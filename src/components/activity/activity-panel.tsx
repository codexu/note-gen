'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'

import { ActivityDayDetail } from '@/components/activity/activity-day-detail'
import { ActivityHeatmap } from '@/components/activity/activity-heatmap'
import { ActivityLegend } from '@/components/activity/activity-legend'
import { CardDescription, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ActivityCalendarData, ActivityDaySummary } from '@/lib/activity/types'

interface ActivityPanelProps {
  data: ActivityCalendarData | null
  selectedDay?: ActivityDaySummary
  loading?: boolean
  onSelectDay: (day: ActivityDaySummary) => void
  mode?: 'page' | 'drawer'
}

export function ActivityPanel({
  data,
  selectedDay,
  loading = false,
  onSelectDay,
  mode = 'page',
}: ActivityPanelProps) {
  const t = useTranslations('activity')

  const summaryLabels = useMemo(() => ({
    totalCount: t('summary.totalCount'),
    activeDays: t('summary.activeDays'),
    records: t('summary.records'),
    writing: t('summary.writing'),
    chats: t('summary.chats'),
    recordBadge: t('labels.record'),
    writingBadge: t('labels.writing'),
    chatBadge: t('labels.chat'),
  }), [t])

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('loading')}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  return (
    <div className={`flex h-full flex-col ${mode === 'page' ? 'gap-6' : 'gap-4'}`}>
      <div className={cn(mode === 'page' ? '' : 'space-y-4')}>
        <div className={cn('flex gap-4', mode === 'page' ? 'flex-col md:flex-row md:items-end md:justify-between' : 'flex-col')}>
          <div className="space-y-2">
            {mode === 'page' ? (
              <>
                <CardTitle className="text-2xl font-semibold tracking-tight">{t('title')}</CardTitle>
                <CardDescription className="max-w-2xl text-sm leading-6">{t('description')}</CardDescription>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight">{t('drawer.title')}</h2>
                <p className="text-xs leading-5 text-muted-foreground">{t('drawer.description')}</p>
              </>
            )}
          </div>
        </div>

        <div className={cn(mode === 'page' ? 'rounded-2xl border border-border/70 p-6 shadow-sm' : 'space-y-4')}>
          <div className={cn('rounded-2xl bg-muted/30 p-4', mode === 'page' && 'border border-border/70')}>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">{summaryLabels.totalCount}</p>
                <p className="mt-1 text-lg font-semibold">{data.totals.totalCount}</p>
              </div>
              <div className="rounded-xl bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">{summaryLabels.activeDays}</p>
                <p className="mt-1 text-lg font-semibold">{data.totals.activeDays}</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">{summaryLabels.records}</p>
                <p className="mt-1 text-lg font-semibold">{data.totals.recordCount}</p>
              </div>
              <div className="rounded-xl bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">{summaryLabels.writing}</p>
                <p className="mt-1 text-lg font-semibold">{data.totals.writingCount}</p>
              </div>
              <div className="rounded-xl bg-background/80 p-3">
                <p className="text-xs text-muted-foreground">{summaryLabels.chats}</p>
                <p className="mt-1 text-lg font-semibold">{data.totals.chatCount}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-base font-semibold">
                {t('heatmap.range', { startDate: data.startDate, endDate: data.endDate })}
              </p>
              <ActivityLegend
                lowLabel={t('heatmap.less')}
                highLabel={t('heatmap.more')}
              />
            </div>
            <ActivityHeatmap
              weeks={data.weeks}
              selectedDay={selectedDay?.day}
              onSelectDay={onSelectDay}
              compact={mode === 'drawer'}
              labels={{
                dayCount: t('heatmap.dayCount'),
                emptyDay: t('heatmap.emptyDay'),
              }}
            />
          </div>
        </div>
      </div>

      <ActivityDayDetail
        day={selectedDay}
        compact={mode === 'drawer'}
        labels={{
          empty: t('detail.empty'),
          records: summaryLabels.recordBadge,
          writing: summaryLabels.writingBadge,
          chats: summaryLabels.chatBadge,
        }}
      />
    </div>
  )
}
