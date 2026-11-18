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

describe('job scheduling review fixes (PM)', () => {
  it('never unblocks dependents with a rejected result, and resets dependents that already used it', () => {
    let card = start(job([plan('a'), plan('b', ['a']), plan('c', ['b'])]))
    card = reconcileJob(reserveStep(card, 'a', 't-a'), () => ({ status: 'completed', result: 'A1', updatedAt: 2 }), 2)
    expect(ready(card)).toEqual([['job', 'b']])
    card = reconcileJob(reserveStep(card, 'b', 't-b'), id => id === 't-b'
      ? { status: 'completed', result: 'B1', updatedAt: 3 } : { status: 'completed', result: 'A1', updatedAt: 2 }, 3)
    const byId = (j: typeof card) => Object.fromEntries(j.steps.map(s => [s.id, s.status]))
    expect(byId(card)).toMatchObject({ a: 'review', b: 'review', c: 'waiting' })

    const rejected = actOnStep(card, 'a', 'reject')
    expect(byId(rejected)).toMatchObject({ a: 'rejected', b: 'waiting', c: 'waiting' })
    expect(rejected.steps.find(s => s.id === 'b')).toMatchObject({ taskId: undefined, result: undefined })
    expect(ready(rejected)).toEqual([])

    const retried = actOnStep(rejected, 'a', 'retry')
    expect(byId(retried)).toMatchObject({ a: 'waiting' })
    expect(ready(retried)).toEqual([['job', 'a']])
  })

  it('keeps accepted dependents when an upstream step is rejected later, and allows cancelling a rejected step', () => {
    let card = start(job([plan('a'), plan('b', ['a'])]))
    card = reconcileJob(reserveStep(card, 'a', 't-a'), () => ({ status: 'completed', result: 'A', updatedAt: 2 }), 2)
    card = reconcileJob(reserveStep(card, 'b', 't-b'), () => ({ status: 'completed', result: 'B', updatedAt: 3 }), 3)
    card = actOnStep(card, 'b', 'accept')
    const rejected = actOnStep(card, 'a', 'reject')
    expect(rejected.steps.map(s => s.status)).toContain('accepted')
    expect(actOnStep(rejected, 'a', 'cancel').steps.find(s => s.id === 'a')?.status).toBe('cancelled')
  })
})
