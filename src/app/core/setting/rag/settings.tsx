import { useCallback, useEffect, useMemo, useState } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Store } from "@tauri-apps/plugin-store";
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  BrainCircuit,
  BookOpen,
  ChevronDown,
  FileSearch,
  FileText,
  Hash,
  Layers,
  ListFilter,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  StickyNote,
  Palette,
  Pause,
  Play,
  Target,
  Trash
} from "lucide-react";
import useRagSettingsStore, { DEFAULT_RAG_SETTINGS, type RagPreset } from "@/stores/ragSettings";
import type { RagAgentStrategy } from "@/lib/rag-agent-policy";
import useVectorStore from "@/stores/vector";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemActions, ItemDescription, ItemFooter } from '@/components/ui/item';
import { SettingSection } from '@/app/core/setting/components/setting-base';
import { clearVectorDb, initVectorDb } from "@/db/vector";
import { getContextForQuery, initBM25Search, type RagDiagnosticResult } from '@/lib/rag';
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Progress } from '@/components/ui/progress';
import { getKnowledgeIndexStats, getKnowledgeSources } from '@/db/knowledge';
import { purgeDisabledKnowledgeVectors, resumeKnowledgeIndexQueue, retryKnowledgeSource } from '@/lib/knowledge-index';
import type { KnowledgeIndexStatus, KnowledgeSource, KnowledgeSourceType } from '@/types/knowledge';

interface NumericSetting {
  key: 'chunkSize' | 'chunkOverlap' | 'resultCount' | 'similarityThreshold' | 'rerankThreshold';
  title: string;
  desc: string;
  value: number;
  min: number;
  max: number;
  step: number;
  icon: typeof FileText;
  disabled?: boolean;
}

function parseExcludedPaths(value: string): string[] {
  return value.split(/[\n,]/).map(path => path.trim()).filter(Boolean);
}

function isInvalidExcludedPath(path: string): boolean {
  return path.startsWith('/')
    || path.startsWith('\\')
    || /^[a-zA-Z]:[\\/]/.test(path)
    || path.split(/[\\/]/).includes('..');
}

