import { describe, expect, it } from 'vitest'
import type { AgentTask } from '@/lib/agent-tasks/types'
import { JobCenter } from './job-center'
import { projectDecisions } from '@/lib/decide/project'
import { jobsForThread } from './projection'
import type { Job } from './schedule'

describe('job center integration', () => {
  it('persists the reservation before dispatch, projects results by thread, and retries once', async () => {
    let saved: Job[] = []
    let serial = 0
    const tasks = new Map<string, AgentTask>()
    const dispatched: string[] = []
    const center = new JobCenter({
      load: async () => saved,
      save: async jobs => { saved = jobs },
      dispatch: async input => {
        expect(saved.flatMap(job => job.steps)).toContainEqual(expect.objectContaining({
          taskId: input.taskId, status: 'dispatched',
        }))
        dispatched.push(input.title)
        tasks.set(input.taskId, {
          ...input, id: input.taskId, kind: 'agent:research', status: 'queued', drafts: [],
          tokens: 0, createdAt: 1, updatedAt: 1,
        })
      },
      task: id => tasks.get(id),
      publish: () => {},
      isEnabled: () => true,
      id: () => String(++serial),
      now: () => 10,
    })
    const step = { agentId: 'research', prompt: 'Do the work', criterion: 'Cite sources' }
    const id = await center.create('thread-2', { title: 'Project', steps: [
      { ...step, id: 'a', title: 'Research', dependsOn: [] },
      { ...step, id: 'b', title: 'Summarize', dependsOn: ['a'] },
    ] })
    expect(dispatched).toEqual([])
    await Promise.all([center.start(id), center.start(id)])
    expect(dispatched).toEqual(['Research'])
    const first = saved[0].steps[0].taskId!
    tasks.set(first, { ...tasks.get(first)!, status: 'failed', error: 'try again' })
    await center.refresh()
    expect(dispatched).toEqual(['Research'])
    await Promise.all([center.act(id, 'a', 'retry'), center.act(id, 'a', 'retry')])
    expect(dispatched).toEqual(['Research', 'Research'])
    const second = saved[0].steps[0].taskId!
    expect(second).not.toBe(first)
    tasks.set(second, { ...tasks.get(second)!, status: 'completed', result: 'Findings' })
    await center.refresh()
    expect(dispatched).toEqual(['Research', 'Research', 'Summarize'])
    expect(tasks.get(saved[0].steps[1].taskId!)?.prompt).toContain('Findings')
    expect(saved[0]).toMatchObject({ threadKey: 'thread-2', steps: [{ result: 'Findings' }, { status: 'dispatched' }] })
    expect(jobsForThread(saved, 'other-thread')).toEqual([])
    expect(jobsForThread(saved, 'thread-2')).toHaveLength(1)
    const decisions = () => projectDecisions({ items: [], tasks: [], journal: null, jobs: saved })
    expect(decisions()).toMatchObject([{ title: 'Research', preview: { result: 'Findings' } }])
    await center.act(id, 'a', 'accept')
    expect(decisions()).toEqual([])
    expect(saved[0].steps[0].status).toBe('accepted')
  })
})

describe('job center draft cleanup (PM review fix)', () => {
  it('discards drafts of the old tasks when a step is rejected (and its dependents reset) or retried', async () => {
    const step = (id: string, status: Job['steps'][number]['status'], taskId?: string, dependsOn: string[] = []) => ({
      id, title: id, prompt: id, criterion: id, agentId: 'research', dependsOn, status, taskId, result: taskId ? `${id} result` : undefined,
    }) as Job['steps'][number]
    let saved: Job[] = [{
      id: 'j', threadKey: 'thread', createdAt: 1, title: 'card', started: true,
      steps: [step('a', 'review', 't-a'), step('b', 'review', 't-b', ['a']), step('c', 'failed', 't-c')],
    }]
    const tasks = new Map<string, AgentTask>([
      ['t-a', { id: 't-a', kind: 'agent:research', status: 'completed', drafts: [], tokens: 0, createdAt: 1, updatedAt: 1, title: 'a', prompt: 'a' } as AgentTask],
      ['t-b', { id: 't-b', kind: 'agent:research', status: 'completed', drafts: [], tokens: 0, createdAt: 1, updatedAt: 1, title: 'b', prompt: 'b' } as AgentTask],
      ['t-c', { id: 't-c', kind: 'agent:research', status: 'failed', error: 'x', drafts: [], tokens: 0, createdAt: 1, updatedAt: 1, title: 'c', prompt: 'c' } as AgentTask],
    ])
    const discarded: string[] = []
    let serial = 0
    const center = new JobCenter({
      load: async () => saved,
      save: async jobs => { saved = jobs },
      dispatch: async () => {},
      task: id => tasks.get(id),
      publish: () => {},
      isEnabled: () => true,
      id: () => String(++serial),
      now: () => 10,
      discardDrafts: async taskId => { discarded.push(taskId) },
    })
    await center.refresh()
    await center.act('j', 'a', 'reject')
    expect(discarded.sort()).toEqual(['t-a', 't-b'])
    await center.act('j', 'c', 'retry')
    expect(discarded).toContain('t-c')
    expect(saved[0].steps.find(s => s.id === 'b')).toMatchObject({ status: 'waiting', taskId: undefined })
  })
})
