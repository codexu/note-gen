'use client'

import { type CSSProperties, type ReactNode, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

export type ResponsiveSelectOption = {
  value: string
  label: ReactNode
  disabled?: boolean
  group?: string
}

interface ResponsiveSelectProps {
  title: string
  value: string
  options: ResponsiveSelectOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
  placeholder?: ReactNode
  appearance?: 'default' | 'inline'
  triggerContent?: ReactNode
  showChevron?: boolean
}

export function ResponsiveSelect({
  title,
  value,
  options,
  onValueChange,
  disabled,
  id,
  className,
  placeholder,
  appearance = 'default',
  triggerContent,
  showChevron = true,
}: ResponsiveSelectProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const inlineTriggerStyle: CSSProperties | undefined = appearance === 'inline'
    ? {
        width: 'auto',
        minWidth: 0,
        height: 'auto',
        border: 0,
        borderRadius: 0,
        background: 'transparent',
        padding: 0,
        color: 'inherit',
        fontSize: 'inherit',
        fontWeight: 'inherit',
        lineHeight: 'inherit',
        boxShadow: 'none',
      }
    : undefined
  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  )

  if (!isMobile) {
    const groups = Array.from(new Set(options.map(option => option.group || '')))
    return (
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          id={id}
          className={className}
          style={inlineTriggerStyle}
          title={title}
          aria-label={title}
          showChevron={showChevron}
        >
          {triggerContent
            ? <SelectValue>{triggerContent}</SelectValue>
            : <SelectValue placeholder={placeholder} />}
        </SelectTrigger>
        <SelectContent>
          {groups.map(group => (
            <SelectGroup key={group || 'default'}>
              {group ? <SelectLabel>{group}</SelectLabel> : null}
              {options.filter(option => (option.group || '') === group).map(option => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <>
      <Button
        id={id}
        type="button"
        variant={appearance === 'inline' ? 'ghost' : 'outline'}
        disabled={disabled}
        className={cn(
          appearance === 'inline' ? 'w-auto justify-start' : 'h-10 w-full justify-between px-3 font-normal',
          className,
        )}
        style={inlineTriggerStyle}
        title={title}
        aria-label={title}
        onClick={() => setOpen(true)}
      >
        <span className={cn('flex items-center truncate', !selectedOption && 'text-muted-foreground')}>
          {triggerContent ?? selectedOption?.label ?? placeholder}
        </span>
        {showChevron ? <ChevronDown aria-hidden="true" /> : null}
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            {options.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== options[index - 1]?.group ? (
                  <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{option.group}</p>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={option.disabled}
                  className="h-12 w-full justify-start px-3"
                  onClick={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value ? <Check className="ml-auto" aria-hidden="true" /> : null}
                </Button>
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
