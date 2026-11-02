'use client'

import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function KnowledgeSettingCard({
  title, description, icon: Icon, label, enabled, actions, children,
}: {
  title: string
  description: string
  icon: LucideIcon
  label: string
  enabled?: boolean
  actions?: ReactNode
  children?: ReactNode
}) {
  const titleId = useId()

  return <Card role="region" aria-labelledby={titleId} className="gap-0 py-0">
    <CardHeader className="mobile-setting-inline-card-header flex flex-row items-start justify-between gap-4 p-5 sm:p-6">
      <div className="flex min-w-0 items-start gap-3">
        <div aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground', enabled && 'bg-primary/10 text-primary')}>
          <Icon className="size-5" />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id={titleId} role="heading" aria-level={3}>{title}</CardTitle>
            <Badge variant="secondary">{label}</Badge>
          </div>
          <CardDescription>{description}</CardDescription>
        </div>
      </div>
      {actions ? <CardAction className="mobile-setting-inline-card-action shrink-0 pt-1">{actions}</CardAction> : null}
    </CardHeader>
    {children ? <CardContent className="flex min-w-0 flex-col gap-5 px-5 pb-5 sm:px-6 sm:pb-6">{children}</CardContent> : null}
  </Card>
}
