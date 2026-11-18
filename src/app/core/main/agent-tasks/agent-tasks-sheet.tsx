'use client'

// Fork（#30）：背景任務清單與草稿審核抽屜。掛在 fork-services.tsx。
// 首頁的 Agent 任務卡（#32）之後也打開同一個抽屜。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Check, Loader2, Play, Square, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from '@/hooks/use-toast'
import {
  agentTaskCenter,
  applyTaskDraft,
  applyTaskDraftsInBulk,
  discardTaskDrafts,
  inspectTaskDrafts,
  useAgentTaskStore,
} from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import { isJobTaskId } from '@/lib/jobs/task-id'
import type { DraftReviewView } from '@/lib/agent-tasks/review'
import type { AgentTask, AgentTaskStatus, DraftChange } from '@/lib/agent-tasks/types'

type Group = 'waiting' | 'running' | 'unfinished' | 'done'

const GROUP_OF: Record<AgentTaskStatus, Group> = {
  awaiting_review: 'waiting',
  queued: 'running',
  running: 'running',
  interrupted: 'unfinished',
  failed: 'unfinished',
  completed: 'done',
  cancelled: 'done',
}

const GROUP_ORDER: Group[] = ['waiting', 'running', 'unfinished', 'done']

const GROUP_TONE: Record<Group, string> = {
  waiting: 'text-ink',
  running: 'text-ink',
  unfinished: 'text-destructive',
  done: 'text-muted-foreground',
}

function TaskRow({ task, onReview }: { task: AgentTask; onReview: () => void }) {
  const t = useTranslations('agentTasks')
  const managed = isJobTaskId(task.id)
  const pending = task.drafts.filter(draft => draft.state === 'pending').length
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{task.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {t(`status.${task.status}`)}
          {pending > 0 && ` · ${t('pendingDrafts', { count: pending })}`}
          {task.tokens > 0 && ` · ${t('tokens', { count: task.tokens.toLocaleString() })}`}
          {task.error && ` · ${task.error}`}
        </div>
      </div>
      {task.status === 'awaiting_review' && <Button size="sm" onClick={onReview}>{t('actions.review')}</Button>}
      {!managed && (task.status === 'running' || task.status === 'queued') && (
        <Button size="sm" variant="ghost" onClick={() => void agentTaskCenter.cancel(task.id)}>
          {task.status === 'running' ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
          {t('actions.cancel')}
        </Button>
      )}
      {!managed && (task.status === 'interrupted' || task.status === 'failed') && (
        <Button size="sm" variant="secondary" onClick={() => void agentTaskCenter.resume(task.id)}><Play className="size-3.5" />{t('actions.resume')}</Button>
      )}
      {!managed && (task.status === 'completed' || task.status === 'cancelled' || task.status === 'interrupted' || task.status === 'failed') && (
        <Button size="icon" variant="ghost" className="size-7" onClick={() => void agentTaskCenter.remove(task.id)} aria-label={t('actions.remove')}><Trash2 className="size-3.5" /></Button>
      )}
    </div>
  )
}

function DraftRow({ view, taskId, onChanged }: { view: DraftReviewView; taskId: string; onChanged: () => void }) {
  const t = useTranslations('agentTasks')
  const [busy, setBusy] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const { draft, conflict, individual } = view

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  const kindTone = draft.kind === 'delete' ? 'bg-destructive/15 text-destructive' : draft.kind === 'create' || draft.kind === 'folder' ? 'bg-hover text-ink' : 'bg-secondary'
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-xs ${kindTone}`}>{t(`kind.${draft.kind}`)}</span>
        <span className="flex-1" />
        {draft.state !== 'pending' ? (
          <span className={`text-xs ${draft.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{t(`draftState.${draft.state}`)}</span>
        ) : (
          <>
            {individual && <span className="text-xs text-ink">{t('individual')}</span>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => applyTaskDraft(taskId, draft.id, conflict))}>
              <Check className="size-3.5" />{conflict ? t('actions.overwrite') : t('actions.accept')}
            </Button>
            <Button size="icon" variant="ghost" className="size-7" disabled={busy} onClick={() => void run(() => discardTaskDrafts(taskId, [draft.id]))} aria-label={t('actions.discard')}>
              <X className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      <div className="mt-1.5 break-all font-mono text-xs">{draft.targetPath ? `${draft.path} → ${draft.targetPath}` : draft.path}</div>
      {draft.state === 'failed' && draft.error && <div className="mt-1.5 text-xs text-destructive">{draft.error === 'CONFLICT' ? t('conflict') : draft.error}</div>}
      {conflict && draft.state === 'pending' && (
        <div className="mt-2 flex items-center gap-1.5 rounded bg-hover px-2 py-1 text-xs text-ink font-medium"><AlertTriangle className="size-3.5" />{t('conflict')}</div>
      )}
      {(draft.content !== undefined || conflict) && (
        <button className="mt-1.5 text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowDiff(value => !value)}>
          {showDiff ? t('hideContent') : t('showContent')}
        </button>
      )}
      {showDiff && <DraftContent draft={draft} current={view.currentContent} conflict={conflict} />}
    </div>
  )
}

