'use client'

// Fork（almanac ALMNC-10）：等你定的共用小件——差異預覽、種類圖示、收下／不要的動作（含 toast 與復原）。
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, FilePen, FilePlus, FileText, FolderPlus, Copy, ListTodo, MoveRight, Trash2 } from 'lucide-react'
import { acceptDecision, DraftNotApplied, rejectDecision } from '@/lib/decide/actions'
import type { DecideItem, DecideKind, DecidePreview, DiffPreview } from '@/lib/decide/project'
import { OrganizeConflict } from '@/lib/organize/transaction'
import { SlotUnavailable } from '@/lib/timeslots/apply'
import { useAgentTaskStore } from '@/lib/agent-tasks'

export const KIND_ICON: Record<DecideKind, typeof FileText> = {
  job: ListTodo, note: FileText, task: ListTodo, event: CalendarClock,
  create: FilePlus, update: FilePen, delete: Trash2, move: MoveRight, copy: Copy, folder: FolderPlus,
}

/** 差異預覽：變動處上一行淡色、刪掉的淡色加刪除線、新增的用 ink 疊透明底（v5 的 del／ins）。 */
export function DiffBlock({ diff, className }: { diff: DiffPreview, className?: string }) {
  const t = useTranslations('decide')
  if (diff.context.length + diff.removed.length + diff.added.length === 0) return null
  return (
    <div className={className} data-testid="decide-diff">
      <pre className="overflow-x-auto rounded-md border border-line-soft bg-bg px-3 py-2 font-mono text-[12.5px] leading-6 whitespace-pre-wrap break-words">
        {diff.context.map((line, i) => <div key={`c${i}`} className="text-faint">{`  ${line}`}</div>)}
        {diff.removed.map((line, i) => <div key={`r${i}`} className="text-faint line-through">{`- ${line}`}</div>)}
        {diff.added.map((line, i) => <div key={`a${i}`}><ins className="rounded-[3px] bg-ink/9 px-0.5 no-underline">{`+ ${line}`}</ins></div>)}
      </pre>
      {diff.hidden > 0 && <p className="mt-1 text-xs text-faint">{t('diff.hidden', { count: diff.hidden })}</p>}
    </div>
  )
}

/** 這一條接受後寫到哪裡（一句話）。 */
export function destinationText(t: ReturnType<typeof useTranslations>, preview: Exclude<DecidePreview, { type: 'job' }>): string {
  if (preview.type === 'newNote') return t('dest.note')
  if (preview.type === 'journal') return preview.fileMissing ? t('dest.journalNew', { section: preview.section }) : t('dest.journal', { section: preview.section })
  return preview.targetPath ? `${preview.path} → ${preview.targetPath}` : preview.path
}

export function useDecideActions() {
  const t = useTranslations('decide')
  const week = useTranslations('week')
  const organize = useTranslations('organize')
  const [busy, setBusy] = useState<string | null>(null)

  async function accept(item: DecideItem) {
    setBusy(item.key)
    try {
      const outcome = await acceptDecision(item)
      toast.success(t('accepted', { title: item.source === 'draft' ? item.summary || item.title : item.title }), {
        action: outcome.undo
          ? { label: t('undo'), onClick: () => void outcome.undo!().then(ok => { if (!ok) toast.error(t('undoFailed')) }) }
          : undefined,
      })
    } catch (error) {
      if (error instanceof DraftNotApplied) {
        const taskId = error.taskId
        toast.error(error.conflict ? t('conflict') : t('failed'), { action: { label: t('openReview'), onClick: () => useAgentTaskStore.getState().openSheet(taskId) } })
      } else if (error instanceof OrganizeConflict) {
        toast.error(organize('conflict'))
      } else if (error instanceof SlotUnavailable) {
        toast.error(week('slotUnavailable'))
      } else {
        console.error('[decide] accept failed:', error)
        toast.error(t('failed'))
      }
    } finally {
      setBusy(null)
    }
  }

  async function reject(item: DecideItem) {
    setBusy(item.key)
    try {
      await rejectDecision(item)
      toast(t('rejected', { title: item.source === 'draft' ? item.summary || item.title : item.title }))
    } catch (error) {
      console.error('[decide] reject failed:', error)
      toast.error(t('failed'))
    } finally {
      setBusy(null)
    }
  }

  return { busy, accept, reject }
}
