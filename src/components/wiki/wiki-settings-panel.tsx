'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from 'next/navigation'
import { BookOpen, ChevronDown, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ModelSelect } from '@/app/core/setting/components/model-select'
import { updateWikiSettings } from '@/lib/wiki/settings'
import { assertWikiContextCurrent } from '@/lib/wiki/context'
import { pauseWikiQueue, resumeWikiQueue, retryWikiJob } from '@/lib/wiki/queue'
import { getPluginLanguages } from '@/i18n/config'
import { cn } from '@/lib/utils'
import { getWikiUsage } from '@/db/wiki'
import type { WikiUsage } from '@/types/wiki'
import type { useWikiData } from './use-wiki-data'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { WikiTaskList } from './wiki-task-list'
import { WikiSyncNotice } from './wiki-sync-notice'
import { KnowledgeSettingCard } from './knowledge-setting-card'
import { useWikiActionScope } from './use-wiki-action-scope'

function WikiUsageDetails({ contextId }: { contextId: string }) {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const [usage, setUsage] = useState<WikiUsage | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let awaitingInitial = true
    const onUsage = (event: Event) => {
      const detail = (event as CustomEvent<{ contextId: string; usage: WikiUsage }>).detail
      if (detail.contextId !== contextId) return
      awaitingInitial = false
      setUsage(detail.usage)
      setError(null)
    }
    window.addEventListener('wiki-usage-updated', onUsage)
    void getWikiUsage(contextId).then(total => {
      if (awaitingInitial) setUsage(total)
    }).catch(cause => { if (awaitingInitial) setError(errorMessage(cause)) })
    return () => {
      awaitingInitial = false
      window.removeEventListener('wiki-usage-updated', onUsage)
    }
  }, [contextId, errorMessage])
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  return <>
    <dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">{t('inputTokens')}</dt><dd className="font-medium">{usage?.inputTokens.toLocaleString() ?? '…'}</dd></div><div><dt className="text-xs text-muted-foreground">{t('outputTokens')}</dt><dd className="font-medium">{usage?.outputTokens.toLocaleString() ?? '…'}</dd></div></dl>
    {usage && <p className="text-xs text-muted-foreground">{t(usage.estimated ? 'estimatedUsage' : 'actualUsage')}</p>}
  </>
}

export function WikiSettingsPanel({ state, onShowMore }: { state: ReturnType<typeof useWikiData>; onShowMore: () => void }) {
  const t = useTranslations('wiki')
  const mobileRoute = usePathname().startsWith('/mobile')
  const errorMessage = useWikiErrorMessage()
  const { data, error, loading, refresh } = state
  const { busy, beginAction } = useWikiActionScope(data?.context.id ?? 'loading')
  const [advancedOpen, setAdvancedOpen] = useState(false)

  async function run(action: () => Promise<unknown>) {
    if (!data) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(data.context.id)
      if (!operation.isCurrent()) return
      await action()
      if (operation.isCurrent()) await refresh()
    } catch (cause) {
      if (operation.isCurrent()) toast.error(t('failed'), { description: errorMessage(cause) })
    } finally { operation.finish() }
  }

  if (loading || !data) return <KnowledgeSettingCard
    title={t('wikiTitle')} description={t('wikiDescription')} icon={BookOpen} label={t('defaultMode')}
    actions={<Switch aria-label={t('enabled')} checked={false} disabled />}
  >
    {error ? <Alert variant="destructive"><AlertDescription>{t('loadFailed')}: {errorMessage(error)}</AlertDescription></Alert> : null}
  </KnowledgeSettingCard>

  const { settings, context, jobs, failedCount } = data
  const languages = [...new Map([
    { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, ...getPluginLanguages(),
    { value: settings.language, label: settings.language },
  ].reverse().map(language => [language.value, language])).values()].reverse()
  const failedJobs = jobs.filter(job => job.status === 'failed')
  const activeJobs = jobs.filter(job => job.status !== 'failed')
  const retry = (job: (typeof jobs)[number]) => run(() => retryWikiJob(job.id, { expectedContextId: context.id }))
  const rebuild = (job: (typeof jobs)[number]) => run(() => retryWikiJob(job.id, { overwriteEdited: true, expectedContextId: context.id }))
  return <KnowledgeSettingCard
    title={t('wikiTitle')}
    description={t('wikiDescription')}
    icon={BookOpen}
    label={t('defaultMode')}
    enabled={settings.enabled}
    actions={<Switch aria-label={t('enabled')} checked={settings.enabled} disabled={busy} onCheckedChange={value => void run(() => updateWikiSettings({ enabled: value }, context.id))} />}
  >
    {settings.enabled ? <>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t(mobileRoute ? 'folderManagementMobileHint' : 'folderManagementHint')}</p>
        {settings.started ? <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(settings.paused ? 'statuses.paused' : 'automaticMaintenance')}</Badge>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => settings.paused ? resumeWikiQueue({ unpause: true, expectedContextId: context.id }) : pauseWikiQueue(context.id))}>{settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{settings.paused ? t('resume') : t('pause')}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('foregroundNotice')}</p>
        </> : null}
        {failedJobs.length > 0 && <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t('failedTasks', { count: failedCount })}</h3>
          <WikiTaskList jobs={failedJobs} data={data} busy={busy} onRetry={retry} onRebuild={rebuild} />
          {failedCount > failedJobs.length && <Button variant="ghost" size="sm" onClick={onShowMore}>{t('folder.showMore')}</Button>}
        </section>}
      </div>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-xl bg-muted/40 p-2">
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-auto min-h-8 w-full justify-between py-2"><span className="min-w-0 whitespace-normal text-left">{t('wikiAdvanced')}</span><ChevronDown data-icon="inline-end" className={cn('transition-transform', advancedOpen && 'rotate-180')} /></Button></CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-4 p-2 pt-3">
          <ItemGroup>
            <Item variant="outline">
              <ItemContent><ItemTitle>{t('model')}</ItemTitle><ItemDescription>{t('modelDescription')}</ItemDescription></ItemContent>
              <ItemActions className="max-sm:w-full"><ModelSelect modelKey="wiki" value={settings.modelId || ''} persistSelection={false} emptyLabel={t('inheritModel')} onValueChange={modelId => run(() => updateWikiSettings({ modelId: modelId || null }, context.id))} /></ItemActions>
            </Item>
            <Item variant="outline">
              <ItemContent><ItemTitle>{t('outputLanguage')}</ItemTitle><ItemDescription>{t('outputLanguageDescription')}</ItemDescription></ItemContent>
              <ItemActions><Select value={settings.language} disabled={busy} onValueChange={language => void run(() => updateWikiSettings({ language }, context.id))}><SelectTrigger aria-label={t('outputLanguage')}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{languages.map(language => <SelectItem key={language.value} value={language.value}>{language.label}</SelectItem>)}</SelectGroup></SelectContent></Select></ItemActions>
            </Item>
          </ItemGroup>
          <WikiUsageDetails key={context.id} contextId={context.id} />
          {activeJobs.length ? <WikiTaskList jobs={activeJobs} data={data} busy={busy} onRetry={retry} />
            : !failedJobs.length && <p className="text-sm text-muted-foreground">{t('noTasks')}</p>}
          <p className="text-xs text-muted-foreground">{t('syncNotice')}</p>
          <WikiSyncNotice status={data.syncStatus} />
        </CollapsibleContent>
      </Collapsible>
    </> : null}
  </KnowledgeSettingCard>
}
