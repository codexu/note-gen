// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { expect, it, vi } from 'vitest'
import { agentTaskCenter } from '@/lib/agent-tasks'
import emitter from '@/lib/emitter'
import { projectDecisions } from '@/lib/decide/project'
import { useUiModeStore } from '@/lib/fork-ui'
import { HOUR } from '@/lib/organize/detect'
import { useOrganizeSettings } from '@/lib/organize/settings'
import { indexNote } from '@/lib/vault-index/index-note'
import useDailySettingsStore from '@/stores/daily-settings'
import useSettingStore from '@/stores/setting'
import useVaultIndexStore from '@/stores/vault-index'
import messages from '../../../../../messages/en.json'
import { OrganizeService } from './organize-service'

const { files, mtime, persist } = vi.hoisted(() => ({
  files: new Map([
    ['Keeper.md', 'A detailed description of an acoustic instrument and how it is normally played.'],
    ['Spare.md', 'A detailed description of an acoustic instrument and how it is normally played.'],
    ['Reader.md', 'I was reading about Heliophysics.'],
    ['Heliophysics.md', 'A field of study.'],
    ['Topic.md', '---\ntags: [science]\n---\nAn introduction.'],
    ['Peer A.md', '---\ntags: [science, reading]\n---\nAn article.'],
    ['Peer B.md', '---\ntags: [science, reading]\n---\nA reference sheet.'],
    ['Peer C.md', '---\ntags: [science, reading]\n---\nA reference book.'],
  ]),
  mtime: 1_700_000_000_000,
  persist: vi.fn(async () => {}),
}))

vi.mock('@/lib/agent-tasks', async () => {
  const { AgentTaskCenter } = await import('@/lib/agent-tasks/task-center')
  return {
    agentTaskCenter: new AgentTaskCenter({
      createRuntime: () => { throw new Error('Organize must not invoke a model') },
      persist,
      load: async () => [],
      remove: async () => {},
      concurrency: async () => 2,
      notify: () => {},
      now: () => Date.now(),
    }),
    startAgentTaskCenter: async () => {},
  }
})
vi.mock('@/lib/workspace', () => ({ getWorkspaceAbsolutePath: async () => '/vault' }))
vi.mock('@/lib/organize/vault-io', () => ({
  currentWorkspaceIdentity: async () => 'custom:/vault',
  inspectNote: async (path: string) => files.has(path) ? { mtime, size: files.get(path)!.length } : null,
  readOrganizeNote: async (path: string) => files.get(path) ?? null,
}))

it('submits merge, tag and link drafts only after a full idle hour in enabled V3', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(mtime + 2 * HOUR)
  vi.stubGlobal('React', React)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  useSettingStore.setState({ workspacePath: '/vault' })
  useDailySettingsStore.setState({ initialized: true })
  useVaultIndexStore.getState().reset('/vault')
  useVaultIndexStore.getState().upsert([...files].map(([path, content]) => indexNote(path, content, mtime)))
  useVaultIndexStore.getState().setStatus('ready')
  useOrganizeSettings.setState({ ready: true, enabled: false })
  useUiModeStore.setState({ mode: 'v3' })
  const root = createRoot(document.createElement('div'))
  const snapshot = [...files]
  const intl = {
    locale: 'en', messages, timeZone: 'Asia/Taipei' as const, children: React.createElement(OrganizeService),
  }
  try {
    await act(async () => root.render(React.createElement(NextIntlClientProvider, intl)))
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR) })
    expect(persist).not.toHaveBeenCalled()

    await act(async () => useOrganizeSettings.setState({ enabled: true }))
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR / 2) })
    emitter.emit('editor-input', undefined)
    await act(async () => { await vi.advanceTimersByTimeAsync(HOUR - 60_000) })
    expect(persist).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(persist).toHaveBeenCalledTimes(1)
    const decisions = projectDecisions({ workspace: '/vault', items: [], journal: null, tasks: agentTaskCenter.list() })
    expect(decisions.map(item => item.summary)).toEqual([
      'Merge Spare.md into Keeper.md', 'Link Reader.md to Heliophysics.md', 'Add #reading to Topic.md',
    ])
    expect([...files]).toEqual(snapshot)

    await act(async () => { await vi.advanceTimersByTimeAsync(2 * HOUR) })
    expect(persist).toHaveBeenCalledTimes(1)
    await act(async () => useUiModeStore.setState({ mode: 'classic' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * HOUR) })
    expect(persist).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
