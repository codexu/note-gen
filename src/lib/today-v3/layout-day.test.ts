import { describe, expect, it } from 'vitest'
import { parseDailyNote } from '@/lib/daily/daily-note'
import type { CalendarEvent } from '@/lib/today/today-model'
import { collectTasks } from '@/lib/vault-index/index-core'
import { indexNote } from '@/lib/vault-index/index-note'
import { buildTimeline, buildTodayLayout, buildTodo } from './layout'

// 現在：2026-11-19 週四 10:30；選中日：2026-11-20 週五
const NOW = new Date(2026, 10, 19, 10, 30)
const FRIDAY = new Date(2026, 10, 20)
const on = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()

const tasks = collectTasks([
  indexNote('Daily/20261119.md', [
    '- [ ] 今天的事 📅 2026-11-19 ⏰ 14:00',
    '- [ ] 逾期的事 📅 2026-11-16',
    '- [x] 今天做完 📅 2026-11-19 ✅ 2026-11-19',
  ].join('\n'), 1),
  indexNote('Tasks.md', [
    '- [ ] 週五簡報 📅 2026-11-20 ⏰ 09:30',
    '- [ ] 週五沒時間 📅 2026-11-20',
    '- [x] 週五已完成 📅 2026-11-20 ✅ 2026-11-18',
    '- [ ] 週六的事 📅 2026-11-21',
  ].join('\n'), 1),
])

const events: CalendarEvent[] = [
  { id: 'fri', title: '週五站會', start: on(20, 11), end: on(20, 12), allDay: false, calendar: 'Work' },
  { id: 'fri-all', title: '週五出差', start: on(20, 0), end: on(21, 0), allDay: true, calendar: 'Work' },
]

describe('buildTimeline on another day', () => {
  it('puts that day\'s calendar events and timed tasks on the axis, with no now-line', () => {
    const view = buildTimeline({ now: NOW, day: FRIDAY, dailyNote: null, tasks, events })
    expect(view.entries.map(entry => [entry.title, entry.time, entry.kind])).toEqual([
      ['週五簡報', '09:30', 'task'],
      ['週五站會', '11:00', 'calendar'],
    ])
    expect(view.entries[1].startMin).toBe(11 * 60)
    expect(view.allDay).toEqual(['週五出差'])
    expect(view.nowMin).toBeNull()
  })

  it('still draws the now-line when the shown day is today', () => {
    const view = buildTimeline({ now: NOW, day: new Date(2026, 10, 19), dailyNote: null, tasks, events: [] })
    expect(view.nowMin).toBe(10 * 60 + 30)
    expect(view.entries.map(entry => entry.title)).toEqual(['今天的事'])
  })

  it('uses the selected day\'s journal anchors', () => {
    const note = parseDailyNote('## 錨點時段\n- 08:30 晨跑\n')
    const view = buildTimeline({ now: NOW, day: FRIDAY, dailyNote: note, tasks: [], events: [] })
    expect(view.entries.map(entry => [entry.title, entry.time, entry.kind])).toEqual([['晨跑', '08:30', 'anchor']])
  })
})

describe('buildTodo on another day', () => {
  it('lists only tasks due that day: timed first, then untimed, then done; never overdue', () => {
    const todo = buildTodo(tasks, NOW, FRIDAY)
    expect(todo.items.map(item => item.title)).toEqual(['週五簡報', '週五沒時間', '週五已完成'])
    expect(todo.items.some(item => item.hot || item.due.kind === 'overdue')).toBe(false)
    expect(todo).toMatchObject({ openCount: 2, doneCount: 1, total: 3 })
  })

  it('keeps today\'s rule (overdue first, then today, then done) when the day is today', () => {
    const todo = buildTodo(tasks, NOW, NOW)
    expect(todo.items.map(item => item.title)).toEqual(['逾期的事', '今天的事', '今天做完'])
    expect(buildTodo(tasks, NOW)).toEqual(todo)
  })
})

describe('buildTodayLayout with a selected day', () => {
  const base = { now: NOW, journalContent: '---\n---\n週五的日記段落。\n', dailyNote: null, tasks, events, decisions: [], captures: [] }
  const friday = buildTodayLayout({ ...base, day: FRIDAY })

  it('heading, journal, summary and todo follow the selected day', () => {
    expect(friday.heading).toMatchObject({ month: 11, day: 20, weekday: 5 })
    expect(friday.journal.paragraphs).toEqual(['週五的日記段落。'])
    expect(friday.summary).toEqual({ events: 2, openTasks: 2, decisions: 0 })
    expect(friday.timeline.nowMin).toBeNull()
  })

  it('captures stay on today (they are captured at "now")', () => {
    const captured = buildTodayLayout({
      ...base,
      day: FRIDAY,
      captures: [{ id: 'c1', createdAt: on(19, 9), state: 'ready', input: { kind: 'text', text: '早上收的' } }],
    })
    expect(captured.captures.items.map(item => item.title)).toEqual(['早上收的'])
  })

  it('without a day it is exactly today', () => {
    const today = buildTodayLayout(base)
    expect(today.heading).toMatchObject({ day: 19, weekday: 4 })
    expect(today.timeline.nowMin).toBe(10 * 60 + 30)
    expect(today).toEqual(buildTodayLayout({ ...base, day: new Date(2026, 10, 19, 23, 59) }))
  })
})
