import { loadCalendarEvents } from '@/lib/calendar/calendar'
import type { AcceptResult } from '@/lib/collect/write'
import type { Proposal } from '@/lib/collect/types'
import { dailyNotePath, toDateKey } from '@/lib/daily/format'
import { isUiV3 } from '@/lib/fork-ui'
import { readNote, writeNote } from '@/lib/daily/note-io'
import useDailySettingsStore from '@/stores/daily-settings'
import useSettingStore from '@/stores/setting'
import { scheduleSlot, slotContext, validateSlots, type SlotTarget } from './model'

export class SlotUnavailable extends Error {}

let tail: Promise<unknown> = Promise.resolve()

/** Serialize scheduler writes so two approvals cannot reserve the same opening or lose a task edit. */
export function acceptSlot(proposal: Proposal & { slot: SlotTarget }, now: Date): Promise<AcceptResult> {
  const result = tail.then(() => writeSlot(proposal, now))
  tail = result.catch(() => undefined)
  return result
}

async function writeSlot(proposal: Proposal & { slot: SlotTarget }, now: Date): Promise<AcceptResult> {
  const { slot, due, time } = proposal
  const date = toDateKey(now)
  const path = slot.path
  const isCurrent = () => {
    const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
    return isUiV3() && due === date && toDateKey(new Date()) === date
      && path === dailyNotePath(now, dailyFolder, dailyPattern)
      && slot.workspace === useSettingStore.getState().workspacePath
  }
  if (!isCurrent()) throw new SlotUnavailable()

  const calendar = await loadCalendarEvents(now)
  if (!isCurrent() || calendar.access !== 'granted') throw new SlotUnavailable()
  const before = await readNote(path)
  if (!isCurrent() || before === null) throw new SlotUnavailable()

  const checkTime = new Date()
  const { tasks, gaps } = slotContext(before, path, checkTime, calendar.events)
  const task = tasks.find(task => task.line === slot.line && task.raw === slot.raw)
  if (!task || !validateSlots([{ task: 1, start: time }], [task], gaps, checkTime).length) throw new SlotUnavailable()

  const after = scheduleSlot(before, task, due, time)
  if (after === null) throw new SlotUnavailable()
  await writeNote(path, after)
  return { path, record: { writes: [{ path, before, after }] } }
}
