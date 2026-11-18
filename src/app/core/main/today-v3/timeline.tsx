'use client'

// Fork（almanac ALMNC-16.2）：v5 的左欄時間軸。06–24，行事曆事件是灰底唯讀、任務與日誌時段是 ink 疊透明底，現在是一條 ink 線。
import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TimelineEntry, TimelineProposal, TimelineView } from '@/lib/today-v3/layout'
import { LABEL } from './styles'

/** 一小時的高度（px）。 */
export const HOUR_PX = 44
/** 事件文字左邊留給小時標籤的寬度。 */
const GUTTER_PX = 40

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function minutesToClock(min: number): string {
  return `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`
}

function Entry({ entry, startHour, onOpenTask }: { entry: TimelineEntry, startHour: number, onOpenTask: (path: string) => void }) {
  const t = useTranslations('todayV3.timeline')
  const top = ((entry.startMin - startHour * 60) / 60) * HOUR_PX + 1
  const height = Math.max(((entry.endMin - entry.startMin) / 60) * HOUR_PX - 3, 20)
  const width = `calc((100% - ${GUTTER_PX}px) / ${entry.lanes})`
  const left = `calc(${GUTTER_PX}px + ${width} * ${entry.lane})`
  const calendar = entry.kind === 'calendar'
  const clickable = entry.kind === 'task' && entry.task
  const className = cn(
    'absolute overflow-hidden rounded-md px-2 py-[5px] text-left text-xs leading-4 transition-colors duration-100',
    calendar ? 'bg-sunken' : 'border border-line bg-hover hover:bg-active',
    clickable && 'cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
  )
  const body = (
    <>
      <span className={cn(calendar ? 'font-normal text-muted-ink' : 'font-medium text-ink')}>{entry.title}</span>{' '}
      <span className="font-mono text-[10.5px] text-muted-ink">{entry.time}</span>
      {calendar && <Lock aria-label={t('readOnly')} className="absolute top-1.5 right-1.5 size-3 text-faint" />}
    </>
  )
  const style = { top, height, left, width: `calc(${width} - 2px)` }
  return clickable
    ? <button type="button" className={className} style={style} data-kind={entry.kind} onClick={() => onOpenTask(entry.task!.path)}>{body}</button>
    : <div className={className} style={style} data-kind={entry.kind}>{body}</div>
}

/** 排程員的時段提案：虛線框，收下／不要直接走等你定（ALMNC-16）。 */
function ProposalBlock({ proposal, startHour, busy, onAccept, onReject }: {
  proposal: TimelineProposal, startHour: number, busy: boolean, onAccept: () => void, onReject: () => void,
}) {
  const t = useTranslations('todayV3.timeline')
  const top = ((proposal.startMin - startHour * 60) / 60) * HOUR_PX + 1
  // 30 分鐘只有 22px，放不下標籤、標題與收下／不要：至少留三行加按鈕的高度
  const height = Math.max(((proposal.endMin - proposal.startMin) / 60) * HOUR_PX - 3, 66)
  return (
    <div
      className="absolute z-[1] flex flex-col overflow-hidden rounded-md border border-dashed border-line bg-bg px-2 py-[5px] text-xs leading-4"
      style={{ top, height, left: GUTTER_PX, right: 0 }}
      data-kind="proposal"
      data-testid="today-v3-proposal"
    >
      <span className="text-[10.5px] text-faint">{t('proposal')}</span>
      <span className="font-medium text-ink">{proposal.title} <span className="font-mono text-[10.5px] text-muted-ink">{proposal.time}–{proposal.end}</span></span>
      <span className="mt-auto flex gap-3 pt-1">
        <button type="button" disabled={busy} onClick={onAccept} className="cursor-pointer rounded-sm font-medium text-ink outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50">{t('accept')}</button>
        <button type="button" disabled={busy} onClick={onReject} className="cursor-pointer rounded-sm text-muted-ink outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50">{t('reject')}</button>
      </span>
    </div>
  )
}

export function Timeline({ view, dayKey, onOpenTask, noAccess, proposals = [], busyKey = null, onAccept, onReject }: {
  view: TimelineView
  /** 顯示哪一天（YYYY-MM-DD）；換日時捲動位置重設。 */
  dayKey: string
  onOpenTask: (path: string) => void
  noAccess: boolean
  proposals?: TimelineProposal[]
  busyKey?: string | null
  onAccept?: (key: string) => void
  onReject?: (key: string) => void
}) {
  const t = useTranslations('todayV3.timeline')
  const hours = Array.from({ length: view.endHour - view.startHour + 1 }, (_, i) => view.startHour + i)
  const height = (view.endHour - view.startHour) * HOUR_PX
  const nowRef = useRef<HTMLDivElement>(null)

  const rootRef = useRef<HTMLDivElement>(null)

  // 進來時、換日時：今天把現在線捲到可視範圍中段，別天捲回頂端
  useEffect(() => {
    if (nowRef.current) nowRef.current.scrollIntoView({ block: 'center' })
    else rootRef.current?.scrollIntoView({ block: 'start' })
    // 只在第一次顯示與換日時捲動（現在線每分鐘移動不重捲）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey])

  return (
    <div ref={rootRef}>
      <div className={LABEL}>{t('label')}</div>
      {view.allDay.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {view.allDay.map(title => (
            <span key={title} className="rounded-md bg-sunken px-2 py-0.5 text-xs text-muted-ink"><span className="mr-1 text-faint">{t('allDay')}</span>{title}</span>
          ))}
        </div>
      )}
      {noAccess && <p className="mt-2 text-xs text-faint">{t('noAccess')}</p>}
      <div className="relative mt-3" style={{ height }} data-testid="today-v3-timeline">
        {hours.map(hour => (
          <div key={hour} className="absolute right-0 left-0 h-0 border-t border-line-soft" style={{ top: (hour - view.startHour) * HOUR_PX }}>
            <span className="absolute top-[-8px] left-0 bg-bg pr-1.5 font-mono text-[10.5px] leading-4 text-faint">{pad(hour)}</span>
          </div>
        ))}
        {view.entries.map(entry => <Entry key={entry.key} entry={entry} startHour={view.startHour} onOpenTask={onOpenTask} />)}
        {proposals.map(proposal => (
          <ProposalBlock
            key={proposal.key}
            proposal={proposal}
            startHour={view.startHour}
            busy={busyKey === proposal.key}
            onAccept={() => onAccept?.(proposal.key)}
            onReject={() => onReject?.(proposal.key)}
          />
        ))}
        {view.nowMin !== null && (
          <div
            ref={nowRef}
            className="absolute right-0 left-7 z-[2] h-0 border-t border-ink before:absolute before:top-[-3.5px] before:left-0 before:size-1.5 before:rounded-full before:bg-ink before:content-['']"
            style={{ top: ((view.nowMin - view.startHour * 60) / 60) * HOUR_PX }}
            data-testid="today-v3-now"
            aria-label={`${t('now')} ${minutesToClock(view.nowMin)}`}
          >
            <span className="absolute top-[-8px] left-[-28px] bg-bg font-mono text-[10px] leading-4 font-semibold text-ink">{view.nowTime}</span>
          </div>
        )}
      </div>
    </div>
  )
}
