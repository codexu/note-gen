'use client'

import { useTranslations } from 'next-intl'
import { BookOpen, FolderTree, Pause, Play, RefreshCw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { KnowledgeSettingCard } from '@/components/wiki/knowledge-setting-card'
import { useWikiData } from '@/components/wiki/use-wiki-data'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import { WikiFolderIcon } from '@/components/wiki/wiki-folder-icon'
import { assertWikiContextCurrent } from '@/lib/wiki/context'
import { pauseWikiQueue, resumeWikiQueue } from '@/lib/wiki/queue'
import { updateWikiSettings } from '@/lib/wiki/settings'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'

/** Wiki directories present the shared knowledge space, rather than a source-folder dashboard. */
export function WikiFolderView({ folderPath }: { folderPath: string }) {
  const t = useTranslations('wiki.folder')
  const wiki = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { data, loading, error, refresh } = useWikiData()
  const { busy, beginAction } = useWikiActionScope(`${data?.context.id ?? 'loading'}:${folderPath}`)
  const enabled = data?.settings.enabled ?? false
  const pages = data?.pages.filter(page => page.status !== 'archived') ?? []
  const summaries = pages.filter(page => page.kind === 'source').length
  const topics = pages.filter(page => page.kind === 'topic').length
  const sources = data?.sources.filter(source => source.status === 'ready').length ?? 0
  const pending = data?.jobs.filter(job => ['pending', 'running', 'paused'].includes(job.status)).length ?? 0
  const failed = data?.jobs.filter(job => job.status === 'failed').length ?? 0
  const state = !enabled ? 'disabled' : data?.settings.paused ? 'paused' : data?.settings.started ? 'active' : 'notStarted'

  async function run(action: () => Promise<unknown>) {
    if (!data) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(data.context.id)
      if (!operation.isCurrent()) return
      await action()
      if (operation.isCurrent()) await refresh()
    } catch (cause) {
      if (operation.isCurrent()) toast.error(wiki('failed'), { description: errorMessage(cause) })
    } finally { operation.finish() }
  }

  return <ScrollArea className="h-full min-h-0 w-full flex-1">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      <header className="flex items-start gap-4">
        <div aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><WikiFolderIcon className="size-7" /></div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2><Badge variant="secondary">{t('outputLabel')}</Badge></div>
          <p className="break-all text-xs text-muted-foreground">{folderPath.replaceAll('\\', '/').replace(/\/$/, '')}/</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t('description')}</p>
        </div>
      </header>

      {error ? <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert> : null}

      <KnowledgeSettingCard title={t('overviewTitle')} description={t('overviewDescription')} icon={BookOpen} label="Markdown">
        <dl className="grid grid-cols-3 gap-3">
          {[[t('summaries'), summaries], [t('topics'), topics], [t('sources'), sources]].map(([label, count]) => <div key={label} className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3 sm:p-4"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-medium tabular-nums">{loading ? '—' : count}</dd></div>)}
        </dl>
      </KnowledgeSettingCard>

      <KnowledgeSettingCard title={t('maintenanceTitle')} description={t('maintenanceDescription')} icon={RefreshCw} label={wiki('defaultMode')} enabled={enabled}
        actions={<Switch aria-label={t('enabled')} checked={enabled} disabled={loading || !data || busy} onCheckedChange={value => { if (data) void run(() => updateWikiSettings({ enabled: value }, data.context.id)) }} />}>
        {data && enabled ? <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1"><p className="text-sm font-medium">{t('enabled')}</p><p className="text-sm text-muted-foreground">{t('enabledDescription')}</p></div>
            <Badge variant="secondary">{t(state)}</Badge>
          </div>
          {data.settings.started ? <>
            <dl className="grid grid-cols-2 gap-3">{[[t('pendingTasks'), pending], [t('failedTasks'), failed]].map(([label, count]) => <div key={label} className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-medium tabular-nums">{count}</dd></div>)}</dl>
            <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => data.settings.paused ? resumeWikiQueue({ unpause: true, expectedContextId: data.context.id }) : pauseWikiQueue(data.context.id))}>{data.settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{wiki(data.settings.paused ? 'resume' : 'pause')}</Button><span className="text-xs text-muted-foreground">{wiki('foregroundNotice')}</span></div>
          </> : <p className="text-sm text-muted-foreground">{t('chooseSources')}</p>}
          <Button variant="outline" size="sm" className="self-start" onClick={() => useSettingsDialogStore.getState().openSettings('rag')}><Settings2 data-icon="inline-start" />{t('settings')}</Button>
        </> : null}
      </KnowledgeSettingCard>

      <KnowledgeSettingCard title={t('scopeTitle')} description={t('scopeDescription')} icon={FolderTree} label={t('outputLabel')} />
    </div>
  </ScrollArea>
}
