import { expect, it, vi } from 'vitest'
import { AgentTaskCenter } from '@/lib/agent-tasks/task-center'
import type { AgentTask } from '@/lib/agent-tasks/types'

vi.mock('@/lib/daily/note-io', () => ({ readNote: vi.fn(async () => null) }))

it('publishes a storage failure instead of releasing a successful result before it is durable', async () => {
  const id = 'job-step-one'
  const persisted = new Map<string, AgentTask>()
  const observed: string[] = []
  const persist = vi.fn(async (task: AgentTask) => {
    if (task.status === 'completed') throw new Error('SQLite write failed')
    persisted.set(task.id, task)
  })
  const center = new AgentTaskCenter({
    createRuntime: () => { throw new Error('Unexpected generic runner') },
    persist,
    load: async () => [],
    remove: async taskId => { persisted.delete(taskId) },
    concurrency: async () => 3,
    notify: () => {},
    now: () => 1,
  })
  const runner = vi.fn(async () => ({ result: 'Ready' }))
  center.registerRunner('agent:a', runner)
  center.subscribe(tasks => {
    const task = tasks.find(entry => entry.id === id)
    if (task) observed.push(task.status)
  })
  await center.enqueue({ id, kind: 'agent:a', prompt: 'Work' })
  await vi.waitFor(() => expect(persisted.get(id)?.status).toBe('failed'))
  expect(observed).not.toContain('completed')
  expect(center.get(id)).toMatchObject({ status: 'failed', error: 'SQLite write failed' })

  await center.resume(id)
  await center.remove(id)
  expect(runner).toHaveBeenCalledTimes(1)
  expect(persisted.has(id)).toBe(true)
})
