'use client'

// Fork (D8): time blocks. Drag a task onto today's timeline to write `📅 today ⏰ HH:mm`
// (15-minute slots); the clock button on each task is the keyboard alternative.
import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Clock, GripVertical } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { minutesToSlot, SLOT_MINUTES } from '@/lib/today/schedule'
import type { AgendaItem } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'

export const TASK_DRAG_MIME = 'application/x-notegen-task'

const HOUR_PX = 48
const PX_PER_MIN = HOUR_PX / 60
const MIN_BLOCK_PX = 20

export function taskDragKey(task: Pick<TaskRef, 'path' | 'line'>): string {
  return `${task.path}\n${task.line}`
}

function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

function hhmm(ms: number): string {
  return minutesToSlot(minutesOfDay(ms), 1)
}

/** 重疊的項目並排：同一群重疊項目平分寬度。 */
function layoutLanes(items: AgendaItem[]): Map<string, { lane: number, lanes: number }> {
  const out = new Map<string, { lane: number, lanes: number }>()
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end)
  let cluster: AgendaItem[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const item of cluster) out.set(item.key, { lane: out.get(item.key)!.lane, lanes: laneEnds.length })
    cluster = []
    laneEnds = []
  }
  for (const item of sorted) {
    if (item.start >= clusterEnd) flush()
    let lane = laneEnds.findIndex(end => end <= item.start)
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(item.end) } else laneEnds[lane] = item.end
    out.set(item.key, { lane, lanes: 1 })
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.end)
  }
  flush()
  return out
}

