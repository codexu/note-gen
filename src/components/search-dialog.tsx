'use client'

import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { debounce } from 'lodash-es'
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Drawer, DrawerContent } from '@/components/ui/drawer'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { File, FolderTree, NotebookPen, Palette, SearchX, Tags } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Store } from '@tauri-apps/plugin-store'
import useArticleStore, {
  beginDeferredFileActivation,
  isDeferredFileActivationCurrent,
} from '@/stores/article'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import { useSidebarStore } from '@/stores/sidebar'
import { usePathname, useRouter } from 'next/navigation'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import { search, type SearchableItem } from '@/lib/search-utils'
import useCanvasStore from '@/stores/canvas'
import { createCanvasTab } from '@/app/core/main/canvas/canvas-tab'
import { searchKnowledge } from '@/lib/knowledge-search'
import { getKnowledgeIndexStats } from '@/db/knowledge'
import type { KnowledgeSearchCandidate, KnowledgeSourceType } from '@/types/knowledge'

interface SearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mobile?: boolean
}

type SearchFilter = 'all' | 'record' | 'article' | 'canvas'

interface EnhancedSearchResult {
  id: string
  markId?: number
  path?: string
  canvasId?: string
  nodeIds?: string[]
  sourceKey: string
  article?: string
  content?: string
  desc?: string
  title: string
  searchType: 'article' | 'record' | 'canvas'
  tagId?: number
  tagName?: string
  type?: string
  url?: string
  highlightText: string
  score: number
  firstMatchIndex?: number
}

