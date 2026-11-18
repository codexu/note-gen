'use client'

// Fork (D3): month calendar for jumping between daily notes, plus prev/next navigation.
import { useMemo, useState, type ReactNode } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { de, enUS, ja, ptBR, zhCN, zhTW } from 'react-day-picker/locale'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dailyNoteDateKeys } from '@/lib/daily/daily-nav'
import { parseDailyNotePath, toDateKey } from '@/lib/daily/format'
import { openAdjacentDailyNote, openDailyNote } from '@/lib/daily/open-daily-note'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import useVaultIndexStore, { selectAllTasks } from '@/stores/vault-index'

const DAY_PICKER_LOCALES = { en: enUS, zh: zhCN, 'zh-TW': zhTW, ja, de, 'pt-BR': ptBR } as const

const DOT = "after:pointer-events-none after:absolute after:bottom-0.5 after:left-1/2 after:z-20 after:size-1 after:-translate-x-1/2 after:rounded-full after:content-['']"

/** 有日記的日子、有未完成任務到期的日子（`YYYY-MM-DD`）。 */
export function useDailyDates() {
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const dailyFolder = useDailySettingsStore(state => state.dailyFolder)
  const dailyPattern = useDailySettingsStore(state => state.dailyPattern)
  return useMemo(() => {
    const withNote = dailyNoteDateKeys(notes.keys(), dailyFolder, dailyPattern)
    const withOpenTasks = new Set<string>()
    for (const task of selectAllTasks({ notes, revision })) {
      if (!task.done && task.due) withOpenTasks.add(task.due)
    }
    return { withNote, withOpenTasks }
  }, [notes, revision, dailyFolder, dailyPattern])
}

/** 目前開著的日記的日期；不是日記時為 null。 */
export function useActiveDailyDate(): Date | null {
  const activeFilePath = useArticleStore(state => state.activeFilePath)
  const dailyFolder = useDailySettingsStore(state => state.dailyFolder)
  const dailyPattern = useDailySettingsStore(state => state.dailyPattern)
  return useMemo(
    () => (activeFilePath ? parseDailyNotePath(activeFilePath, dailyFolder, dailyPattern) : null),
    [activeFilePath, dailyFolder, dailyPattern],
  )
}

/** 月曆上「有日記」「有任務到期」兩種小點的 modifiers；彈出月曆與左側欄月曆共用。 */
export function useDailyDayModifiers() {
  const { withNote, withOpenTasks } = useDailyDates()
  return useMemo(() => ({
    modifiers: {
      hasNote: (date: Date) => withNote.has(toDateKey(date)),
      openTasks: (date: Date) => withOpenTasks.has(toDateKey(date)),
    },
    modifiersClassNames: {
      hasNote: `relative ${DOT} after:bg-muted-foreground/70`,
      openTasks: `relative ${DOT} after:bg-ink`,
    },
  }), [withNote, withOpenTasks])
}

export function dayPickerLocale(locale: string) {
  return DAY_PICKER_LOCALES[locale as keyof typeof DAY_PICKER_LOCALES] ?? enUS
}

export function openDailyNoteWithFeedback(date: Date, errorMessage: string) {
  void openDailyNote(date).catch(error => {
    console.error('[daily] open failed:', error)
    toast.error(errorMessage)
  })
}

export function DailyCalendarPopover({ selected, children, align = 'end' }: {
  selected?: Date | null
  children: ReactNode
  align?: 'start' | 'center' | 'end'
}) {
  const t = useTranslations('today.calendarNav')
  const locale = useLocale()
  const { modifiers, modifiersClassNames } = useDailyDayModifiers()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState<Date>(() => selected ?? new Date())

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setMonth(selected ?? new Date()) }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-0">
        <Calendar
          mode="single"
          locale={dayPickerLocale(locale)}
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={selected ?? undefined}
          onSelect={date => {
            if (!date) return
            setOpen(false)
            openDailyNoteWithFeedback(date, t('openFailed'))
          }}
          modifiers={modifiers}
          modifiersClassNames={modifiersClassNames}
        />
        <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-muted-foreground/70" />{t('legendNote')}</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-ink" />{t('legendTasks')}</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2"
            onClick={() => { setOpen(false); openDailyNoteWithFeedback(new Date(), t('openFailed')) }}
          >
            {t('today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function stepDailyNoteWithFeedback(direction: -1 | 1, messages: { none: string, failed: string }) {
  void openAdjacentDailyNote(direction)
    .then(date => { if (!date) toast(messages.none) })
    .catch(error => {
      console.error('[daily] step failed:', error)
      toast.error(messages.failed)
    })
}

/** 狀態列：開著日記時顯示「‹ 日期 ›」，其他時候只有月曆按鈕。 */
export function DailyNavStatusItem() {
  const t = useTranslations('today.calendarNav')
  const locale = useLocale()
  const activeDate = useActiveDailyDate()
  const messages = { none: t('noMore'), failed: t('openFailed') }
  const label = activeDate
    ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(activeDate)
    : null

  return (
    <div className="flex h-5 items-center">
      {activeDate && (
        <button type="button" className="grid h-5 w-5 cursor-pointer place-items-center rounded hover:bg-muted" aria-label={t('prev')} title={t('prevShortcut')} onClick={() => stepDailyNoteWithFeedback(-1, messages)}>
          <ChevronLeft className="size-3" aria-hidden />
        </button>
      )}
      <DailyCalendarPopover selected={activeDate}>
        <button type="button" className="flex h-5 cursor-pointer items-center gap-1 rounded px-1.5 hover:bg-muted" aria-label={t('open')} title={t('open')}>
          <CalendarDays className="size-3" aria-hidden />
          {label && <span className="tabular-nums">{label}</span>}
        </button>
      </DailyCalendarPopover>
      {activeDate && (
        <button type="button" className="grid h-5 w-5 cursor-pointer place-items-center rounded hover:bg-muted" aria-label={t('next')} title={t('nextShortcut')} onClick={() => stepDailyNoteWithFeedback(1, messages)}>
          <ChevronRight className="size-3" aria-hidden />
        </button>
      )}
    </div>
  )
}
