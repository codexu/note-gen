import { describe, expect, it } from 'vitest'
import { actOnStep, createJob, pickReadySteps, reconcileJob, reserveStep } from './schedule'
import type { Job, StepPlan } from './schedule'

function plan(id: string, dependsOn: string[] = []): StepPlan {
  return { id, dependsOn, title: id, prompt: id, criterion: id, agentId: 'agent' }
}

function job(steps: StepPlan[], id = 'job'): Job {
  return createJob({ title: 'Job', steps }, { id, threadKey: 'thread', now: 1 })
}

const start = (card: Job) => ({ ...card, started: true })
const ready = (...cards: Job[]) => pickReadySteps(cards).map(step => [step.jobId, step.stepId])

describe('job scheduling', () => {
  it('requires explicit start, then waits for successful dependency execution', () => {
    const proposal = job([plan('final', ['first']), plan('first')])
    expect(ready(proposal)).toEqual([])
    const running = reserveStep(start(proposal), 'first', 'attempt')
    expect(ready(running)).toEqual([])
    const review = reconcileJob(running, () => ({ status: 'awaiting_review', result: 'findings', updatedAt: 2 }), 2)
    expect(review.steps[1]).toMatchObject({ status: 'review', result: 'findings' })
    expect(ready(review)).toEqual([['job', 'final']])
    const accepted = actOnStep(review, 'first', 'accept')
    expect(accepted.steps.map(step => step.status)).toEqual(['waiting', 'accepted'])
  })

  it('shares three slots across cards, including jobs reserved but still queued in P5', () => {
    let first = start(job([plan('a'), plan('b'), plan('c')]))
    const second = start(job([plan('d'), plan('e')], 'other'))
    expect(ready(first, second)).toEqual([['job', 'a'], ['job', 'b'], ['job', 'c']])
    first = reserveStep(reserveStep(first, 'a', 'one'), 'b', 'two')
    expect(ready(first, second)).toEqual([['job', 'c']])
    first = reconcileJob(first, id => ({ status: id === 'one' ? 'completed' : 'queued', updatedAt: 2 }), 2)
    expect(ready(first, second)).toEqual([['job', 'c'], ['other', 'd']])
  })

  it('keeps failure with pending drafts distinct from success, supports rerun and cancels descendants', () => {
    const initial = start(job([plan('a'), plan('b', ['a']), plan('c', ['b']), plan('d')]))
    const running = reserveStep(initial, 'a', 'first')
    const failed = reconcileJob(running, () => ({ status: 'awaiting_review', error: 'failure', updatedAt: 2 }), 2)
    expect(failed.steps[0]).toMatchObject({ status: 'failed', error: 'failure' })
    expect(ready(failed)).toEqual([['job', 'd']])
    const retry = actOnStep(failed, 'a', 'retry')
    expect(retry.steps[0]).toMatchObject({ status: 'waiting', taskId: undefined, error: undefined })
    expect(ready(retry)).toEqual([['job', 'a'], ['job', 'd']])
    const retried = reserveStep(retry, 'a', 'second')
    const interrupted = reconcileJob(retried, () => ({ status: 'interrupted', updatedAt: 3 }), 3)
    const cancelled = actOnStep(interrupted, 'a', 'cancel')
    expect(cancelled.steps.map(step => step.status)).toEqual(['cancelled', 'cancelled', 'cancelled', 'waiting'])
    expect(ready(cancelled)).toEqual([['job', 'd']])
  })

  it('recovers a reservation missing from SQLite and ignores invalid or repeated actions', () => {
    const running = reserveStep(start(job([plan('a')])), 'a', 'lost')
    expect(actOnStep(running, 'a', 'retry')).toBe(running)
    const failed = reconcileJob(running, () => undefined, 3)
    expect(failed.steps[0]).toMatchObject({ status: 'failed', error: 'JOB_INTERRUPTED' })
    expect(reconcileJob(failed, () => undefined, 4)).toBe(failed)
  })

  it('rejects cycles, unknown dependencies, and ambiguous IDs', () => {
    expect(() => job([plan('a', ['b']), plan('b', ['a'])])).toThrow('JOB_INVALID_DEPENDENCIES')
    expect(() => job([plan('a', ['a'])])).toThrow('JOB_INVALID_DEPENDENCIES')
    expect(() => job([plan('a', ['missing'])])).toThrow('JOB_INVALID_DEPENDENCIES')
    expect(() => job([plan('a'), plan('a')])).toThrow('JOB_INVALID_DEPENDENCIES')
  })
})
