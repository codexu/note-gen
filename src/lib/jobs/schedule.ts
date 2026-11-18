import type { AgentTask } from '@/lib/agent-tasks/types'

export const JOB_CONCURRENCY = 3
export const MAX_JOB_STEPS = 12

export interface StepPlan {
  id: string
  title: string
  agentId: string
  agentName?: string
  prompt: string
  criterion: string
  dependsOn: string[]
}

export interface JobPlan {
  title: string
  steps: StepPlan[]
}

export type StepStatus = 'waiting' | 'dispatched' | 'review' | 'accepted' | 'rejected' | 'failed' | 'cancelled'
export type StepAction = 'accept' | 'reject' | 'retry' | 'cancel'

export interface JobStep extends StepPlan {
  status: StepStatus
  taskId?: string
  result?: string
  error?: string
  finishedAt?: number
}

export interface Job {
  id: string
  threadKey: string
  createdAt: number
  title: string
  started: boolean
  steps: JobStep[]
}

type TaskSnapshot = Pick<AgentTask, 'status' | 'result' | 'error' | 'updatedAt' | 'finishedAt'>

function validateGraph(steps: StepPlan[]) {
  const byId = new Map(steps.map(step => [step.id, step]))
  const visiting = new Set<string>()
  const visited = new Set<string>()

  function visit(id: string) {
    if (visited.has(id)) return
    const step = byId.get(id)
    if (!step || visiting.has(id)) throw new Error('JOB_INVALID_DEPENDENCIES')
    visiting.add(id)
    step.dependsOn.forEach(visit)
    visiting.delete(id)
    visited.add(id)
  }

  if (byId.size !== steps.length) throw new Error('JOB_INVALID_DEPENDENCIES')
  byId.forEach(step => visit(step.id))
}

export function createJob(plan: JobPlan, context: { id: string; threadKey: string; now: number }): Job {
  if (!plan.title.trim() || !context.threadKey || plan.steps.length < 1 || plan.steps.length > MAX_JOB_STEPS) {
    throw new Error('JOB_INVALID_PLAN')
  }
  for (const step of plan.steps) {
    if (![step.id, step.title, step.prompt, step.agentId, step.criterion].every(value => value.trim())) {
      throw new Error('JOB_INVALID_PLAN')
    }
  }
  validateGraph(plan.steps)
  return {
    id: context.id,
    threadKey: context.threadKey,
    createdAt: context.now,
    title: plan.title.trim(),
    started: false,
    steps: plan.steps.map(step => ({ ...step, dependsOn: [...step.dependsOn], status: 'waiting' })),
  }
}

export function hasJobResult(step: JobStep) {
  return step.status === 'review' || step.status === 'accepted' || step.status === 'rejected'
}

export function pickReadySteps(jobs: Job[]): Array<{ jobId: string; stepId: string }> {
  const reserved = jobs.reduce((sum, job) => sum + job.steps.filter(step => step.status === 'dispatched').length, 0)
  const candidates = jobs.filter(job => job.started).flatMap(job => {
    const satisfied = new Set(job.steps.filter(hasJobResult).map(step => step.id))
    return job.steps
      .filter(step => step.status === 'waiting' && step.dependsOn.every(id => satisfied.has(id)))
      .map(step => ({ jobId: job.id, stepId: step.id }))
  })
  return candidates.slice(0, Math.max(0, JOB_CONCURRENCY - reserved))
}

function updateStep(job: Job, stepId: string, update: (step: JobStep) => JobStep): Job {
  const steps = job.steps.map(step => step.id === stepId ? update(step) : step)
  return steps.every((step, index) => step === job.steps[index]) ? job : { ...job, steps }
}

export function reserveStep(job: Job, stepId: string, taskId: string): Job {
  return updateStep(job, stepId, step => ({ ...step, taskId, status: 'dispatched' }))
}

export function failDispatch(job: Job, stepId: string, error: string): Job {
  return updateStep(job, stepId, step => ({ ...step, error, status: 'failed' }))
}

export function reconcileJob(job: Job, lookup: (id: string) => TaskSnapshot | undefined, now: number): Job {
  const steps = job.steps.map((step): JobStep => {
    if (step.status !== 'dispatched' || !step.taskId) return step
    const task = lookup(step.taskId)
    if (task?.status === 'queued' || task?.status === 'running') return step
    const succeeded = task && !task.error && (task.status === 'completed' || task.status === 'awaiting_review')
    return {
      ...step,
      status: succeeded ? 'review' : 'failed',
      result: task?.result,
      error: succeeded ? undefined : task?.error || 'JOB_INTERRUPTED',
      finishedAt: task?.finishedAt ?? task?.updatedAt ?? now,
    }
  })
  return steps.every((step, index) => step === job.steps[index]) ? job : { ...job, steps }
}

export function actOnStep(job: Job, stepId: string, action: StepAction): Job {
  const step = job.steps.find(entry => entry.id === stepId)
  if (!step) return job
  if (step.status === 'review' && (action === 'accept' || action === 'reject')) {
    return updateStep(job, stepId, entry => ({ ...entry, status: action === 'accept' ? 'accepted' : 'rejected' }))
  }
  if (step.status === 'failed' && action === 'retry') {
    return updateStep(job, stepId, entry => ({
      ...entry, status: 'waiting', taskId: undefined, error: undefined, result: undefined, finishedAt: undefined,
    }))
  }
  if (job.started && (step.status === 'failed' || step.status === 'waiting') && action === 'cancel') {
    // Descendants cannot run once any prerequisite is cancelled. Independent work continues.
    const cancelled = new Set([stepId])
    for (let size = 0; size !== cancelled.size;) {
      size = cancelled.size
      for (const entry of job.steps) {
        if (entry.status === 'waiting' && entry.dependsOn.some(id => cancelled.has(id))) cancelled.add(entry.id)
      }
    }
    return { ...job, steps: job.steps.map(entry => cancelled.has(entry.id) ? { ...entry, status: 'cancelled' } : entry) }
  }
  return job
}
