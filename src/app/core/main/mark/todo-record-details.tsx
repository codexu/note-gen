'use client'

import { useId } from 'react'
import { ChevronDown, Flag } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import type { Mark } from '@/db/marks'
import { cn } from '@/lib/utils'
import { parseTodoMarkContent, patchTodoMarkContent, type ParsedTodoMark } from './mark-list-item-content'
import { getTodoPriorityDotClass } from './mark-type-meta'
import type { useRecordDetailSave } from './use-record-detail-save'

const priorities = [
  { id: 'low', label: 'priorityLow' },
  { id: 'medium', label: 'priorityMedium' },
  { id: 'high', label: 'priorityHigh' },
] as const

interface TodoRecordDetailsProps {
  mark: Mark
  save: ReturnType<typeof useRecordDetailSave>['save']
  disabled?: boolean
}

export function TodoRecordDetails({ mark, save, disabled }: TodoRecordDetailsProps) {
  const t = useTranslations('record.mark.todo')
  const detail = useTranslations('record.mark.detail')
  const completionId = useId()
  const todo = parseTodoMarkContent(mark, { preserveFormatting: true })
  const readOnly = mark.deleted === 1
  const canEdit = !readOnly && !disabled
  const status = t(todo.completed ? 'completed' : 'uncompleted')
  const toggleLabel = t(todo.completed ? 'markUncompleted' : 'markCompleted')
  const priorityLabel = t(priorities.find(option => option.id === todo.priority)?.label ?? 'priorityMedium')

  function updateTodo(changes: Partial<ParsedTodoMark>, debounce = false) {
    if (!canEdit) return
    void save(latest => latest.type === 'todo' ? patchTodoMarkContent(latest, changes) : latest, { debounce })
  }

  const priority = (
    <>
      <Flag aria-hidden="true" data-icon="inline-start" />
      <span>{t('priority')}</span>
      <span className={cn('size-1.5 rounded-full', getTodoPriorityDotClass(todo.priority))} aria-hidden="true" />
      <span>{priorityLabel}</span>
    </>
  )

  return (
    <div className="flex min-w-0 flex-col gap-5 py-2">
      <section aria-label={t('title')} className="flex min-w-0 items-start gap-3 px-2">
        <Checkbox
          id={completionId}
          checked={todo.completed}
          disabled={!canEdit}
          aria-label={toggleLabel}
          title={toggleLabel}
          onCheckedChange={checked => updateTodo({ completed: checked === true })}
          className="mt-1.5 size-6 rounded-full after:-inset-2.5 [&_[data-slot=checkbox-indicator]>svg]:size-4"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {readOnly ? (
            <h1 className={cn(
              'min-h-9 wrap-break-word text-xl leading-9 font-semibold tracking-tight md:text-2xl',
              todo.completed && 'text-muted-foreground line-through',
            )}>
              {todo.title.trim() || t('title')}
            </h1>
          ) : (
            <Textarea
              rows={1}
              maxRows={5}
              value={todo.title}
              readOnly={!canEdit}
              aria-label={detail('todoTitle')}
              placeholder={t('titlePlaceholder')}
              className={cn(
                'min-h-9 resize-none border-0 bg-transparent! p-0 text-xl! leading-9 font-semibold tracking-tight focus-visible:ring-1 md:text-2xl!',
                todo.completed && 'text-muted-foreground line-through focus:text-foreground focus:no-underline',
              )}
              onChange={event => updateTodo({ title: event.currentTarget.value.replace(/[\r\n]+/g, ' ') }, true)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.preventDefault()
              }}
            />
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Label htmlFor={completionId} className={cn('text-xs text-muted-foreground', canEdit && 'cursor-pointer')}>
              {status}
            </Label>
            {readOnly ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground [&>svg]:size-3.5">{priority}</span>
            ) : (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="secondary" disabled={!canEdit} className="min-h-11 md:min-h-7">
                    {priority}
                    <ChevronDown aria-hidden="true" data-icon="inline-end" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={todo.priority}
                    onValueChange={value => {
                      const option = priorities.find(item => item.id === value)
                      if (option) updateTodo({ priority: option.id })
                    }}
                  >
                    {priorities.map(option => (
                      <DropdownMenuRadioItem key={option.id} value={option.id} className="min-h-11 md:min-h-0">
                        <span className={cn('size-1.5 rounded-full', getTodoPriorityDotClass(option.id))} aria-hidden="true" />
                        {t(option.label)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </section>

      {!readOnly || todo.description.trim() ? (
        <div className="flex flex-col gap-3">
          <Separator />
          <h2 className="text-sm font-medium text-muted-foreground">{detail('todoNotes')}</h2>
        </div>
      ) : null}
    </div>
  )
}
