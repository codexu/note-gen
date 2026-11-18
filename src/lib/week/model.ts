import { toDateKey } from '@/lib/daily/format'
import { slotToMinutes } from '@/lib/today/schedule'
import type { CalendarEvent } from '@/lib/today/today-model'
import type { TaskRef } from '@/lib/vault-index/index-core'
import { localDay, weekDays } from './dates'

type EntryKind = 'calendar' | 'task' | 'proposal'

interface WeekEntry {
  key: string
  kind: EntryKind
  title: string
  done?: boolean
  decisionKey?: string
}

export interface TimedWeekEntry extends WeekEntry {
  start: number
  end: number
}

export interface WeekPlanDay {
  date: Date
  key: string
  untimed: WeekEntry[]
  timed: TimedWeekEntry[]
}

export interface WeekSlot {
  key: string
  title: string
  due: string
  time: string
}

const DAY_MINUTES = 24 * 60
const TASK_MINUTES = 30
const MIN_CARD_MINUTES = 25

function minuteOfDay(time: number): number {
  const date = new Date(time)
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
}

export function weekTime(minutes: number): string {
  const whole = Math.floor(minutes)
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

export function buildWeekPlan(input: {
  start: Date
  events: readonly CalendarEvent[]
  tasks: readonly TaskRef[]
  pathFor: (date: Date) => string
  proposals?: readonly WeekSlot[]
}): WeekPlanDay[] {
  const { start, events, tasks, pathFor, proposals = [] } = input
  const days = weekDays(start).map((date): WeekPlanDay => ({ date, key: toDateKey(date), timed: [], untimed: [] }))
  const byDate = new Map(days.map(day => [day.key, day]))
  const byPath = new Map(days.map(day => [pathFor(day.date), day]))

  for (const day of days) {
    const start = day.date.getTime()
    const end = localDay(day.date, 1).getTime()
    for (const event of events) {
      if (!(event.start < end && event.end > start && event.end > event.start)) continue
      const entry = { key: `calendar:${event.id}:${event.start}`, kind: 'calendar' as const, title: event.title }
      if (event.allDay) {
        day.untimed.push(entry)
      } else {
        const from = event.start <= start ? 0 : minuteOfDay(event.start)
        const to = event.end >= end ? DAY_MINUTES : minuteOfDay(event.end)
        // A clock change may fold the wall-clock end before its start.
        const fallbackEnd = from + (event.end - event.start) / 60_000
        day.timed.push({ ...entry, start: from, end: Math.min(DAY_MINUTES, to > from ? to : fallbackEnd) })
      }
    }
  }

  for (const task of tasks) {
    const day = task.due ? byDate.get(task.due) : byPath.get(task.path)
    if (!day || !task.title) continue
    const entry = { key: `task:${task.path}:${task.line}`, kind: 'task' as const, title: task.title, done: task.done }
    addTaskEntry(day, entry, task.time)
  }
  for (const slot of proposals) {
    const day = byDate.get(slot.due)
    if (day) addTaskEntry(day, { key: slot.key, kind: 'proposal', title: slot.title, decisionKey: slot.key }, slot.time)
  }
  for (const day of days) day.timed.sort((a, b) => a.start - b.start)
  return days
}

function addTaskEntry(day: WeekPlanDay, entry: WeekEntry, time: string) {
  const start = slotToMinutes(time)
  if (start >= 0 && start < DAY_MINUTES) day.timed.push({ ...entry, start, end: Math.min(DAY_MINUTES, start + TASK_MINUTES) })
  else day.untimed.push(entry)
}

/** Assign lane widths per contiguous overlap group, including the minimum card height. */
export function packWeekEntries(entries: readonly TimedWeekEntry[]) {
  const packed: Array<TimedWeekEntry & { visualEnd: number, lane: number, lanes: number }> = []
  let groupStart = 0
  let ends: number[] = []
  function finishGroup() {
    for (let i = groupStart; i < packed.length; i++) packed[i].lanes = ends.length
  }
  for (const entry of entries) {
    if (ends.every(end => end <= entry.start)) {
      finishGroup()
      groupStart = packed.length
      ends = []
    }
    const free = ends.findIndex(end => end <= entry.start)
    const lane = free === -1 ? ends.length : free
    const visualEnd = Math.min(DAY_MINUTES, Math.max(entry.end, entry.start + MIN_CARD_MINUTES))
    ends[lane] = visualEnd
    packed.push({ ...entry, visualEnd, lane, lanes: 0 })
  }
  finishGroup()
  return packed
}
