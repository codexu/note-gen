'use client'

import { FileText, Image as ImageIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'

export type RecordImageView = 'image' | 'body'

interface RecordImageViewSwitchProps {
  value: RecordImageView
  onValueChange: (value: RecordImageView) => void
  disabled?: boolean
  compact?: boolean
}

export function RecordImageViewSwitch({ value, onValueChange, disabled, compact }: RecordImageViewSwitchProps) {
  const t = useTranslations('record.mark.detail')
  const options = [
    { value: 'image', label: t('imageView'), icon: ImageIcon },
    { value: 'body', label: t('imageBody'), icon: FileText },
  ] as const

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={next => {
        if (next === 'image' || next === 'body') onValueChange(next)
      }}
      aria-label={t('imageViewMode')}
      disabled={disabled}
      size="sm"
      spacing={0.5}
      className="shrink-0 bg-muted p-0.5"
      data-swipe-back-ignore
    >
      {options.map(({ value: option, label, icon: Icon }) => (
        <ToggleGroupItem
          key={option}
          value={option}
          aria-label={label}
          title={label}
          className={cn(
            'text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs',
            compact ? 'h-7 w-9 min-w-0 px-0 @sm/record-detail:w-11' : '@max-lg/record-detail:w-7 @max-lg/record-detail:px-0',
          )}
        >
          <Icon aria-hidden="true" />
          {!compact && <span className="@max-lg/record-detail:hidden">{label}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
