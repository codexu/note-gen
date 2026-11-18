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

/** 兩個時間是不是同一個本地日曆日。 */
export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function buildTimeline(input: {
  now: Date
  /** 時間軸顯示哪一天；省略為 now 那天。現在線只在 day 是今天時畫。 */
  day?: Date
  dailyNote: DailyNote | null
  tasks: readonly TaskRef[]
  events: readonly CalendarEvent[]
}): TimelineView {
  const { now } = input
  const day = input.day ?? now
  const viewingToday = isSameDay(day, now)
  const lo = TIMELINE_START_HOUR * 60
  const hi = TIMELINE_END_HOUR * 60
  // 別天：以那天為基準組行程（任務的 due、日誌時段都對那天）；狀態（過去／進行中）只對今天有意義
  const agenda = buildAgenda({ ...input, now: viewingToday ? now : day })
  const placed: Array<Omit<TimelineEntry, 'lane' | 'lanes'>> = []
  for (const item of agenda) {
    const start = minuteOfDay(item.start, day)
    const end = minuteOfDay(item.end, day)
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
    nowMin: viewingToday && current >= lo && current <= Math.min(hi, MINUTES_PER_DAY) ? current : null,
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

/** 逾期與今天到期、未完成的任務在前，今天完成的接在後。day 是別天時：只列那天到期的任務（未完成在前、已完成在後）。 */
export function buildTodo(tasks: readonly TaskRef[], now: Date, day: Date = now): TodoView {
  if (!isSameDay(day, now)) return buildDayTodo(tasks, day)
  const today = dateKey(now)
  const groups = groupTasks(tasks, now)
  const open = [...groups.overdue, ...(groups.upcoming[0]?.tasks ?? [])]
  const items = [...open.map(task => todoItem(task, today)), ...groups.doneToday.map(task => todoItem(task, today))]
  return { items, doneCount: groups.doneToday.length, total: items.length, openCount: open.length }
}

function byTimeThenTitle(a: TaskRef, b: TaskRef): number {
  if (a.time !== b.time) return !a.time ? 1 : !b.time ? -1 : a.time < b.time ? -1 : 1
  return a.title.localeCompare(b.title)
}

/** 別天的待辦：那天到期（📅）的任務，不算逾期；有時間的排前面。 */
function buildDayTodo(tasks: readonly TaskRef[], day: Date): TodoView {
  const key = dateKey(day)
  const mine = tasks.filter(task => task.due === key)
  const open = mine.filter(task => !task.done).sort(byTimeThenTitle)
  const done = mine.filter(task => task.done).sort(byTimeThenTitle)
  return {
    items: [...open, ...done].map(task => todoItem(task, key)),
    doneCount: done.length,
    total: mine.length,
    openCount: open.length,
  }
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
  /** 現在時間（現在線、右欄「今天收進來」以它為準）。 */
  now: Date
  /** 主畫面顯示哪一天；省略為今天。日誌、行事曆事件、任務都對這一天。 */
  day?: Date
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
  const day = input.day ?? now
  const todo = buildTodo(input.tasks, now, day)
  const decide = buildDecideRail(input.decisions)
  return {
    heading: dateHeading(day),
    summary: { events: input.events.length, openTasks: todo.openCount, decisions: decide.count },
    timeline: buildTimeline({ now, day, dailyNote: input.dailyNote, tasks: input.tasks, events: input.events }),
    journal: buildJournalView(input.journalContent, input.dailyNote),
    todo,
    decide,
    captures: buildCaptureRail(input.captures, now),
  }
}

/** ALMNC-16：排程員提的時段（等你定裡待決的），畫在時間軸上的虛線框。 */
export interface TimelineProposal {
  key: string
  title: string
  time: string
  end: string
  startMin: number
  endMin: number
}

export const PROPOSAL_MINUTES = 30

function clockToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return Number(match[1]) < 24 && Number(match[2]) < 60 ? minutes : null
}

/** 把待決時段轉成時間軸區塊：時間格式錯誤或落在 06–24 之外的不畫，依開始時間排序。 */
export function buildProposalBlocks(
  pending: ReadonlyArray<{ key: string, title: string, time: string }>,
  startHour = TIMELINE_START_HOUR,
  endHour = TIMELINE_END_HOUR,
): TimelineProposal[] {
  return pending.flatMap(slot => {
    const start = clockToMinutes(slot.time)
    if (start === null || start < startHour * 60 || start >= endHour * 60) return []
    const end = Math.min(start + PROPOSAL_MINUTES, endHour * 60)
    const label = `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
    return [{ key: slot.key, title: slot.title, time: slot.time, end: label, startMin: start, endMin: end }]
  }).sort((a, b) => a.startMin - b.startMin)
}
