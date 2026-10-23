'use client'

import { ArrowDownToLine, ArrowUpFromLine, Ellipsis, FileText, RefreshCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item, ItemContent, ItemDescription, ItemFooter, ItemMedia, ItemTitle } from '@/components/ui/item'
import { cn } from '@/lib/utils'
import type { DocumentSyncController } from '@/stores/document-sync'

export function DocumentSyncPanel({
  document,
  disabled,
  onBeforeAction,
  summaryStatus,
}: {
  document: DocumentSyncController
  disabled: boolean
  onBeforeAction: () => void
  summaryStatus: string
}) {
  const t = useTranslations('syncOverview')
  const busy = disabled || document.busy || document.phase === 'checking'
  const status = document.phase === 'conflict' ? t('document.conflict')
    : document.phase === 'update-available' ? t('document.update')
      : document.phase === 'error' ? t('document.failed')
        : document.phase === 'syncing' ? t('syncing')
          : document.phase === 'checking' ? t('checking') : null
  const showStatus = status && status !== summaryStatus
    && !(document.phase === 'error' && summaryStatus === t('failed'))

  function run(action: () => Promise<void>) {
    onBeforeAction()
    void action()
  }

  return (
    <Item variant="muted" size="xs" className="min-w-0" role="region" aria-label={t('document.title')}>
      <ItemMedia variant="icon" className="text-muted-foreground">
        <FileText aria-hidden="true" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemDescription>{t('document.title')}</ItemDescription>
        <ItemTitle className="w-full min-w-0">
          <span className="truncate" title={document.path}>{document.path.split('/').pop()}</span>
        </ItemTitle>
      </ItemContent>
      {showStatus && <ItemFooter>
        <Badge variant={document.phase === 'error' ? 'destructive'
          : document.phase === 'conflict' || document.phase === 'update-available' ? 'warning' : 'secondary'}
          className="max-w-full" title={status ?? undefined}>
          <span className="truncate">{status}</span>
        </Badge>
      </ItemFooter>}
      <ItemFooter>
        <Button
          type="button"
          className="min-w-0 flex-1"
          disabled={busy}
          aria-busy={document.busy}
          onClick={() => run(document.phase === 'conflict'
            ? async () => document.resolveConflict()
            : document.sync)}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" className={cn(document.busy && 'animate-spin')} />
          <span className="min-w-0 truncate">{t(document.phase === 'conflict' ? 'document.resolve' : 'document.sync')}</span>
        </Button>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="icon" disabled={busy}
              aria-label={t('document.more')} title={t('document.more')}>
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" sideOffset={6} className="w-56 max-w-[calc(100vw-2rem)]">
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={busy} onSelect={() => run(document.push)}>
                <ArrowUpFromLine aria-hidden="true" />
                {t('document.upload')}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => run(document.pull)}>
                <ArrowDownToLine aria-hidden="true" />
                {t('document.download')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemFooter>
    </Item>
  )
}
