'use client'

import { useCallback, useEffect, useState } from 'react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { Store } from '@tauri-apps/plugin-store'
import { useTranslations } from 'next-intl'
import { AlertTriangle, ChevronDown, FileSearch, FileText, Hash, Layers, ListFilter, Pause, Play, RefreshCw, Search, Shield, Target, Trash } from 'lucide-react'
import { toast } from 'sonner'
import useRagSettingsStore, { type RagPreset } from '@/stores/ragSettings'
import useVectorStore from '@/stores/vector'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemActions, ItemDescription } from '@/components/ui/item'
import { SettingSection } from '@/app/core/setting/components/setting-base'
import { clearVectorDb, initVectorDb } from '@/db/vector'
import { getContextForQuery, initBM25Search, type RagDiagnosticResult } from '@/lib/rag'
import { cn } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { getKnowledgeIndexStats, getKnowledgeSources } from '@/db/knowledge'
import { purgeDisabledKnowledgeVectors, resumeKnowledgeIndexQueue, retryKnowledgeSource } from '@/lib/knowledge-index'
import type { KnowledgeIndexStatus, KnowledgeSource, KnowledgeSourceType } from '@/types/knowledge'
import { ModelSetting } from './model-setting'

interface NumericSetting {
  key: 'chunkSize' | 'chunkOverlap' | 'resultCount' | 'similarityThreshold' | 'rerankThreshold'
  title: string
  desc: string
  value: number
  min: number
  max: number
  step: number
  icon: typeof FileText
  disabled?: boolean
}

