'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { dailyNotePath, toDateKey } from '@/lib/daily/format'
import { refreshJournal } from '@/lib/decide/actions'
import { useUiV3 } from '@/lib/fork-ui'
import { usePendingSlots } from '@/lib/timeslots/use-pending-slots'
import { localDay, weekStart } from '@/lib/week/dates'
import { buildWeekPlan } from '@/lib/week/model'
import { useWeekOverlay } from '@/lib/week/overlay'
import { useWeekCalendar } from '@/lib/week/use-week-calendar'
import useDailySettingsStore from '@/stores/daily-settings'
import useDecideStore from '@/stores/decide'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'
import { SidebarCalendar } from '../daily/sidebar-calendar'
import { PageHeader, PageSurface } from '../page-ui'
import { WeekGrid } from './week-grid'

const NO_EVENTS = [] as const

function openDecision(key: string) {
  useDecideStore.getState().select(key)
  useDecideStore.getState().show()
}

function WeekPage() {
  const t = useTranslations('week')
  const locale = useLocale()
  const [start, setStart] = useState(() => weekStart(new Date()))
  const hide = useWeekOverlay(state => state.hide)
  const calendar = useWeekCalendar(start)
  const access = calendar.response?.access ?? 'loading'
  const events = calendar.response?.events ?? NO_EVENTS
  const tasks = useVaultIndexStore(selectAllTasks)
  const indexStatus = useVaultIndexStore(state => state.status)
  const { dailyFolder, dailyPattern, initSettings } = useDailySettingsStore()
  const today = toDateKey(new Date())
  const proposals = usePendingSlots(today)

  useEffect(() => {
    void initSettings().catch(() => undefined)
    void refreshJournal()
  }, [initSettings])

  const days = useMemo(() => buildWeekPlan({
    start, events, tasks, proposals,
    pathFor: date => dailyNotePath(date, dailyFolder, dailyPattern),
  }), [start, events, tasks, proposals, dailyFolder, dailyPattern])

  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
  const range = date.formatRange(start, localDay(start, 6))
  return (
    <PageSurface label={t('title')} className="bg-bg text-ink">
      <PageHeader title={t('title')} onBack={hide}>
        <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" disabled={calendar.requesting} aria-label={t('previous')} onClick={() => setStart(day => localDay(day, -7))}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="min-w-28 text-center font-mono text-xs">{range}</span>
          <Button type="button" variant="ghost" size="icon" disabled={calendar.requesting} aria-label={t('next')} onClick={() => setStart(day => localDay(day, 7))}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={calendar.requesting} onClick={() => setStart(weekStart(new Date()))}>{t('current')}</Button>
        </div>
      </PageHeader>
      {(access !== 'granted' || indexStatus !== 'ready') && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 border-b border-line px-5 py-2 text-xs text-muted-ink" role="status">
          {access !== 'granted' && <span>{t(`access.${access}`)}</span>}
          {access === 'notDetermined' && <Button type="button" size="sm" variant="outline" disabled={calendar.requesting} onClick={calendar.request}>{t('grantAccess')}</Button>}
          {indexStatus !== 'ready' && <span>{t(indexStatus === 'error' ? 'tasksUnavailable' : 'loadingTasks')}</span>}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {/* ALMNC-20：月曆從側欄搬到計畫頁。data-left-sidebar：點日期開日記時沿用「從側欄開檔就收起覆蓋層」的規則。 */}
        <aside className="hidden w-[248px] shrink-0 overflow-y-auto border-r border-line-soft md:block" aria-label={t('calendarLabel')} data-left-sidebar>
          <SidebarCalendar />
        </aside>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto" tabIndex={0} role="region" aria-label={t('gridLabel')}>
          <WeekGrid days={days} today={today} openDecision={openDecision} />
        </div>
      </div>
    </PageSurface>
  )
}

export function WeekScreen() {
  const isV3 = useUiV3()
  const visible = useWeekOverlay(state => state.visible)
  return isV3 && visible ? <WeekPage /> : null
}
