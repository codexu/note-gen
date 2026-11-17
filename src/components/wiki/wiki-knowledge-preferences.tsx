'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BookOpen, BrainCircuit, ChevronDown, MessageSquare, Palette, Sparkles, StickyNote } from 'lucide-react'
import { toast } from 'sonner'
import useRagSettingsStore, { DEFAULT_RAG_SETTINGS } from '@/stores/ragSettings'
import type { KnowledgeSourceType } from '@/types/knowledge'
import type { RagAgentStrategy } from '@/lib/rag-agent-policy'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useWikiErrorMessage } from './use-wiki-error-message'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { KnowledgeSettingCard } from './knowledge-setting-card'

function parsePaths(value: string) {
  return value.split(/[\n,]/).map(path => path.trim()).filter(Boolean)
}

export function WikiKnowledgePreferences() {
  const t = useTranslations('settings.rag')
  const wiki = useTranslations('wiki')
  const errorMessage = useWikiErrorMessage()
  const fieldId = useId()
  const { enabledSourceTypes, automaticSearchEnabled, agentStrategy, excludedPaths, initSettings, updateSetting } = useRagSettingsStore()
  const [busy, setBusy] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState(excludedPaths.join('\n'))
  const [saved, setSaved] = useState(true)
  const invalid = useMemo(() => parsePaths(draft).some(path => path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/.test(path) || path.split(/[\\/]/).includes('..')), [draft])

  useEffect(() => {
    void initSettings().catch(error => toast.error(wiki('failed'), { description: errorMessage(error) }))
  }, [initSettings, wiki, errorMessage])
  useEffect(() => { setDraft(excludedPaths.join('\n')); setSaved(true) }, [excludedPaths])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try { await action() }
    catch (error) { toast.error(wiki('failed'), { description: errorMessage(error) }) }
    finally { setBusy(false) }
  }

  function toggleSource(sourceType: KnowledgeSourceType, enabled: boolean) {
    return updateSetting('enabledSourceTypes', enabled ? [...new Set([...enabledSourceTypes, sourceType])]
      : enabledSourceTypes.filter(type => type !== sourceType))
  }

  return <KnowledgeSettingCard title={wiki('chatSettingsTitle')} description={wiki('chatSettingsDescription')} icon={MessageSquare} label={wiki('sharedMode')}>
    <ItemGroup>
      <Item variant="muted">
        <ItemMedia variant="icon"><Sparkles /></ItemMedia>
        <ItemContent><ItemTitle>{t('automaticSearchTitle')}</ItemTitle><ItemDescription>{t('automaticSearchDesc')}</ItemDescription></ItemContent>
        <ItemActions><Switch aria-label={t('automaticSearchTitle')} checked={automaticSearchEnabled} disabled={busy} onCheckedChange={enabled => void run(() => updateSetting('automaticSearchEnabled', enabled))} /></ItemActions>
      </Item>
    </ItemGroup>
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-xl bg-muted/40 p-2">
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-auto min-h-8 w-full justify-between py-2"><span className="min-w-0 whitespace-normal text-left">{wiki('chatAdvanced')}</span><ChevronDown data-icon="inline-end" className={cn('transition-transform', advancedOpen && 'rotate-180')} /></Button></CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 p-2 pt-3">
        <ItemGroup>
          <Item variant="outline">
            <ItemMedia variant="icon"><BrainCircuit /></ItemMedia>
            <ItemContent><ItemTitle>{t('agentStrategyTitle')}</ItemTitle><ItemDescription>{t(`agentStrategies.${agentStrategy}.desc`)}</ItemDescription></ItemContent>
            <ItemActions className="max-sm:w-full"><ToggleGroup type="single" variant="outline" size="sm" value={agentStrategy} disabled={busy || !automaticSearchEnabled} aria-label={t('agentStrategyTitle')} onValueChange={value => { if (value) void run(() => updateSetting('agentStrategy', value as RagAgentStrategy)) }}>{(['fast', 'balanced', 'deep'] as RagAgentStrategy[]).map(strategy => <ToggleGroupItem key={strategy} value={strategy}>{t(`agentStrategies.${strategy}.title`)}</ToggleGroupItem>)}</ToggleGroup></ItemActions>
          </Item>
          {([['article', BookOpen], ['record', StickyNote], ['canvas', Palette]] as const).map(([sourceType, Icon]) => <Item key={sourceType} variant="outline">
            <ItemMedia variant="icon"><Icon /></ItemMedia>
            <ItemContent><ItemTitle>{t(`sourceTypes.${sourceType}.title`)}</ItemTitle><ItemDescription>{t(`sourceTypes.${sourceType}.desc`)}</ItemDescription></ItemContent>
            <ItemActions><Switch aria-label={t(`sourceTypes.${sourceType}.title`)} checked={enabledSourceTypes.includes(sourceType)} disabled={busy} onCheckedChange={enabled => void run(() => toggleSource(sourceType, enabled))} /></ItemActions>
          </Item>)}
        </ItemGroup>
        <FieldGroup>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={fieldId}>{t('excludedPaths')}</FieldLabel>
            <FieldDescription>{t('excludedPathsDesc')}</FieldDescription>
            <Textarea id={fieldId} value={draft} aria-invalid={invalid} disabled={busy} placeholder={t('excludedPathsPlaceholder')} className="min-h-24" onChange={event => { setDraft(event.target.value); setSaved(false) }} />
            <FieldDescription>{invalid ? t('excludedPathsInvalid') : saved ? t('excludedPathsSaved') : t('excludedPathsUnsaved')}</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => updateSetting('excludedPaths', DEFAULT_RAG_SETTINGS.excludedPaths))}>{t('restoreDefaultExclusions')}</Button>
          <Button size="sm" disabled={busy || saved || invalid} onClick={() => void run(async () => { await updateSetting('excludedPaths', parsePaths(draft)); setSaved(true) })}>{t('saveExcludedPaths')}</Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </KnowledgeSettingCard>
}
