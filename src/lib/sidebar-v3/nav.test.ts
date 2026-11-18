import { describe, expect, it } from 'vitest'
import {
  COLLECT_TABS, ENTRY_HOME, KNOWLEDGE_TABS, LEGACY_ENTRIES, NAV_KEYS,
  activeNavKey, buildAgentRows, buildNav, runningAgentCount, type NavVisibility,
} from './nav'

const closed: NavVisibility = {
  home: false, decide: false, collect: false, inbox: false, threads: false, week: false, knowledge: false, promptLibrary: false,
}

describe('sidebar v3 nav', () => {
  it('lists the six items in the v5 order', () => {
    expect(buildNav({ decideCount: 0, collectPending: 0, visibility: closed }).map(row => row.key))
      .toEqual(['today', 'decide', 'collect', 'threads', 'knowledge', 'plan'])
  })

  it('shows decide and collect numbers, hides zeros and clamps junk', () => {
    const rows = buildNav({ decideCount: 3, collectPending: 0, visibility: closed })
    expect(rows.find(row => row.key === 'decide')?.count).toBe(3)
    expect(rows.find(row => row.key === 'collect')?.count).toBe(0)
    expect(rows.find(row => row.key === 'today')?.count).toBe(0)
    expect(buildNav({ decideCount: -2, collectPending: 4.9, visibility: closed }).map(row => row.count)).toEqual([0, 0, 4, 0, 0, 0])
  })

  it('marks no row active while the workspace is showing', () => {
    expect(buildNav({ decideCount: 1, collectPending: 1, visibility: closed }).some(row => row.active)).toBe(false)
  })

  it('maps every overlay to its nav item', () => {
    const cases: Array<[Partial<NavVisibility>, string]> = [
      [{ home: true }, 'today'],
      [{ decide: true }, 'decide'],
      [{ collect: true }, 'collect'],
      [{ inbox: true }, 'collect'],
      [{ threads: true }, 'threads'],
      [{ knowledge: true }, 'knowledge'],
      [{ promptLibrary: true }, 'knowledge'],
      [{ week: true }, 'plan'],
    ]
    for (const [open, key] of cases) {
      const rows = buildNav({ decideCount: 0, collectPending: 0, visibility: { ...closed, ...open } })
      expect(rows.filter(row => row.active).map(row => row.key)).toEqual([key])
    }
    expect(activeNavKey(closed)).toBeNull()
  })

  it('gives every legacy entry a home and every nav item at least one', () => {
    for (const entry of LEGACY_ENTRIES) expect(NAV_KEYS).toContain(ENTRY_HOME[entry])
    for (const key of NAV_KEYS) expect(LEGACY_ENTRIES.some(entry => ENTRY_HOME[entry] === key)).toBe(true)
    expect(ENTRY_HOME.inbox).toBe('collect')
    expect(ENTRY_HOME.week).toBe('plan')
    expect(ENTRY_HOME.calendar).toBe('plan')
    for (const entry of ['notes', 'timeline', 'canvases', 'noteTags', 'prompts'] as const) expect(ENTRY_HOME[entry]).toBe('knowledge')
    expect(COLLECT_TABS).toEqual(['collect', 'inbox'])
    expect(KNOWLEDGE_TABS).toEqual(['timeline', 'canvases', 'noteTags', 'prompts'])
  })
})

describe('sidebar v3 agents', () => {
  const agents = [
    { id: 'a', name: '整理員', role: 'organizer' as const, enabled: true },
    { id: 'b', name: '排程員', role: 'scheduler' as const, enabled: true },
    { id: 'c', name: '研究員', role: 'researcher' as const, enabled: false },
  ]

  it('counts agents with a queued or running task, once each', () => {
    const rows = buildAgentRows(agents, [
      { kind: 'agent:a', status: 'running' },
      { kind: 'agent:a', status: 'queued' },
      { kind: 'agent:b', status: 'completed' },
      { kind: 'chat', status: 'running' },
    ])
    expect(rows.map(row => row.running)).toEqual([true, false, false])
    expect(runningAgentCount(rows)).toBe(1)
  })

  it('ignores tasks of disabled or unknown agents', () => {
    const rows = buildAgentRows(agents, [
      { kind: 'agent:c', status: 'running' },
      { kind: 'agent:zzz', status: 'running' },
    ])
    expect(runningAgentCount(rows)).toBe(0)
  })

  it('returns no rows without agents', () => {
    expect(buildAgentRows([], [{ kind: 'agent:a', status: 'running' }])).toEqual([])
  })
})
