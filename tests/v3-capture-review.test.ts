import { afterEach, expect, it, vi } from 'vitest'
import { dailyNotePath } from '@/lib/daily/format'
import { acceptDecision, refreshJournal, rejectDecision } from '@/lib/decide/actions'
import { projectDecisions } from '@/lib/decide/project'
import { buildTodayLayout } from '@/lib/today-v3/layout'
import { indexNote } from '@/lib/vault-index/index-note'
import { collectTasks } from '@/lib/vault-index/index-core'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useDailySettingsStore from '@/stores/daily-settings'

const files = new Map<string, string>()

vi.mock('@/lib/collect/ai', () => ({ askCollectModel: async () => null }))
vi.mock('@/lib/daily/note-io', () => ({
  noteExists: async (path: string) => files.has(path),
  readNote: async (path: string) => files.get(path) ?? null,
  writeNote: async (path: string, content: string) => { files.set(path, content) },
  revealInFileTree: async () => undefined,
}))
vi.mock('@/lib/daily/open-daily-note', () => ({
  ensureDailyNote: async () => ({ path: journalPath }),
}))

const now = new Date(2026, 10, 19, 9, 30)
const journalPath = dailyNotePath(now)
const original = '# 今日\n\n先整理上週的會議記錄。\n'
const captures = () => useCollectStore.getState().items
const pending = () => projectDecisions({ items: captures(), tasks: [], journal: useDecideStore.getState().journal })

afterEach(() => {
  vi.useRealTimers()
  useCollectStore.setState({ items: [] })
  files.clear()
})

it('splits a capture, reviews it via Decide, and assembles Today from the resulting journal and queue', async () => {
  vi.setSystemTime(now)
  useDailySettingsStore.setState({ initialized: true })
  files.set(journalPath, original)
  await refreshJournal(now)
  await useCollectStore.getState().submit({ kind: 'text', text: '15:30 寄報價單' })
  await useCollectStore.getState().submit({ kind: 'text', text: '明天備份資料' })

  const decisions = pending()
  expect(decisions.map(item => item.title).sort()).toEqual(['備份資料', '寄報價單'])
  const scheduled = decisions.find(item => item.title === '寄報價單')!
  const unwanted = decisions.find(item => item.title === '備份資料')!
  expect(scheduled.preview).toMatchObject({ type: 'journal', diff: { added: expect.arrayContaining(['- [ ] 寄報價單 📅 2026-11-19 ⏰ 15:30']) } })
  expect(files.get(journalPath)).toBe(original)

  await rejectDecision(unwanted)
  expect(pending().map(item => item.key)).toEqual([scheduled.key])
  expect(files.get(journalPath)).toBe(original)
  const result = await acceptDecision(scheduled)
  expect(pending()).toEqual([])
  const journal = files.get(journalPath)!
  expect(journal).toContain('- [ ] 寄報價單 📅 2026-11-19 ⏰ 15:30')
  expect(journal).not.toContain('備份資料')

  const layout = buildTodayLayout({
    now, journalContent: journal, dailyNote: null, events: [],
    tasks: collectTasks([indexNote(journalPath, journal, 1)]),
    decisions: pending(), captures: captures(),
  })
  expect(layout.journal.paragraphs).toEqual(['先整理上週的會議記錄。'])
  expect(layout.todo.items.map(item => item.title)).toEqual(['寄報價單'])
  expect(layout.timeline.entries.map(item => item.time)).toEqual(['15:30'])
  expect(layout.decide.count).toBe(0)
  expect(layout.captures.total).toBe(2)

  expect(await result.undo?.()).toBe(true)
  expect(files.get(journalPath)).toBe(original)
  await refreshJournal(now)
  expect(pending().map(item => item.key)).toEqual([scheduled.key])
})
