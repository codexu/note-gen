// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useUiModeStore } from '@/lib/fork-ui'
import { jobCenter, useJobs } from '@/lib/jobs'
import useChatStore from '@/stores/chat'
import type { Job } from '@/lib/jobs/schedule'
import en from '../../../../../messages/en.json'
import zh from '../../../../../messages/zh.json'
import zhTW from '../../../../../messages/zh-TW.json'
import { CreateJobButton } from './create-job'
import { JobMessages } from './job-result'

const { dispatch, list, propose } = vi.hoisted(() => ({
  dispatch: vi.fn(), list: vi.fn(), propose: vi.fn(),
}))

vi.mock('next-intl', async importOriginal => {
  const intl = await importOriginal<typeof import('next-intl')>()
  return {
    ...intl,
    useLocale: () => 'en',
    useTranslations: () => intl.createTranslator({ locale: 'en', messages: { jobs: en.jobs }, namespace: 'jobs' }),
  }
})
vi.mock('@/db/agents', () => ({ listAgentSettings: list }))
vi.mock('@/lib/jobs/planner', () => ({ proposeJob: propose }))
vi.mock('@/lib/agent-tasks', async () => {
  const { create } = await import('zustand')
  return { useAgentTaskStore: create(() => ({ tasks: [] })) }
})
vi.mock('@/stores/chat', async () => {
  const { create } = await import('zustand')
  return { default: create(() => ({
    isTemporaryConversation: false,
    currentConversationId: 1,
    conversations: [
      { id: 1, syncId: 'first', messageCount: 2 },
      { id: 2, syncId: 'other', messageCount: 1 },
    ],
    chats: [{ role: 'user', content: 'Prepare a brief' }],
  })) }
})
vi.mock('@/components/ui/message-scroller', () => ({
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('@/lib/jobs', async () => {
  const { JobCenter } = await import('@/lib/jobs/job-center')
  const { isUiV3 } = await import('@/lib/fork-ui')
  const { create } = await import('zustand')
  const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }))
  let id = 0
  return {
    useJobs,
    jobCenter: new JobCenter({
      load: async () => [],
      save: async () => {},
      dispatch,
      task: attemptId => dispatch.mock.calls[0]?.[0].taskId === attemptId
        ? { id: attemptId, kind: 'agent:a', title: 'Outline', prompt: 'Outline the brief', status: 'completed', result: 'A three-part brief', drafts: [], tokens: 0, createdAt: 1, updatedAt: 10 }
        : undefined,
      publish: jobs => useJobs.setState({ jobs }),
      isEnabled: isUiV3,
      id: () => String(++id),
      now: () => 10,
    }),
  }
})

it('provides the job strings in all supported locales', () => {
  for (const locale of [zh, zhTW]) {
    expect(Object.keys(locale.jobs)).toEqual(Object.keys(en.jobs))
    expect(Object.keys(locale.jobs.status)).toEqual(Object.keys(en.jobs.status))
  }
})

it('creates a proposal, starts it explicitly, and reviews the result in its own V3 thread', async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true })
  const agent = { id: 'a', name: 'Researcher', enabled: true }
  list.mockResolvedValue([agent])
  propose.mockResolvedValue({ title: 'Brief', steps: [
    { id: 'outline', title: 'Outline', agentId: 'a', prompt: 'Outline the brief', criterion: 'Cover the main points', dependsOn: [] },
  ] })
  useUiModeStore.setState({ mode: 'v3' })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const button = (name: string) => [...document.querySelectorAll('button')].find(btn => btn.textContent === name)!
  async function click(name: string) {
    await act(async () => button(name).click())
  }
  try {
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(CreateJobButton),
      React.createElement(JobMessages, { conversationId: 1 }),
    )))
    await click(en.jobs.new)
    await click(en.jobs.generate)
    expect(propose).toHaveBeenCalledWith('Prepare a brief', [agent], 'en')
    await click(en.jobs.saveProposal)
    expect(dispatch).not.toHaveBeenCalled()
    expect(container.querySelector('[data-card="kickoff-result"]')?.textContent).toContain('Cover the main points')
    await click(en.jobs.start)
    expect(dispatch).toHaveBeenCalledTimes(1)
    await act(async () => { await jobCenter.refresh() })
    expect(container.textContent).toContain('A three-part brief')
    await click(en.jobs.accept)
    expect(useJobs.getState().jobs[0].steps[0].status).toBe('accepted')

    await act(async () => root.render(React.createElement(JobMessages, { conversationId: 2 })))
    expect(container.textContent).toBe('')
    await act(async () => {
      useChatStore.setState({ currentConversationId: 1 })
      useUiModeStore.setState({ mode: 'classic' })
      root.render(React.createElement(React.Fragment, null,
        React.createElement(CreateJobButton),
        React.createElement(JobMessages, { conversationId: 1 }),
      ))
    })
    expect(container.textContent).toBe('')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
