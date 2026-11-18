import { describe, expect, it } from 'vitest'
import { parseDailyNote } from '@/lib/daily/daily-note'
import type { DecideItem } from '@/lib/decide/project'
import type { CalendarEvent } from '@/lib/today/today-model'
import { collectTasks } from '@/lib/vault-index/index-core'
import { indexNote } from '@/lib/vault-index/index-note'
import {
  buildCaptureRail,
  buildDecideRail,
  buildTimeline,
  buildTodayLayout,
  buildTodo,
  extractJournalParagraphs,
  isoWeek,
  type CaptureLike,
} from './layout'

// 2026-11-18 週三 13:20
const NOW = new Date(2026, 10, 18, 13, 20)
const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m).getTime()

const tasks = collectTasks([
  indexNote('Daily/2026-11-18.md', [
    '- [x] 回覆設計組 📅 2026-11-18 ✅ 2026-11-18',
    '- [ ] 交 Q4 預算表初稿 📅 2026-11-18 ⏰ 15:00',
    '- [ ] 逾期的事 📅 2026-11-16',
    '- [ ] 明天的事 📅 2026-11-19',
    '- [ ] 沒日期',
  ].join('\n'), 1),
])

function event(id: string, title: string, sh: number, eh: number, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start: at(sh), end: at(eh), allDay: false, calendar: 'Work', ...extra }
}

function decision(key: string, overrides: Partial<DecideItem> = {}): DecideItem {
  return {
    key, source: 'collect', kind: 'task', title: key, origin: '收集', summary: '', when: '', at: 0,
    preview: { type: 'newNote', diff: { context: [], removed: [], added: [], hidden: 0 } },
    duplicates: [], ref: { source: 'collect', itemId: key, proposalId: key },
    ...overrides,
  }
}

describe('isoWeek', () => {
  it('matches ISO 8601 weeks', () => {
    expect(isoWeek(new Date(2026, 10, 18))).toBe(47)
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1)
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53)
    expect(isoWeek(new Date(2024, 11, 30))).toBe(1)
  })
})

describe('extractJournalParagraphs', () => {
  it('keeps prose and skips frontmatter, headings, lists, tasks, quotes and inline fields', () => {
    const md = [
      '---', 'tags: [daily]', '---',
      '# 2026-11-18', '',
      '預算表的數字要先對過。', '',
      '- [ ] 任務', '- 清單', '> 引言', 'morning:: done', '',
      '```', '程式碼不算', '```',
      '下午先做骨架。',
    ].join('\n')
    expect(extractJournalParagraphs(md)).toEqual(['預算表的數字要先對過。', '下午先做骨架。'])
  })

  it('returns the last few paragraphs and handles missing notes', () => {
    const md = Array.from({ length: 12 }, (_, i) => `第 ${i} 段`).join('\n')
    expect(extractJournalParagraphs(md, 3)).toEqual(['第 9 段', '第 10 段', '第 11 段'])
    expect(extractJournalParagraphs(null)).toEqual([])
  })
})

