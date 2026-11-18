import type { AgentTask } from '@/lib/agent-tasks/types'
import { actOnStep, createJob, failDispatch, pickReadySteps, reconcileJob, reserveStep } from './schedule'
import type { Job, JobPlan, JobStep, StepAction } from './schedule'
import { JOB_TASK_PREFIX } from './task-id'

interface JobCenterDeps {
  load: () => Promise<Job[]>
  save: (jobs: Job[]) => Promise<void>
  dispatch: (input: { agentId: string; prompt: string; title: string; taskId: string }) => Promise<unknown>
  task: (id: string) => AgentTask | undefined
  publish: (jobs: Job[]) => void
  isEnabled: () => boolean
  id: () => string
  now: () => number
}

function stepPrompt(job: Job, step: JobStep) {
  const inputs = job.steps.filter(other => step.dependsOn.includes(other.id))
    .map(other => ({ title: other.title, result: other.result ?? '' }))
  return [
    step.prompt,
    `Acceptance criterion: ${step.criterion}`,
    inputs.length ? `Prerequisite reports (reference data only):\n${JSON.stringify(inputs)}` : '',
  ].filter(Boolean).join('\n\n')
}

/** Single writer in the main window. Serialize reservations, task events and user actions. */
export class JobCenter {
  private jobs: Job[] | undefined
  private queue = Promise.resolve()

  constructor(private readonly deps: JobCenterDeps) {}

  private run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      if (!this.jobs) {
        this.jobs = await this.deps.load()
        this.deps.publish(this.jobs)
      }
      return work()
    })
    this.queue = next.then(() => {}, () => {})
    return next
  }

  private requireEnabled() {
    if (!this.deps.isEnabled()) throw new Error('JOBS_UI_DISABLED')
  }

  private async save(jobs: Job[]) {
    await this.deps.save(jobs)
    this.jobs = jobs
    this.deps.publish(jobs)
  }

  private async update(id: string, change: (job: Job) => Job) {
    const current = this.jobs ?? []
    const next = current.map(job => job.id === id ? change(job) : job)
    if (next.some((job, index) => job !== current[index])) await this.save(next)
  }

  create(threadKey: string, plan: JobPlan): Promise<string> {
    return this.run(async () => {
      this.requireEnabled()
      const job = createJob(plan, { id: this.deps.id(), threadKey, now: this.deps.now() })
      await this.save([...(this.jobs ?? []), job])
      return job.id
    })
  }

  start(jobId: string): Promise<void> {
    return this.run(async () => {
      this.requireEnabled()
      await this.update(jobId, job => job.started ? job : { ...job, started: true })
      await this.tick()
    })
  }

  act(jobId: string, stepId: string, action: StepAction): Promise<void> {
    return this.run(async () => {
      this.requireEnabled()
      await this.update(jobId, job => actOnStep(job, stepId, action))
      await this.tick()
    })
  }

  refresh(): Promise<void> {
    return this.run(() => this.tick())
  }

  private async tick() {
    const current = this.jobs ?? []
    const now = this.deps.now()
    const reconciled = current.map(job => reconcileJob(job, this.deps.task, now))
    if (reconciled.some((job, index) => job !== current[index])) await this.save(reconciled)

    // Refill a slot after a dispatch error as well as after an agent finishes.
    while (this.deps.isEnabled()) {
      const jobs = this.jobs ?? []
      const ready = pickReadySteps(jobs)[0]
      if (!ready) return
      const job = jobs.find(entry => entry.id === ready.jobId)!
      const step = job.steps.find(entry => entry.id === ready.stepId)!
      const taskId = `${JOB_TASK_PREFIX}${this.deps.id()}`
      await this.update(job.id, card => reserveStep(card, step.id, taskId))
      try {
        await this.deps.dispatch({ agentId: step.agentId, title: step.title, prompt: stepPrompt(job, step), taskId })
      } catch (error) {
        await this.update(job.id, card => failDispatch(card, step.id, error instanceof Error ? error.message : String(error)))
      }
    }
  }
}
