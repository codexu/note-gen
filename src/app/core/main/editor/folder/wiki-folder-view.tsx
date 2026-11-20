'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, FileText, Pause, Play, Settings2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { KnowledgeSettingCard } from '@/components/wiki/knowledge-setting-card'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'
import { useWikiData } from '@/components/wiki/use-wiki-data'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import { useWikiNavigation } from '@/components/wiki/use-wiki-navigation'
import { WikiFolderIcon } from '@/components/wiki/wiki-folder-icon'
import { WikiSyncNotice } from '@/components/wiki/wiki-sync-notice'
import { getWikiTaskTitle, WikiTaskList } from '@/components/wiki/wiki-task-list'
import { assertWikiContextCurrent } from '@/lib/wiki/context'
import { isWikiRootFolder } from '@/lib/wiki/path'
import { estimateWikiScope, pauseWikiQueue, resumeWikiQueue, retryWikiJob, startWikiCompilation } from '@/lib/wiki/queue'
import { removeWikiScope, updateWikiSettings } from '@/lib/wiki/settings'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { WIKI_ROOT_FOLDER } from '@/types/wiki'
import { WikiDirectoryFiles } from './wiki-directory-files'
import { WikiOverviewStats } from './wiki-overview-stats'
import { WikiSourcePicker } from './wiki-source-picker'

type WikiData = NonNullable<ReturnType<typeof useWikiData>['data']>

