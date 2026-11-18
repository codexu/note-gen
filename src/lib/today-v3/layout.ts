// Fork（almanac ALMNC-16.2）：v5「今天」主畫面的版面資料組裝。純函式、無 I/O；now 由參數注入。
// 把今日日誌、任務、行事曆、等你定、收集組成三欄所需資料：
//   左欄  06–24 時間軸（行程、帶時間的任務、日誌錨點、現在時間線）
//   中欄  日誌段落、今天要完成
//   右欄  等你定、今天收進來
// 頂部摘要的數字全部來自這裡算出的本地事實，不由模型生成。
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import type { DailyNote } from '@/lib/daily/daily-note'
import type { DecideItem } from '@/lib/decide/project'
import { buildAgenda, dateKey, daysBetween, groupTasks, type AgendaItem, type CalendarEvent } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'

export const TIMELINE_START_HOUR = 6
export const TIMELINE_END_HOUR = 24
export const JOURNAL_MAX_PARAGRAPHS = 8
export const DECIDE_RAIL_LIMIT = 5
export const CAPTURE_RAIL_LIMIT = 4

const MINUTES_PER_DAY = 24 * 60

// ---------- 日期 ----------

export interface DateHeading {
  month: number
  day: number
  /** 0 = 週日 … 6 = 週六 */
  weekday: number
  /** ISO 週數 */
  week: number
}

/** ISO 8601 週數（週一起算，含 1/4 的那週為第 1 週）。 */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
}

export function dateHeading(now: Date): DateHeading {
  return { month: now.getMonth() + 1, day: now.getDate(), weekday: now.getDay(), week: isoWeek(now) }
}

// ---------- 日誌 ----------

export interface JournalView {
  /** 「最重要的一件事」，有才顯示成大標。 */
  heading: string | null
  paragraphs: string[]
}

const INLINE_FIELD_RE = /^[\w一-鿿-]+::/u
const NON_PROSE_RE = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<!--|---\s*$|```|\[[ xX]\]|!\[)/u

/** 日誌裡的散文段落：略過 frontmatter、標題、清單與任務、引言、表格、行內欄位（key:: value）。取最後幾段。 */
export function extractJournalParagraphs(content: string | null, max = JOURNAL_MAX_PARAGRAPHS): string[] {
  if (!content) return []
  const body = splitFrontmatter(content).body
  const paragraphs: string[] = []
  let inFence = false
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\r$/, '').trim()
    if (line.startsWith('```')) { inFence = !inFence; continue }
    if (inFence || !line || NON_PROSE_RE.test(line) || INLINE_FIELD_RE.test(line)) continue
    paragraphs.push(line)
  }
  return paragraphs.slice(-max)
}

export function buildJournalView(content: string | null, dailyNote: DailyNote | null): JournalView {
  return { heading: dailyNote?.oneThing?.text || null, paragraphs: extractJournalParagraphs(content) }
}

// ---------- 時間軸 ----------

export interface TimelineEntry {
  key: string
  kind: AgendaItem['kind']
  title: string
  /** 從 00:00 起算的分鐘，已夾在 06–24 之內。 */
  startMin: number
  endMin: number
  /** 實際開始時間（顯示用 HH:mm）。 */
  time: string
  state: AgendaItem['state']
  /** 同時段重疊時並排：第幾欄／共幾欄。 */
  lane: number
  lanes: number
  task?: TaskRef
}

export interface TimelineView {
  startHour: number
  endHour: number
  entries: TimelineEntry[]
  /** 全天行事曆事件（不上軸，列在軸上方）。 */
  allDay: string[]
  /** 現在線位置（分鐘）；現在不在 06–24 之內時為 null。 */
  nowMin: number | null
  nowTime: string
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function minuteOfDay(ms: number, now: Date): number {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((ms - dayStart) / 60_000)
}

/** 重疊的項目排成並排欄：連通的一群共用欄數。 */
function assignLanes(entries: Array<Omit<TimelineEntry, 'lane' | 'lanes'>>): TimelineEntry[] {
  const out: TimelineEntry[] = entries.map(entry => ({ ...entry, lane: 0, lanes: 1 }))
  let cluster: TimelineEntry[] = []
  let clusterEnd = -1
  const flush = () => {
    const laneEnds: number[] = []
    for (const entry of cluster) {
      let lane = laneEnds.findIndex(end => end <= entry.startMin)
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(0) }
      laneEnds[lane] = entry.endMin
      entry.lane = lane
    }
    for (const entry of cluster) entry.lanes = Math.max(1, laneEnds.length)
    cluster = []
    clusterEnd = -1
  }
  for (const entry of out) {
    if (cluster.length && entry.startMin >= clusterEnd) flush()
    cluster.push(entry)
    clusterEnd = Math.max(clusterEnd, entry.endMin)
  }
  if (cluster.length) flush()
  return out
}

