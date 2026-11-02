'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BookOpen, FileText, Folder, Layers, Loader2, PackageOpen, RefreshCw, Settings2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { KnowledgeSettingCard } from '@/components/wiki/knowledge-setting-card'
import { useWikiData } from '@/components/wiki/use-wiki-data'
import { useWikiErrorMessage } from '@/components/wiki/use-wiki-error-message'
import { getVectorIndexStatsForFiles } from '@/db/vector'
import { collectMarkdownFiles } from '@/lib/files'
import { calculateFolderVectors } from '@/lib/folder-vector'
import { cn } from '@/lib/utils'
import { isWritingAssetsFolder } from '@/lib/writing-assets-path'
import { getWikiFolderSelection, setWikiFolderEnabled, startWikiFolderCompilation } from '@/lib/wiki/folders'
import { getWikiSettings, isWikiArticlePathSelected } from '@/lib/wiki/settings'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import { collectWikiArticleSourceDocuments } from '@/lib/wiki/sources'
import emitter from '@/lib/emitter'
import { useWikiActionScope } from '@/components/wiki/use-wiki-action-scope'

interface FolderStatsViewProps { folderPath: string; folderFiles: string[] }
interface FolderIndexStats { documentCount: number; chunkCount: number; lastUpdatedAt: number | null }
interface BatchProgress { total: number; processed: number; failed: number; currentFile: string }
const indexingFolders = new Set<string>()

function normalizePath(path: string) { return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '') }
function isWithinFolder(path: string, folder: string) { return !folder || path === folder || path.startsWith(`${folder}/`) }