describe('buildTimeline', () => {
  const dailyNote = parseDailyNote('## 錨點時段\n- 09:00-09:30 站會\n')

  it('places events and timed tasks within 06–24 and marks the state', () => {
    const view = buildTimeline({
      now: NOW,
      dailyNote: null,
      tasks,
      events: [event('a', '站會', 9, 10), event('b', '客戶會議', 13, 14), event('c', '深夜', 5, 6, { allDay: false })],
    })
    expect(view.entries.map(e => [e.title, e.startMin, e.endMin, e.state])).toEqual([
      ['站會', 540, 600, 'past'],
      ['客戶會議', 780, 840, 'now'],
      ['交 Q4 預算表初稿', 900, 960, 'upcoming'],
    ])
    expect(view.nowMin).toBe(13 * 60 + 20)
    expect(view.nowTime).toBe('13:20')
  })

  it('clamps events that cross the window edge and drops those outside', () => {
    const view = buildTimeline({
      now: NOW, dailyNote: null, tasks: [],
      events: [event('a', '早班', 5, 7), event('b', '太早', 3, 5), event('c', '跨夜', 23, 25)],
    })
    expect(view.entries.map(e => [e.title, e.startMin, e.endMin])).toEqual([['早班', 360, 420], ['跨夜', 1380, 1440]])
  })

  it('puts overlapping items side by side', () => {
    const view = buildTimeline({ now: NOW, dailyNote: null, tasks: [], events: [event('a', 'A', 9, 11), event('b', 'B', 10, 12), event('c', 'C', 12, 13)] })
    expect(view.entries.map(e => [e.title, e.lane, e.lanes])).toEqual([['A', 0, 2], ['B', 1, 2], ['C', 0, 1]])
  })

  it('lists all-day events outside the axis and includes journal anchors', () => {
    const view = buildTimeline({ now: NOW, dailyNote, tasks: [], events: [event('d', '生日', 0, 0, { allDay: true })] })
    expect(view.allDay).toEqual(['生日'])
    expect(view.entries.map(e => [e.kind, e.title])).toEqual([['anchor', '站會']])
  })

  it('hides the now line outside the window', () => {
    expect(buildTimeline({ now: new Date(2026, 10, 18, 5, 0), dailyNote: null, tasks: [], events: [] }).nowMin).toBeNull()
  })
})

describe('buildTodo', () => {
  it('lists overdue and today open tasks first, then today done', () => {
    const view = buildTodo(tasks, NOW)
    expect(view.items.map(i => [i.title, i.done, i.due, i.hot])).toEqual([
      ['逾期的事', false, { kind: 'overdue', days: 2 }, true],
      ['交 Q4 預算表初稿', false, { kind: 'time', time: '15:00' }, false],
      ['回覆設計組', true, { kind: 'none' }, false],
    ])
    expect(view).toMatchObject({ doneCount: 1, openCount: 2, total: 3 })
  })
})

describe('rails', () => {
  it('limits decisions but counts all, preferring the draft summary', () => {
    const items = Array.from({ length: 7 }, (_, i) => decision(`d${i}`))
    items[0] = decision('d0', { source: 'draft', title: '任務', summary: '改寫結論' })
    const rail = buildDecideRail(items, 5)
    expect(rail.count).toBe(7)
    expect(rail.items).toHaveLength(5)
    expect(rail.items[0].title).toBe('改寫結論')
  })

  it('keeps only today\'s captures, newest first', () => {
    const cap = (id: string, ms: number, extra: Partial<CaptureLike> = {}): CaptureLike => ({ id, createdAt: ms, state: 'ready', input: { kind: 'text', text: `內容 ${id}` }, ...extra })
    const rail = buildCaptureRail([
      cap('old', new Date(2026, 10, 17, 23, 0).getTime()),
      cap('a', at(8, 47)),
      cap('b', at(10, 15), { input: { kind: 'link', text: 'https://x.test' } }),
      cap('c', at(13, 18), { state: 'reading', input: { kind: 'image', text: '', name: '場地.png' } }),
    ], NOW, 2)
    expect(rail.total).toBe(3)
    expect(rail.items.map(i => [i.key, i.title, i.time, i.loading])).toEqual([
      ['c', '場地.png', '13:18', true],
      ['b', 'https://x.test', '10:15', false],
    ])
  })
})

describe('buildTodayLayout', () => {
  it('derives the summary counts from the data', () => {
    const layout = buildTodayLayout({
      now: NOW,
      journalContent: '一段日誌',
      dailyNote: null,
      tasks,
      events: [event('a', '站會', 9, 10), event('b', '會議', 13, 14), event('c', '生日', 0, 0, { allDay: true })],
      decisions: [decision('d1'), decision('d2')],
      captures: [],
    })
    expect(layout.heading).toEqual({ month: 11, day: 18, weekday: 3, week: 47 })
    expect(layout.summary).toEqual({ events: 3, openTasks: 2, decisions: 2 })
    expect(layout.journal.paragraphs).toEqual(['一段日誌'])
  })
})
