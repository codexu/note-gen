'use client'

// Fork (D2): native Today page, design v2 (personal/notegen-today-d2-redesign.html).
// #31：Today 分頁退役，內容拆成區塊放進首頁的「日程」卡片（版型 D）。
import useInboxStore, { selectStaleRecords } from '@/stores/inbox'
import { createContext, useContext, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  CalendarDays,
  ChevronUp,
  Clock,
  FileText,
  Inbox,
  List,
  MoreHorizontal,
  Moon,
  RefreshCw,
  Repeat,
  Sun,
  Target,
  Rows3,
  Zap,
  ListChecks,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { EmptyState } from '../page-ui'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { openDailyNote } from '@/lib/daily/open-daily-note'
import type { useCalendarEvents } from '@/lib/calendar/calendar'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { dateKey, daysBetween, type AgendaItem } from '@/lib/today/today-model'
import useVaultIndexStore from '@/stores/vault-index'
import { DailyCalendarPopover } from '../daily/daily-calendar'
import { QuickAdd } from './quick-add'
import { ScheduleButton, TASK_DRAG_MIME, taskDragKey, TimeBlocks } from './time-blocks'
import { useTodayActions } from './use-today-actions'
import { useTodayData } from './use-today-data'

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}


type TodayContextValue = ReturnType<typeof useTodayData> & ReturnType<typeof useTodayActions> & {
  /** 從首頁打開筆記：先做動作，再切回工作區。 */
  navigate: (action: () => unknown) => void
}

const TodayContext = createContext<TodayContextValue | null>(null)

export function TodayProvider({ children, onNavigate }: { children: React.ReactNode, onNavigate?: () => void }) {
  const data = useTodayData()
  const actions = useTodayActions({ now: data.now, tasks: data.tasks })
  const navigate = (action: () => unknown) => {
    void Promise.resolve(action()).finally(() => onNavigate?.())
  }
  const openNote = (path: string) => navigate(() => actions.openNote(path))
  return <TodayContext.Provider value={{ ...data, ...actions, openNote, navigate }}>{children}</TodayContext.Provider>
}

function useToday(): TodayContextValue {
  const value = useContext(TodayContext)
  if (!value) throw new Error('useToday must be used inside <TodayProvider>')
  return value
}

/** 首頁頂部的日期與摘要。 */
/** 頁首的標題與副標（日期；問候、現在時間、今天到期與逾期數）。要放在 TodayProvider 裡。 */
export function useTodayTitle() {
  const t = useTranslations('today')
  const locale = useLocale()
  const { now, groups } = useToday()
  const title = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(now)
  const hour = now.getHours()
  const greeting = hour < 12 ? t('greeting.morning') : hour < 18 ? t('greeting.afternoon') : t('greeting.evening')
  const todayGroup = groups.upcoming[0]
  const subtitle = (
    <>
      {greeting} · <span className="tabular-nums">{hhmm(now.getTime())}</span>
      {' · '}{t('summary', { today: todayGroup?.tasks.length ?? 0, overdue: groups.overdue.length })}
    </>
  )
  return { title, subtitle }
}