export function FolderStatsView({ folderPath, folderFiles }: FolderStatsViewProps) {
  const t = useTranslations('article.file.folderView')
  const wiki = useTranslations('wiki')
  const rag = useTranslations('settings.rag')
  const locale = useLocale()
  const errorMessage = useWikiErrorMessage()
  const { data, error, loading, refresh } = useWikiData()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const assetsPath = useSettingStore(state => state.assetsPath)
  const vectorIndexedFiles = useArticleStore(state => state.vectorIndexedFiles)
  const initVectorIndexedFiles = useArticleStore(state => state.initVectorIndexedFiles)
  const path = normalizePath(folderPath)
  const isAssetsFolder = isWritingAssetsFolder(folderPath, assetsPath)
  const FolderIdentityIcon = isAssetsFolder ? PackageOpen : Folder
  const treeFileSignature = [...new Set(folderFiles.map(normalizePath))].sort().join('\u0000')
  const treeFiles = useMemo(() => treeFileSignature ? treeFileSignature.split('\u0000') : [], [treeFileSignature])
  const viewKey = `${workspacePath || '__default__'}:${path}`
  const { busy, beginAction } = useWikiActionScope(viewKey)
  const activeView = useRef(viewKey)
  activeView.current = viewKey
  const mounted = useRef(true)
  const statRequest = useRef(0)
  const [discovered, setDiscovered] = useState<{ key: string; files: string[] } | null>(null)
  const [indexStats, setIndexStats] = useState<{ key: string; stats: FolderIndexStats } | null>(null)
  const [statsError, setStatsError] = useState<string | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [unregistered, setUnregistered] = useState<{ key: string; count: number } | null>(null)
  const [batchProgress, setBatchProgress] = useState<{ key: string; progress: BatchProgress } | null>(null)
  const semanticEnabled = data?.settings.semanticSearchEnabled ?? false
  const progress = batchProgress?.key === viewKey ? batchProgress.progress : null
  const stats = indexStats?.key === viewKey ? indexStats.stats : null
  const folderName = path.split('/').pop() || '/'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; statRequest.current++ }
  }, [])

  useEffect(() => {
    setStatsError(null)
    setBatchProgress(null)
    statRequest.current++
  }, [viewKey])

  useEffect(() => {
    let active = true
    void collectMarkdownFiles(path).then(files => {
      if (active && mounted.current && activeView.current === viewKey) {
        setDiscovered({ key: viewKey, files: files.map(file => normalizePath(file.path)) })
      }
    }).catch(cause => console.error('Failed to read folder notes:', cause))
    return () => { active = false }
  }, [path, viewKey, treeFileSignature])

  const knownFiles = useMemo(() => [...new Set([
    ...treeFiles, ...(discovered?.key === viewKey ? discovered.files : []),
  ])].filter(file => isWithinFolder(file, path)).sort(), [treeFiles, discovered, path, viewKey])

  const refreshStats = useCallback(async () => {
    if (!semanticEnabled) return
    const request = ++statRequest.current
    setLoadingStats(true)
    try {
      const result = await getVectorIndexStatsForFiles(knownFiles)
      if (mounted.current && activeView.current === viewKey && statRequest.current === request) {
        setIndexStats({ key: viewKey, stats: result })
        setStatsError(null)
      }
    } catch (cause) {
      if (mounted.current && activeView.current === viewKey && statRequest.current === request) setStatsError(errorMessage(cause))
    } finally {
      if (mounted.current && activeView.current === viewKey && statRequest.current === request) setLoadingStats(false)
    }
  }, [semanticEnabled, knownFiles, viewKey, errorMessage])

  useEffect(() => {
    if (!semanticEnabled) { setLoadingStats(false); statRequest.current++; return }
    let active = true
    void initVectorIndexedFiles()
      .catch(cause => { if (active) setStatsError(errorMessage(cause)) })
    return () => { active = false }
  }, [semanticEnabled, initVectorIndexedFiles, viewKey, errorMessage])

  useEffect(() => { void refreshStats() }, [refreshStats, vectorIndexedFiles])

  const selection = data ? getWikiFolderSelection(path, data.settings) : null
  const folderSources = useMemo(() => data?.sources.filter(source => source.sourceType === 'article'
    && isWithinFolder(normalizePath(source.source.locator.filePath || source.sourceKey.replace(/^article:/, '')), path)
    && !['deleted', 'excluded'].includes(source.status)) ?? [], [data?.sources, path])
  const wikiReady = folderSources.filter(source => source.status === 'ready').length
  const settings = data?.settings
  const contextId = data?.context.id
  const candidatePaths = useMemo(() => {
    const registeredPaths = new Set(folderSources.map(source => normalizePath(source.source.locator.filePath || source.sourceKey.replace(/^article:/, ''))))
    return settings ? knownFiles.filter(file => isWikiArticlePathSelected(file, settings) && !registeredPaths.has(file)) : []
  }, [settings, knownFiles, folderSources])
  const candidateKey = JSON.stringify([viewKey, contextId, candidatePaths])
  useEffect(() => {
    let active = true
    let request = 0
    const isCurrent = captureWikiWorkspaceGuard()
    const refreshEligible = async () => {
      const current = ++request
      if (!contextId) return
      const documents = await collectWikiArticleSourceDocuments(candidatePaths, contextId)
      if (active && isCurrent() && current === request) {
        setUnregistered({ key: candidateKey, count: documents.length })
      }
    }
    const update = () => { void refreshEligible().catch(cause => console.error('Failed to read Wiki source eligibility:', cause)) }
    const onFile = ({ path: changedPath }: { path: string }) => {
      if (isWithinFolder(normalizePath(changedPath), path)) update()
    }
    update()
    emitter.on('article-saved', onFile)
    emitter.on('workspace-file-changed', onFile)
    window.addEventListener('wiki-settings-changed', update)
    return () => {
      active = false
      emitter.off('article-saved', onFile)
      emitter.off('workspace-file-changed', onFile)
      window.removeEventListener('wiki-settings-changed', update)
    }
  }, [candidateKey, candidatePaths, contextId, path, settings])
  const unregisteredFiles = unregistered?.key === candidateKey ? unregistered.count : 0
  const wikiPending = folderSources.filter(source => ['pending', 'processing', 'unavailable'].includes(source.status)).length + unregisteredFiles
  const wikiFailed = folderSources.filter(source => source.status === 'failed').length
  const runningWikiJobs = !data?.settings.paused && (data?.jobs.some(job => job.kind === 'source' && ['running', 'pending'].includes(job.status)
    && job.sourceKey.startsWith('article:') && isWithinFolder(normalizePath(job.sourceKey.slice('article:'.length)), path)) ?? false)

  async function runWiki(action: () => Promise<void>, message: string) {
    if (!data) return
    const operation = beginAction()
    try {
      await assertWikiContextCurrent(data.context.id)
      if (!operation.isCurrent()) return
      await action()
      if (!operation.isCurrent()) return
      await refresh()
      if (operation.isCurrent()) toast.success(message)
    } catch (cause) {
      if (operation.isCurrent()) toast.error(wiki('failed'), { description: errorMessage(cause) })
    } finally { operation.finish() }
  }

  async function updateIndex() {
    const currentKey = viewKey
    if (indexingFolders.has(currentKey) || !knownFiles.length) return
    try {
      if (!(await getWikiSettings()).semanticSearchEnabled || activeView.current !== currentKey || !mounted.current) return
    } catch (cause) {
      toast.error(t('folderStatsFailed'), { description: errorMessage(cause) })
      return
    }
    if (indexingFolders.has(currentKey)) return
    indexingFolders.add(currentKey)
    setBatchProgress({ key: currentKey, progress: { total: knownFiles.length, processed: 0, failed: 0, currentFile: '' } })
    const article = useArticleStore.getState()
    const workspaceIsCurrent = () => useSettingStore.getState().workspacePath === workspacePath
    article.setVectorCalcStatus(path, 'calculating')
    try {
      const result = await calculateFolderVectors({
        folderPath: path, mode: 'recalculate', setVectorCalcStatus: (file, status) => {
          if (workspaceIsCurrent()) article.setVectorCalcStatus(file, status)
        },
        onProgress: next => {
          if (mounted.current && activeView.current === currentKey) setBatchProgress({ key: currentKey, progress: next })
        },
      })
      if (!workspaceIsCurrent()) return
      article.setVectorCalcStatus(path, result.failed || !result.semanticSearchEnabled || !result.embeddingModelAvailable ? 'idle' : 'completed')
      await article.initVectorIndexedFiles()
      if (!mounted.current || activeView.current !== currentKey) return
      await refreshStats()
      if (result.semanticSearchEnabled === false) toast.info(t('ragGlobalDisabled'))
      else if (!result.embeddingModelAvailable) toast.error(t('embeddingRequired'))
      else if (result.failed) toast.error(t('indexPartial', { count: result.failed }))
      else toast.success(t('indexUpdated'))
    } catch (cause) {
      if (workspaceIsCurrent()) article.setVectorCalcStatus(path, 'idle')
      if (mounted.current && activeView.current === currentKey) toast.error(t('folderStatsFailed'), { description: errorMessage(cause) })
    } finally {
      indexingFolders.delete(currentKey)
      if (mounted.current && activeView.current === currentKey) setBatchProgress(null)
    }
  }

  function openSettings() { useSettingsDialogStore.getState().openSettings('rag') }
  const openSettingsButton = <Button variant="outline" size="sm" onClick={openSettings}><Settings2 data-icon="inline-start" />{t('openKnowledgeSettings')}</Button>
  const formatTime = (timestamp: number | null) => timestamp ? new Intl.DateTimeFormat(locale, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(timestamp) : t('never')

  return <ScrollArea className="h-full min-h-0 w-full flex-1">
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 sm:p-8">
      <header className="flex items-start gap-4">
        <div aria-hidden="true" className={cn('flex size-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground', isAssetsFolder && 'bg-primary/10 text-primary')}><FolderIdentityIcon className="size-6" /></div>
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="truncate text-xl font-semibold tracking-tight">{folderName}</h2>
          <p className="break-all text-xs text-muted-foreground">{path || '/'}</p>
          <p className="text-sm text-muted-foreground">{t('detailsDescription')}</p>
          <div className="flex flex-wrap gap-2"><Badge variant="secondary"><FileText data-icon="inline-start" />{t('markdownCount', { count: knownFiles.length })}</Badge><Badge variant="outline">{t('subfoldersIncluded')}</Badge></div>
        </div>
      </header>

      {error ? <Alert variant="destructive"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert> : null}
      <KnowledgeSettingCard title={wiki('wikiTitle')} description={t('wikiSourceDescription')} icon={BookOpen} label={wiki('defaultMode')} enabled={data?.settings.enabled && selection?.included}>
        {loading || !data || !selection ? <p className="text-sm text-muted-foreground">{t('loadingFolder')}</p>
          : !data.settings.enabled ? <div className="flex flex-col items-start gap-3"><p className="text-sm text-muted-foreground">{t('wikiGlobalDisabled')}</p>{openSettingsButton}</div>
            : <>
              <ItemGroup><Item variant="muted"><ItemContent><ItemTitle>{t('wikiSourceToggle')}</ItemTitle><ItemDescription>{t('subfoldersIncluded')}{selection.inheritedFrom !== null ? ` · ${t('wikiInherited', { path: selection.inheritedFrom || '/' })}` : ''}</ItemDescription></ItemContent><ItemActions><Switch aria-label={t('wikiSourceToggle')} checked={selection.included} disabled={busy} onCheckedChange={included => void runWiki(() => setWikiFolderEnabled(path, included, data.context.id), t('folderSelectionSaved'))} /></ItemActions></Item></ItemGroup>
              {selection.hasOverrides ? <p className="text-xs text-muted-foreground">{t('wikiOverrides')}</p> : null}
              {selection.included || selection.hasOverrides ? <>
                <dl className="grid grid-cols-3 gap-3">{[[t('wikiReady'), wikiReady], [t('wikiPending'), wikiPending], [t('wikiFailed'), wikiFailed]].map(([label, count]) => <div key={label} className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-lg font-medium tabular-nums">{count}</dd></div>)}</dl>
                <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !selection.included || !knownFiles.length || runningWikiJobs} onClick={() => void runWiki(() => startWikiFolderCompilation(path, data.context.id), t('organizeQueued'))}>{busy || runningWikiJobs ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Sparkles data-icon="inline-start" />}{wikiReady ? t('updateFolder') : t('organizeFolder')}</Button><span className="text-xs text-muted-foreground">{data.settings.started ? wiki('foregroundNotice') : t('startMaintenanceHint')}</span></div>
              </> : null}
            </>}
      </KnowledgeSettingCard>

      <KnowledgeSettingCard title={rag('ragTitle')} description={t('ragFolderDescription')} icon={Layers} label={wiki('optionalMode')} enabled={semanticEnabled}>
        {loading || !data ? <p className="text-sm text-muted-foreground">{t('loadingFolder')}</p>
          : !semanticEnabled ? <div className="flex flex-col items-start gap-3"><p className="text-sm text-muted-foreground">{t('ragGlobalDisabled')}</p>{openSettingsButton}</div>
            : <>
              {statsError ? <Alert variant="destructive"><AlertDescription>{t('folderStatsFailed')}</AlertDescription></Alert> : null}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[[t('indexed'), stats ? `${stats.documentCount} / ${knownFiles.length}` : '—'], [t('vectorCount'), stats?.chunkCount ?? '—'], [t('lastCalculated'), stats ? formatTime(stats.lastUpdatedAt) : '—']].map(([label, value]) => <div key={label} className="flex flex-col gap-1 rounded-xl bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-medium tabular-nums">{value}</dd></div>)}</dl>
              {progress ? <div className="flex flex-col gap-2"><div className="flex justify-between gap-3 text-xs text-muted-foreground"><span className="truncate">{progress.currentFile || t('calculating')}</span><span className="shrink-0">{progress.processed} / {progress.total}</span></div><Progress aria-label={t('calculating')} value={progress.total ? progress.processed / progress.total * 100 : 0} />{progress.failed ? <p className="text-xs text-destructive">{t('failed')}: {progress.failed}</p> : null}</div> : null}
              <div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!knownFiles.length || Boolean(progress) || indexingFolders.has(viewKey)} onClick={() => void updateIndex()}><RefreshCw data-icon="inline-start" className={cn((progress || indexingFolders.has(viewKey)) && 'animate-spin')} />{progress || indexingFolders.has(viewKey) ? t('calculating') : t('updateFolderIndex')}</Button>{loadingStats ? <Loader2 aria-label={t('loadingFolder')} className="size-4 animate-spin text-muted-foreground" /> : null}</div>
            </>}
      </KnowledgeSettingCard>
    </div>
  </ScrollArea>
}
