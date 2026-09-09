'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { debounce } from 'lodash-es'
import { FileText, Search, SearchX, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/hooks/use-toast'
import type { Mark } from '@/db/marks'
import { searchKnowledge } from '@/lib/knowledge-search'
import { search, type SearchableItem } from '@/lib/search-utils'
import { downloadRemoteLibraryFile } from '@/lib/sync/remote-library'
import { cn } from '@/lib/utils'
import type { KnowledgeSearchCandidate } from '@/types/knowledge'
import useArticleStore, {
  beginDeferredFileActivation,
  isDeferredFileActivationCurrent,
} from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import useMarkStore from '@/stores/mark'
import { useSidebarStore } from '@/stores/sidebar'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

import { CanvasThumbnail } from './canvas/canvas-thumbnail'
import { createCanvasTab } from './canvas/canvas-tab'
import { buildFileTreeSearchIndex, searchFileTreeIndex } from './file/file-tree-model'
import { flattenFileTree } from './file/file-selection'
import { useSyncAvailability } from './file/use-sync-availability'
import { createRecordTab } from './mark/mark-record-tab'
import { getMarkTypeListBadgeClasses, MARK_TYPE_OPTIONS } from './mark/mark-type-meta'

type SidebarTab = 'files' | 'notes' | 'canvases'
type SearchType = 'article' | 'record' | 'canvas'
type MatchSection = 'exact' | 'related'

interface SidebarSearchResult {
  id: string
  sourceKey: string
  searchType: SearchType
  section: MatchSection
  title: string
  highlightText: string
  score: number
  path?: string
  isLocale?: boolean
  markId?: number
  tagId?: number
  tagName?: string
  canvasId?: string
  nodeIds?: string[]
  type?: string
  firstMatchIndex?: number
}

const TYPE_BY_TAB: Record<SidebarTab, SearchType> = {
  files: 'article',
  notes: 'record',
  canvases: 'canvas',
}

const TAB_BY_TYPE: Record<SearchType, SidebarTab> = {
  article: 'files',
  record: 'notes',
  canvas: 'canvases',
}

const SEARCH_TYPES: SearchType[] = ['article', 'record', 'canvas']

function extractTitleFromPath(path: string) {
  const fileName = path.split(/[\\/]/).pop() || path
  const extensionIndex = fileName.lastIndexOf('.')
  return extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery || !text) return <>{text}</>

  const parts: React.ReactNode[] = []
  const normalizedText = text.toLocaleLowerCase()
  let cursor = 0
  let matchIndex = normalizedText.indexOf(normalizedQuery)

  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex))
    parts.push(
      <mark key={`${matchIndex}-${cursor}`} className="rounded bg-primary/15 px-0.5 text-foreground">
        {text.slice(matchIndex, matchIndex + normalizedQuery.length)}
      </mark>
    )
    cursor = matchIndex + normalizedQuery.length
    matchIndex = normalizedText.indexOf(normalizedQuery, cursor)
  }

  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