export function Settings() {
  const t = useTranslations('settings.rag');
  const {
    automaticSearchEnabled,
    agentStrategy,
    chunkSize,
    chunkOverlap,
    resultCount,
    similarityThreshold,
    rerankThreshold,
    excludedPaths,
    enabledSourceTypes,
    globalSemanticSearchEnabled,
    indexPaused,
    indexNeedsRebuild,
    initSettings,
    updateSetting,
    applyPreset,
    markIndexDirty,
    markIndexClean,
    resetToDefaults
  } = useRagSettingsStore();
  const {
    hasEmbeddingModel,
    hasRerankModel,
    isProcessing,
    lastProcessTime,
    indexStats,
    processAllDocuments,
    refreshIndexStats
  } = useVectorStore();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [excludedPathsDraft, setExcludedPathsDraft] = useState(excludedPaths.join('\n'));
  const [excludedPathsSaved, setExcludedPathsSaved] = useState(true);
  const [diagnosticQuery, setDiagnosticQuery] = useState('');
  const [diagnosticResults, setDiagnosticResults] = useState<RagDiagnosticResult[]>([]);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticCompleted, setDiagnosticCompleted] = useState(false);
  const [rebuildRequested, setRebuildRequested] = useState(false);
  const [knowledgeStats, setKnowledgeStats] = useState<Record<KnowledgeSourceType, Record<KnowledgeIndexStatus, number>> | null>(null);
  const [failedKnowledgeSources, setFailedKnowledgeSources] = useState<KnowledgeSource[]>([]);

  const refreshKnowledgeStats = useCallback(async () => {
    setKnowledgeStats(await getKnowledgeIndexStats());
    setFailedKnowledgeSources(await getKnowledgeSources({ statuses: ['failed'] }));
  }, []);

  useEffect(() => {
    void initSettings();
    void refreshIndexStats();
    void refreshKnowledgeStats();
  }, [initSettings, refreshIndexStats, refreshKnowledgeStats]);

  useEffect(() => {
    setExcludedPathsDraft(excludedPaths.join('\n'));
    setExcludedPathsSaved(true);
  }, [excludedPaths]);

  const invalidExcludedPaths = useMemo(
    () => parseExcludedPaths(excludedPathsDraft).filter(isInvalidExcludedPath),
    [excludedPathsDraft]
  );

  const basicSettings: NumericSetting[] = [{
    key: 'resultCount',
    title: t('resultCount'),
    desc: t('resultCountDesc'),
    value: resultCount,
    min: 1,
    max: 10,
    step: 1,
    icon: Hash
  }];

  const advancedSettings: NumericSetting[] = [
    {
      key: 'chunkSize',
      title: t('chunkSize'),
      desc: t('chunkSizeDesc'),
      value: chunkSize,
      min: 100,
      max: 5000,
      step: 100,
      icon: FileText
    },
    {
      key: 'chunkOverlap',
      title: t('chunkOverlap'),
      desc: t('chunkOverlapDesc'),
      value: chunkOverlap,
      min: 0,
      max: Math.min(500, Math.max(0, chunkSize - 50)),
      step: 50,
      icon: Layers
    },
    {
      key: 'similarityThreshold',
      title: t('similarityThreshold'),
      desc: t('similarityThresholdDesc'),
      value: similarityThreshold,
      min: 0,
      max: 1,
      step: 0.01,
      icon: Target
    },
    {
      key: 'rerankThreshold',
      title: t('rerankThreshold'),
      desc: hasRerankModel ? t('rerankThresholdDesc') : t('rerankThresholdDisabledDesc'),
      value: rerankThreshold,
      min: 0,
      max: 1,
      step: 0.01,
      icon: ListFilter,
      disabled: !hasRerankModel
    }
  ];

  function isPresetActive(preset: RagPreset) {
    const values = {
      precision: [3, 0.4, 0.25],
      balanced: [5, 0.25, 0.1],
      recall: [8, 0.1, 0.05]
    }[preset];
    return resultCount === values[0]
      && similarityThreshold === values[1]
      && rerankThreshold === values[2];
  }

  async function handleDeleteIndex() {
    const confirmed = await confirm(t('deleteVectorConfirm'));
    if (!confirmed) return;
    await clearVectorDb();
    await initVectorDb();
    await markIndexDirty();
    const store = await Store.load('store.json');
    await store.delete('lastVectorProcessTime');
    useVectorStore.setState({ lastProcessTime: null });
    await refreshIndexStats();
    toast({ title: t('deleteVectorSuccess'), variant: 'default' });
  }

  async function handleRebuildIndex() {
    if (rebuildRequested) return;
    setRebuildRequested(true);
    try {
      const consentStore = await Store.load('store.json');
      await consentStore.set('ragStructuredKnowledgeConsent', true);
      if (hasEmbeddingModel) {
        await processAllDocuments();
      } else {
        await initBM25Search();
        await markIndexClean();
        const builtAt = Date.now();
        const store = await Store.load('store.json');
        await store.set('lastVectorProcessTime', builtAt);
        useVectorStore.setState({ lastProcessTime: builtAt });
        toast({ title: t('lexicalIndexRebuilt'), variant: 'default' });
      }
      await refreshIndexStats();
      await refreshKnowledgeStats();
    } finally {
      setRebuildRequested(false);
    }
  }

  async function toggleSourceType(sourceType: KnowledgeSourceType, enabled: boolean) {
    const next = enabled
      ? Array.from(new Set([...enabledSourceTypes, sourceType]))
      : enabledSourceTypes.filter(type => type !== sourceType);
    await updateSetting('enabledSourceTypes', next);
  }

  async function toggleIndexPaused(paused: boolean) {
    await updateSetting('indexPaused', paused);
    if (!paused) await resumeKnowledgeIndexQueue();
    await refreshKnowledgeStats();
  }

  async function handlePurgeDisabledIndex() {
    const confirmed = await confirm(t('purgeDisabledConfirm'));
    if (!confirmed) return;
    await purgeDisabledKnowledgeVectors();
    await refreshIndexStats();
    await refreshKnowledgeStats();
    toast({ title: t('purgeDisabledSuccess'), variant: 'default' });
  }

  async function handleRetrySource(sourceKey: string) {
    await retryKnowledgeSource(sourceKey);
    await refreshKnowledgeStats();
    await refreshIndexStats();
  }

  async function saveExcludedPaths() {
    if (invalidExcludedPaths.length > 0) return;
    await updateSetting('excludedPaths', parseExcludedPaths(excludedPathsDraft));
    setExcludedPathsSaved(true);
  }

  async function restoreDefaultExcludedPaths() {
    await updateSetting('excludedPaths', DEFAULT_RAG_SETTINGS.excludedPaths);
  }

  async function runDiagnostic() {
    const query = diagnosticQuery.trim();
    if (!query || diagnosticLoading) return;
    setDiagnosticLoading(true);
    setDiagnosticCompleted(false);
    try {
      const result = await getContextForQuery(query);
      setDiagnosticResults(result.diagnostics);
      setDiagnosticCompleted(true);
    } catch (error) {
      console.error('知识库检索测试失败:', error);
      toast({ title: t('diagnosticFailed'), variant: 'destructive' });
    } finally {
      setDiagnosticLoading(false);
    }
  }

  function formatIndexTime(timestamp: number | null) {
    if (!timestamp) return t('neverBuilt');
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  }

  function renderNumericSetting(setting: NumericSetting) {
    const Icon = setting.icon;
    return (
      <Item
        key={setting.key}
        className={cn(
          'max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-start',
          setting.disabled && 'opacity-60'
        )}
        variant="outline"
      >
        <ItemMedia variant="icon"><Icon className="size-4" /></ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle>{setting.title}</ItemTitle>
          <ItemDescription>{setting.desc}</ItemDescription>
        </ItemContent>
        <ItemActions className="w-[180px] max-md:col-span-2 max-md:w-full">
          <div className="w-full space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{setting.min}</span>
              <span className="text-xs font-medium">{setting.value}</span>
              <span className="text-xs text-muted-foreground">{setting.max}</span>
            </div>
            <Slider
              disabled={setting.disabled}
              value={[setting.value]}
              onValueChange={value => void updateSetting(setting.key, value[0])}
              min={setting.min}
              max={setting.max}
              step={setting.step}
              className="w-full"
            />
          </div>
        </ItemActions>
      </Item>
    );
  }

  return (
    <>
      <SettingSection
        title={t('indexStatusTitle')}
        desc={t('indexStatusDesc')}
        actions={(
          <Button size="sm" onClick={() => void handleRebuildIndex()} disabled={isProcessing || rebuildRequested}>
            <RefreshCw className={isProcessing || rebuildRequested ? 'size-4 animate-spin' : 'size-4'} />
            {isProcessing || rebuildRequested ? t('rebuildingIndex') : t('rebuildIndex')}
          </Button>
        )}
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            [t('vectorDocuments'), indexStats.documentCount],
            [t('vectorChunks'), indexStats.chunkCount],
            [t('bm25Documents'), indexStats.bm25DocumentCount],
            [t('bm25Chunks'), indexStats.bm25ChunkCount]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-1 text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{t('lastBuilt')}: {formatIndexTime(lastProcessTime || indexStats.lastUpdatedAt)}</span>
          {indexNeedsRebuild ? <Badge variant="destructive">{t('indexNeedsRebuild')}</Badge> : <Badge variant="secondary">{t('indexUpToDate')}</Badge>}
          {!hasEmbeddingModel ? <Badge variant="outline">{t('lexicalOnly')}</Badge> : null}
        </div>
      </SettingSection>

      <SettingSection title={t('basicSettingsTitle')} desc={t('basicSettingsDesc')}>
        <ItemGroup className="gap-4">
          {([
            ['article', BookOpen],
            ['record', StickyNote],
            ['canvas', Palette],
          ] as const).map(([sourceType, Icon]) => (
            <Item key={sourceType} variant="outline">
              <ItemMedia variant="icon"><Icon /></ItemMedia>
              <ItemContent>
                <ItemTitle>{t(`sourceTypes.${sourceType}.title`)}</ItemTitle>
                <ItemDescription>{t(`sourceTypes.${sourceType}.desc`)}</ItemDescription>
              </ItemContent>
              <ItemActions className="mobile-setting-inline-action">
                <Switch
                  checked={enabledSourceTypes.includes(sourceType)}
                  aria-label={t(`sourceTypes.${sourceType}.title`)}
                  onCheckedChange={checked => void toggleSourceType(sourceType, checked)}
                />
              </ItemActions>
            </Item>
          ))}
          <Item variant="outline">
            <ItemMedia variant="icon"><Search /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('globalSemanticSearchTitle')}</ItemTitle>
              <ItemDescription>{t('globalSemanticSearchDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="mobile-setting-inline-action">
              <Switch
                checked={globalSemanticSearchEnabled}
                aria-label={t('globalSemanticSearchTitle')}
                onCheckedChange={checked => void updateSetting('globalSemanticSearchEnabled', checked)}
              />
            </ItemActions>
          </Item>
          <Item variant="outline">
            <ItemMedia variant="icon"><Sparkles /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('automaticSearchTitle')}</ItemTitle>
              <ItemDescription>{t('automaticSearchDesc')}</ItemDescription>
            </ItemContent>
            <ItemActions className="mobile-setting-inline-action">
              <Switch
                checked={automaticSearchEnabled}
                aria-label={t('automaticSearchTitle')}
                onCheckedChange={checked => void updateSetting('automaticSearchEnabled', checked)}
              />
            </ItemActions>
          </Item>
          <Item variant="outline" className={cn(!automaticSearchEnabled && "opacity-60")}>
            <ItemMedia variant="icon"><BrainCircuit /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('agentStrategyTitle')}</ItemTitle>
              <ItemDescription>{t(`agentStrategies.${agentStrategy}.desc`)}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={agentStrategy}
                disabled={!automaticSearchEnabled}
                aria-label={t('agentStrategyTitle')}
                onValueChange={value => {
                  if (value) void updateSetting('agentStrategy', value as RagAgentStrategy)
                }}
              >
                {(['fast', 'balanced', 'deep'] as RagAgentStrategy[]).map(strategy => (
                  <ToggleGroupItem key={strategy} value={strategy}>
                    {t(`agentStrategies.${strategy}.title`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </ItemActions>
          </Item>
        </ItemGroup>
        {knowledgeStats ? (
          <Item variant="outline">
            <ItemMedia variant="icon"><Layers /></ItemMedia>
            <ItemContent>
              <ItemTitle>{t('structuredIndexTitle')}</ItemTitle>
              <ItemDescription>
                {(['article', 'record', 'canvas'] as KnowledgeSourceType[]).map(type => (
                  <span key={type} className="mr-3 inline-block">
                    {t(`sourceTypes.${type}.title`)}: {knowledgeStats[type].ready}/{Object.values(knowledgeStats[type]).reduce((sum, value) => sum + value, 0)}
                    {knowledgeStats[type].failed > 0 ? ` · ${t('failedCount', { count: knowledgeStats[type].failed })}` : ''}
                  </span>
                ))}
              </ItemDescription>
              <Progress
                value={(() => {
                  const values = Object.values(knowledgeStats).flatMap(stats => Object.values(stats));
                  const total = values.reduce((sum, value) => sum + value, 0);
                  const ready = Object.values(knowledgeStats).reduce((sum, stats) => sum + stats.ready, 0);
                  return total > 0 ? ready / total * 100 : 100;
                })()}
              />
            </ItemContent>
            <ItemActions>
              <Button size="sm" variant="outline" onClick={() => void toggleIndexPaused(!indexPaused)}>
                {indexPaused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
                {indexPaused ? t('continueIndex') : t('pauseIndex')}
              </Button>
            </ItemActions>
          </Item>
        ) : null}
        {failedKnowledgeSources.map(source => (
          <Item key={source.sourceKey} variant="outline">
            <ItemMedia variant="icon"><AlertTriangle className="size-4 text-destructive" /></ItemMedia>
            <ItemContent>
              <ItemTitle>{source.title}</ItemTitle>
              <ItemDescription>{source.error || t('unknownIndexError')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button size="sm" variant="outline" onClick={() => void handleRetrySource(source.sourceKey)}>
                <RefreshCw className="size-4" /> {t('retrySource')}
              </Button>
            </ItemActions>
          </Item>
        ))}
        <div className="flex flex-wrap gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={(['precision', 'balanced', 'recall'] as RagPreset[]).find(isPresetActive) || ''}
            aria-label={t('presetDesc')}
            onValueChange={value => {
              if (value) void applyPreset(value as RagPreset)
            }}
          >
            {(['precision', 'balanced', 'recall'] as RagPreset[]).map(preset => (
              <ToggleGroupItem key={preset} value={preset}>
                {t(`presets.${preset}.title`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <span className="self-center text-xs text-muted-foreground">{t('presetDesc')}</span>
        </div>
        <ItemGroup className="gap-4">{basicSettings.map(renderNumericSetting)}</ItemGroup>
        <Item variant="outline">
          <ItemMedia variant="icon"><Shield className="size-4" /></ItemMedia>
          <ItemContent>
            <ItemTitle>{t('excludedPaths')}</ItemTitle>
            <ItemDescription>{t('excludedPathsDesc')}</ItemDescription>
          </ItemContent>
          <ItemFooter className="w-full flex-col items-stretch">
            <Textarea
              value={excludedPathsDraft}
              placeholder={t('excludedPathsPlaceholder')}
              className="min-h-24 font-mono text-xs"
              aria-invalid={invalidExcludedPaths.length > 0}
              onChange={event => {
                setExcludedPathsDraft(event.currentTarget.value);
                setExcludedPathsSaved(false);
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {invalidExcludedPaths.length > 0
                  ? <span className="text-destructive">{t('excludedPathsInvalid')}</span>
                  : excludedPathsSaved ? t('excludedPathsSaved') : t('excludedPathsUnsaved')}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => void restoreDefaultExcludedPaths()}>{t('restoreDefaultExclusions')}</Button>
                <Button size="sm" disabled={excludedPathsSaved || invalidExcludedPaths.length > 0} onClick={() => void saveExcludedPaths()}>{t('saveExcludedPaths')}</Button>
              </div>
            </div>
          </ItemFooter>
        </Item>
      </SettingSection>

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <SettingSection
          title={t('advancedSettingsTitle')}
          desc={t('advancedSettingsDesc')}
          actions={(
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">
                {advancedOpen ? t('collapse') : t('expand')}
                <ChevronDown className={advancedOpen ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
              </Button>
            </CollapsibleTrigger>
          )}
        >
          <CollapsibleContent>
            <ItemGroup className="gap-4">{advancedSettings.map(renderNumericSetting)}</ItemGroup>
            <div className="mt-3 flex justify-end">
              <Button variant="outline" onClick={() => void resetToDefaults()}>
                <RefreshCw className="size-4" /> {t('resetToDefaults')}
              </Button>
            </div>
          </CollapsibleContent>
        </SettingSection>
      </Collapsible>

      <SettingSection title={t('diagnosticTitle')} desc={t('diagnosticDesc')}>
        <div className="flex gap-2">
          <Input
            value={diagnosticQuery}
            placeholder={t('diagnosticPlaceholder')}
            onChange={event => setDiagnosticQuery(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void runDiagnostic();
            }}
          />
          <Button onClick={() => void runDiagnostic()} disabled={!diagnosticQuery.trim() || diagnosticLoading}>
            <Search className={diagnosticLoading ? 'size-4 animate-spin' : 'size-4'} />
            {t('runDiagnostic')}
          </Button>
        </div>
        {diagnosticCompleted && diagnosticResults.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('diagnosticNoResults')}</div>
        ) : null}
        {diagnosticResults.length > 0 ? (
          <ItemGroup className="gap-3">
            {diagnosticResults.map(result => (
              <Item key={`${result.filepath}-${result.rank}`} variant="outline" className="items-start">
                <ItemMedia variant="icon"><FileSearch className="size-4" /></ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="max-w-full">
                    <span>#{result.rank} {result.filename}</span>
                    <Badge variant={result.beforeRerankRank !== result.rank ? 'default' : 'outline'}>{result.beforeRerankRank} → {result.rank}</Badge>
                  </ItemTitle>
                  <ItemDescription className="line-clamp-1">{result.filepath}</ItemDescription>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {result.retrievers.map(retriever => <Badge key={retriever} variant="secondary">{t(`retrievers.${retriever}`)}</Badge>)}
                    <Badge variant="outline">{t('fusedScore')}: {result.fusedScore.toFixed(3)}</Badge>
                    <Badge variant="outline">{t('finalScore')}: {result.finalScore.toFixed(3)}</Badge>
                  </div>
                  <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{result.content}</p>
                </ItemContent>
              </Item>
            ))}
          </ItemGroup>
        ) : null}
      </SettingSection>

      <SettingSection title={t('dangerZoneTitle')} desc={t('dangerZoneDesc')}>
        <div className="flex flex-wrap gap-2 rounded-lg border border-destructive/30 p-3">
          <Button variant="destructive" onClick={() => void handleDeleteIndex()}>
            <Trash className="size-4" /> {t('deleteVector')}
          </Button>
          <Button variant="outline" onClick={() => void handlePurgeDisabledIndex()}>
            <Shield className="size-4" /> {t('purgeDisabledIndex')}
          </Button>
          <div className="flex min-w-0 flex-1 basis-60 items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="size-4 shrink-0 text-destructive" />
            {t('deleteVectorHint')}
          </div>
        </div>
      </SettingSection>
    </>
  );
}
