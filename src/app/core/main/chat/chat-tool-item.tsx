'use client'

import * as React from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ChatToolItemProps = Omit<React.ComponentProps<typeof Button>, 'children' | 'title' | 'value'> & {
  icon: LucideIcon
  title: string
  description: string
  value?: React.ReactNode
}

export const ChatToolItem = React.forwardRef<HTMLButtonElement, ChatToolItemProps>(function ChatToolItem({
  icon: Icon,
  title,
  description,
  value,
  className,
  ...props
}, ref) {
  return (
    <Button
      {...props}
      ref={ref}
      type="button"
      variant="ghost"
      className={cn('h-auto min-h-14 w-full min-w-0 max-w-full justify-start gap-3 px-2 py-2.5', className)}
    >
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate">{title}</span>
        <span className="truncate text-xs font-normal text-muted-foreground" title={description}>{description}</span>
      </span>
      {value && <span className="min-w-0 max-w-24 shrink truncate text-xs font-normal text-muted-foreground">{value}</span>}
      <ChevronRight data-icon="inline-end" />
    </Button>
  )
})