/** 本週七天、月曆、開今日筆記與更多動作。 */
export function TodayWeekNav() {
  const t = useTranslations('today')
  const locale = useLocale()
  const { now, week, dailyNote, indexStatus, stamp, navigate } = useToday()
  return (
    <>
      <nav className="flex gap-1" aria-label={t('week.label')}>
        {week.map(day => {
          const date = new Date(`${day.date}T00:00:00`)
          const label = new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(date)
          return (
            <button
              key={day.date}
              type="button"
              aria-current={day.isToday ? 'date' : undefined}
              aria-label={t('week.day', { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', weekday: 'short' }).format(date), open: day.open })}
              onClick={() => navigate(() => openDailyNote(date))}
              className={cn(
                'flex h-12 w-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-muted-foreground transition-colors hover:bg-accent',
                day.isToday && 'bg-active ring-1 ring-ink/40 ring-inset',
              )}
            >
              <span className="text-xs">{label}</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{date.getDate()}</span>
              <span className={cn('size-1.5 rounded-full', day.open > 0 ? 'bg-ink' : day.hasNote ? 'bg-muted-foreground/70' : 'bg-transparent')} />
            </button>
          )
        })}
        <DailyCalendarPopover selected={now}>
          <button
            type="button"
            aria-label={t('calendarNav.open')}
            title={t('calendarNav.open')}
            className="grid h-12 w-11 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <CalendarDays className="size-4" aria-hidden />
          </button>
        </DailyCalendarPopover>
      </nav>

      <div className="flex items-center gap-2">
        <Button className="h-10 gap-2 px-4 font-semibold" onClick={() => navigate(() => openDailyNote(now))}>
          <FileText className="size-4" aria-hidden />{t('openDaily')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" className="size-10" aria-label={t('moreActions')}>
              <MoreHorizontal className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={dailyNote?.morning} onSelect={() => stamp('morning')}>
              <Sun className="size-4" aria-hidden />{dailyNote?.morning ? t('morningDone') : t('morning')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={dailyNote?.reviewed} onSelect={() => stamp('review')}>
              <Moon className="size-4" aria-hidden />{dailyNote?.reviewed ? t('reviewDone') : t('review')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={indexStatus === 'scanning'} onSelect={() => void useVaultIndexStore.getState().rescan?.()}>
              <RefreshCw className="size-4" aria-hidden />{indexStatus === 'scanning' ? t('index.scanning') : t('index.rescan')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  )
}

/** 焦點：唯一要務、定調、三件 MIT。 */
export function TodayFocus() {
  const t = useTranslations('today')
  const { dailyNote } = useToday()
  const mits = dailyNote?.mits ?? []
  const mitDone = mits.filter(mit => mit.done).length
  return (
    <section className="@container rounded-xl bg-background p-5" aria-labelledby="today-one">
      <div className="grid grid-cols-[1.3fr_1fr] gap-6 @max-[36rem]:grid-cols-1">
        <div className="min-w-0">
          <div id="today-one" className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground">
            <Target className="size-4" aria-hidden />{t('oneThing')}
          </div>
          <p className="mt-1.5 text-2xl font-bold leading-snug [overflow-wrap:anywhere]">
            {dailyNote?.oneThing?.text || <span className="text-muted-foreground">{t('notFilled')}</span>}
          </p>
          {dailyNote?.tone && <p className="mt-1 text-sm text-muted-foreground">{t('tone', { tone: dailyNote.tone })}</p>}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t('mits', { done: mitDone, total: mits.length })}</div>
          {mits.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t('notFilled')}</p>}
          <ul className="mt-1.5 grid gap-1">
            {mits.map(mit => (
              <li key={mit.lineNo} className="flex min-h-11 items-center gap-2.5 rounded-lg px-2">
                <span className={cn('h-3.5 w-1 rounded-full', mit.priority >= 3 ? 'bg-ink' : 'bg-muted-foreground/60')} aria-hidden />
                <span className={cn('min-w-0 [overflow-wrap:anywhere]', mit.done && 'text-muted-foreground line-through')}>
                  {mit.text}
                  {mit.done && <span className="sr-only">{t('done')}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/** 任務：快速新增、帶入昨天、逾期／今天起七天／今天完成。 */
export function TodayTasks() {
  const t = useTranslations('today')
  const { now, groups, indexStatus, carryable, busy, addTask, carry, toggleTask, openNote, schedule } = useToday()
  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="today-tasks">
      <header className="mb-2.5 flex items-center gap-2.5">
        <h2 id="today-tasks" className="text-[15px] font-semibold">{t('tasks.title')}</h2>
        <span className="ml-auto text-xs text-muted-foreground">{t('tasks.counts', { pending: groups.pendingCount, done: groups.doneToday.length })}</span>
      </header>

      <QuickAdd now={now} busy={busy.has('quick-add')} onSubmit={addTask} />

      {carryable > 0 && (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-hover px-3 py-2.5">
          <ArrowDownToLine className="size-4 text-ink" aria-hidden />
          <p className="text-sm">{t('carry.prompt', { count: carryable })}</p>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto border-line text-ink"
            disabled={busy.has('carry')}
            onClick={carry}
          >
            {t('carry.action')}
          </Button>
        </div>
      )}

      {groups.pendingCount === 0 && groups.doneToday.length === 0 && (
        <EmptyState icon={ListChecks} text={indexStatus === 'ready' ? t('tasks.empty') : t('tasks.loading')} />
      )}

      {groups.overdue.length > 0 && (
        <TaskGroup
          heading={<><AlertTriangle className="size-3.5 text-destructive" aria-hidden />{t('tasks.overdue', { count: groups.overdue.length })}</>}
          tasks={groups.overdue}
          renderMeta={task => (
            <span className="rounded-md bg-hover px-1.5 py-0.5 text-xs text-ink font-medium">
              {t('tasks.lateBy', { days: daysBetween(task.due, dateKey(now)) })}
            </span>
          )}
          busy={busy}
          onToggle={toggleTask}
          onOpen={openNote}
          onSchedule={schedule}
        />
      )}
      {groups.upcoming.map(day => day.tasks.length > 0 && (
        <TaskGroup
          key={day.date}
          heading={t(`tasks.day${day.offset}` as 'tasks.day0', { count: day.tasks.length })}
          tasks={day.tasks}
          renderMeta={task => task.time
            ? <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums"><Clock className="size-3" aria-hidden />{task.time}</span>
            : null}
          busy={busy}
          onToggle={toggleTask}
          onOpen={openNote}
          onSchedule={schedule}
        />
      ))}
      {groups.doneToday.length > 0 && (
        <TaskGroup heading={t('tasks.doneToday', { count: groups.doneToday.length })} tasks={groups.doneToday} renderMeta={() => null} busy={busy} onToggle={toggleTask} onOpen={openNote} onSchedule={schedule} />
      )}
    </section>
  )
}

/** 今日時間軸（清單／時間區塊）。 */
export function TodayAgenda() {
  const { agenda, calendar, now, dropTask } = useToday()
  return <AgendaPanel agenda={agenda} calendar={calendar} now={now} onDropTask={dropTask} />
}

/** 今日足跡：捕捉、Inbox、復盤。 */
export function TodayFootprint() {
  const t = useTranslations('today')
  const { now, dailyNote, staleInbox, staleDays, navigate } = useToday()
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  // Fork（#46）：Inbox 積壓＝Inbox 資料夾裡放太久的筆記＋放太久沒整理的記錄；「去整理」打開 Inbox 頁
  const staleCount = staleInbox.length + selectStaleRecords({ records, processed }, staleDays, now).length
  return (
    <div className="grid gap-2.5">
      <Tile icon={<Zap className="size-4" aria-hidden />} value={String(dailyNote?.capture.total ?? 0)} label={t('capture.title')}
        detail={t('capture.detail', { flash: dailyNote?.capture.flash ?? 0, read: dailyNote?.capture.read ?? 0, task: dailyNote?.capture.task ?? 0 })} />
      <Tile icon={<Inbox className="size-4" aria-hidden />} warn={staleCount > 0} value={String(staleCount)} label={t('inbox.title')}
        detail={t('inbox.detail', { days: staleDays })}
        action={staleCount > 0 ? { label: t('inbox.action'), onClick: () => useInboxStore.getState().show() } : undefined} />
      <Tile icon={<Moon className="size-4" aria-hidden />} value={dailyNote?.reflection.filled ? t('reflection.filled') : t('reflection.empty')} label={t('reflection.title')}
        detail={dailyNote?.reviewed ? t('reviewDone') : t('reflection.detail')}
        action={{ label: t('reflection.action'), onClick: () => navigate(() => openDailyNote(now)) }} />
    </div>
  )
}

function TaskGroup({ heading, tasks, renderMeta, busy, onToggle, onOpen, onSchedule }: {
  heading: React.ReactNode
  tasks: TaskRef[]
  renderMeta: (task: TaskRef) => React.ReactNode
  busy: ReadonlySet<string>
  onToggle: (task: TaskRef, checked: boolean) => void
  onOpen: (path: string) => void
  onSchedule: (task: TaskRef, time: string) => void
}) {
  const t = useTranslations('today')
  return (
    <>
      <h3 className="flex items-center gap-1.5 px-2 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{heading}</h3>
      <ul className="grid gap-0.5">
        {tasks.map(task => (
          <li
            key={`${task.path}:${task.line}`}
            draggable={!task.done}
            onDragStart={event => {
              event.dataTransfer.setData(TASK_DRAG_MIME, taskDragKey(task))
              event.dataTransfer.effectAllowed = 'move'
            }}
            className={cn('group grid min-h-11 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-accent', !task.done && 'cursor-grab active:cursor-grabbing')}
          >
            <Checkbox
              className="size-[18px]"
              checked={task.done}
              disabled={busy.has(`${task.path}:${task.line}`)}
              onCheckedChange={checked => onToggle(task, checked === true)}
              aria-label={task.title}
            />
            <div className="min-w-0">
              <span className={cn('block [overflow-wrap:anywhere]', task.done && 'text-muted-foreground line-through')}>{task.title}</span>
              <button type="button" className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => onOpen(task.path)} aria-label={t('openSource', { name: task.path })}>
                {task.recurrence ? <Repeat className="size-3" aria-hidden /> : <FileText className="size-3" aria-hidden />}
                <span className="truncate">{task.recurrence ? `${task.recurrence} · ` : ''}{task.path}</span>
              </button>
            </div>
            <span className="flex items-center gap-1.5">
              {task.priority === 'high' && (
                <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-ink">
                  <ChevronUp className="size-3.5" aria-hidden />{t('priorityHigh')}
                </span>
              )}
              {renderMeta(task)}
              {!task.done && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <ScheduleButton task={task} disabled={busy.has(`${task.path}:${task.line}`)} onSchedule={onSchedule} />
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

const AGENDA_VIEW_KEY = 'notegen.today.agendaView'

function useAgendaView(): ['list' | 'blocks', (view: 'list' | 'blocks') => void] {
  const [view, setView] = useState<'list' | 'blocks'>(() => {
    try { return window.localStorage.getItem(AGENDA_VIEW_KEY) === 'blocks' ? 'blocks' : 'list' } catch { return 'list' }
  })
  return [view, next => {
    setView(next)
    try { window.localStorage.setItem(AGENDA_VIEW_KEY, next) } catch { /* 沒有 localStorage 就只記在這次 */ }
  }]
}

function AgendaPanel({ agenda, calendar, now, onDropTask }: {
  agenda: AgendaItem[]
  calendar: ReturnType<typeof useCalendarEvents>
  now: Date
  onDropTask: (dragKey: string, time: string) => void
}) {
  const t = useTranslations('today')
  const [view, setView] = useAgendaView()
  const [showPast, setShowPast] = useState(false)
  const past = agenda.filter(item => item.state === 'past')
  const visible = showPast ? agenda : agenda.filter(item => item.state !== 'past')
  // 「現在」線：放在進行中的項目之後；沒有進行中的就放在下一個項目之前；都過了就放最後
  const currentIndex = visible.findIndex(item => item.state === 'now')
  const nextIndex = visible.findIndex(item => item.state === 'upcoming')
  const markerAt = currentIndex >= 0 ? currentIndex + 1 : nextIndex >= 0 ? nextIndex : visible.length
  const nowMarker = (
    <li key="now-line" className="grid grid-cols-[44px_16px_1fr] items-center gap-2 text-xs font-semibold text-ink" aria-hidden>
      <span className="text-right tabular-nums">{hhmm(now.getTime())}</span>
      <span className="col-span-2 h-px bg-ink/50" />
    </li>
  )
  const rows: React.ReactNode[] = visible.map(item => <AgendaRow key={item.key} item={item} />)
  rows.splice(markerAt, 0, nowMarker)

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="today-agenda">
      <header className="mb-2.5 flex items-center gap-2.5">
        <h2 id="today-agenda" className="text-[15px] font-semibold">{t('agenda.title')}</h2>
        <div className="ml-auto flex rounded-lg bg-muted p-0.5" role="group" aria-label={t('agenda.view')}>
          {(['list', 'blocks'] as const).map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                'flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-foreground',
                view === option && 'bg-background text-foreground shadow-sm',
              )}
            >
              {option === 'list' ? <List className="size-3.5" aria-hidden /> : <Rows3 className="size-3.5" aria-hidden />}
              {t(`agenda.${option}`)}
            </button>
          ))}
        </div>
      </header>
      <p className="-mt-1.5 mb-2 text-xs text-muted-foreground">{t('agenda.sources')}</p>

      {(calendar.access === 'notDetermined' || calendar.access === 'denied') && (
        <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2 text-sm">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{calendar.access === 'denied' ? t('calendar.denied') : t('calendar.prompt')}</span>
          {calendar.access === 'notDetermined' && (
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void calendar.requestAccess()}>{t('calendar.connect')}</Button>
          )}
        </div>
      )}

      {view === 'blocks' && <TimeBlocks agenda={agenda} now={now} onDropTask={onDropTask} />}

      {view === 'list' && past.length > 0 && (
        <button type="button" className="cursor-pointer pb-2 pl-[68px] text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowPast(value => !value)} aria-expanded={showPast}>
          {showPast ? t('agenda.hidePast') : t('agenda.showPast', { count: past.length })}
        </button>
      )}

      {view === 'list' && (agenda.length === 0
        ? <EmptyState icon={Clock} text={t('agenda.empty')} />
        : (
          <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-[51px] before:w-px before:bg-border">
            {rows}
          </ol>
        ))}
    </section>
  )
}

function AgendaRow({ item }: { item: AgendaItem }) {
  const t = useTranslations('today')
  return (
    <li className="relative grid grid-cols-[44px_16px_minmax(0,1fr)] items-start gap-2 py-2">
      <time className={cn('pt-px text-right text-sm tabular-nums', item.state === 'past' ? 'text-muted-foreground/80' : 'text-muted-foreground')}>{hhmm(item.start)}</time>
      <span
        className={cn(
          'relative z-10 mt-1.5 ml-0.5 size-[11px] rounded-full border-2',
          item.state === 'now' ? 'border-ink bg-ink shadow-[0_0_0_4px] shadow-ink/15'
            : item.state === 'past' ? 'border-muted-foreground/60 bg-muted-foreground/60'
              : 'border-muted-foreground/60 bg-background',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div className={cn('[overflow-wrap:anywhere]', item.state === 'now' && 'font-semibold', item.state === 'past' && 'text-muted-foreground')}>{item.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {item.kind === 'task' ? <Clock className="size-3" aria-hidden /> : item.kind === 'calendar' ? <CalendarDays className="size-3" aria-hidden /> : null}
          {t(`agenda.kind.${item.kind}`)}
          {item.kind === 'calendar' && item.source ? ` · ${item.source}` : ''}
          {item.kind === 'task' ? ` · ${item.source.split('/').pop()}` : ''}
          {item.state === 'now' ? ` · ${t('agenda.until', { time: hhmm(item.end), minutes: item.minutesLeft })}` : ''}
        </div>
        {item.state === 'now' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-muted" role="progressbar" aria-label={item.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)}>
            <div className="h-full rounded bg-ink" style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
      </div>
    </li>
  )
}

function Tile({ icon, value, label, detail, warn, action }: {
  icon: React.ReactNode
  value: string
  label: string
  detail: string
  warn?: boolean
  action?: { label: string, onClick: () => void }
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-background px-4 py-3.5">
      <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground', warn && 'bg-hover text-ink')}>{icon}</span>
      <div className="min-w-0">
        <div><b className="text-lg tabular-nums">{value}</b> <span className="text-sm">{label}</span></div>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      {action && (
        <Button size="sm" variant="secondary" className="ml-auto" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
