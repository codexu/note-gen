'use client'

import { CircleAlert, CircleDot, Cloud, CloudCheck, CloudDownload, CloudUpload, Database, LibraryBig, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWikiWorking } from '@/components/wiki/use-wiki-working'
import { cn } from '@/lib/utils'
import { isWikiFolderPath } from '@/lib/wiki/path'
import type { FileTreeSyncStatus } from './file-tree-action-policy'

export interface FileTreeRagStatus {
  status: 'idle' | 'calculating' | 'indexed'
  indexedCount?: number
}

export function FileTreeDecorations({
  path,
  kind = 'file',
  iconSize,
  rag,
  syncStatus,
  syncTitle,
  alwaysShowSynced = false,
}: {
  path: string
  kind?: 'file' | 'folder'
  iconSize: string
  rag?: FileTreeRagStatus
  syncStatus: FileTreeSyncStatus
  syncTitle: string
  alwaysShowSynced?: boolean
}) {
  const t = useTranslations('article.file.activityStatus')
  const wikiWorking = useWikiWorking(kind === 'folder' && isWikiFolderPath(path) ? undefined : path, kind)
  const ragWorking = rag?.status === 'calculating'
  const working = wikiWorking || ragWorking || syncStatus === 'loading'
  const failed = syncStatus === 'error'
  const rows = [
    { key: 'wiki', icon: LibraryBig, label: t('wiki'), detail: t(wikiWorking ? 'wikiWorking' : 'wikiIdle'), working: wikiWorking, failed: false },
    ...(rag ? [{
      key: 'rag', icon: Database, label: t('rag'), working: ragWorking, failed: false,
      detail: [
        t(ragWorking ? 'ragWorking' : rag.status === 'indexed' ? 'ragIndexed' : 'ragIdle'),
        ...(rag.indexedCount ? [t('ragIndexedCount', { count: rag.indexedCount })] : []),
      ].join(' · '),
    }] : []),
    { key: 'sync', icon: Cloud, label: t('sync'), detail: syncTitle, working: syncStatus === 'loading', failed },
  ]
  const summary = rows.map(row => `${row.label}: ${row.detail}`).join('; ')

  // Active work determines the single icon; a simultaneous sync failure
  // colors it and remains explicit in the detail panel.
  const StatusIcon = wikiWorking ? LibraryBig
    : working ? LoaderCircle
      : failed ? CircleAlert
        : syncStatus === 'dirty' ? CloudUpload
          : syncStatus === 'remote-only' ? CloudDownload
            : rag?.status === 'indexed' ? Database
              : syncStatus === 'synced' ? CloudCheck : CircleDot

  return (
    <span className="ml-auto flex min-w-5 shrink-0 items-center justify-end pr-1">
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            role="img"
            aria-label={summary}
            data-file-manager-status={alwaysShowSynced ? undefined : ''}
            title=""
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
              wikiWorking && !failed && 'text-primary',
              failed && 'text-destructive',
            )}
          >
            <StatusIcon
              aria-hidden="true"
              className={cn(iconSize, wikiWorking && 'notegen-wiki-icon', working && !wikiWorking && 'motion-safe:animate-spin')}
              data-wiki-working={wikiWorking || undefined}
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" align="start" sideOffset={8} className="flex w-64 flex-col items-stretch gap-3 p-3 motion-reduce:animate-none">
          <p className="font-medium">{t('title')}</p>
          <dl className="flex flex-col gap-3">
            {rows.map(({ key, icon: Icon, label, detail, working: rowWorking, failed: rowFailed }) => (
              <div key={key}>
                <dt className="flex items-center gap-2">
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="flex-1">{label}</span>
                  {rowFailed ? <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" /> : rowWorking ? <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin" /> : null}
                </dt>
                <dd className="mt-0.5 ml-5.5 break-words text-background/70">{detail}</dd>
              </div>
            ))}
          </dl>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}
