import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { loadCalendarWeek } from './calendar'
import { weekDays, weekStart } from './dates'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

afterEach(() => vi.unstubAllEnvs())

describe('calendar week', () => {
  it('starts the displayed week on Monday, including on Sunday at year end', () => {
    expect(weekDays(weekStart(new Date(2023, 11, 31))).map(day => day.getDate())).toEqual([25, 26, 27, 28, 29, 30, 31])
  })

  it.each([[2, 4, 167], [9, 28, 169]])('queries seven local days across DST and preserves denied access', async (month, date, hours) => {
    vi.stubEnv('TZ', 'America/New_York')
    const start = new Date(2024, month, date, 17)
    const midnight = new Date(2024, month, date).getTime()
    vi.mocked(invoke).mockResolvedValue({ access: 'denied', events: [] })
    await expect(loadCalendarWeek(start)).resolves.toEqual({ access: 'denied', events: [] })
    expect(invoke).toHaveBeenLastCalledWith('calendar_week', { start: midnight, end: midnight + hours * 3_600_000 })
  })

  it('returns unavailable when the native bridge cannot be reached', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no bridge'))
    await expect(loadCalendarWeek(new Date())).resolves.toEqual({ access: 'unavailable', events: [] })
  })
})