export function TimeBlocks({ agenda, now, onDropTask }: {
  agenda: AgendaItem[]
  now: Date
  onDropTask: (dragKey: string, time: string) => void
}) {
  const t = useTranslations('today.timeBlocks')
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  /** 拖曳既有區塊時，抓的位置距離區塊頂端幾分鐘 */
  const grabOffsetRef = useRef(0)
  const [ghost, setGhost] = useState<string | null>(null)

  const nowMin = now.getHours() * 60 + now.getMinutes()
  const { startHour, endHour } = useMemo(() => {
    let first = Math.min(7, Math.floor(nowMin / 60))
    let last = Math.max(22, Math.ceil(nowMin / 60))
    for (const item of agenda) {
      first = Math.min(first, Math.floor(minutesOfDay(item.start) / 60))
      last = Math.max(last, Math.ceil(Math.min(minutesOfDay(item.end - 1) + 1, 24 * 60) / 60))
    }
    return { startHour: first, endHour: Math.min(24, last) }
  }, [agenda, nowMin])
  const lanes = useMemo(() => layoutLanes(agenda), [agenda])
  const top = (minutes: number) => (minutes - startHour * 60) * PX_PER_MIN

  // 打開時捲到「現在」附近
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, top(nowMin) - el.clientHeight / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startHour])

  function slotAt(clientY: number): string {
    const rect = gridRef.current!.getBoundingClientRect()
    const minutes = startHour * 60 + (clientY - rect.top) / PX_PER_MIN - grabOffsetRef.current
    return minutesToSlot(minutes)
  }

  return (
    <div ref={scrollRef} className="max-h-[560px] overflow-y-auto pr-1">
      <div
        ref={gridRef}
        className="relative ml-12"
        style={{ height: (endHour - startHour) * HOUR_PX }}
        onDragOver={event => {
          if (!event.dataTransfer.types.includes(TASK_DRAG_MIME)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setGhost(slotAt(event.clientY))
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGhost(null)
        }}
        onDrop={event => {
          const key = event.dataTransfer.getData(TASK_DRAG_MIME)
          setGhost(null)
          if (!key) return
          event.preventDefault()
          onDropTask(key, slotAt(event.clientY))
          grabOffsetRef.current = 0
        }}
        aria-label={t('label')}
      >
        {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
          <div key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: i * HOUR_PX }}>
            <span className="absolute -top-2 -left-12 w-10 text-right text-xs tabular-nums text-muted-foreground">
              {String(startHour + i).padStart(2, '0')}:00
            </span>
          </div>
        ))}

        {agenda.map(item => {
          const lane = lanes.get(item.key) ?? { lane: 0, lanes: 1 }
          const startMin = minutesOfDay(item.start)
          const height = Math.max(MIN_BLOCK_PX, (item.end - item.start) / 60_000 * PX_PER_MIN - 2)
          const draggable = item.kind === 'task' && !!item.task
          return (
            <div
              key={item.key}
              draggable={draggable}
              onDragStart={draggable
                ? event => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  grabOffsetRef.current = (event.clientY - rect.top) / PX_PER_MIN
                  event.dataTransfer.setData(TASK_DRAG_MIME, taskDragKey(item.task!))
                  event.dataTransfer.effectAllowed = 'move'
                }
                : undefined}
              onDragEnd={() => { grabOffsetRef.current = 0; setGhost(null) }}
              className={cn(
                'absolute overflow-hidden rounded-md border-l-2 px-2 py-0.5 text-xs leading-tight',
                item.kind === 'task' && 'cursor-grab border-line bg-hover active:cursor-grabbing',
                item.kind === 'calendar' && 'border-muted-foreground/60 bg-muted',
                item.kind === 'anchor' && 'border border-dashed border-muted-foreground/40 bg-background',
                item.state === 'past' && 'opacity-60',
                item.state === 'now' && 'ring-1 ring-ink/60',
              )}
              style={{
                top: top(startMin) + 1,
                height,
                left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
                width: `calc(${100 / lane.lanes}% - 4px)`,
              }}
              title={`${hhmm(item.start)}–${hhmm(item.end)} ${item.title}`}
            >
              <div className="flex items-center gap-1">
                {item.kind === 'calendar' ? <CalendarDays className="size-3 shrink-0" aria-hidden /> : item.kind === 'task' ? <GripVertical className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className="shrink-0 tabular-nums text-muted-foreground">{hhmm(item.start)}</span>
                <span className={cn('truncate', item.state === 'now' && 'font-semibold')}>{item.title}</span>
              </div>
            </div>
          )
        })}

        {nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
          <div className="pointer-events-none absolute inset-x-0 z-10 h-px bg-ink" style={{ top: top(nowMin) }} aria-hidden>
            <span className="absolute -top-1 -left-1 size-2 rounded-full bg-ink" />
          </div>
        )}

        {ghost && (
          <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-dashed border-ink" style={{ top: top(Number(ghost.slice(0, 2)) * 60 + Number(ghost.slice(3))) }} aria-hidden>
            <span className="absolute -top-3 right-0 rounded bg-invert px-1.5 text-xs font-semibold text-invert-ink tabular-nums">{ghost}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('hint', { minutes: SLOT_MINUTES })}</p>
    </div>
  )
}

/** 鍵盤也能排時間：任務列上的時鐘按鈕。 */
export function ScheduleButton({ task, disabled, onSchedule }: {
  task: TaskRef
  disabled?: boolean
  onSchedule: (task: TaskRef, time: string) => void
}) {
  const t = useTranslations('today.timeBlocks')
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState(task.time || '09:00')

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setTime(task.time || '09:00') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
          aria-label={t('schedule', { name: task.title })}
          title={t('scheduleShort')}
        >
          <Clock className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60">
        <form
          className="flex flex-col gap-2"
          onSubmit={event => {
            event.preventDefault()
            if (!/^\d{2}:\d{2}$/.test(time)) return
            setOpen(false)
            onSchedule(task, time)
          }}
        >
          <label className="text-sm font-medium" htmlFor={`schedule-${task.path}-${task.line}`}>{t('timeLabel')}</label>
          <Input id={`schedule-${task.path}-${task.line}`} type="time" step={SLOT_MINUTES * 60} value={time} onChange={event => setTime(event.target.value)} />
          <p className="text-xs text-muted-foreground">{t('timeHelp')}</p>
          <div className="flex justify-end gap-2">
            {task.time && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); onSchedule(task, '') }}>{t('clear')}</Button>
            )}
            <Button type="submit" size="sm">{t('apply')}</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
