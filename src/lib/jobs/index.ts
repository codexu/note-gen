import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { agentTaskCenter, discardTaskDrafts, startAgentTaskCenter } from '@/lib/agent-tasks'
import { enqueueAgentTask } from '@/lib/agents'
import { isUiV3, useUiModeStore } from '@/lib/fork-ui'
import { JobCenter } from './job-center'
import type { Job } from './schedule'

export const JOBS_KEY = 'almanacJobCardsV1'
export const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }))

export const jobCenter = new JobCenter({
  load: async () => {
    // Reconcile reservations only after P5 has loaded and marked interrupted runs.
    await startAgentTaskCenter()
    const store = await Store.load('store.json')
    return await store.get<Job[]>(JOBS_KEY) ?? []
  },
  save: async jobs => {
    const store = await Store.load('store.json')
    await store.set(JOBS_KEY, jobs)
    await store.save()
  },
  dispatch: enqueueAgentTask,
  discardDrafts: taskId => discardTaskDrafts(taskId),
  task: id => agentTaskCenter.get(id),
  publish: jobs => useJobs.setState({ jobs }),
  isEnabled: isUiV3,
  id: () => crypto.randomUUID(),
  now: Date.now,
})

/** Refresh when execution settles or V3 becomes active. Streaming token events need no refresh. */
export function observeJobTasks() {
  let last = new Map<string, string>()
  const refresh = () => {
    if (isUiV3() && useUiModeStore.getState().loaded) void jobCenter.refresh().catch(error => console.error('[jobs] refresh failed:', error))
  }
  const unsubscribeTasks = agentTaskCenter.subscribe(tasks => {
    const next = new Map<string, string>()
    let changed = false
    for (const job of useJobs.getState().jobs) {
      for (const step of job.steps) {
        if (step.status === 'dispatched' && step.taskId) next.set(step.taskId, '')
      }
    }
    for (const task of tasks) {
      if (!next.has(task.id)) continue
      next.set(task.id, task.status)
      if (task.status !== 'queued' && task.status !== 'running' && last.get(task.id) !== task.status) changed = true
    }
    last = next
    if (changed) refresh()
  })
  const unsubscribeMode = useUiModeStore.subscribe((state, previous) => {
    if (state.mode !== previous.mode || state.loaded !== previous.loaded) refresh()
  })
  refresh()
  return () => {
    unsubscribeTasks()
    unsubscribeMode()
  }
}
