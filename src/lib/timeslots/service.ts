import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getAgentSettings, listAgentSettings } from '@/db/agents'
import type { AgentSettings } from '@/lib/agents/settings'
import { loadCalendarEvents } from '@/lib/calendar/calendar'
import { askCollectModel } from '@/lib/collect/ai'
import { dailyNotePath, toDateKey } from '@/lib/daily/format'
import { readNote } from '@/lib/daily/note-io'
import { isUiV3 } from '@/lib/fork-ui'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'
import useSettingStore from '@/stores/setting'
import { proposeSlots, slotContext } from './model'

let active = false
let attemptedDay = ''
const attemptedWorkspaces = new Set<string>()

/** Check the current journal when the main V3 window is ready, focused, or ticks into a new day. */
export async function offerTodaySlots(): Promise<void> {
  if (active || !isUiV3() || !isTauri() || getCurrentWindow().label !== 'main') return
  const now = new Date()
  const due = toDateKey(now)
  const workspace = useSettingStore.getState().workspacePath
  if (attemptedDay !== due) {
    attemptedWorkspaces.clear()
    attemptedDay = due
  }
  if (attemptedWorkspaces.has(workspace)) return

  const id = `scheduler:${workspace}:${due}`
  const stillCurrent = () => isUiV3() && useSettingStore.getState().workspacePath === workspace && toDateKey(new Date()) === due
  active = true
  try {
    await useCollectStore.getState().hydrate()
    if (useCollectStore.getState().items.some(item => item.id === id)) {
      attemptedWorkspaces.add(workspace)
      return
    }
    const scheduler = (await listAgentSettings()).find(canSchedule)
    if (!scheduler || !stillCurrent()) return

    await useDailySettingsStore.getState().initSettings()
    const { dailyFolder, dailyPattern } = useDailySettingsStore.getState()
    const path = dailyNotePath(now, dailyFolder, dailyPattern)
    if (!stillCurrent()) return
    const content = await readNote(path)
    if (!content) return
    const calendar = await loadCalendarEvents(now)
    if (calendar.access !== 'granted' || !stillCurrent()) return
    const { tasks, gaps } = slotContext(content, path, new Date(), calendar.events)
    if (!tasks.length || !gaps.length) return

    // A failed or unconfigured provider is quiet and gets at most one attempt per workspace/day.
    attemptedWorkspaces.add(workspace)
    const slots = await proposeSlots(tasks, gaps, now, prompt => askCollectModel(prompt, undefined, { silent: true }))
    if (!slots.length || !stillCurrent()) return

    const current = await readNote(path)
    if (current !== content || !canSchedule(await getAgentSettings(scheduler.id)) || !stillCurrent()) return
    useCollectStore.getState().addProposals(id, scheduler.name, slots.map(({ task, start }, index) => ({
      id: String(index + 1),
      kind: 'event',
      title: task.title,
      body: '',
      due,
      time: start,
      tags: [],
      slot: { workspace, path, line: task.line, raw: task.raw },
    })))
  } catch {
    // The app can start without the vault, calendar, or model being available.
  } finally {
    active = false
  }
}

function canSchedule(agent: AgentSettings | undefined): agent is AgentSettings {
  return !!agent && agent.role === 'scheduler' && agent.enabled
    && agent.allowedTools.includes('note_read_file') && agent.allowedTools.includes('calendar_read_day')
}
