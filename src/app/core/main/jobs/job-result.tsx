'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { MessageScrollerItem } from '@/components/ui/message-scroller'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import { jobCenter, useJobs } from '@/lib/jobs'
import { jobsForThread } from '@/lib/jobs/projection'
import { hasJobResult, JOB_CONCURRENCY, type Job, type StepAction } from '@/lib/jobs/schedule'
import { threadKey } from '@/lib/threads/projects'
import useChatStore from '@/stores/chat'

export function JobReviewPreview({ criterion, result }: { criterion: string; result: string }) {
  const t = useTranslations('jobs')
  return (
    <div className="space-y-2 text-sm">
      <p className="wrap-break-word text-muted-ink">{t('criterionText', { criterion })}</p>
      {result && <p className="whitespace-pre-wrap wrap-break-word text-ink">{result}</p>}
    </div>
  )
}

function JobResultCard({ job }: { job: Job }) {
  const t = useTranslations('jobs')
  const tasks = useAgentTaskStore(state => state.tasks)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function run(action: () => Promise<void>) {
    setError(false)
    setBusy(true)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const reviewed = job.steps.filter(step => step.status === 'accepted').length
  const produced = new Set(job.steps.filter(hasJobResult).map(step => step.id))

  return (
    <article data-slot="thread-card" data-card="kickoff-result" className="rounded-md border border-line bg-bg p-3 text-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs text-muted-ink">{t('card')}</span>
        {job.started && <span className="text-xs text-muted-ink">{t('progress', { accepted: reviewed, total: job.steps.length })}</span>}
      </header>
      <h3 className="mb-2 font-medium wrap-break-word text-ink">{job.title}</h3>
      <ol className="divide-y divide-line-soft">
        {job.steps.map((step, index) => {
          const task = tasks.find(entry => entry.id === step.taskId)
          const status = step.status === 'dispatched' ? (task?.status === 'running' ? 'running' : 'queued') : step.status
          const blocked = job.started && status === 'waiting' && step.dependsOn.some(id => !produced.has(id))
          const dependencies = step.dependsOn.map(id => job.steps.findIndex(entry => entry.id === id) + 1)
          const act = (action: StepAction) => void run(() => jobCenter.act(job.id, step.id, action))
          const pendingDrafts = task?.status === 'awaiting_review'
          const errorText = step.error === 'AGENT_DISABLED' ? t('agentDisabled')
            : step.error === 'JOB_INTERRUPTED' ? t('interrupted') : step.error

          return (
            <li key={step.id} className="space-y-1.5 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <h4 className="font-medium wrap-break-word text-ink">{index + 1}. {step.title}</h4>
                {job.started && <span className="shrink-0 text-xs text-muted-ink">{t(`status.${blocked ? 'blocked' : status}`)}</span>}
              </div>
              <p className="text-xs wrap-break-word text-muted-ink">
                {step.agentName ?? step.agentId}
                {dependencies.length > 0 && ` · ${t('dependsOn', { steps: dependencies.join(', ') })}`}
              </p>
              <JobReviewPreview criterion={step.criterion} result={step.result ?? ''} />
              {!job.started && <p className="whitespace-pre-wrap wrap-break-word text-muted-ink">{step.prompt}</p>}
              {errorText && <p className="wrap-break-word text-danger">{errorText}</p>}
              <div className="flex flex-wrap gap-2">
                {status === 'review' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => act('accept')}>{t('accept')}</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => act('reject')}>{t('reject')}</Button>
                  </>
                )}
                {status === 'failed' && <Button size="sm" variant="outline" disabled={busy} onClick={() => act('retry')}>{t('retry')}</Button>}
                {job.started && (status === 'failed' || status === 'waiting') && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act('cancel')}>{t('cancelStep')}</Button>
                )}
                {pendingDrafts && <Button size="sm" variant="outline" onClick={() => useAgentTaskStore.getState().openSheet(task.id)}>{t('reviewDrafts')}</Button>}
              </div>
            </li>
          )
        })}
      </ol>
      {!job.started && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void run(() => jobCenter.start(job.id))}>{t('start')}</Button>
          <span className="text-xs text-muted-ink">{t('parallel', { count: JOB_CONCURRENCY })}</span>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-danger">{t('saveFailed')}</p>}
    </article>
  )
}

/** Render job cards in their conversation's message stream, using the same persisted source as Decide. */
export function JobMessages({ conversationId }: { conversationId: number | null }) {
  const v3 = useUiV3()
  const conversation = useChatStore(state => state.isTemporaryConversation ? undefined : state.conversations.find(entry => entry.id === conversationId))
  const jobs = useJobs(state => state.jobs)
  if (!v3 || !conversation) return null

  return jobsForThread(jobs, threadKey(conversation)).map(job => (
    <MessageScrollerItem key={job.id} messageId={`job:${job.id}`} className="w-full">
      <JobResultCard job={job} />
    </MessageScrollerItem>
  ))
}
