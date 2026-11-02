'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, ChevronDown, Pause, Play, RefreshCw } from 'lucide-react'
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
import { useWikiData } from './use-wiki-data'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { WikiSyncNotice } from './wiki-sync-notice'
import { KnowledgeSettingCard } from './knowledge-setting-card'
import { useWikiActionScope } from './use-wiki-action-scope'

export function WikiSettingsPanel() {
  const t = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const { data, error, loading, refresh } = useWikiData()
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

  const { settings, context, usage, jobs } = data
  const languages = [...new Map([
    { value: 'zh', label: '中文' }, { value: 'en', label: 'English' }, ...getPluginLanguages(),
    { value: settings.language, label: settings.language },
  ].reverse().map(language => [language.value, language])).values()].reverse()
  const failedCount = jobs.filter(job => job.status === 'failed').length
  const jobPriority = { failed: 0, running: 1, pending: 2, paused: 3 }
  const visibleJobs = [...jobs].sort((left, right) => jobPriority[left.status] - jobPriority[right.status] || right.updatedAt - left.updatedAt).slice(0, 10)
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
        <p className="text-sm text-muted-foreground">{t('folderManagementHint')}</p>
        {settings.started ? <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{t(settings.paused ? 'statuses.paused' : 'automaticMaintenance')}</Badge>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => settings.paused ? resumeWikiQueue({ unpause: true, expectedContextId: context.id }) : pauseWikiQueue(context.id))}>{settings.paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{settings.paused ? t('resume') : t('pause')}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('foregroundNotice')}</p>
        </> : null}
        {failedCount > 0 ? <p className="text-sm text-destructive">{t('failedTasks', { count: failedCount })}</p> : null}
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
          <dl className="grid grid-cols-2 gap-4"><div><dt className="text-xs text-muted-foreground">{t('inputTokens')}</dt><dd className="font-medium">{usage.inputTokens.toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">{t('outputTokens')}</dt><dd className="font-medium">{usage.outputTokens.toLocaleString()}</dd></div></dl>
          <p className="text-xs text-muted-foreground">{usage.estimated ? t('estimatedUsage') : t('actualUsage')}</p>
          {visibleJobs.length ? <ItemGroup>{visibleJobs.map(job => <Item key={job.id} variant="outline"><ItemContent><ItemTitle>{data.pages.find(page => page.id === job.id)?.title || data.sources.find(source => source.sourceKey === job.sourceKey)?.source.title || t(job.kind === 'topic' ? 'topicTask' : 'sourceTask')}</ItemTitle><ItemDescription>{job.error ? errorMessage(job.error) : t(`statuses.${job.status}`)}</ItemDescription></ItemContent>{job.status === 'failed' && job.error !== 'WIKI_FILE_DELETED' ? <ItemActions><Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => retryWikiJob(job.id, { overwriteEdited: job.error === 'WIKI_FILE_EDITED', expectedContextId: context.id }))}><RefreshCw data-icon="inline-start" />{t(job.error === 'WIKI_FILE_EDITED' ? 'rebuild' : 'retry')}</Button></ItemActions> : null}</Item>)}</ItemGroup> : <p className="text-sm text-muted-foreground">{t('noTasks')}</p>}
          <p className="text-xs text-muted-foreground">{t('syncNotice')}</p>
          <WikiSyncNotice status={data.syncStatus} />
        </CollapsibleContent>
      </Collapsible>
    </> : null}
  </KnowledgeSettingCard>
}
