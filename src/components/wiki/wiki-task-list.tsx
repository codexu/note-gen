'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import type { WikiJob, WikiSourceState } from '@/types/wiki'
import type { WikiPageListEntry } from '@/db/wiki'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import { getWikiArticleFileSignature } from '@/lib/wiki/files'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { useWikiNavigation } from './use-wiki-navigation'

interface WikiTaskData {
  context: { id: string }
  settings: { enabled: boolean }
  pages: WikiPageListEntry[]
  sources: WikiSourceState[]
}

export function getWikiTaskTitle(job: WikiJob, data: WikiTaskData): string | undefined {
  if (job.kind === 'topic') return data.pages.find(page => page.id === job.id)?.title
  return data.sources.find(source => source.stableId === job.id.slice('source:'.length))?.source.title
}

function PreviousTopicResult({ path, updatedAt }: { path: string; updatedAt: number }) {
  const t = useTranslations('wiki')
  const [present, setPresent] = useState(false)
  useEffect(() => {
    let active = true
    const current = captureWikiWorkspaceGuard()
    void getWikiArticleFileSignature(path).then(signature => {
      if (active && current()) setPresent(signature !== 'missing' && signature !== '!non-file')
    }).catch(() => { if (active && current()) setPresent(false) })
    return () => { active = false }
  }, [path, updatedAt])
  return present ? <ItemDescription>{t('showingLastResult')}</ItemDescription> : null
}

export function WikiTaskList({ jobs, data, busy, onRetry, onRebuild }: {
  jobs: WikiJob[]
  data: WikiTaskData
  busy: boolean
  onRetry: (job: WikiJob) => void
  onRebuild?: (job: WikiJob) => void
}) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { openPage, openConflictFile } = useWikiNavigation()
  return <ItemGroup>{jobs.map(job => {
    const dependency = job.stage === 'waiting-source' ? data.sources.find(source => source.stableId === job.waitingSourceId) : undefined
    const edited = job.error === 'WIKI_FILE_EDITED' || job.error === 'WIKI_INVALID_MARKDOWN_METADATA'
    const previous = job.stage === 'waiting-source' && job.kind === 'topic'
      ? data.pages.find(item => item.id === job.id && item.status !== 'archived') : undefined
    const page = !edited ? undefined : job.kind === 'topic' ? data.pages.find(item => item.id === job.id)
      : data.pages.find(item => item.kind === 'source' && item.sourceRefs.some(ref => `source:${ref.stableId}` === job.id))
    return <Item key={job.id} size="sm" variant="outline">
      <ItemContent>
        <ItemTitle>{getWikiTaskTitle(job, data) || t(job.kind === 'source' ? 'sourceTask' : 'topicTask')}</ItemTitle>
        <ItemDescription>{job.stage === 'waiting-source' ? t('waitingForSource', { source: dependency?.source.title || job.waitingSourceId || t('sourceTask') })
          : job.error ? errorMessage(job.error) : t(`statuses.${job.status}`)}</ItemDescription>
        {previous?.filePath ? <PreviousTopicResult key={`${data.context.id}:${previous.filePath}`} path={previous.filePath} updatedAt={previous.updatedAt} /> : null}
      </ItemContent>
      <ItemActions>
        {page ? <Button size="sm" variant="outline" onClick={() => void (page.filePath
          ? openConflictFile(page.filePath, data.context.id) : openPage(page.id, data.context.id))}>{t('viewPage')}</Button> : null}
        {data.settings.enabled && job.status === 'failed' && job.error !== 'WIKI_FILE_DELETED' && (!edited || onRebuild) ?
          <Button size="sm" variant="outline" disabled={busy} onClick={() => edited ? onRebuild?.(job) : onRetry(job)}>
            <RefreshCw data-icon="inline-start" />{t(edited ? 'backupAndRebuild' : 'retry')}
          </Button> : null}
      </ItemActions>
    </Item>
  })}</ItemGroup>
}
