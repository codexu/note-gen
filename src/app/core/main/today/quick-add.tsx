'use client'

// Fork (D4): natural-language quick add, e.g. `買菜 @明天 9am !high #家`.
import { useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronUp, Clock, CornerDownLeft, Hash, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { parseNaturalTask } from '@/lib/daily/nl-task'
import { cn } from '@/lib/utils'

export function QuickAdd({ now, busy, onSubmit }: {
  now: Date
  busy: boolean
  /** 回傳 true 代表已寫入，清空輸入框 */
  onSubmit: (input: string) => Promise<boolean>
}) {
  const t = useTranslations('today.quickAdd')
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => (value.trim() ? parseNaturalTask(value, now) : null), [value, now])
  const hintId = 'today-quick-add-hint'

  async function submit() {
    if (!parsed?.title || busy) return
    if (await onSubmit(value)) {
      setValue('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="mb-2">
      <label className="flex h-11 items-center gap-2 rounded-lg bg-muted/60 px-3 focus-within:ring-2 focus-within:ring-ring/50">
        <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">{t('label')}</span>
        <input
          ref={inputRef}
          value={value}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit()
            }
            if (event.key === 'Escape') setValue('')
          }}
          placeholder={t('placeholder')}
          aria-describedby={hintId}
          disabled={busy}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {parsed?.title && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      </label>
      <div id={hintId} className="flex min-h-6 flex-wrap items-center gap-1.5 px-1 pt-1 text-xs text-muted-foreground" aria-live="polite">
        {!parsed && <span>{t('hint')}</span>}
        {parsed && !parsed.title && <span>{t('needTitle')}</span>}
        {parsed?.title && (
          <>
            <span className="text-foreground">{t('preview')}</span>
            <Chip>{parsed.title}</Chip>
            {parsed.due && <Chip icon={<CalendarDays className="size-3" aria-hidden />}>{parsed.due}</Chip>}
            {parsed.time && <Chip icon={<Clock className="size-3" aria-hidden />}>{parsed.time}</Chip>}
            {parsed.priority && <Chip icon={<ChevronUp className="size-3" aria-hidden />} accent={parsed.priority === 'high' || parsed.priority === 'highest'}>{t(`priority.${parsed.priority}`)}</Chip>}
            {parsed.tags.map(tag => <Chip key={tag} icon={<Hash className="size-3" aria-hidden />}>{tag.slice(1)}</Chip>)}
          </>
        )}
      </div>
    </div>
  )
}

function Chip({ icon, accent, children }: { icon?: React.ReactNode, accent?: boolean, children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 tabular-nums [overflow-wrap:anywhere]', accent && 'bg-hover text-ink font-medium')}>
      {icon}{children}
    </span>
  )
}
