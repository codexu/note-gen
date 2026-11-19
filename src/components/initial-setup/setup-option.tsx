'use client'

import { Check, type LucideIcon } from 'lucide-react'

import { ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

interface SetupOptionProps {
  value: string
  label: string
  selected: boolean
  hint?: string
  icon?: LucideIcon
}

export function SetupOption({ value, label, selected, hint, icon: Icon }: SetupOptionProps) {
  return (
    <ToggleGroupItem
      value={value}
      variant="outline"
      className={cn(
        'h-auto min-h-16 w-full min-w-0 self-stretch justify-start gap-3 rounded-xl px-4 py-3 text-left whitespace-normal',
        'data-[state=on]:border-primary/50 data-[state=on]:bg-primary/5',
      )}
    >
      {Icon && <Icon className="size-5 text-muted-foreground" aria-hidden="true" />}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm leading-snug font-medium">{label}</span>
        {hint && <span className="text-xs leading-relaxed font-normal text-muted-foreground">{hint}</span>}
      </span>
      <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', selected && 'border-primary bg-primary text-primary-foreground')}>
        {selected && <Check className="size-3" />}
      </span>
    </ToggleGroupItem>
  )
}
