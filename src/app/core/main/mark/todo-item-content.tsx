'use client'

import { useState } from 'react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import type { Mark } from '@/db/marks'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { parseTodoMarkContent } from './mark-list-item-content'
import { getMarkTypeListBadgeClasses, MARK_LIST_BADGE_CLASS } from './mark-type-meta'
import { TodoEditTrigger } from './todo-edit-button'
import { setRecordTodoCompleted } from './use-record-detail-save'

dayjs.extend(relativeTime)

const priorityStyles = {
  low: {
    label: 'todo.priorityLow',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  medium: {
    label: 'todo.priorityMedium',
    className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/35 dark:bg-amber-500/15 dark:text-amber-300',
  },
  high: {
    label: 'todo.priorityHigh',
    className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/35 dark:bg-red-500/15 dark:text-red-300',
  },
} as const

interface TodoItemContentProps {
  mark: Mark
  variant: 'list' | 'compact' | 'cards' | 'mobile'
  titleClassName: string
  previewClassName: string
  interactive?: boolean
  selectionMode?: boolean
  onOpen?: () => void
  timeLabel?: string
}

export function TodoItemContent({
  mark,
  variant,
  titleClassName,
  previewClassName,
  interactive = true,
  selectionMode = false,
  onOpen,
  timeLabel,
}: TodoItemContentProps) {
  const t = useTranslations('record.mark')
  const [pendingCompleted, setPendingCompleted] = useState<boolean | null>(null)
  const todo = parseTodoMarkContent(mark)
  const completed = pendingCompleted ?? todo.completed
  const saving = pendingCompleted !== null
  const taskType = t('type.todo')
  const taskTitle = todo.title || taskType
  const compact = variant === 'compact'
  const canToggle = interactive && !selectionMode && mark.deleted !== 1
  const completionLabel = t(completed ? 'todo.markUncompleted' : 'todo.markCompleted')
  const priority = priorityStyles[todo.priority]
  const priorityLabel = t(priority.label)
  const badgeTextClassName = variant === 'mobile' ? 'text-[10px]' : 'text-xs'

  async function changeCompletion(next: boolean) {
    if (!canToggle || saving) return

    setPendingCompleted(next)
    try {
      if (await setRecordTodoCompleted(mark.id, next)) return
    } catch (error) {
      console.error('Failed to update to-do completion:', error)
    } finally {
      setPendingCompleted(null)
    }
    toast({ title: t('detail.saveFailed'), variant: 'destructive' })
  }

  const contentClassName = 'group/todo-open block w-full min-w-0 rounded-sm text-left hover:no-underline focus-visible:outline-2 focus-visible:outline-ring'
  const content = (
    <>
      <span className={cn(
        'flex min-h-6 min-w-0 items-center gap-2',
        titleClassName,
        !selectionMode && 'ps-8 pointer-coarse:min-h-8 pointer-coarse:ps-13',
      )}>
        <span className={cn('min-w-0 truncate', completed
          ? 'text-muted-foreground line-through'
          : 'group-hover/todo-open:underline')}
        >
          {taskTitle}
        </span>
        <span
          className={cn(
            MARK_LIST_BADGE_CLASS,
            'ms-auto shrink-0 whitespace-nowrap',
            badgeTextClassName,
            priority.className,
          )}
          title={`${t('todo.priority')} ${priorityLabel}`}
        >
          <span className="sr-only">{t('todo.priority')} </span>
          {priorityLabel}
        </span>
      </span>
      {!compact && todo.description ? (
        <span className={cn('mt-1.5 line-clamp-3 break-words [overflow-wrap:anywhere]', previewClassName)}>
          {todo.description}
        </span>
      ) : null}
    </>
  )

  const body = (
    <div className={cn('relative min-w-0', compact && 'flex-1')}>
      {!selectionMode ? (
        <div className={cn(
          'absolute start-0 top-0 z-10 grid h-lh min-h-6 w-6 place-items-center pointer-coarse:h-8 pointer-coarse:w-11',
          titleClassName,
        )}>
          <Checkbox
            aria-label={canToggle ? completionLabel : t(completed ? 'todo.completed' : 'todo.uncompleted')}
            title={canToggle ? completionLabel : undefined}
            checked={completed}
            disabled={!canToggle}
            aria-disabled={saving || undefined}
            aria-busy={saving || undefined}
            className={cn(
              'size-4 rounded-full border-muted-foreground/60 after:-inset-1 pointer-coarse:size-5 pointer-coarse:after:-inset-3',
              'aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground dark:aria-checked:bg-primary',
            )}
            onClick={event => event.stopPropagation()}
            onCheckedChange={checked => void changeCompletion(checked === true)}
          />
        </div>
      ) : null}
      {!selectionMode && onOpen ? (
        <button type="button" className={contentClassName} onClick={onOpen}>{content}</button>
      ) : !selectionMode && interactive ? (
        <TodoEditTrigger mark={mark} className={contentClassName}>{content}</TodoEditTrigger>
      ) : (
        <div>{content}</div>
      )}
    </div>
  )

  return (
    <div className={cn('flex min-w-0 flex-1 flex-col', variant === 'cards' ? 'gap-2.5' : 'gap-2')}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(getMarkTypeListBadgeClasses('todo'), 'shrink-0', badgeTextClassName)}>
          {taskType}
        </span>
        {compact ? body : null}
        <span className={cn(
          'ms-auto shrink-0 whitespace-nowrap',
          variant === 'list' ? previewClassName : 'text-xs text-muted-foreground',
        )}>
          {timeLabel ?? dayjs(mark.createdAt).fromNow()}
        </span>
      </div>
      {!compact ? body : null}
    </div>
  )
}
