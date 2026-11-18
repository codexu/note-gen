import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askCollectModel } from '@/lib/collect/ai'
import { loadCalendarEvents } from '@/lib/calendar/calendar'
import { writeNote } from '@/lib/daily/note-io'
import { dailyNotePath } from '@/lib/daily/format'
import { acceptDecision, refreshJournal } from '@/lib/decide/actions'
import { projectDecisions } from '@/lib/decide/project'
import { parseItems, serializeItems } from '@/lib/collect/persist'
import { buildAgenda } from '@/lib/today/today-model'
import { indexTasks } from '@/lib/vault-index/index-note'
import useCollectStore from '@/stores/collect'
import useDailySettingsStore from '@/stores/daily-settings'
import useDecideStore from '@/stores/decide'
import useSettingStore from '@/stores/setting'
import { useUiModeStore } from '@/lib/fork-ui'
import { SlotUnavailable } from './apply'
import { offerTodaySlots } from './service'

const agent = { id: 'scheduler', role: 'scheduler', name: 'Calendar planner', enabled: true, allowedTools: ['note_read_file', 'calendar_read_day'] }
const original = '# Today\n- [ ] Write budget\n- [ ] Sign off\n'
let content = original

vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/core')>(),
  isTauri: () => true,
}))
vi.mock('@tauri-apps/api/window', async importOriginal => ({
  ...await importOriginal<typeof import('@tauri-apps/api/window')>(),
  getCurrentWindow: () => ({ label: 'main' }),
}))
vi.mock('@tauri-apps/plugin-store', () => ({
  Store: { load: async () => ({ get: async () => [], set: async () => {}, save: async () => {} }) },
}))
vi.mock('@/db/agents', () => ({ listAgentSettings: async () => [agent], getAgentSettings: async () => agent }))
vi.mock('@/lib/collect/ai', () => ({ askCollectModel: vi.fn() }))
vi.mock('@/lib/calendar/calendar', () => ({ loadCalendarEvents: vi.fn() }))
vi.mock('@/lib/daily/note-io', () => ({
  readNote: async () => content,
  writeNote: vi.fn(async (_path: string, next: string) => { content = next }),
}))

function pending() {
  return projectDecisions({
    items: useCollectStore.getState().items,
    journal: useDecideStore.getState().journal,
    workspace: useSettingStore.getState().workspacePath,
    tasks: [],
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 18, 9))
  vi.clearAllMocks()
  content = original
  agent.enabled = true
  useUiModeStore.setState({ mode: 'v3' })
  useDailySettingsStore.setState({ initialized: true })
  useCollectStore.setState({ items: [] })
  useDecideStore.setState({ journal: null })
  vi.mocked(loadCalendarEvents).mockResolvedValue({ access: 'granted', events: [] })
  vi.mocked(askCollectModel).mockResolvedValue('[{"task":1,"start":"14:00"}]')
})

afterEach(() => vi.useRealTimers())

describe('scheduler through collect and decide', () => {
  it('publishes once without writing, survives persistence, and moves a task onto today’s agenda after approval', async () => {
    useSettingStore.setState({ workspacePath: '/fixture/approve' })
    await Promise.all([offerTodaySlots(), offerTodaySlots()])
    await offerTodaySlots()
    expect(askCollectModel).toHaveBeenCalledTimes(1)
    expect(askCollectModel).toHaveBeenCalledWith(expect.any(String), undefined, { silent: true })
    expect(writeNote).not.toHaveBeenCalled()

    const items = parseItems(serializeItems(useCollectStore.getState().items), Date.now())
    expect(items[0]?.proposals[0]?.slot?.raw).toBe('- [ ] Write budget')
    useCollectStore.setState({ items })
    await refreshJournal()
    const [item] = pending()
    expect(item).toMatchObject({ kind: 'event', origin: agent.name, when: '11/18 14:00–14:30' })
    expect(item.preview.diff?.added).toEqual(['- [ ] Write budget 📅 2026-11-18 ⏰ 14:00'])

    const outcome = await acceptDecision(item)
    expect(content).toContain('Write budget 📅 2026-11-18 ⏰ 14:00')
    expect(content.match(/Write budget/g)).toHaveLength(1)
    expect(pending()).toEqual([])

    const now = new Date()
    const tasks = indexTasks(content).map(task => ({ ...task, path: dailyNotePath(now) }))
    expect(buildAgenda({ now, tasks, dailyNote: null, events: [] })).toMatchObject([{ kind: 'task', title: 'Write budget' }])
    await expect(outcome.undo?.()).resolves.toBe(true)
    expect(content).toBe(original)
  })

  it('does not publish with denied access or classic mode and suppresses repeated AI failures', async () => {
    useSettingStore.setState({ workspacePath: '/fixture/denied' })
    useUiModeStore.setState({ mode: 'classic' })
    await offerTodaySlots()
    expect(loadCalendarEvents).not.toHaveBeenCalled()
    useUiModeStore.setState({ mode: 'v3' })

    agent.enabled = false
    await offerTodaySlots()
    expect(loadCalendarEvents).not.toHaveBeenCalled()
    agent.enabled = true
    vi.mocked(loadCalendarEvents).mockResolvedValueOnce({ access: 'denied', events: [] })
    await offerTodaySlots()
    expect(askCollectModel).not.toHaveBeenCalled()

    vi.mocked(askCollectModel).mockRejectedValueOnce(new Error('offline'))
    await offerTodaySlots()
    await offerTodaySlots()
    expect(askCollectModel).toHaveBeenCalledTimes(1)
    expect(useCollectStore.getState().items).toEqual([])
    expect(writeNote).not.toHaveBeenCalled()
  })

  it('keeps a proposal pending if the slot becomes busy before review', async () => {
    useSettingStore.setState({ workspacePath: '/fixture/conflict' })
    await offerTodaySlots()
    await refreshJournal()
    const [item] = pending()
    vi.mocked(loadCalendarEvents).mockResolvedValueOnce({
      access: 'granted',
      events: [{
        id: 'busy', title: 'Meeting', allDay: false, calendar: 'Work',
        start: new Date(2026, 10, 18, 14).getTime(), end: new Date(2026, 10, 18, 15).getTime(),
      }],
    })
    await expect(acceptDecision(item)).rejects.toBeInstanceOf(SlotUnavailable)
    expect(writeNote).not.toHaveBeenCalled()
    expect(pending()).toHaveLength(1)
  })
})