function SearchResultItem({
  result,
  query,
  onSelect,
}: {
  result: SidebarSearchResult
  query: string
  onSelect: (result: SidebarSearchResult) => void
}) {
  const recordTypeT = useTranslations('record.mark.type')
  const canvasProject = useCanvasStore(state => (
    result.canvasId ? state.projects.find(project => project.id === result.canvasId) : undefined
  ))
  const record = useMarkStore(state => (
    result.markId ? state.allMarks.find(mark => mark.id === result.markId) : undefined
  ))
  const recordTypeValue = record?.type || result.type
  const recordType = result.searchType === 'record'
    && recordTypeValue
    && MARK_TYPE_OPTIONS.includes(recordTypeValue as Mark['type'])
    ? recordTypeValue as Mark['type']
    : null

  return (
    <CommandItem
      value={result.id}
      onSelect={() => onSelect(result)}
      className={cn(
        'rounded-md px-2 py-2 [&>svg:last-child]:hidden',
        canvasProject ? 'flex items-center gap-2' : 'block'
      )}
    >
      {canvasProject ? <CanvasThumbnail project={canvasProject} compact /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {result.searchType === 'article' ? (
            <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          ) : null}
          {recordType ? (
            <Badge
              variant="outline"
              className={cn(getMarkTypeListBadgeClasses(recordType), 'h-4 px-1.5 text-[10px]')}
            >
              {recordTypeT(recordType)}
            </Badge>
          ) : null}
          <div className="min-w-0 truncate text-xs font-medium">
            <HighlightedText text={result.title} query={query} />
          </div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          <HighlightedText text={result.highlightText} query={query} />
        </div>
      </div>
    </CommandItem>
  )
}

function SearchResultGroup({
  label,
  results,
  query,
  onSelect,
}: {
  label: string
  results: SidebarSearchResult[]
  query: string
  onSelect: (result: SidebarSearchResult) => void
}) {
  if (results.length === 0) return null

  return (
    <div className="px-1 pb-1">
      <div className="flex items-center justify-between rounded-md bg-muted/45 px-2 py-1.5 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{results.length}</span>
      </div>
      <CommandGroup className="p-1">
        {results.map(result => (
          <SearchResultItem
            key={result.id}
            result={result}
            query={query}
            onSelect={onSelect}
          />
        ))}
      </CommandGroup>
    </div>
  )
}

function mapKnowledgeCandidate(candidate: KnowledgeSearchCandidate): SidebarSearchResult {
  return {
    id: `related-${candidate.sourceKey}`,
    sourceKey: candidate.sourceKey,
    searchType: candidate.sourceType,
    section: 'related',
    title: candidate.title,
    path: candidate.locator.filePath,
    markId: candidate.locator.markId,
    tagId: candidate.locator.tagId,
    canvasId: candidate.locator.canvasId,
    nodeIds: candidate.locator.nodeIds,
    highlightText: candidate.fragments.map(fragment => fragment.content).join('\n\n'),
    score: candidate.relevanceScore,
    type: candidate.sourceType,
  }
}

export function SidebarSearch({ activeTab, children }: { activeTab: SidebarTab; children: React.ReactNode }) {
  const t = useTranslations()
  const router = useRouter()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const semanticRequestRef = useRef(0)
  const fileLoadGenerationRef = useRef(0)
  const loadedWorkspaceRef = useRef<string | null>(null)
  const remoteRootLoadedRef = useRef(false)
  const remoteLoadedPathsRef = useRef(new Set<string>())
  const [query, setQuery] = useState('')
  const [exactResults, setExactResults] = useState<SidebarSearchResult[]>([])
  const [relatedResults, setRelatedResults] = useState<SidebarSearchResult[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)

  const workspacePath = useSettingStore(state => state.workspacePath)
  const sidebarSearchFocusRequest = useSidebarStore(state => state.sidebarSearchFocusRequest)
  const setLeftSidebarTab = useSidebarStore(state => state.setLeftSidebarTab)
  const showCenterPanel = useSidebarStore(state => state.showCenterPanel)
  const allArticle = useArticleStore(state => state.allArticle)
  const fileTree = useArticleStore(state => state.fileTree)
  const showCloudFiles = useArticleStore(state => state.showCloudFiles)
  const loadAllArticle = useArticleStore(state => state.loadAllArticle)
  const loadCollapsibleFiles = useArticleStore(state => state.loadCollapsibleFiles)
  const loadFolderRemoteFiles = useArticleStore(state => state.loadFolderRemoteFiles)
  const loadRemoteSyncFiles = useArticleStore(state => state.loadRemoteSyncFiles)
  const setCollapsibleList = useArticleStore(state => state.setCollapsibleList)
  const setActiveFilePath = useArticleStore(state => state.setActiveFilePath)
  const setMatchPosition = useArticleStore(state => state.setMatchPosition)
  const setPendingSearchKeyword = useArticleStore(state => state.setPendingSearchKeyword)
  const addTab = useArticleStore(state => state.addTab)
  const markFileLocal = useArticleStore(state => state.markFileLocal)
  const allMarks = useMarkStore(state => state.allMarks)
  const fetchAllMarks = useMarkStore(state => state.fetchAllMarks)
  const setActiveMarkId = useMarkStore(state => state.setActiveMarkId)
  const tags = useTagStore(state => state.tags)
  const fetchTags = useTagStore(state => state.fetchTags)
  const canvasProjects = useCanvasStore(state => state.projects)
  const loadCanvasProjects = useCanvasStore(state => state.loadProjects)
  const openCanvasProject = useCanvasStore(state => state.openProject)
  const setPendingCanvasFocus = useCanvasStore(state => state.setPendingFocus)
  const { refresh: refreshSyncAvailability } = useSyncAvailability()

  const normalizedQuery = query.trim()
  const searching = Boolean(normalizedQuery)

  useEffect(() => {
    if (!sidebarSearchFocusRequest) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [sidebarSearchFocusRequest])

  useEffect(() => {
    loadedWorkspaceRef.current = null
    remoteRootLoadedRef.current = false
    remoteLoadedPathsRef.current.clear()
    setExactResults([])
    setRelatedResults([])
  }, [workspacePath])

  useEffect(() => {
    semanticRequestRef.current += 1
    setRelatedResults([])
    setRelatedLoading(false)
  }, [normalizedQuery])

  useEffect(() => {
    if (!searching) return
    const workspaceKey = workspacePath || '__default__'
    if (loadedWorkspaceRef.current === workspaceKey) return
    loadedWorkspaceRef.current = workspaceKey

    void Promise.all([
      loadAllArticle(),
      fetchAllMarks(),
      fetchTags(),
      loadCanvasProjects(),
    ]).catch(error => console.error('Failed to load sidebar search data:', error))
  }, [fetchAllMarks, fetchTags, loadAllArticle, loadCanvasProjects, searching, workspacePath])

  useEffect(() => {
    const generation = ++fileLoadGenerationRef.current
    if (!searching) {
      setFileLoading(false)
      return
    }

    setFileLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const locallyLoadedPaths = new Set<string>()
        while (generation === fileLoadGenerationRef.current) {
          const folderPaths = flattenFileTree(useArticleStore.getState().fileTree)
            .filter(entry => entry.isDirectory && !locallyLoadedPaths.has(entry.path))
            .map(entry => entry.path)
          if (folderPaths.length === 0) break
          for (let index = 0; index < folderPaths.length; index += 4) {
            if (generation !== fileLoadGenerationRef.current) return
            const batch = folderPaths.slice(index, index + 4)
            batch.forEach(path => locallyLoadedPaths.add(path))
            await Promise.all(batch.map(path => loadCollapsibleFiles(path, { skipRemoteSync: true })))
          }
        }

        if (!showCloudFiles || generation !== fileLoadGenerationRef.current) return
        const availability = await refreshSyncAvailability()
        if (!availability.configured || generation !== fileLoadGenerationRef.current) return
        if (!remoteRootLoadedRef.current) {
          await loadRemoteSyncFiles()
          remoteRootLoadedRef.current = true
        }

        while (generation === fileLoadGenerationRef.current) {
          const folderPaths = flattenFileTree(useArticleStore.getState().fileTree)
            .filter(entry => entry.isDirectory && !remoteLoadedPathsRef.current.has(entry.path))
            .map(entry => entry.path)
          if (folderPaths.length === 0) break
          for (let index = 0; index < folderPaths.length; index += 4) {
            if (generation !== fileLoadGenerationRef.current) return
            const batch = folderPaths.slice(index, index + 4)
            batch.forEach(path => remoteLoadedPathsRef.current.add(path))
            await Promise.all(batch.map(path => loadFolderRemoteFiles(path)))
          }
        }
      } catch (error) {
        console.error('Failed to load files for sidebar search:', error)
      } finally {
        if (generation === fileLoadGenerationRef.current) setFileLoading(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [loadCollapsibleFiles, loadFolderRemoteFiles, loadRemoteSyncFiles, refreshSyncAvailability, searching, showCloudFiles])

  const performExactSearch = useCallback((value: string) => {
    const trimmedValue = value.trim()
    if (!trimmedValue) {
      setExactResults([])
      return
    }

    const articleItems: SearchableItem[] = allArticle.map((item, index) => ({
      id: `article-${index}`,
      title: extractTitleFromPath(item.path || ''),
      content: item.article || '',
      metadata: { path: item.path },
    }))
    const articleMatches = search(articleItems, trimmedValue, { maxResults: 50 })
      .filter(result => result.matchType === 'exact')
    const articleResultMap = new Map<string, SidebarSearchResult>()

    const fileIndex = buildFileTreeSearchIndex(fileTree)
    const filePathMatches = searchFileTreeIndex(fileIndex, trimmedValue)
    flattenFileTree(fileTree)
      .filter(entry => entry.isFile && filePathMatches.has(entry.path))
      .forEach(entry => {
        articleResultMap.set(entry.path, {
          id: `article-path-${entry.path}`,
          sourceKey: `article:${entry.path}`,
          searchType: 'article',
          section: 'exact',
          title: extractTitleFromPath(entry.path),
          highlightText: entry.path,
          path: entry.path,
          isLocale: entry.isLocale,
          score: 0,
        })
      })

    articleMatches.forEach(result => {
      const path = String(result.item.metadata?.path || '')
      if (!path) return
      const contentMatchIndex = result.item.content.toLocaleLowerCase().indexOf(trimmedValue.toLocaleLowerCase())
      const existing = articleResultMap.get(path)
      articleResultMap.set(path, {
        ...existing,
        id: `article-content-${path}`,
        sourceKey: `article:${path}`,
        searchType: 'article',
        section: 'exact',
        title: result.item.title,
        highlightText: result.highlightText,
        path,
        isLocale: existing?.isLocale ?? true,
        score: result.score,
        firstMatchIndex: contentMatchIndex >= 0 ? contentMatchIndex : undefined,
      })
    })

    const recordItems: SearchableItem[] = allMarks.map(mark => {
      const tag = tags.find(item => item.id === mark.tagId)
      return {
        id: `record-${mark.id}`,
        title: mark.desc || mark.content?.slice(0, 50) || mark.url || '',
        content: `${mark.content || ''} ${mark.desc || ''} ${mark.url || ''} ${tag?.name || ''}`,
        metadata: { markId: mark.id, tagId: mark.tagId, tagName: tag?.name, type: mark.type },
      }
    })
    const recordResults = search(recordItems, trimmedValue, { maxResults: 50 })
      .filter(result => result.matchType === 'exact')
      .map(result => ({
        id: result.item.id,
        sourceKey: `record:${String(result.item.metadata?.markId)}`,
        searchType: 'record' as const,
        section: 'exact' as const,
        title: result.item.title,
        highlightText: result.highlightText,
        score: result.score,
        markId: Number(result.item.metadata?.markId),
        tagId: Number(result.item.metadata?.tagId) || undefined,
        tagName: result.item.metadata?.tagName ? String(result.item.metadata.tagName) : undefined,
        type: result.item.metadata?.type ? String(result.item.metadata.type) : undefined,
      }))

    const loweredQuery = trimmedValue.toLocaleLowerCase()
    const canvasItems: SearchableItem[] = canvasProjects.map(project => ({
      id: `canvas-${project.id}`,
      title: project.title,
      content: [
        ...project.document.nodes.flatMap(node => [node.data.label, node.data.description, node.data.filePath, node.data.url]),
        ...project.document.edges.map(edge => edge.label),
      ].filter(value => typeof value === 'string').join(' '),
      metadata: { canvasId: project.id, type: project.canvasType },
    }))
    const canvasResults = search(canvasItems, trimmedValue, { maxResults: 50 })
      .filter(result => result.matchType === 'exact')
      .map(result => {
        const canvasId = String(result.item.metadata?.canvasId || '')
        const project = canvasProjects.find(item => item.id === canvasId)
        const nodeIds = project?.document.nodes.filter(node => (
          [node.data.label, node.data.description, node.data.filePath, node.data.url]
            .some(field => typeof field === 'string' && field.toLocaleLowerCase().includes(loweredQuery))
        )).map(node => node.id)
        return {
          id: result.item.id,
          sourceKey: `canvas:${canvasId}`,
          searchType: 'canvas' as const,
          section: 'exact' as const,
          title: result.item.title,
          highlightText: result.highlightText,
          score: result.score,
          canvasId,
          nodeIds,
          type: result.item.metadata?.type ? String(result.item.metadata.type) : undefined,
        }
      })

    setExactResults([...articleResultMap.values(), ...recordResults, ...canvasResults])
  }, [allArticle, allMarks, canvasProjects, fileTree, tags])

  const debouncedExactSearch = useMemo(
    () => debounce(performExactSearch, 300),
    [performExactSearch]
  )

  useEffect(() => {
    debouncedExactSearch(query)
    return () => debouncedExactSearch.cancel()
  }, [debouncedExactSearch, query])

  useEffect(() => {
    const requestId = ++semanticRequestRef.current
    if (!searching) {
      setRelatedLoading(false)
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        if (requestId !== semanticRequestRef.current) return
        setRelatedLoading(true)
        const candidates = await searchKnowledge(normalizedQuery, { limit: 20 })
        if (requestId === semanticRequestRef.current) {
          setRelatedResults(candidates.map(mapKnowledgeCandidate))
        }
      } catch (error) {
        console.error('Sidebar semantic search failed:', error)
        if (requestId === semanticRequestRef.current) setRelatedResults([])
      } finally {
        if (requestId === semanticRequestRef.current) setRelatedLoading(false)
      }
    }, 700)

    return () => window.clearTimeout(timer)
  }, [normalizedQuery, searching])

  const orderedTypes = useMemo(() => {
    const activeType = TYPE_BY_TAB[activeTab]
    return [activeType, ...SEARCH_TYPES.filter(type => type !== activeType)]
  }, [activeTab])

  const { exactGroups, relatedGroups } = useMemo(() => {
    const exactKeys = new Set(exactResults.map(result => result.sourceKey))
    const dedupedRelated = relatedResults.filter(result => !exactKeys.has(result.sourceKey))
    return {
      exactGroups: orderedTypes.map(type => ({
        type,
        results: exactResults.filter(result => result.searchType === type),
      })),
      relatedGroups: orderedTypes.map(type => ({
        type,
        results: dedupedRelated.filter(result => result.searchType === type),
      })),
    }
  }, [exactResults, orderedTypes, relatedResults])

  const resultCount = [...exactGroups, ...relatedGroups]
    .reduce((sum, group) => sum + group.results.length, 0)
  const hasExactResults = exactGroups.some(group => group.results.length > 0)
  const hasRelatedResults = relatedGroups.some(group => group.results.length > 0)

  const handleSelect = useCallback(async (result: SidebarSearchResult) => {
    const activationIntent = beginDeferredFileActivation()
    await setLeftSidebarTab(TAB_BY_TYPE[result.searchType])
    if (!isDeferredFileActivationCurrent(activationIntent)) return
    await showCenterPanel()
    if (!isDeferredFileActivationCurrent(activationIntent)) return
    router.push('/core/main')

    if (result.searchType === 'record') {
      let mark = allMarks.find(item => item.id === result.markId)
      if (!mark) {
        await fetchAllMarks()
        if (!isDeferredFileActivationCurrent(activationIntent)) return
        mark = useMarkStore.getState().allMarks.find(item => item.id === result.markId)
      }
      if (!mark) return
      setActiveMarkId(mark.id)
      await addTab(createRecordTab(mark, t(`record.mark.type.${mark.type}`)))
      if (!isDeferredFileActivationCurrent(activationIntent)) return
      await setActiveFilePath('')
      return
    }

    if (result.searchType === 'canvas') {
      if (!result.canvasId) return
      if (result.nodeIds?.length) {
        setPendingCanvasFocus({ canvasId: result.canvasId, nodeIds: result.nodeIds })
      }
      const project = await openCanvasProject(result.canvasId)
      if (!isDeferredFileActivationCurrent(activationIntent)) return
      if (project) await addTab(createCanvasTab(project))
      return
    }

    if (!result.path) return
    try {
      if (result.isLocale === false) {
        await downloadRemoteLibraryFile(result.path)
        if (!isDeferredFileActivationCurrent(activationIntent)) return
        markFileLocal(result.path)
      }
      const parts = result.path.split('/')
      parts.pop()
      let currentPath = ''
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part
        await setCollapsibleList(currentPath, true)
      }
      if (!isDeferredFileActivationCurrent(activationIntent)) return
      setMatchPosition(result.firstMatchIndex ?? null)
      setPendingSearchKeyword(result.firstMatchIndex !== undefined ? normalizedQuery : '')
      await setActiveFilePath(result.path, true, { tabOpenMode: 'preview' })
    } catch (error) {
      console.error('Failed to open sidebar search result:', error)
      toast({ title: t('search.openFailed'), variant: 'destructive' })
    }
  }, [addTab, allMarks, fetchAllMarks, markFileLocal, normalizedQuery, openCanvasProject, router, setActiveFilePath, setActiveMarkId, setCollapsibleList, setLeftSidebarTab, setMatchPosition, setPendingCanvasFocus, setPendingSearchKeyword, showCenterPanel, t, toast])

  const getTypeLabel = (type: SearchType) => t(`search.item.${type}`)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 py-2">
        <InputGroup focusRing="subtle" className="h-8 bg-background shadow-none">
          <InputGroupAddon className="text-muted-foreground">
            {fileLoading || relatedLoading ? <Spinner /> : <Search />}
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape' && query) {
                event.preventDefault()
                setQuery('')
              }
            }}
            placeholder={t('search.placeholder')}
            aria-label={t('search.placeholder')}
            className="text-xs"
          />
          {query ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                onClick={() => setQuery('')}
                aria-label={t('search.clear')}
                title={t('search.clear')}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      {!searching ? children : (
        <Command shouldFilter={false} className="min-h-0 flex-1 rounded-none">
          <CommandList className="app-panel-scrollbar max-h-none flex-1 overflow-y-auto">
            {resultCount === 0 && !fileLoading && !relatedLoading ? (
              <Empty className="min-h-48 border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
                  <EmptyTitle>{t('search.noResults')}</EmptyTitle>
                  <EmptyDescription>{t('search.tryDifferentKeywords')}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}

            {hasExactResults ? (
              <div className="px-3 pb-1 pt-1 text-xs font-medium text-foreground">
                {t('search.exactMatches')}
              </div>
            ) : null}

            {exactGroups.map(group => (
              <SearchResultGroup
                key={group.type}
                label={getTypeLabel(group.type)}
                results={group.results}
                query={normalizedQuery}
                onSelect={result => void handleSelect(result)}
              />
            ))}

            {hasRelatedResults || relatedLoading ? (
              <div className="px-3 pb-1 pt-3 text-xs font-medium text-foreground">
                {t('search.relatedContent')}
              </div>
            ) : null}

            {relatedGroups.map(group => (
              <SearchResultGroup
                key={`related-${group.type}`}
                label={getTypeLabel(group.type)}
                results={group.results}
                query={normalizedQuery}
                onSelect={result => void handleSelect(result)}
              />
            ))}

            {relatedLoading ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-muted-foreground">
                <Spinner />
                {t('search.searchingRelated')}
              </div>
            ) : null}
          </CommandList>
        </Command>
      )}
    </div>
  )
}
