import { describe, expect, it } from 'vitest'
import { buildWeekPlan, packWeekEntries } from './model'
import { dailyNotePath } from '@/lib/daily/format'
import type { TaskRef } from '@/lib/vault-index/index-core'

const first = new Date(2026, 10, 16)
const at = (day: number, hour = 0) => new Date(2026, 10, day, hour).getTime()
const event = { title: 'Overnight', id: 'id', calendar: 'Personal', allDay: false, start: at(16, 23), end: at(17, 1) }
const task: TaskRef = { title: 'Budget', done: false, due: '', time: '14:00', priority: 'mid', raw: '', recurrence: '', path: dailyNotePath(first), line: 5 }

describe('week plan', () => {
  it('uses the date of undated journal tasks and splits events that span midnight', () => {
    const days = buildWeekPlan({
      start: first, events: [event], tasks: [task, { ...task, line: 6, time: '', due: '2026-11-18' }],
      pathFor: dailyNotePath,
    })
    expect(days).toHaveLength(7)
    expect(days[0].timed.map(({ title, start, end }) => [title, start, end])).toEqual([
      ['Budget', 840, 870], ['Overnight', 1380, 1440],
    ])
    expect(days[1].timed).toMatchObject([{ start: 0, end: 60 }])
    expect(days[2].untimed).toMatchObject([{ title: 'Budget' }])
  })

  it('keeps all-day events in the date band with an exclusive end', () => {
    const days = buildWeekPlan({
      start: first, tasks: [], pathFor: dailyNotePath,
      events: [{ ...event, allDay: true, start: at(15), end: at(18) }],
    })
    expect(days.map(day => day.untimed.length)).toEqual([1, 1, 0, 0, 0, 0, 0])
    expect(days.every(day => !day.timed.length)).toBe(true)
  })

  it('places visually overlapping cards in separate lanes and expands isolated cards', () => {
    const entries = [0, 10, 90].map(start => ({
      key: String(start), title: 'Entry', kind: 'calendar' as const, start, end: start + 5,
    }))
    expect(packWeekEntries(entries).map(({ lane, lanes }) => [lane, lanes])).toEqual([[0, 2], [1, 2], [0, 1]])
  })
})
