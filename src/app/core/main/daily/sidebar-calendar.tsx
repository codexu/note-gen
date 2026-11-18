'use client'

// Fork（#45）：左側欄頂部的日記月曆。點日期打開那天的每日筆記（沒有就依模板建立）；
// 可收起成一週的日期列，收起時照樣可點。
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Calendar } from '@/components/ui/calendar'
import { toDateKey } from '@/lib/daily/format'
import { cn } from '@/lib/utils'
import useHomeStore from '@/stores/home'
import { SIDEBAR_ROW } from '../sidebar-row'
import { dayPickerLocale, openDailyNoteWithFeedback, useActiveDailyDate, useDailyDates, useDailyDayModifiers } from './daily-calendar'

const COLLAPSED_KEY = 'leftSidebarCalendarCollapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(value))
  } catch {
    // 存不了就只在這次啟動有效
  }
}

/** 以週一為一週的開頭。 */
function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** 首頁蓋在編輯器上時先收起，再打開每日筆記。 */
export function openDailyNoteFromSidebar(date: Date, errorMessage: string) {
  useHomeStore.getState().hide()
  openDailyNoteWithFeedback(date, errorMessage)
}

export function SidebarCalendar() {
  const t = useTranslations('today.calendarNav')
  const locale = useLocale()
  const activeDate = useActiveDailyDate()
  const { withNote, withOpenTasks } = useDailyDates()
  const { modifiers, modifiersClassNames } = useDailyDayModifiers()
  const [collapsed, setCollapsed] = useState(false)
  const [view, setView] = useState<Date>(() => activeDate ?? new Date())

  useEffect(() => setCollapsed(readCollapsed()), [])
  useEffect(() => {
    if (activeDate) setView(activeDate)
  }, [activeDate])

  const weekStart = startOfWeek(view)
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const todayKey = toDateKey(new Date())
  const activeKey = activeDate ? toDateKey(activeDate) : null
  const label = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(collapsed ? weekStart : view)
  const weekdayFormat = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })

  const open = (date: Date) => openDailyNoteFromSidebar(date, t('openFailed'))
  const step = (direction: -1 | 1) => setView(current => collapsed
    ? addDays(current, direction * 7)
    : new Date(current.getFullYear(), current.getMonth() + direction, 1))
  const toggle = () => setCollapsed(current => {
    writeCollapsed(!current)
    return !current
  })

  const iconButton = cn('grid size-6 shrink-0 place-items-center text-muted-foreground', SIDEBAR_ROW)

  return (
    <div className="px-2 pt-1.5 pb-1" data-sidebar-calendar>
      <div className="flex h-7 items-center gap-0.5">
        <button type="button" className={iconButton} aria-label={t(collapsed ? 'prevWeek' : 'prevMonth')} title={t(collapsed ? 'prevWeek' : 'prevMonth')} onClick={() => step(-1)}>
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={cn('h-6 min-w-0 flex-1 truncate px-1 text-left text-xs font-medium', SIDEBAR_ROW)} title={t('today')} onClick={() => setView(new Date())}>
          {label}
        </button>
        <button type="button" className={iconButton} aria-label={t(collapsed ? 'nextWeek' : 'nextMonth')} title={t(collapsed ? 'nextWeek' : 'nextMonth')} onClick={() => step(1)}>
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
        <button type="button" className={iconButton} aria-label={t(collapsed ? 'expand' : 'collapse')} title={t(collapsed ? 'expand' : 'collapse')} onClick={toggle}>
          {collapsed ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
        </button>
      </div>
      {collapsed ? (
        <div className="grid grid-cols-7 gap-0.5 pt-0.5">
          {week.map(day => {
            const key = toDateKey(day)
            return (
              <button
                key={key}
                type="button"
                aria-label={new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(day)}
                aria-current={key === todayKey ? 'date' : undefined}
                aria-pressed={key === activeKey}
                onClick={() => open(day)}
                className={cn(
                  'relative flex h-10 flex-col items-center justify-center text-xs leading-none',
                  SIDEBAR_ROW,
                  // 今天除了顏色再加一圈框，不只靠顏色辨認
                  key === todayKey && 'font-semibold text-ink ring-1 ring-ink/40 ring-inset',
                  key === activeKey && 'bg-active text-ink ring-0 hover:bg-active hover:text-ink',
                )}
              >
                <span className="text-[10px] opacity-60">{weekdayFormat.format(day)}</span>
                <span className="mt-0.5 mb-1.5 tabular-nums">{day.getDate()}</span>
                {(withOpenTasks.has(key) || withNote.has(key)) && (
                  <span className={cn('absolute bottom-0.5 size-1 rounded-full', withOpenTasks.has(key) ? 'bg-ink' : 'bg-muted-foreground/70', key === activeKey && 'bg-invert-ink')} />
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <Calendar
          mode="single"
          required
          locale={dayPickerLocale(locale)}
          weekStartsOn={1}
          month={view}
          onMonthChange={setView}
          selected={activeDate ?? undefined}
          onSelect={date => { if (date) open(date) }}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
          className="w-full bg-transparent p-0 [--cell-size:--spacing(7)] [&_button[data-day]]:aspect-auto [&_button[data-day]]:h-7"
          // 側欄要矮：日期格固定 h-7，不用預設的正方形
          classNames={{
            root: 'w-full',
            month_caption: 'hidden',
            nav: 'hidden',
            week: 'mt-0.5 flex w-full',
            day: 'group/day relative h-7 w-full rounded-(--cell-radius) p-0 text-center select-none',
          }}
        />
      )}
    </div>
  )
}