export function buildTimeline(input: {
  now: Date
  dailyNote: DailyNote | null
  tasks: readonly TaskRef[]
  events: readonly CalendarEvent[]
}): TimelineView {
  const { now } = input
  const lo = TIMELINE_START_HOUR * 60
  const hi = TIMELINE_END_HOUR * 60
  const agenda = buildAgenda(input)
  const placed: Array<Omit<TimelineEntry, 'lane' | 'lanes'>> = []
  for (const item of agenda) {
    const start = minuteOfDay(item.start, now)
    const end = minuteOfDay(item.end, now)
    if (end <= lo || start >= hi) continue
    placed.push({
      key: item.key,
      kind: item.kind,
      title: item.title,
      startMin: Math.max(lo, start),
      endMin: Math.min(hi, Math.max(end, start + 15)),
      time: clock(item.start),
      state: item.state,
      task: item.task,
    })
  }
  placed.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const current = now.getHours() * 60 + now.getMinutes()
  return {
    startHour: TIMELINE_START_HOUR,
    endHour: TIMELINE_END_HOUR,
    entries: assignLanes(placed),
    allDay: input.events.filter(event => event.allDay).map(event => event.title),
    nowMin: current >= lo && current <= Math.min(hi, MINUTES_PER_DAY) ? current : null,
    nowTime: clock(now.getTime()),
  }
}

// ---------- 今天要完成 ----------

export type TodoDue = { kind: 'time', time: string } | { kind: 'overdue', days: number } | { kind: 'none' }

export interface TodoItem {
  key: string
  title: string
  done: boolean
  due: TodoDue
  /** 逾期，或今天有時間的未完成任務。 */
  hot: boolean
  task: TaskRef
}

export interface TodoView {
  items: TodoItem[]
  doneCount: number
  total: number
  openCount: number
}

function todoItem(task: TaskRef, today: string): TodoItem {
  const overdue = !task.done && !!task.due && task.due < today
  const due: TodoDue = overdue
    ? { kind: 'overdue', days: daysBetween(task.due, today) }
    : task.time ? { kind: 'time', time: task.time } : { kind: 'none' }
  return { key: `${task.path}:${task.line}`, title: task.title, done: task.done, due, hot: overdue, task }
}

/** 逾期與今天到期、未完成的任務在前，今天完成的接在後。 */
export function buildTodo(tasks: readonly TaskRef[], now: Date): TodoView {
  const today = dateKey(now)
  const groups = groupTasks(tasks, now)
  const open = [...groups.overdue, ...(groups.upcoming[0]?.tasks ?? [])]
  const items = [...open.map(task => todoItem(task, today)), ...groups.doneToday.map(task => todoItem(task, today))]
  return { items, doneCount: groups.doneToday.length, total: items.length, openCount: open.length }
}

// ---------- 右欄 ----------

export interface DecideRailItem {
  key: string
  title: string
  kind: DecideItem['kind']
  origin: string
  when: string
  item: DecideItem
}

export interface DecideRailView {
  count: number
  items: DecideRailItem[]
}

export function buildDecideRail(decisions: readonly DecideItem[], limit = DECIDE_RAIL_LIMIT): DecideRailView {
  return {
    count: decisions.length,
    items: decisions.slice(0, limit).map(item => ({
      key: item.key,
      title: item.source === 'draft' ? item.summary || item.title : item.title,
      kind: item.kind,
      origin: item.origin,
      when: item.when,
      item,
    })),
  }
}

/** 結構型別，不綁定 store。 */
export interface CaptureLike {
  id: string
  createdAt: number
  state: 'reading' | 'ready'
  input: { kind: 'text' | 'link' | 'image' | 'file', text: string, name?: string }
}

export interface CaptureRailItem {
  key: string
  kind: CaptureLike['input']['kind']
  title: string
  time: string
  loading: boolean
}

export interface CaptureRailView {
  total: number
  items: CaptureRailItem[]
}

function captureTitle(input: CaptureLike['input']): string {
  if (input.name) return input.name
  const first = input.text.trim().split('\n')[0] ?? ''
  return Array.from(first).slice(0, 48).join('')
}

/** 今天（本地日曆日）收進來的項目，新的在前。 */
export function buildCaptureRail(items: readonly CaptureLike[], now: Date, limit = CAPTURE_RAIL_LIMIT): CaptureRailView {
  const today = dateKey(now)
  const mine = items
    .filter(item => dateKey(new Date(item.createdAt)) === today)
    .sort((a, b) => b.createdAt - a.createdAt)
  return {
    total: mine.length,
    items: mine.slice(0, limit).map(item => ({
      key: item.id,
      kind: item.input.kind,
      title: captureTitle(item.input),
      time: clock(item.createdAt),
      loading: item.state === 'reading',
    })),
  }
}

// ---------- 整頁 ----------

export interface TodayV3Layout {
  heading: DateHeading
  /** 頂部摘要的三個數字（本地事實）。 */
  summary: { events: number, openTasks: number, decisions: number }
  timeline: TimelineView
  journal: JournalView
  todo: TodoView
  decide: DecideRailView
  captures: CaptureRailView
}

export interface TodayV3Input {
  now: Date
  /** 今日日誌全文；沒有檔案為 null。 */
  journalContent: string | null
  dailyNote: DailyNote | null
  tasks: readonly TaskRef[]
  events: readonly CalendarEvent[]
  decisions: readonly DecideItem[]
  captures: readonly CaptureLike[]
}

export function buildTodayLayout(input: TodayV3Input): TodayV3Layout {
  const { now } = input
  const todo = buildTodo(input.tasks, now)
  const decide = buildDecideRail(input.decisions)
  return {
    heading: dateHeading(now),
    summary: { events: input.events.length, openTasks: todo.openCount, decisions: decide.count },
    timeline: buildTimeline({ now, dailyNote: input.dailyNote, tasks: input.tasks, events: input.events }),
    journal: buildJournalView(input.journalContent, input.dailyNote),
    todo,
    decide,
    captures: buildCaptureRail(input.captures, now),
  }
}
