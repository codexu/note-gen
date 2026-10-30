'use client'

import { useMemo, useRef, type ReactNode, type UIEvent } from 'react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type DifferenceLine = { type: 'equal' | 'add' | 'remove'; text: string; local?: number; remote?: number }

// Keep the comparison bounded for long notes. Common prefixes and suffixes are
// always preserved; very large changed blocks are shown as whole replacements.
function compareLines(localContent: string, remoteContent: string): DifferenceLine[] {
  const local = localContent ? localContent.split('\n') : []
  const remote = remoteContent ? remoteContent.split('\n') : []
  const changes: Array<Pick<DifferenceLine, 'type' | 'text'>> = []
  let start = 0
  while (start < local.length && start < remote.length && local[start] === remote[start]) {
    changes.push({ type: 'equal', text: local[start++] })
  }
  let localEnd = local.length
  let remoteEnd = remote.length
  while (localEnd > start && remoteEnd > start && local[localEnd - 1] === remote[remoteEnd - 1]) {
    localEnd--
    remoteEnd--
  }
  const localLength = localEnd - start
  const remoteLength = remoteEnd - start
  if ((localLength + 1) * (remoteLength + 1) <= 250_000) {
    const width = remoteLength + 1
    const lengths = new Uint32Array((localLength + 1) * width)
    for (let i = localLength - 1; i >= 0; i--) {
      for (let j = remoteLength - 1; j >= 0; j--) {
        lengths[i * width + j] = local[start + i] === remote[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
      }
    }
    let i = 0
    let j = 0
    while (i < localLength || j < remoteLength) {
      if (i < localLength && j < remoteLength && local[start + i] === remote[start + j]) {
        changes.push({ type: 'equal', text: local[start + i] })
        i++
        j++
      } else if (i < localLength && (j === remoteLength || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) {
        changes.push({ type: 'remove', text: local[start + i++] })
      } else {
        changes.push({ type: 'add', text: remote[start + j++] })
      }
    }
  } else {
    for (let i = start; i < localEnd; i++) changes.push({ type: 'remove', text: local[i] })
    for (let i = start; i < remoteEnd; i++) changes.push({ type: 'add', text: remote[i] })
  }
  for (let i = localEnd; i < local.length; i++) changes.push({ type: 'equal', text: local[i] })
  let localLine = 0
  let remoteLine = 0
  return changes.map(line => ({
    ...line,
    local: line.type === 'add' ? undefined : ++localLine,
    remote: line.type === 'remove' ? undefined : ++remoteLine,
  }))
}

export function SyncContentComparison({
  localContent, remoteContent, localLabel, remoteLabel, mergePanel, mergeLabel,
}: {
  localContent: string
  remoteContent: string
  localLabel: string
  remoteLabel: string
  mergePanel?: ReactNode
  mergeLabel?: string
}) {
  const t = useTranslations('syncOverview.selfHostedConflict')
  const lines = useMemo(() => {
    if (localContent.length + remoteContent.length > 500_000) return null
    let lineCount = 2
    for (const content of [localContent, remoteContent]) {
      for (let index = 0; index < content.length; index++) {
        if (content.charCodeAt(index) === 10 && ++lineCount > 4_000) return null
      }
    }
    return compareLines(localContent, remoteContent)
  }, [localContent, remoteContent])
  const localRef = useRef<HTMLDivElement>(null)
  const remoteRef = useRef<HTMLDivElement>(null)
  const added = lines?.filter(line => line.type === 'add').length ?? 0
  const removed = lines?.filter(line => line.type === 'remove').length ?? 0
  const syncScroll = (event: UIEvent<HTMLDivElement>, side: 'local' | 'remote') => {
    if (!window.matchMedia('(min-width: 768px)').matches) return
    const other = side === 'local' ? remoteRef.current : localRef.current
    if (other && Math.abs(other.scrollTop - event.currentTarget.scrollTop) > 1) {
      other.scrollTop = event.currentTarget.scrollTop
    }
  }

  return <Tabs defaultValue="local" className="min-w-0 gap-3">
    {lines && <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <Badge className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere]" variant={added ? 'success' : 'secondary'}>{t('addedLines', { count: added })}</Badge>
      <Badge className="h-auto max-w-full whitespace-normal [overflow-wrap:anywhere]" variant={removed ? 'destructive' : 'secondary'}>{t('removedLines', { count: removed })}</Badge>
    </div>}
    <p className="text-xs text-muted-foreground">{t(lines ? 'comparisonHint' : 'largeComparisonHint')}</p>
    <TabsList className={cn('grid h-auto w-full gap-1 md:hidden', mergePanel ? 'grid-cols-3' : 'grid-cols-2')}>
      <TabsTrigger value="local" className="min-h-9 min-w-0 whitespace-normal [overflow-wrap:anywhere]">{localLabel}</TabsTrigger>
      <TabsTrigger value="remote" className="min-h-9 min-w-0 whitespace-normal [overflow-wrap:anywhere]">{remoteLabel}</TabsTrigger>
      {mergePanel && <TabsTrigger value="merged" className="min-h-9 min-w-0 whitespace-normal [overflow-wrap:anywhere]">{mergeLabel}</TabsTrigger>}
    </TabsList>
    <div className="grid min-w-0 gap-3 md:grid-cols-2">
      {(['local', 'remote'] as const).map(side => <TabsContent key={side} value={side} forceMount className="min-w-0 data-[state=inactive]:hidden md:data-[state=inactive]:block">
        <section className="min-w-0 overflow-hidden rounded-md border" aria-label={side === 'local' ? localLabel : remoteLabel}>
          <p className="border-b bg-muted px-3 py-2 text-sm font-medium [overflow-wrap:anywhere]">{side === 'local' ? localLabel : remoteLabel}</p>
          <div ref={side === 'local' ? localRef : remoteRef} tabIndex={0} onScroll={event => syncScroll(event, side)}
            className="h-[clamp(10rem,32dvh,24rem)] min-w-0 overflow-auto overscroll-contain py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="region" aria-label={side === 'local' ? localLabel : remoteLabel}>
            {lines === null ? <Textarea
              readOnly
              value={side === 'local' ? localContent : remoteContent}
              aria-label={side === 'local' ? localLabel : remoteLabel}
              className="h-full min-h-full resize-none [field-sizing:fixed]"
            /> : lines.length ? lines.map((line, index) => {
              const missing = side === 'local' ? line.type === 'add' : line.type === 'remove'
              return <div key={index} className={cn('min-h-5 items-start gap-2 px-2', missing ? 'hidden md:flex' : 'flex',
                !missing && line.type === 'add' && 'bg-success/10', !missing && line.type === 'remove' && 'bg-destructive/10')}>
                <span aria-hidden="true" className="w-7 shrink-0 select-none text-right tabular-nums text-muted-foreground">{line[side]}</span>
                <span aria-hidden="true" className="w-3 shrink-0 select-none">{missing || line.type === 'equal' ? ' ' : line.type === 'add' ? '+' : '−'}</span>
                <pre className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{missing ? '\u00a0' : line.text || '\u00a0'}</pre>
              </div>
            }) : <p className="px-3 text-muted-foreground">{t('emptyVersion')}</p>}
          </div>
        </section>
      </TabsContent>)}
    </div>
    {mergePanel && <TabsContent value="merged" forceMount className="min-w-0 data-[state=inactive]:hidden md:data-[state=inactive]:block">{mergePanel}</TabsContent>}
  </Tabs>
}