function WikiOverview({ data, refresh }: { data: WikiData; refresh: () => Promise<void> }) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { openPage } = useWikiNavigation()
  const { context, settings, jobs, sources, pages } = data
  const { busy, beginAction } = useWikiActionScope(context.id)
  const [scopeLimit, setScopeLimit] = useState(6)
  const [issueLimit, setIssueLimit] = useState(5)
  const selected = settings.scopes.filter(scope => scope.enabled && scope.effect !== 'exclude')
  const ready = sources.filter(source => source.status === 'ready').length
  const running = jobs.find(job => job.status === 'running')
  const pending = jobs.filter(job => ['pending', 'running', 'paused'].includes(job.status)).length
  const failures = jobs.filter(job => job.status === 'failed')
  const waiting = jobs.filter(job => job.stage === 'waiting-source' && job.status === 'paused')
  const issues = [...failures, ...waiting]
  const state = !settings.enabled ? 'disabled' : settings.paused ? 'paused' : settings.started ? 'active' : 'notStarted'

  async function run(action: (isCurrent: () => boolean) => Promise<void>) {
    if (busy) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(context.id)
      if (!operation.isCurrent()) return
      await action(operation.isCurrent)
      if (operation.isCurrent()) await refresh()
    } catch (cause) {
      if (operation.isCurrent()) toast.error(t('failed'), { description: errorMessage(cause) })
    } finally { operation.finish() }
  }

  function start() {
    void run(async isCurrent => {
      const scope = await estimateWikiScope(context.id)
      if (!isCurrent()) return
      if (!scope.sourceCount) {
        toast.info(t('folder.emptySelection'))
        return
      }
      await startWikiCompilation(context.id)
    })
  }

  return <>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <WikiFolderIcon aria-hidden="true" className="mt-1 size-7 shrink-0 text-primary" />
        <div className="flex flex-col gap-1"><h2 className="text-xl font-semibold tracking-tight">{t('folder.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('folder.description')}</p></div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void openPage(undefined, context.id)}><FileText data-icon="inline-start" />{t('folder.openIndex')}</Button>
    </header>

    <WikiOverviewStats contextId={context.id} pages={pages} sources={sources} />

    <KnowledgeSettingCard title={t('folder.maintenanceTitle')} description={t('folder.maintenanceDescription')}
      icon={BookOpen} label={t(`folder.${state}`)} enabled={settings.enabled}
      actions={<Switch aria-label={t('enabled')} checked={settings.enabled} disabled={busy}
        onCheckedChange={enabled => void run(() => updateWikiSettings({ enabled }, context.id))} />}>
      {settings.started ? <div className="flex flex-wrap items-center justify-between gap-2" aria-live="polite">
        <p className="text-sm">{t('folder.progress', { ready, pending, failed: failures.length })}
          {running ? <span className="ml-2 text-muted-foreground">{t('folder.workingOn', { title: getWikiTaskTitle(running, data) || t(running.kind === 'source' ? 'sourceTask' : 'topicTask') })}</span> : null}</p>
        {settings.enabled ? <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => settings.paused
          ? resumeWikiQueue({ unpause: true, expectedContextId: context.id }) : pauseWikiQueue(context.id))}>
          {settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{t(settings.paused ? 'resume' : 'pause')}
        </Button> : null}
      </div> : null}
      {settings.enabled ? <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{t('scopeTitle')}</p>
        {selected.length ? <div className="flex flex-wrap gap-2">
          {selected.slice(0, scopeLimit).map(scope => <Badge key={scope.key} variant="secondary" className="max-w-full gap-1">
            <span className="truncate" title={scope.label}>{scope.label || scope.id || t('allArticles')}</span>
            <button type="button" aria-label={`${t('removeScope')} · ${scope.label || t('allArticles')}`} disabled={busy}
              onClick={() => void run(() => removeWikiScope(scope.key, context.id))}><X aria-hidden="true" className="size-3" /></button>
          </Badge>)}
          {selected.length > scopeLimit ? <Button variant="link" size="xs" onClick={() => setScopeLimit(n => n + 20)}>{t('folder.showMore')}</Button> : null}
        </div> : <p className="text-sm text-muted-foreground">{t('scopeEmptyDescription')}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <WikiSourcePicker contextId={context.id} disabled={busy} />
          {!settings.started ? <Button size="sm" disabled={busy || !selected.length} onClick={start}>
            <Play data-icon="inline-start" />{t('start')}
          </Button> : null}
          <Button variant="ghost" size="sm" onClick={() => useSettingsDialogStore.getState().openSettings('rag')}>
            <Settings2 data-icon="inline-start" />{t('folder.settings')}
          </Button>
        </div>
      </div> : null}
      <WikiSyncNotice status={data.syncStatus} />
    </KnowledgeSettingCard>

    {issues.length ? <section aria-label={t('folder.issues')} className="flex flex-col gap-3">
      <h3 className="text-base font-medium">{t('folder.issues')}</h3>
      <WikiTaskList jobs={issues.slice(0, issueLimit)} data={data} busy={busy}
        onRetry={job => void run(() => retryWikiJob(job.id, { expectedContextId: context.id }))}
        onRebuild={job => void run(() => retryWikiJob(job.id, { overwriteEdited: true, expectedContextId: context.id }))} />
      {issues.length > issueLimit ? <Button variant="ghost" size="sm" onClick={() => setIssueLimit(n => n + 20)}>{t('folder.showMore')}</Button> : null}
    </section> : null}
  </>
}

export function WikiFolderView({ folderPath }: { folderPath: string }) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { data, error, refresh } = useWikiData()
  const path = folderPath.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const root = isWikiRootFolder(path)
  const directoryTitle = path === `${WIKI_ROOT_FOLDER}/来源摘要` ? t('folder.summaries')
    : path === `${WIKI_ROOT_FOLDER}/主题` ? t('folder.topics') : path === `${WIKI_ROOT_FOLDER}/备份` ? t('folder.backups') : path.split('/').pop()
  return <ScrollArea className="h-full min-h-0 w-full flex-1">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      {error ? <Alert variant="destructive"><AlertTitle>{t('loadFailed')}</AlertTitle><AlertDescription>{errorMessage(error)}</AlertDescription></Alert> : null}
      {!data && !error ? <p className="text-sm text-muted-foreground">{t('scopeLoading')}</p> : null}
      {data && root ? <WikiOverview key={data.context.id} data={data} refresh={refresh} /> : null}
      {!root ? <header><h2 className="text-xl font-semibold">{directoryTitle}</h2><p className="break-all text-sm text-muted-foreground">{path}/</p></header> : null}
      {data ? <WikiDirectoryFiles key={`${data.context.id}:${path}`} path={path} contextId={data.context.id} pages={data.pages} /> : null}
    </div>
  </ScrollArea>
}
