'use client'

import { Check, Lock } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { packWeekEntries, weekTime, type WeekPlanDay } from '@/lib/week/model'

const HOUR_HEIGHT = 64

export function WeekGrid({ days, today, openDecision }: {
  days: WeekPlanDay[]
  today: string
  openDecision: (key: string) => void
}) {
  const locale = useLocale()
  const t = useTranslations('week')
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  const gridStart = Math.min(6, ...days.map(day => Math.floor((day.timed[0]?.start ?? 360) / 60)))
  const hours = Array.from({ length: 24 - gridStart }, (_, index) => gridStart + index)
  const hasUntimed = days.some(day => day.untimed.length > 0)

  return (
    <div className="grid min-w-[840px] grid-cols-[48px_repeat(7,minmax(0,1fr))]">
      <div className="sticky top-0 z-10 border-b border-line bg-bg" />
      {days.map(day => (
        <div key={day.key} aria-current={day.key === today ? 'date' : undefined} className={cn(
          'sticky top-0 z-10 flex items-center justify-center gap-2 border-b border-l border-line bg-bg py-2.5 text-sm text-muted-ink',
          day.key === today && 'bg-panel font-semibold text-ink',
        )}>
          <span>{weekday.format(day.date)}</span>
          <time dateTime={day.key} className="font-mono">{day.date.getDate()}</time>
        </div>
      ))}
      {hasUntimed && <>
        <div className="border-b border-line" />
        {days.map(day => (
          <ul key={day.key} aria-label={day.key} className="space-y-1 border-b border-l border-line px-1 py-1.5">
            {day.untimed.map(entry => (
              <li key={entry.key} className="flex items-center gap-1 rounded bg-panel px-1.5 py-1 text-xs break-words">
                {entry.kind === 'calendar' && <Lock className="size-3 shrink-0 text-faint" aria-label={t('calendar')} />}
                {entry.done && <Check className="size-3 shrink-0 text-brand" aria-label={t('completed')} />}
                <span className={cn('min-w-0', entry.done && 'text-brand line-through')}>{entry.title || t('untitledEvent')}</span>
              </li>
            ))}
          </ul>
        ))}
      </>}
      <div aria-hidden className="font-mono text-[11px] text-faint">
        {hours.map(hour => <div key={hour} className="pt-0.5 pr-2 text-right" style={{ height: HOUR_HEIGHT }}>{weekTime(hour * 60)}</div>)}
      </div>
      {days.map(day => (
        <section key={day.key} aria-label={day.key} className={cn('relative border-l border-line', day.key === today && 'bg-panel')}>
          <div aria-hidden>{hours.map(hour => <div key={hour} className="border-b border-line-soft" style={{ height: HOUR_HEIGHT }} />)}</div>
          {packWeekEntries(day.timed).map(entry => {
            const description = `${weekTime(entry.start)}–${weekTime(entry.end)} · ${entry.title || t('untitledEvent')}`
            const className = cn(
              'absolute overflow-hidden rounded border px-1 text-left text-xs leading-3',
              entry.kind === 'calendar' ? 'border-line bg-sunken' : 'border-line bg-bg',
              entry.kind === 'proposal' && 'cursor-pointer border-dashed border-faint hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring',
            )
            const style = {
              top: (entry.start / 60 - gridStart) * HOUR_HEIGHT,
              height: (entry.visualEnd - entry.start) / 60 * HOUR_HEIGHT,
              left: `calc(${entry.lane / entry.lanes * 100}% + 2px)`,
              width: `calc(${100 / entry.lanes}% - 4px)`,
            }
            const content = <>
              <span className="flex items-center gap-0.5 font-mono text-[10px] text-muted-ink">
                {entry.kind === 'calendar' && <Lock className="size-2.5 shrink-0" aria-label={t('calendar')} />}
                {entry.done && <Check className="size-2.5 shrink-0 text-brand" aria-label={t('completed')} />}
                {weekTime(entry.start)}
              </span>
              <span className={cn('block truncate', entry.done && 'text-brand line-through')}>{entry.title || t('untitledEvent')}</span>
            </>
            return entry.decisionKey
              ? <button key={entry.key} type="button" className={className} style={style} title={description} aria-label={t('reviewProposal', { description })} onClick={() => openDecision(entry.key)}>{content}</button>
              : <div key={entry.key} className={className} style={style} title={description}>{content}</div>
          })}
        </section>
      ))}
    </div>
  )
}
