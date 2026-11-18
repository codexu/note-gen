import { describe, expect, it, vi } from 'vitest'
import { dailySlotTasks, findFreeGaps, proposeSlots, slotContext, validateSlots, scheduleSlot } from './model'

const now = new Date(2026, 10, 18, 9, 6)
const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m).getTime()
const journal = '# Today\n- [ ] Budget #work ^budget\n- [x] Done\n- [ ] Existing ⏰ 11:00\n- [ ] Later 📅 2026-11-19\n- [ ] Review\n'
const tasks = dailySlotTasks(journal, 'today.md', now)
const gaps = [{ start: at(9, 15), end: at(11) }]

describe('scheduler slots', () => {
  it('rounds forward, merges busy time, and permits touching boundaries', () => {
    expect(findFreeGaps({ start: now.getTime(), end: at(13) }, [
      { start: at(10, 1), end: at(10, 40) },
      { start: at(9, 45), end: at(10, 15) },
      { start: at(12, 45), end: at(14) },
    ], now)).toEqual([{ start: at(9, 15), end: at(9, 45) }, { start: at(10, 45), end: at(12, 45) }])
  })

  it('uses today’s eligible tasks and rejects model inventions, overlap, past and off-grid values', () => {
    expect(tasks.map(task => task.title)).toEqual(['Budget', 'Review'])
    expect(validateSlots([
      { task: 1, start: '09:00' }, { task: 1, start: '09:16' }, { task: 99, start: '09:15' },
      { task: 1, start: '09:15', title: 'Invented' }, { task: 2, start: '09:30' },
      { task: 1, start: '10:15' }, { task: 2, start: '10:30' },
    ], tasks, gaps, now)).toEqual([
      { task: tasks[0], start: '09:15', end: '09:45' },
      { task: tasks[1], start: '10:30', end: '11:00' },
    ])
  })

  it('treats an overlapping all-day event and existing timed tasks as busy', () => {
    expect(slotContext(journal, 'today.md', now, [{ id: '1', title: 'Away', calendar: '', allDay: true, start: at(0), end: at(23) }]).gaps).toEqual([])
    expect(slotContext(journal, 'today.md', now, []).gaps).toEqual([
      { start: at(9, 15), end: at(11) },
      { start: at(12), end: new Date(2026, 10, 19).getTime() },
    ])
  })

  it('produces nothing when the model is unavailable or has no eligible input', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(proposeSlots(tasks, gaps, now, offline)).resolves.toEqual([])
    offline.mockClear()
    await expect(proposeSlots(tasks, [], now, offline)).resolves.toEqual([])
    expect(offline).not.toHaveBeenCalled()
  })

  it('schedules the original checkbox, keeps CRLF and block IDs, and refuses an edited task', () => {
    const input = journal.replaceAll('\n', '\r\n')
    const next = scheduleSlot(input, tasks[0], '2026-11-18', '09:15')
    expect(next).toContain('- [ ] Budget #work 📅 2026-11-18 ⏰ 09:15 ^budget\r\n')
    expect(next?.match(/Budget/g)).toHaveLength(1)
    expect(scheduleSlot(input.replace('Budget', 'Revised'), tasks[0], '2026-11-18', '09:15')).toBeNull()
  })
})
