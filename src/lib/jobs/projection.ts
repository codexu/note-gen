import type { DecideItem } from '@/lib/decide/project'
import type { Job } from './schedule'

export function jobsForThread(jobs: Job[], threadKey?: string): Job[] {
  return threadKey ? jobs.filter(job => job.threadKey === threadKey) : []
}

export function projectJobDecisions(jobs: Job[]): DecideItem[] {
  return jobs.flatMap(job => job.steps.filter(step => step.status === 'review').map(step => ({
    key: `job:${job.id}:${step.id}`,
    source: 'job',
    kind: 'job',
    title: step.title,
    origin: job.title,
    summary: step.criterion,
    when: '',
    at: step.finishedAt ?? job.createdAt,
    preview: { type: 'job', result: step.result ?? '', criterion: step.criterion, diff: null },
    duplicates: [],
    ref: { source: 'job', jobId: job.id, stepId: step.id },
  })))
}