export function SearchDialog({ open, onOpenChange, mobile = false }: SearchDialogProps) {
  const t = useTranslations()
  const router = useRouter()
  const pathname = usePathname()
  const [searchValue, setSearchValue] = useState('')
  const [searchResult, setSearchResult] = useState<EnhancedSearchResult[]>([])
  const [relatedResult, setRelatedResult] = useState<EnhancedSearchResult[]>([])
  const [relatedLoading, setRelatedLoading] = useState(false)
  const [indexCoverage, setIndexCoverage] = useState<{ ready: number; total: number } | null>(null)
  const [searchFilter, setSearchFilter] = useState<SearchFilter>('all')
  const { allArticle, loadAllArticle, addTab, setActiveFilePath, setMatchPosition, setPendingSearchKeyword, setCollapsibleList } = useArticleStore()
  const { allMarks, fetchAllMarks, setPendingScrollMarkId } = useMarkStore()
  const { tags, fetchTags, setCurrentTagId } = useTagStore()
  const { setLeftSidebarTab } = useSidebarStore()
  const canvasProjects = useCanvasStore(state => state.projects)
  const loadCanvasProjects = useCanvasStore(state => state.loadProjects)
  const openCanvasProject = useCanvasStore(state => state.openProject)
  const setPendingCanvasFocus = useCanvasStore(state => state.setPendingFocus)
  const isMobileRoute = mobile || pathname.startsWith('/mobile')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const semanticRequestRef = useRef(0)
  const lastSemanticRunRef = useRef<{ key: string; at: number } | null>(null)

  function extractTitleFromPath(path: string): string {
    if (!path) return ''
    const parts = path.split(/[\/\\]/)
    const fileName = parts[parts.length - 1]
    return fileName.includes('.') ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName
  }

  // 高亮搜索关键词
  function highlightText(text: string, query: string) {
    if (!query.trim() || !text) return text
    
    const parts: React.ReactNode[] = []
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase().trim()
    
    let lastIndex = 0
    let index = lowerText.indexOf(lowerQuery)
    
    while (index !== -1) {
      // 添加匹配前的文本
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index))
      }
      
      // 添加高亮的匹配文本
      parts.push(
        <mark key={index} className="rounded bg-primary/15 px-0.5 text-foreground">
          {text.substring(index, index + lowerQuery.length)}
        </mark>
      )
      
      lastIndex = index + lowerQuery.length
      index = lowerText.indexOf(lowerQuery, lastIndex)
    }
    
    // 添加剩余文本
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex))
    }
    
    return <>{parts}</>
  }

  function getResultMeta(item: EnhancedSearchResult) {
    if (item.searchType === 'record') {
      return {
        icon: Tags,
        primary: item.tagName || t('search.item.record'),
        secondary: item.type || null,
      }
    }

    if (item.searchType === 'canvas') {
      return {
        icon: Palette,
        primary: t('search.item.canvas'),
        secondary: item.type || null,
      }
    }

    return {
      icon: FolderTree,
      primary: item.path || t('search.item.article'),
      secondary: null,
    }
  }

  function getResultTone(item: EnhancedSearchResult) {
    return item.searchType === 'record'
      ? 'border border-primary/20 bg-primary/10 text-primary'
      : item.searchType === 'canvas'
        ? 'border border-primary/20 bg-primary/10 text-primary'
        : 'border border-border bg-muted text-muted-foreground'
  }

  const performSearch = useCallback((value: string) => {
    if (!value.trim()) {
      setSearchResult([])
      return
    }
    
    // 构建文章搜索项
    const articleItems: SearchableItem[] = allArticle.map((item, index) => ({
      id: `article-${index}-${item.path?.replace(/[^a-zA-Z0-9]/g, '-')}`,
      title: extractTitleFromPath(item.path || ''),
      content: item.article || '',
      metadata: {
        path: item.path,
        article: item.article,
        searchType: 'article'
      }
    }))
    
    // 准备记录搜索数据
    const markItems: SearchableItem[] = allMarks.map((item, index) => {
      const tag = tags.find(tag => tag.id === item.tagId)
      return {
        id: `mark-${index}-${item.id}`,
        title: item.desc || item.content?.slice(0, 50) || '',
        content: `${item.content || ''} ${item.desc || ''} ${tag?.name || ''}`,
        metadata: {
          markId: item.id,
          content: item.content,
          desc: item.desc,
          tagName: tag?.name,
          tagId: item.tagId,
          type: item.type,
          url: item.url,
          searchType: 'record'
        }
      }
    })

    const normalizedCanvasQuery = value.trim().toLocaleLowerCase()
    const canvasItems: SearchableItem[] = canvasProjects.map(project => ({
      id: `canvas-${project.id}`,
      title: project.title,
      content: [
        ...project.document.nodes.flatMap(node => [
          node.data.label,
          node.data.description,
          node.data.filePath,
          node.data.url,
        ]),
        ...project.document.edges.map(edge => edge.label),
      ].filter(value => typeof value === 'string').join(' '),
      metadata: {
        canvasId: project.id,
        nodeIds: project.document.nodes.filter(node => [
          node.data.label,
          node.data.description,
          node.data.filePath,
          node.data.url,
        ].some(field => typeof field === 'string' && field.toLocaleLowerCase().includes(normalizedCanvasQuery)))
          .map(node => node.id),
        type: project.canvasType,
        searchType: 'canvas',
      },
    }))
    
    // 合并所有搜索项
    const allItems = [...articleItems, ...markItems, ...canvasItems]
    
    // 执行搜索（自动合并精确和模糊结果）
    const searchResults = search(allItems, value, { 
      maxResults: 50 
    })
    
    // 转换为组件需要的格式
    const results: EnhancedSearchResult[] = searchResults.filter(result => result.matchType === 'exact').map(result => {
      const metadata = result.item.metadata || {}
      const firstMatch = result.matches[0]
      
      return {
        id: result.item.id,
        sourceKey: metadata.searchType === 'article'
          ? `article:${metadata.path}`
          : metadata.searchType === 'record'
            ? `record:${metadata.markId}`
            : `canvas:${metadata.canvasId}`,
        title: result.item.title,
        searchType: metadata.searchType as 'article' | 'record' | 'canvas',
        highlightText: result.highlightText,
        score: result.score,
        firstMatchIndex: firstMatch?.index,
        // 文章特定字段
        path: metadata.path,
        article: metadata.article,
        canvasId: metadata.canvasId,
        nodeIds: metadata.nodeIds,
        // 记录特定字段
        markId: metadata.markId,
        content: metadata.content,
        desc: metadata.desc,
        tagName: metadata.tagName,
        tagId: metadata.tagId,
        type: metadata.type,
        url: metadata.url
      }
    })
    
    setSearchResult(results)
  }, [allArticle, allMarks, canvasProjects, tags])

  // 防抖搜索，300ms 延迟
  const debouncedSearch = useMemo(
    () => debounce(performSearch, 300),
    [performSearch]
  )

  const filteredSearchResult = useMemo(() => {
    if (searchFilter === 'all') {
      return searchResult
    }
    return searchResult.filter((item) => item.searchType === searchFilter)
  }, [searchFilter, searchResult])

  const filteredRelatedResult = useMemo(() => {
    const exactKeys = new Set(searchResult.map(item => item.sourceKey))
    return relatedResult.filter(item => (
      !exactKeys.has(item.sourceKey)
      && (searchFilter === 'all' || item.searchType === searchFilter)
    ))
  }, [relatedResult, searchFilter, searchResult])

  const groupedSearchResults = useMemo(() => [
    ...filteredSearchResult.map(item => ({ item, section: 'exact' as const })),
    ...filteredRelatedResult.map(item => ({ item, section: 'related' as const })),
  ], [filteredRelatedResult, filteredSearchResult])

  const mapKnowledgeCandidate = useCallback((candidate: KnowledgeSearchCandidate): EnhancedSearchResult => ({
    id: `related-${candidate.sourceKey}`,
    sourceKey: candidate.sourceKey,
    searchType: candidate.sourceType,
    title: candidate.title,
    path: candidate.locator.filePath,
    markId: candidate.locator.markId,
    tagId: candidate.locator.tagId,
    canvasId: candidate.locator.canvasId,
    nodeIds: candidate.locator.nodeIds,
    highlightText: candidate.fragments.map(fragment => fragment.content).join('\n\n'),
    content: candidate.fragments[0]?.content,
    score: candidate.relevanceScore,
    type: candidate.sourceType,
  }), [])

  const runSemanticSearch = useCallback(async (value: string) => {
    const query = value.trim()
    const runKey = `${searchFilter}:${query}`
    const previousRun = lastSemanticRunRef.current
    if (previousRun?.key === runKey && Date.now() - previousRun.at < 1000) return
    lastSemanticRunRef.current = { key: runKey, at: Date.now() }
    const effectiveLength = query.replace(/[\p{P}\p{S}\s]/gu, '').length
    const requestId = ++semanticRequestRef.current
    if (effectiveLength < 2) {
      setRelatedResult([])
      setRelatedLoading(false)
      return
    }
    const store = await Store.load('store.json')
    const enabled = await store.get<boolean>('ragGlobalSemanticSearchEnabled') ?? true
    if (!enabled || requestId !== semanticRequestRef.current) {
      setRelatedResult([])
      setRelatedLoading(false)
      return
    }
    setRelatedLoading(true)
    try {
      const sourceTypes = searchFilter === 'all'
        ? undefined
        : [searchFilter as KnowledgeSourceType]
      const candidates = await searchKnowledge(query, {
        sourceTypes,
        sourceMode: sourceTypes ? 'only' : undefined,
        limit: 20,
      })
      if (requestId === semanticRequestRef.current) {
        setRelatedResult(candidates.map(mapKnowledgeCandidate))
      }
    } catch (error) {
      console.error('Global semantic search failed:', error)
      if (requestId === semanticRequestRef.current) setRelatedResult([])
    } finally {
      if (requestId === semanticRequestRef.current) setRelatedLoading(false)
    }
  }, [mapKnowledgeCandidate, searchFilter])

  async function handleSelect(item: EnhancedSearchResult) {
    const activationIntent = beginDeferredFileActivation()
    // 如果是记录类型，跳转到记录页面并设置对应的 tag
    if (item.searchType === 'record') {
      onOpenChange(false)
      setPendingSearchKeyword('')
      setMatchPosition(null)
      setPendingScrollMarkId(item.markId ?? null)

      if (item.tagId) {
        await setCurrentTagId(item.tagId)
        if (!isDeferredFileActivationCurrent(activationIntent)) return
      }

      if (!isMobileRoute) {
        // PC 端：切换到记录标签页
        await setLeftSidebarTab('notes')
        if (!isDeferredFileActivationCurrent(activationIntent)) return
      } else {
        // 移动端：进入记录页
        router.push('/mobile/record')
      }

      emitter.emit(EmitterRecordEvents.refreshMarks)

      return
    }

    if (item.searchType === 'canvas') {
      onOpenChange(false)
      setPendingSearchKeyword('')
      setMatchPosition(null)
      setPendingScrollMarkId(null)
      if (item.canvasId && item.nodeIds?.length) {
        setPendingCanvasFocus({ canvasId: item.canvasId, nodeIds: item.nodeIds })
      }
      if (isMobileRoute && item.canvasId) {
        router.push(`/mobile/canvas/editor?id=${encodeURIComponent(item.canvasId)}`)
        return
      }
      await setLeftSidebarTab('canvases')
      if (!isDeferredFileActivationCurrent(activationIntent)) return
      const project = item.canvasId ? await openCanvasProject(item.canvasId) : null
      if (!isDeferredFileActivationCurrent(activationIntent)) return
      router.push('/core/main')
      if (project) await addTab(createCanvasTab(project))
      return
    }
    
    onOpenChange(false)
    setPendingScrollMarkId(null)

    // PC 端切换到笔记标签页；移动端直接跳转写作页
    if (!isMobileRoute) {
      await setLeftSidebarTab('files')
      if (!isDeferredFileActivationCurrent(activationIntent)) return
    }
    
    const filePath = item.path as string
    
    const setupAndNavigate = async () => {
      // 展开文件夹路径
      const pathParts = filePath.split('/')
      pathParts.pop()
      
      let currentPath = ''
      for (const part of pathParts) {
        if (currentPath) {
          currentPath += '/' + part
        } else {
          currentPath = part
        }
        
        if (currentPath) {
          await setCollapsibleList(currentPath, true)
        }
      }
      if (!isDeferredFileActivationCurrent(activationIntent)) return

      // 如果是文章类型，跳转到文章页面
      if (item.firstMatchIndex !== undefined) {
        setMatchPosition(item.firstMatchIndex)
      }
      setPendingSearchKeyword(searchValue.trim())
      
      // 设置活动文件路径
      await setActiveFilePath(
        filePath,
        true,
        isMobileRoute ? undefined : { tabOpenMode: 'preview' },
      )
      
      // 跳转到对应平台页面
      router.push(isMobileRoute ? '/mobile/writing' : '/core/main')
    }
    
    void setupAndNavigate()
  }

  useEffect(() => {
    if (open) {
      loadAllArticle()
      fetchAllMarks()
      fetchTags()
      void loadCanvasProjects()
      if (!isMobileRoute) {
        void getKnowledgeIndexStats().then(stats => {
          const values = Object.values(stats).flatMap(sourceStats => Object.values(sourceStats))
          setIndexCoverage({
            ready: Object.values(stats).reduce((sum, sourceStats) => sum + sourceStats.ready, 0),
            total: values.reduce((sum, value) => sum + value, 0),
          })
        })
      }
    }
  }, [fetchAllMarks, fetchTags, isMobileRoute, loadAllArticle, loadCanvasProjects, open])

  useEffect(() => {
    const loadSearchFilter = async () => {
      const store = await Store.load('store.json')
      const savedFilter = await store.get<SearchFilter>('globalSearchFilter')
      if (savedFilter === 'all' || savedFilter === 'record' || savedFilter === 'article' || savedFilter === 'canvas') {
        setSearchFilter(savedFilter)
      }
    }

    loadSearchFilter()
  }, [])

  useEffect(() => {
    const persistSearchFilter = async () => {
      const store = await Store.load('store.json')
      await store.set('globalSearchFilter', searchFilter)
    }

    persistSearchFilter()
  }, [searchFilter])

  useEffect(() => {
    debouncedSearch(searchValue)
  }, [searchValue, debouncedSearch])

  useEffect(() => {
    semanticRequestRef.current += 1
    const timer = setTimeout(() => {
      void runSemanticSearch(searchValue)
    }, 700)
    return () => clearTimeout(timer)
  }, [runSemanticSearch, searchValue])

  useEffect(() => {
    if (!open || isMobileRoute) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 60)
    return () => clearTimeout(timer)
  }, [open, isMobileRoute])

  const handleDrawerAnimationEnd = useCallback((drawerOpen: boolean) => {
    if (!drawerOpen) return

    searchInputRef.current?.focus()
  }, [])

  const searchContent = (
    <>
      <div
        className={cn(
          "flex border-b border-border/70 px-4 py-3",
          isMobileRoute
            ? "flex-col items-stretch gap-2"
            : "items-center gap-3"
        )}
      >
        <div className="min-w-0 flex-1">
          <CommandInput
            ref={searchInputRef}
            autoFocus={!isMobileRoute}
            placeholder={t('search.placeholder')}
            value={searchValue}
            onValueChange={setSearchValue}
            onKeyDown={event => {
              if (event.key === 'Enter') void runSemanticSearch(searchValue)
            }}
            className="h-10 text-base font-medium"
          />
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center gap-3",
            isMobileRoute && "justify-end px-1"
          )}
        >
          {!isMobileRoute ? (
            <>
              <div className="text-sm font-semibold tracking-tight text-foreground/90">
                {t('search.results', { count: groupedSearchResults.length })}
              </div>
              {indexCoverage && indexCoverage.ready < indexCoverage.total ? (
                <Badge variant="outline">
                  {t('search.indexingProgress', indexCoverage)}
                </Badge>
              ) : null}
              <Separator orientation="vertical" className="h-5" />
            </>
          ) : null}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={searchFilter}
            onValueChange={(value) => value && setSearchFilter(value as SearchFilter)}
          >
            <ToggleGroupItem value="all" aria-label={t('common.all')}>
              {t('common.all')}
            </ToggleGroupItem>
            <ToggleGroupItem value="record" aria-label={t('search.item.record')}>
              {t('search.item.record')}
            </ToggleGroupItem>
            <ToggleGroupItem value="article" aria-label={t('search.item.article')}>
              {t('search.item.article')}
            </ToggleGroupItem>
            <ToggleGroupItem value="canvas" aria-label={t('search.item.canvas')}>
              {t('search.item.canvas')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <CommandList className={isMobileRoute ? "h-[64vh] max-h-[64vh]" : "min-h-0 flex-1 max-h-none"}>
        {!searchValue && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.placeholder')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {groupedSearchResults.length === 0 && searchValue && !relatedLoading && (
          <Empty className="border-0">
            <EmptyHeader>
              <SearchX className="size-10 text-muted-foreground" />
              <EmptyTitle>{t('search.noResults')}</EmptyTitle>
              <EmptyDescription>
                {t('search.tryDifferentKeywords')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {(groupedSearchResults.length > 0 || relatedLoading) && (
          <CommandGroup>
            <div className="flex flex-col divide-y divide-border/60">
              {groupedSearchResults.map(({ item, section }, index) => {
              const resultMeta = getResultMeta(item)
              const MetaIcon = resultMeta.icon
              return (
                <Fragment key={item.id}>
                {(index === 0 || groupedSearchResults[index - 1].section !== section) ? (
                  <div className="px-5 py-2 text-xs font-medium text-muted-foreground">
                    {section === 'exact' ? t('search.exactMatches') : t('search.relatedContent')}
                  </div>
                ) : null}
                <CommandItem
                  value={`${item.searchType}-${item.title || item.path}`}
                  onSelect={() => handleSelect(item)}
                  className={cn(
                    isMobileRoute
                      ? "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                      : "group flex flex-col items-start gap-0 rounded-none bg-transparent p-0 text-left data-[selected=true]:bg-muted/30"
                  )}
                >
                  {isMobileRoute ? (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : item.searchType === 'canvas' ? (
                            <Palette className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              {item.title ? (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightText(item.title, searchValue)}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[120px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {highlightText(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full py-3">
                      <div className="flex items-start gap-3 px-2 py-2 transition-colors group-data-[selected=true]:bg-muted/30">
                        <div className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", getResultTone(item))}>
                          {item.searchType === 'record' ? (
                            <NotebookPen className="size-3.5" />
                          ) : item.searchType === 'canvas' ? (
                            <Palette className="size-3.5" />
                          ) : (
                            <File className="size-3.5" />
                          )}
                        </div>

                        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                          <div className="flex min-w-0 items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              {item.title && (
                                <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
                                  {highlightText(item.title, searchValue)}
                                </div>
                              )}
                            </div>

                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                {item.type ? (
                                  <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] capitalize">
                                    {item.type}
                                  </Badge>
                                ) : null}
                                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <MetaIcon className="size-3 shrink-0" />
                                  <span className="max-w-[180px] truncate">{resultMeta.primary}</span>
                                </div>
                            </div>
                          </div>

                          <div className="line-clamp-2 text-[12px] leading-5 text-muted-foreground">
                            {highlightText(item.highlightText, searchValue)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CommandItem>
                </Fragment>
              )
            })}
            {relatedLoading && filteredRelatedResult.length === 0 ? (
              <div className="px-5 py-4 text-xs text-muted-foreground">{t('search.searchingRelated')}</div>
            ) : null}
            </div>
          </CommandGroup>
        )}
      </CommandList>
    </>
  )

  if (isMobileRoute) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} onAnimationEnd={handleDrawerAnimationEnd}>
        <DrawerContent className="h-[88vh] rounded-t-[28px] border-border/70 bg-background p-0 shadow-2xl">
          <div className="min-h-0 flex-1 px-3 pb-3 pt-3">
        <Command
          shouldFilter={false}
          className={cn(
            "h-full rounded-[22px] border border-border/70 bg-background shadow-sm",
            "[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-sm [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
                "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
                "[&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
                "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
                "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2 [&_[cmdk-item]]:rounded-2xl [&_[cmdk-item]]:px-0 [&_[cmdk-item]]:py-0"
              )}
            >
              {searchContent}
            </Command>
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="h-[56vh] max-h-[56vh] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">{t('search.placeholder')}</DialogTitle>
        <Command
          shouldFilter={false}
          className={cn(
            "h-full bg-transparent",
            "[&_[cmdk-group-heading]]:px-5 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-base [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-tight [&_[cmdk-group-heading]]:text-foreground/85",
            "[&_[cmdk-group]]:px-0 [&_[cmdk-input-wrapper]]:border-0 [&_[cmdk-input-wrapper]]:bg-transparent [&_[cmdk-input-wrapper]]:px-0",
            "[&_[cmdk-input-wrapper]_svg]:size-4 [&_[cmdk-input-wrapper]_svg]:text-muted-foreground",
            "[&_[cmdk-input]]:h-10 [&_[cmdk-input]]:text-base [&_[cmdk-input]]:font-medium [&_[cmdk-input]]:tracking-tight [&_[cmdk-input]]:placeholder:text-muted-foreground/60",
            "[&_[cmdk-list]]:px-0 [&_[cmdk-list]]:py-2"
          )}
        >
          {searchContent}
        </Command>
      </DialogContent>
    </Dialog>
  )
}