export function Settings() {
  const t = useTranslations('settings.rag')
  const {
    chunkSize, chunkOverlap, resultCount, similarityThreshold, rerankThreshold,
    globalSemanticSearchEnabled, indexPaused, indexNeedsRebuild,
    initSettings, updateSetting, applyPreset, markIndexDirty, markIndexClean, resetToDefaults,
  } = useRagSettingsStore()
  const {
    hasEmbeddingModel, hasRerankModel, isProcessing, lastProcessTime,
    indexStats, processAllDocuments, refreshIndexStats,
  } = useVectorStore()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [diagnosticQuery, setDiagnosticQuery] = useState('')
  const [diagnosticResults, setDiagnosticResults] = useState<RagDiagnosticResult[]>([])
  const [diagnosticLoading, setDiagnosticLoading] = useState(false)
  const [diagnosticCompleted, setDiagnosticCompleted] = useState(false)
  const [rebuildRequested, setRebuildRequested] = useState(false)
  const [knowledgeStats, setKnowledgeStats] = useState<Record<KnowledgeSourceType, Record<KnowledgeIndexStatus, number>> | null>(null)
  const [failedKnowledgeSources, setFailedKnowledgeSources] = useState<KnowledgeSource[]>([])

  const refreshKnowledgeStats = useCallback(async () => {
    setKnowledgeStats(await getKnowledgeIndexStats())
    setFailedKnowledgeSources(await getKnowledgeSources({ statuses: ['failed'] }))
  }, [])

  useEffect(() => {
    void initSettings()
    void refreshIndexStats()
    void refreshKnowledgeStats()
  }, [initSettings, refreshIndexStats, refreshKnowledgeStats])

  const numericSettings: NumericSetting[] = [
    { key: 'resultCount', title: t('resultCount'), desc: t('resultCountDesc'), value: resultCount, min: 1, max: 10, step: 1, icon: Hash },
    { key: 'chunkSize', title: t('chunkSize'), desc: t('chunkSizeDesc'), value: chunkSize, min: 100, max: 5000, step: 100, icon: FileText },
    { key: 'chunkOverlap', title: t('chunkOverlap'), desc: t('chunkOverlapDesc'), value: chunkOverlap, min: 0, max: Math.min(500, Math.max(0, chunkSize - 50)), step: 50, icon: Layers },
    { key: 'similarityThreshold', title: t('similarityThreshold'), desc: t('similarityThresholdDesc'), value: similarityThreshold, min: 0, max: 1, step: 0.01, icon: Target },
    { key: 'rerankThreshold', title: t('rerankThreshold'), desc: hasRerankModel ? t('rerankThresholdDesc') : t('rerankThresholdDisabledDesc'), value: rerankThreshold, min: 0, max: 1, step: 0.01, icon: ListFilter, disabled: !hasRerankModel },
  ]

  function isPresetActive(preset: RagPreset) {
    const values = { precision: [3, 0.4, 0.25], balanced: [5, 0.25, 0.1], recall: [8, 0.1, 0.05] }[preset]
    return resultCount === values[0] && similarityThreshold === values[1] && rerankThreshold === values[2]
  }

  async function handleDeleteIndex() {
    if (!await confirm(t('deleteVectorConfirm'))) return
    await clearVectorDb()
    await initVectorDb()
    await markIndexDirty()
    const store = await Store.load('store.json')
    await store.delete('lastVectorProcessTime')
    useVectorStore.setState({ lastProcessTime: null })
    await refreshIndexStats()
    toast.success(t('deleteVectorSuccess'))
  }

  async function handleRebuildIndex() {
    if (rebuildRequested) return
    setRebuildRequested(true)
    try {
      const consentStore = await Store.load('store.json')
      await consentStore.set('ragStructuredKnowledgeConsent', true)
      if (hasEmbeddingModel) await processAllDocuments()
      else {
        await initBM25Search()
        await markIndexClean()
        const builtAt = Date.now()
        const store = await Store.load('store.json')
        await store.set('lastVectorProcessTime', builtAt)
        useVectorStore.setState({ lastProcessTime: builtAt })
        toast.success(t('lexicalIndexRebuilt'))
      }
      await refreshIndexStats()
      await refreshKnowledgeStats()
    } finally { setRebuildRequested(false) }
  }

  async function toggleIndexPaused(paused: boolean) {
    await updateSetting('indexPaused', paused)
    if (!paused) await resumeKnowledgeIndexQueue()
    await refreshKnowledgeStats()
  }

  async function handlePurgeDisabledIndex() {
    if (!await confirm(t('purgeDisabledConfirm'))) return
    await purgeDisabledKnowledgeVectors()
    await refreshIndexStats()
    await refreshKnowledgeStats()
    toast.success(t('purgeDisabledSuccess'))
  }

  async function handleRetrySource(sourceKey: string) {
    await retryKnowledgeSource(sourceKey)
    await refreshKnowledgeStats()
    await refreshIndexStats()
  }

  async function runDiagnostic() {
    const query = diagnosticQuery.trim()
    if (!query || diagnosticLoading) return
    setDiagnosticLoading(true)
    setDiagnosticCompleted(false)
    try {
      const result = await getContextForQuery(query)
      setDiagnosticResults(result.diagnostics)
      setDiagnosticCompleted(true)
    } catch (error) {
      console.error('知识库检索测试失败:', error)
      toast.error(t('diagnosticFailed'))
    } finally { setDiagnosticLoading(false) }
  }

  function formatIndexTime(timestamp: number | null) {
    return timestamp ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)) : t('neverBuilt')
  }

  function renderNumericSetting(setting: NumericSetting) {
    const Icon = setting.icon
    return <Item key={setting.key} className={cn('max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-start', setting.disabled && 'opacity-60')} variant="outline">
      <ItemMedia variant="icon"><Icon /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle>{setting.title}</ItemTitle><ItemDescription>{setting.desc}</ItemDescription></ItemContent>
      <ItemActions className="w-[180px] max-md:col-span-2 max-md:w-full">
        <div className="flex w-full flex-col gap-3">
          <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{setting.min}</span><span className="text-xs font-medium">{setting.value}</span><span className="text-xs text-muted-foreground">{setting.max}</span></div>
          <Slider disabled={setting.disabled} value={[setting.value]} onValueChange={value => void updateSetting(setting.key, value[0])} min={setting.min} max={setting.max} step={setting.step} className="w-full" aria-label={setting.title} />
        </div>
      </ItemActions>
    </Item>
  }

  return <>
    <ItemGroup>
      <Item variant="outline">
        <ItemMedia variant="icon"><Layers /></ItemMedia>
        <ItemContent><ItemTitle>{t('indexStatusTitle')}<Badge variant={indexNeedsRebuild ? 'outline' : 'secondary'}>{t(indexNeedsRebuild ? 'indexNeedsRebuild' : 'indexUpToDate')}</Badge></ItemTitle><ItemDescription>{t('vectorDocuments')}: {indexStats.documentCount} · {t('lastBuilt')}: {formatIndexTime(lastProcessTime || indexStats.lastUpdatedAt)}</ItemDescription></ItemContent>
        <ItemActions><Button size="sm" onClick={() => void handleRebuildIndex()} disabled={isProcessing || rebuildRequested}><RefreshCw data-icon="inline-start" className={isProcessing || rebuildRequested ? 'animate-spin' : undefined} />{isProcessing || rebuildRequested ? t('rebuildingIndex') : t('rebuildIndex')}</Button></ItemActions>
      </Item>
    </ItemGroup>
    <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="rounded-xl bg-muted/40 p-2">
      <CollapsibleTrigger asChild><Button size="sm" variant="ghost" className="h-auto min-h-8 w-full justify-between py-2"><span className="min-w-0 whitespace-normal text-left">{t('ragAdvanced')}</span><ChevronDown data-icon="inline-end" className={cn('transition-transform', advancedOpen && 'rotate-180')} /></Button></CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 p-2 pt-3">
        <ModelSetting kind="reranking" />
        <ItemGroup>
          <Item variant="outline"><ItemMedia variant="icon"><Search /></ItemMedia><ItemContent><ItemTitle>{t('globalSemanticSearchTitle')}</ItemTitle><ItemDescription>{t('globalSemanticSearchDesc')}</ItemDescription></ItemContent><ItemActions><Switch checked={globalSemanticSearchEnabled} aria-label={t('globalSemanticSearchTitle')} onCheckedChange={checked => void updateSetting('globalSemanticSearchEnabled', checked)} /></ItemActions></Item>
          {knowledgeStats ? <Item variant="outline"><ItemMedia variant="icon"><Layers /></ItemMedia><ItemContent><ItemTitle>{t('structuredIndexTitle')}</ItemTitle><ItemDescription>{(['article', 'record', 'canvas'] as KnowledgeSourceType[]).map(type => <span key={type} className="mr-3 inline-block">{t(`sourceTypes.${type}.title`)}: {knowledgeStats[type].ready}/{Object.values(knowledgeStats[type]).reduce((sum, value) => sum + value, 0)}{knowledgeStats[type].failed > 0 ? ` · ${t('failedCount', { count: knowledgeStats[type].failed })}` : ''}</span>)}</ItemDescription><Progress value={(() => { const total = Object.values(knowledgeStats).flatMap(stats => Object.values(stats)).reduce((sum, value) => sum + value, 0); const ready = Object.values(knowledgeStats).reduce((sum, stats) => sum + stats.ready, 0); return total > 0 ? ready / total * 100 : 100 })()} /></ItemContent><ItemActions><Button size="sm" variant="outline" onClick={() => void toggleIndexPaused(!indexPaused)}>{indexPaused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}{indexPaused ? t('continueIndex') : t('pauseIndex')}</Button></ItemActions></Item> : null}
          {failedKnowledgeSources.map(source => <Item key={source.sourceKey} variant="outline"><ItemMedia variant="icon"><AlertTriangle /></ItemMedia><ItemContent><ItemTitle>{source.title}</ItemTitle><ItemDescription>{source.error || t('unknownIndexError')}</ItemDescription></ItemContent><ItemActions><Button size="sm" variant="outline" onClick={() => void handleRetrySource(source.sourceKey)}><RefreshCw data-icon="inline-start" />{t('retrySource')}</Button></ItemActions></Item>)}
        </ItemGroup>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[[t('vectorDocuments'), indexStats.documentCount], [t('vectorChunks'), indexStats.chunkCount], [t('bm25Documents'), indexStats.bm25DocumentCount], [t('bm25Chunks'), indexStats.bm25ChunkCount]].map(([label, value]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>
        <div className="flex flex-wrap items-center gap-2"><ToggleGroup type="single" variant="outline" size="sm" value={(['precision', 'balanced', 'recall'] as RagPreset[]).find(isPresetActive) || ''} aria-label={t('presetDesc')} onValueChange={value => { if (value) void applyPreset(value as RagPreset) }}>{(['precision', 'balanced', 'recall'] as RagPreset[]).map(preset => <ToggleGroupItem key={preset} value={preset}>{t(`presets.${preset}.title`)}</ToggleGroupItem>)}</ToggleGroup><span className="text-xs text-muted-foreground">{t('presetDesc')}</span></div>
        <ItemGroup>{numericSettings.map(renderNumericSetting)}</ItemGroup>
        <div className="flex justify-end"><Button variant="outline" size="sm" onClick={() => void resetToDefaults()}><RefreshCw data-icon="inline-start" />{t('resetToDefaults')}</Button></div>
        <SettingSection title={t('diagnosticTitle')} desc={t('diagnosticDesc')}>
          <div className="flex gap-2"><Input value={diagnosticQuery} placeholder={t('diagnosticPlaceholder')} aria-label={t('diagnosticTitle')} onChange={event => setDiagnosticQuery(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') void runDiagnostic() }} /><Button onClick={() => void runDiagnostic()} disabled={!diagnosticQuery.trim() || diagnosticLoading}><Search data-icon="inline-start" className={diagnosticLoading ? 'animate-spin' : undefined} />{t('runDiagnostic')}</Button></div>
          {diagnosticCompleted && diagnosticResults.length === 0 ? <Empty className="border"><EmptyHeader><EmptyDescription>{t('diagnosticNoResults')}</EmptyDescription></EmptyHeader></Empty> : null}
          {diagnosticResults.length ? <ItemGroup>{diagnosticResults.map(result => <Item key={`${result.filepath}-${result.rank}`} variant="outline" className="items-start"><ItemMedia variant="icon"><FileSearch /></ItemMedia><ItemContent className="min-w-0"><ItemTitle><span>#{result.rank} {result.filename}</span><Badge variant="outline">{result.beforeRerankRank} → {result.rank}</Badge></ItemTitle><ItemDescription className="line-clamp-1">{result.filepath}</ItemDescription><div className="flex flex-wrap gap-1.5 pt-1">{result.retrievers.map(retriever => <Badge key={retriever} variant="secondary">{t(`retrievers.${retriever}`)}</Badge>)}<Badge variant="outline">{t('fusedScore')}: {result.fusedScore.toFixed(3)}</Badge><Badge variant="outline">{t('finalScore')}: {result.finalScore.toFixed(3)}</Badge></div><p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{result.content}</p></ItemContent></Item>)}</ItemGroup> : null}
        </SettingSection>
        <SettingSection title={t('dangerZoneTitle')} desc={t('dangerZoneDesc')}>
          <div className="flex flex-wrap gap-2"><Button variant="destructive" size="sm" onClick={() => void handleDeleteIndex()}><Trash data-icon="inline-start" />{t('deleteVector')}</Button><Button variant="outline" size="sm" onClick={() => void handlePurgeDisabledIndex()}><Shield data-icon="inline-start" />{t('purgeDisabledIndex')}</Button></div>
          <p className="text-xs text-muted-foreground">{t('deleteVectorHint')}</p>
        </SettingSection>
      </CollapsibleContent>
    </Collapsible>
  </>
}
