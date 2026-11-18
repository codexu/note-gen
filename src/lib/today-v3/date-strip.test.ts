import { describe, expect, it } from 'vitest'
import { dailyNoteDateKeys } from '@/lib/daily/daily-nav'
import { STRIP_DAYS, buildDateStrip, defaultStripStart, ensureStripVisible, shiftStripStart } from './date-strip'

const TODAY = new Date(2026, 10, 19) // 2026-11-19 週四

describe('buildDateStrip', () => {
  const noteKeys = dailyNoteDateKeys(['Daily/20261119.md', 'Daily/20261121.md', 'Daily/20261201.md', 'Other/20261120.md'], 'Daily', 'YYYYMMDD')
  const days = buildDateStrip({ start: defaultStripStart(TODAY), selectedKey: '2026-11-21', todayKey: '2026-11-19', noteKeys })

  it('makes 14 consecutive days starting three days before today', () => {
    expect(days).toHaveLength(STRIP_DAYS)
    expect(days[0].key).toBe('2026-11-16')
    expect(days[13].key).toBe('2026-11-29')
    expect(days.map(day => day.day).slice(0, 3)).toEqual([16, 17, 18])
  })

  it('carries weekday (0 = Sunday) for each day', () => {
    expect(days.find(day => day.key === '2026-11-19')?.weekday).toBe(4)
    expect(days.find(day => day.key === '2026-11-22')?.weekday).toBe(0)
  })

  it('marks exactly one today and one selected', () => {
    expect(days.filter(day => day.isToday).map(day => day.key)).toEqual(['2026-11-19'])
    expect(days.filter(day => day.isSelected).map(day => day.key)).toEqual(['2026-11-21'])
  })

  it('marks days that have a daily note, only inside the daily folder', () => {
    expect(days.filter(day => day.hasNote).map(day => day.key)).toEqual(['2026-11-19', '2026-11-21'])
  })

  it('crosses month and year boundaries and flags the first of the month', () => {
    const wrap = buildDateStrip({ start: new Date(2026, 11, 28), selectedKey: '2026-12-31', todayKey: '2026-11-19', noteKeys: new Set() })
    expect(wrap.map(day => day.key).slice(2, 6)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    expect(wrap.filter(day => day.firstOfMonth).map(day => day.key)).toEqual(['2027-01-01'])
  })

  it('selecting today is selecting today (no selected day outside the window is invented)', () => {
    const none = buildDateStrip({ start: defaultStripStart(TODAY), selectedKey: '2027-05-01', todayKey: '2026-11-19', noteKeys: new Set() })
    expect(none.some(day => day.isSelected)).toBe(false)
  })
})

describe('strip window', () => {
  it('pages by one week', () => {
    const start = defaultStripStart(TODAY)
    expect(shiftStripStart(start, 1).getDate()).toBe(23)
    expect(shiftStripStart(start, -1).getDate()).toBe(9)
  })

  it('keeps the window when the target is visible and moves it just enough otherwise', () => {
    const start = defaultStripStart(TODAY) // 11/16 – 11/29
    expect(ensureStripVisible(start, new Date(2026, 10, 29))).toBe(start)
    const later = ensureStripVisible(start, new Date(2026, 10, 30))
    expect(later.getMonth()).toBe(10)
    expect(later.getDate()).toBe(17)
    const earlier = ensureStripVisible(start, new Date(2026, 10, 15))
    expect(earlier.getDate()).toBe(15)
  })
})