function DraftContent({ draft, current, conflict }: { draft: DraftChange; current: string | null; conflict: boolean }) {
  const t = useTranslations('agentTasks')
  return (
    <div className="mt-2 space-y-2">
      {(draft.kind === 'update' || conflict) && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">{conflict ? t('contentNow') : t('contentBefore')}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{(conflict ? current : draft.baseContent) ?? ''}</pre>
        </div>
      )}
      {draft.content !== undefined && (
        <div>
          <div className="mb-1 text-xs text-muted-foreground">{t('contentAfter')}</div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{draft.content}</pre>
        </div>
      )}
    </div>
  )
}

function Review({ task, onBack }: { task: AgentTask; onBack: () => void }) {
  const t = useTranslations('agentTasks')
  const [views, setViews] = useState<DraftReviewView[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void inspectTaskDrafts(task).then(next => { if (!cancelled) setViews(next) })
    return () => { cancelled = true }
  }, [task])

  const bulkCount = views?.filter(view => view.draft.state === 'pending' && !view.individual).length ?? 0
  const pendingCount = task.drafts.filter(draft => draft.state === 'pending').length

  async function bulk(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast({ title: t('applyFailed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button className="mb-2 self-start text-xs text-muted-foreground hover:underline" onClick={onBack}>← {t('back')}</button>
      <div className="mb-1 text-sm font-medium">{task.title}</div>
      <p className="mb-3 text-xs text-muted-foreground">{t('reviewHint')}</p>
      {task.result && <div className="mb-3 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">{task.result}</div>}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {!views && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {views?.map(view => (
          <DraftRow key={view.draft.id} view={view} taskId={task.id} onChanged={() => {}} />
        ))}
      </div>
      {pendingCount > 0 && (
        <div className="mt-3 flex gap-2 border-t pt-3">
          <Button disabled={busy || bulkCount === 0} onClick={() => void bulk(() => applyTaskDraftsInBulk(task.id))}>{t('actions.acceptBulk', { count: bulkCount })}</Button>
          <Button variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={() => void bulk(() => discardTaskDrafts(task.id))}>{t('actions.discardAll')}</Button>
        </div>
      )}
    </div>
  )
}

export function AgentTasksSheet() {
  const t = useTranslations('agentTasks')
  const v3 = useUiV3()
  const { tasks: allTasks, sheetOpen, reviewTaskId, closeSheet, setReviewTask } = useAgentTaskStore()
  const tasks = v3 ? allTasks : allTasks.filter(task => !isJobTaskId(task.id))
  const reviewTask = reviewTaskId ? tasks.find(task => task.id === reviewTaskId) : undefined

  return (
    <Sheet open={sheetOpen} onOpenChange={open => { if (!open) closeSheet() }}>
      <SheetContent side="right" className="flex flex-col gap-0 p-5 data-[side=right]:w-[520px] data-[side=right]:sm:max-w-[520px]">
        <SheetHeader className="mb-3 p-0">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
        </SheetHeader>
        {reviewTask ? (
          <Review task={reviewTask} onBack={() => setReviewTask(null)} />
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            {tasks.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</div>}
            {GROUP_ORDER.map(group => {
              const items = tasks.filter(task => GROUP_OF[task.status] === group)
              if (!items.length) return null
              return (
                <section key={group}>
                  <div className={`mb-1 px-2 text-xs font-medium ${GROUP_TONE[group]}`}>{t(`group.${group}`)}（{items.length}）</div>
                  {items.map(task => <TaskRow key={task.id} task={task} onReview={() => setReviewTask(task.id)} />)}
                </section>
              )
            })}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
