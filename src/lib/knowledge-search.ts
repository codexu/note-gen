import { Store } from '@tauri-apps/plugin-store'
import { getKnowledgeSource, getKnowledgeSources } from '@/db/knowledge'
import { getSimilarDocuments } from '@/db/vector'
import { fetchEmbedding, rerankDocuments } from '@/lib/ai'
import { discoverKnowledgeArticles, lookupKnowledgeLexicalText } from '@/lib/knowledge-lexical-cache'
import { parseBM25ChunkKey } from '@/lib/bm25'
import { getArticleKnowledgeUpdatedAt, getKnowledgeSourceDocument } from '@/lib/knowledge-content'
import { getFilePathOptions, isAbsoluteFsPath, toWorkspaceRelativePath } from '@/lib/workspace'
import { getKnowledgeSettings, isKnowledgeSourceEnabled } from '@/lib/knowledge-settings'
import { getIdentifierTerms, getLexicalTerms } from '@/lib/lexical-tokenizer'
import { DEFAULT_EXCLUDED_RAG_PATHS, isPathAllowedForRag } from '@/lib/rag-retrieval-policy'
import type { MarkdownFile } from '@/lib/files'
import { isWikiFolderPath } from '@/lib/wiki/path'
import { isWikiNoteScope, type WikiSettings, type WikiSourceReference } from '@/types/wiki'
import { captureWikiWorkspaceGuard } from '@/lib/wiki/context'
import { waitForKnowledgeArticleImports, waitForKnowledgeArticleScan } from '@/lib/knowledge-article-import'
import {
  createKnowledgeSourceKey,
  isKnowledgeSourceType,
  type KnowledgeReadPage,
  type KnowledgeOriginalGrant,
  type KnowledgeSearchCandidate,
  type KnowledgeSearchResults,
  type KnowledgeSearchFragment,
  type KnowledgeSource,
  type KnowledgeSourceDocument,
  type KnowledgeSourceType,
  type KnowledgeWikiSearchScope,
} from '@/types/knowledge'

export interface KnowledgeSearchOptions extends KnowledgeWikiSearchScope {
  mode?: 'auto' | 'rag' | 'keyword'
  limit?: number
}

interface ChunkCandidate {
  sourceKey: string
  chunkId: number
  nodeId?: string
  content: string
  score: number
}

type ArticleFile = Pick<MarkdownFile, 'path' | 'relativePath' | 'name'>

/** Files imported without Wiki or vector indexing have no knowledge_sources row yet. */
function withLocalArticles(registered: KnowledgeSource[], files: ArticleFile[]) {
  const articles = new Map(registered.filter(source => source.sourceType === 'article').map(source => [source.sourceId, source]))
  const sources = registered.filter(source => source.sourceType !== 'article')
  for (const file of files) {
    const path = file.relativePath
    const existing = articles.get(path) ?? articles.get(file.path.replaceAll('\\', '/'))
    if (existing) sources.push(existing)
    else if (!isWikiFolderPath(path)) sources.push({
      sourceType: 'article', sourceKey: createKnowledgeSourceKey('article', path), sourceId: path,
      title: file.name, locator: { filePath: path }, updatedAt: 0, contentHash: '', status: 'pending',
    })
  }
  return sources
}

interface AgentArticleInventory {
  files?: ArticleFile[]
  originals?: WikiSourceReference[]
}

async function prepareAgentArticleSearch(contextId: string, settings: WikiSettings, signal?: AbortSignal): Promise<AgentArticleInventory> {
  const wikiOnly = settings.enabled && !settings.semanticSearchEnabled
  if (wikiOnly && !settings.scopes.some(scope => scope.enabled && scope.effect !== 'exclude' && isWikiNoteScope(scope))) return {}
  await waitForKnowledgeArticleImports(signal)
  signal?.throwIfAborted()
  if (!wikiOnly) {
    const files = await waitForKnowledgeArticleScan(discoverKnowledgeArticles(), signal)
    return { files }
  }
  const queue = await import('./wiki/queue')
  if (settings.started && !settings.paused) {
    await waitForKnowledgeArticleScan(queue.ensureAgentWikiSourcesReady(contextId), signal)
    return {}
  }
  const originals = await waitForKnowledgeArticleScan(queue.listUncompiledAgentWikiArticles(contextId, settings), signal)
  return { originals }
}

const DEFAULT_SOURCE_SHARES: Record<KnowledgeSourceType, number> = {
  article: 0.6,
  record: 0.25,
  canvas: 0.15,
}

function inferSourceHints(query: string): KnowledgeSourceType[] {
  const hints: KnowledgeSourceType[] = []
  if (/(?:笔记|文章|markdown|md\s*文件)/i.test(query)) hints.push('article')
  if (/(?:记录|录音|ocr|截图|待办|素材)/i.test(query)) hints.push('record')
  if (/(?:画布|绘图|流程图|思维导图|节点|连线|白板)/i.test(query)) hints.push('canvas')
  return hints
}

function isOnlySourceRequest(query: string) {
  return /(?:只|仅|只从|仅从|不要查(?:其他|其它|别的)|only|exclusively)/i.test(query)
}

function sourceShares(query: string, options: KnowledgeSearchOptions) {
  const explicit = (options.sourceTypes || []).filter(isKnowledgeSourceType)
  const hinted = explicit.length ? explicit : inferSourceHints(query)
  const only = options.sourceMode === 'only' || (hinted.length > 0 && isOnlySourceRequest(query))
  if (only) {
    const allowed = hinted.length ? hinted : ['article', 'record', 'canvas'] as KnowledgeSourceType[]
    const total = allowed.reduce((sum, type) => sum + DEFAULT_SOURCE_SHARES[type], 0)
    return Object.fromEntries(allowed.map(type => [type, DEFAULT_SOURCE_SHARES[type] / total])) as Partial<Record<KnowledgeSourceType, number>>
  }
  if (hinted.length === 1) {
    const preferred = hinted[0]
    const remaining = (['article', 'record', 'canvas'] as KnowledgeSourceType[]).filter(type => type !== preferred)
    const remainingTotal = remaining.reduce((sum, type) => sum + DEFAULT_SOURCE_SHARES[type], 0)
    return {
      [preferred]: 0.6,
      ...Object.fromEntries(remaining.map(type => [type, 0.4 * DEFAULT_SOURCE_SHARES[type] / remainingTotal])),
    }
  }
  if (hinted.length === 2) {
    const unmentioned = (['article', 'record', 'canvas'] as KnowledgeSourceType[]).find(type => !hinted.includes(type))
    return { [hinted[0]]: 0.4, [hinted[1]]: 0.4, ...(unmentioned ? { [unmentioned]: 0.2 } : {}) }
  }
  if (hinted.length === 3) return { article: 1 / 3, record: 1 / 3, canvas: 1 / 3 }
  return DEFAULT_SOURCE_SHARES
}

function isRelativeTimeQuery(query: string) {
  return /(?:最近|最新|上次|近期|recent|latest|last time)/i.test(query)
}

function recencyBoost(updatedAt: number) {
  const ageDays = Math.max(0, Date.now() - updatedAt) / 86_400_000
  return 0.1 * Math.pow(0.5, ageDays / 30)
}

function inferDateRange(query: string): { start: number; end: number } | null {
  const now = new Date()
  const dayStart = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const nextDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1).getTime()
  if (/(?:今天|今日|today)/i.test(query)) return { start: dayStart(now), end: nextDay(now) }
  if (/(?:本周|这周|this week)/i.test(query)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
    return { start: start.getTime(), end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7).getTime() }
  }
  if (/(?:上个月|上月|last month)/i.test(query)) {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
      end: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
    }
  }
  const dates = Array.from(query.matchAll(/\b(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/g))
    .map(match => new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    .filter(date => !Number.isNaN(date.getTime()))
  if (dates.length >= 2) return { start: dayStart(dates[0]), end: nextDay(dates[1]) }
  if (dates.length === 1) return { start: dayStart(dates[0]), end: nextDay(dates[0]) }
  return null
}

export function matchesKnowledgeSearchScope(source: KnowledgeSource, options: KnowledgeSearchOptions) {
  if (options.dateRange && (!source.updatedAt || source.updatedAt < options.dateRange.start || source.updatedAt >= options.dateRange.end)) return false
  if (options.sourceMode === 'only' && options.sourceTypes?.length
    && !options.sourceTypes.includes(source.sourceType)) return false
  if (options.folderPath && source.sourceType !== 'article') return false
  if (typeof options.tagId === 'number' && options.tagId > 0 && source.sourceType !== 'record') return false
  if (options.folderPath && source.sourceType === 'article') {
    const normalize = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').replace(/\/+$/, '')
    const path = normalize(source.locator.filePath || source.sourceId)
    const folder = normalize(options.folderPath)
    if (!(path === folder || path.startsWith(`${folder}/`))) return false
  }
  if (typeof options.tagId === 'number' && options.tagId > 0 && source.sourceType === 'record' &&
    source.locator.tagId !== options.tagId && !source.locator.tagIds?.includes(options.tagId)) {
    return false
  }
  return !options.sourceFilter || options.sourceFilter(source)
}

function lexicalScore(content: string, query: string) {
  const normalizedContent = content.toLocaleLowerCase()
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return 0
  if (normalizedContent.includes(normalizedQuery)) return 1
  const terms = normalizedQuery.split(/[\s，。！？、,.;:]+/).filter(term => term.length > 1)
  if (terms.length === 0) return 0
  return terms.filter(term => normalizedContent.includes(term)).length / terms.length
}

async function searchOriginalKnowledge(
  query: string,
  options: KnowledgeSearchOptions,
  assertCurrent: () => Promise<void>,
  wikiSources: ReadonlyMap<string, { stableId: string }> | null,
  localArticles?: ArticleFile[],
  uncompiledArticles?: Map<string, WikiSourceReference>,
): Promise<KnowledgeSearchCandidate[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []
  const lexicalQuery = normalizedQuery.normalize('NFKC').toLowerCase()
  const exactIdentifier = getIdentifierTerms(normalizedQuery).includes(lexicalQuery)
    ? lexicalQuery : undefined
  const store = await Store.load('store.json')
  const resultCount = options.limit ?? await store.get<number>('ragResultCount') ?? 5
  const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25
  const settings = await getKnowledgeSettings()
  const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
  const excludedFiles = new Set(await store.get<string[]>('vectorExcludedFiles') ?? [])
  const shares = sourceShares(normalizedQuery, options)
  const allowedTypes = Object.keys(shares).filter(isKnowledgeSourceType)
  const sources: KnowledgeSource[] = []
  const { dateRange, ...scope } = options
  const registeredSources = await getKnowledgeSources({ sourceTypes: allowedTypes })
  const scoped = (localArticles ? withLocalArticles(registeredSources, localArticles) : registeredSources)
    .filter(source => (
      isKnowledgeSourceEnabled(source, settings) && matchesKnowledgeSearchScope(source, scope)
      && (source.sourceType !== 'article' || (isPathAllowedForRag(source.locator.filePath || source.sourceId, { excludedPaths })
        && !excludedFiles.has(source.locator.filePath || source.sourceId)))
    ))
  for (const registered of scoped) {
    // Older article registry entries carry the indexing time. Check the file
    // timestamp for date-limited searches even if no reindex has happened.
    const source = dateRange && registered.sourceType === 'article'
      ? { ...registered, updatedAt: await getArticleKnowledgeUpdatedAt(await getFilePathOptions(registered.locator.filePath || registered.sourceId)) }
      : registered
    if (matchesKnowledgeSearchScope(source, { dateRange })) sources.push(source)
  }
  if (sources.length === 0) return []
  const sourceByKey = new Map(sources.map(source => [source.sourceKey, source]))
  const readyVectorKeys = new Set(sources
    .filter(source => source.status === 'ready' && source.indexedHash === source.contentHash)
    .map(source => source.sourceKey))
  const candidatePoolSize = Math.max(resultCount * 8, 40)
  const candidates = new Map<string, ChunkCandidate>()
  const addCandidate = (candidate: ChunkCandidate) => {
    if (exactIdentifier) {
      const source = sourceByKey.get(candidate.sourceKey)
      const contentMatches = getLexicalTerms(candidate.content).includes(exactIdentifier)
      const sourceMatches = getLexicalTerms(`${source?.title || ''} ${source?.sourceId || ''}`)
        .some(term => term === exactIdentifier || term.endsWith(`/${exactIdentifier}`))
      if (!contentMatches && !sourceMatches) return
    }
    const key = `${candidate.sourceKey}:${candidate.chunkId}`
    const current = candidates.get(key)
    if (!current || candidate.score > current.score) candidates.set(key, candidate)
  }

  if (options.mode !== 'keyword' && settings.semanticSearchEnabled && readyVectorKeys.size > 0) {
    try {
      const queryEmbedding = await fetchEmbedding(normalizedQuery)
      if (queryEmbedding) {
        const vectorResults = await getSimilarDocuments(
          queryEmbedding,
          candidatePoolSize,
          similarityThreshold,
          readyVectorKeys
        )
        vectorResults.forEach(result => addCandidate({
          sourceKey: result.filename,
          chunkId: result.chunk_id,
          content: result.content,
          score: Math.max(0, result.similarity),
        }))
      }
    } catch (error) {
      console.warn('统一知识库 Embedding 不可用，已降级为本地检索:', error)
    }
  }

  if (getLexicalTerms(normalizedQuery).length) {
    const registeredByDiskKey = new Map<string, string>()
    for (const source of sources) {
      const key = source.sourceType === 'article' && isAbsoluteFsPath(source.sourceId)
        ? createKnowledgeSourceKey('article', await toWorkspaceRelativePath(source.sourceId))
        : source.sourceKey
      if (key === source.sourceKey || !registeredByDiskKey.has(key)) registeredByDiskKey.set(key, source.sourceKey)
    }
    const { ensureBM25Search } = await import('@/lib/rag')
    await assertCurrent()
    const bm25 = await ensureBM25Search()
    await assertCurrent()
    if (bm25) {
      const hits = await bm25.search(normalizedQuery, candidatePoolSize, new Set(registeredByDiskKey.keys())).catch(error => {
        console.warn('BM25 查询失败，回退到原文检索:', error)
        return []
      })
      await assertCurrent()
      for (const result of hits) {
        const parsed = parseBM25ChunkKey(result.id)
        const sourceKey = parsed && registeredByDiskKey.get(parsed.filename)
        if (!parsed || !sourceKey || !result.content) continue
        addCandidate({
          sourceKey, chunkId: parsed.chunkId, content: result.content,
          score: Math.min(1, result.score / Math.max(1, result.score + 5)),
        })
      }
    }
  }

  // Index hits nominate chunks. Verify current text and scope before sending
  // anything to the reranker, including hits from a previous workspace.
  const liveHits = new Map<string, KnowledgeSourceDocument | null>()
  const stableIds = new Map<string, string>()
  async function readCurrent(sourceKey: string) {
    const registered = sourceByKey.get(sourceKey)
    if (!registered) return null
    const document = await getKnowledgeSourceDocument(sourceKey)
    if (!document) return null
    const uncompiled = uncompiledArticles?.get(sourceKey)
    if (uncompiled) {
      const { wikiHash } = await import('@/lib/wiki/sources')
      if (wikiHash(document.content.replace(/\r\n?/g, '\n').trim()) !== uncompiled.contentHash) return null
    }
    if (wikiSources && document.sourceType === 'record' && document.stableId !== wikiSources.get(sourceKey)?.stableId) return null
    const current = { ...registered, title: document.title, contentHash: document.contentHash,
      updatedAt: document.updatedAt, locator: document.locator }
    if (!matchesKnowledgeSearchScope(current, options)) return null
    if (document.stableId) stableIds.set(sourceKey, document.stableId)
    sourceByKey.set(sourceKey, current)
    return document
  }
  for (const [key, candidate] of candidates) {
    if (!liveHits.has(candidate.sourceKey)) liveHits.set(candidate.sourceKey, await readCurrent(candidate.sourceKey))
    const chunk = liveHits.get(candidate.sourceKey)?.chunks[candidate.chunkId]
    if (!chunk || chunk.content !== candidate.content) candidates.delete(key)
    else candidate.nodeId = chunk.nodeId
  }

  for (const source of sources) {
    if (candidates.size >= candidatePoolSize * 2) break
    const cached = await lookupKnowledgeLexicalText(source)
    if (cached.text !== undefined && lexicalScore(cached.text, normalizedQuery) === 0) continue
    const document = liveHits.has(source.sourceKey) ? liveHits.get(source.sourceKey) : await readCurrent(source.sourceKey)
    if (!document) continue
    cached.remember(document)
    document.chunks.forEach((chunk, chunkId) => {
      const score = lexicalScore(chunk.content, normalizedQuery)
      if (score > 0) addCandidate({ sourceKey: source.sourceKey, chunkId, nodeId: chunk.nodeId, content: chunk.content, score })
    })
  }

  const grouped = new Map<string, ChunkCandidate[]>()
  for (const candidate of candidates.values()) {
    const group = grouped.get(candidate.sourceKey) || []
    group.push(candidate)
    grouped.set(candidate.sourceKey, group)
  }

  const quotaTotal = Math.max(resultCount * 4, 20)
  const quotaSelected: ChunkCandidate[] = []
  for (const type of allowedTypes) {
    const quota = Math.max(1, Math.round(quotaTotal * (shares[type] || 0)))
    const sourceGroups = Array.from(grouped.entries())
      .filter(([sourceKey]) => sourceByKey.get(sourceKey)?.sourceType === type)
      .sort((left, right) => Math.max(...right[1].map(item => item.score)) - Math.max(...left[1].map(item => item.score)))
      .slice(0, quota)
    sourceGroups.forEach(([, group]) => quotaSelected.push(...group.sort((a, b) => b.score - a.score).slice(0, 3)))
  }

  const sourceCandidates = Array.from(new Set(quotaSelected.map(candidate => candidate.sourceKey))).map(sourceKey => {
    const fragments = quotaSelected.filter(candidate => candidate.sourceKey === sourceKey).slice(0, 3)
    return {
      sourceKey,
      content: fragments.map(fragment => fragment.content).join('\n\n---\n\n'),
      score: Math.max(...fragments.map(fragment => fragment.score)),
      fragments,
    }
  })
  if (sourceCandidates.length === 0) return []
  const rankingInput = sourceCandidates.map((candidate, id) => ({
    id, filename: candidate.sourceKey, content: candidate.content, similarity: candidate.score,
  }))
  await assertCurrent()
  const reranked = options.mode === 'keyword' || !settings.semanticSearchEnabled
    ? rankingInput
    : await rerankDocuments(
    normalizedQuery,
    rankingInput,
    similarityThreshold
  )
  const strongestScore = reranked.reduce(
    (maximum, result) => Math.max(maximum, Math.max(0, result.similarity)),
    0
  )
  // Embedding models often place many unrelated documents above a low absolute
  // cosine threshold. Keep candidates reasonably close to the best hit while
  // capping the adaptive floor so semantic-only matches are still discoverable.
  const finalRelevanceThreshold = Math.max(
    similarityThreshold,
    Math.min(0.65, strongestScore - 0.12)
  )

  const results: KnowledgeSearchCandidate[] = []
  for (const result of reranked) {
    const candidate = sourceCandidates[result.id]
    const source = sourceByKey.get(candidate?.sourceKey || '')
    if (!candidate || !source) continue
    const baseScore = Math.max(0, result.similarity)
    if (baseScore < finalRelevanceThreshold) continue
    const score = baseScore + (isRelativeTimeQuery(normalizedQuery) ? recencyBoost(source.updatedAt) : 0)
    const fragments = candidate.fragments.map(({ content, nodeId }) => ({ content, nodeId }))
    results.push({
      sourceKey: source.sourceKey,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      stableId: stableIds.get(source.sourceKey),
      title: source.title,
      fragments,
      relevanceScore: score,
      updatedAt: source.updatedAt,
      locator: {
        ...source.locator,
        nodeIds: source.sourceType === 'canvas'
          ? fragments.flatMap(fragment => fragment.nodeId ? [fragment.nodeId] : [])
          : source.locator.nodeIds,
      },
    })
  }
  const priority = (source: KnowledgeSearchCandidate) => {
    const hints = inferSourceHints(normalizedQuery)
    const hintedIndex = hints.indexOf(source.sourceType)
    if (hintedIndex >= 0) return hintedIndex
    return 10 + (source.sourceType === 'article' ? 0 : source.sourceType === 'record' ? 1 : 2)
  }
  return results
    .sort((left, right) => Math.abs(right.relevanceScore - left.relevanceScore) > 0.0001
      ? right.relevanceScore - left.relevanceScore
      : priority(left) - priority(right))
    .slice(0, resultCount)
}

const READ_PAGE_SIZE = 7000

export async function searchKnowledgeWithWiki(
  query: string, options: KnowledgeSearchOptions = {},
  agent?: { signal?: AbortSignal },
): Promise<KnowledgeSearchResults> {
  const isCurrent = captureWikiWorkspaceGuard()
  const search = () => searchCurrentKnowledge(query, options, isCurrent, agent)
  const result = search().catch(error => {
    if (!isCurrent() || !(error instanceof Error) || error.message !== 'WIKI_SELECTION_CHANGED') throw error
    return search()
  })
  return agent ? waitForKnowledgeArticleScan(result, agent.signal) : result
}

async function searchCurrentKnowledge(query: string, options: KnowledgeSearchOptions, isCurrent: () => boolean, agent?: { signal?: AbortSignal }): Promise<KnowledgeSearchResults> {
  const [{ getWikiSettings, isWikiSourceSelected }, { getWikiContext, captureWikiSelectionGuard, assertWikiContextCurrent }, { searchWiki },
    { listWikiOriginalSearchSources }] = await Promise.all([
    import('@/lib/wiki/settings'), import('@/lib/wiki/context'), import('@/lib/wiki/search'), import('@/db/wiki'),
  ])
  const checkSelection = captureWikiSelectionGuard()
  const context = await getWikiContext()
  const assertCurrent = async () => {
    agent?.signal?.throwIfAborted()
    if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    checkSelection()
    if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  const settings = await getWikiSettings(context.id)
  await assertCurrent()
  const store = await Store.load('store.json')
  const limit = options.limit ?? await store.get<number>('ragResultCount') ?? 5
  const hinted = options.sourceTypes?.length ? options.sourceTypes : inferSourceHints(query)
  const dateRange = options.dateRange ?? inferDateRange(query) ?? undefined
  const wikiOptions = { ...options, limit, dateRange,
    ...(hinted.length && isOnlySourceRequest(query) ? { sourceTypes: hinted, sourceMode: 'only' as const } : {}) }
  let inventory: AgentArticleInventory = {}
  if (agent && query.trim() && !options.tagId && sourceShares(query, wikiOptions).article
    && (await getKnowledgeSettings()).enabledSourceTypes.includes('article')) {
    inventory = await prepareAgentArticleSearch(context.id, settings, agent.signal)
    await assertCurrent()
  }
  const wiki = settings.enabled ? await searchWiki(query, wikiOptions) : []
  await assertCurrent()
  const scopedSources = settings.enabled && !settings.semanticSearchEnabled
    ? await listWikiOriginalSearchSources(context.id) : null
  const uncompiled = new Map(inventory.originals?.map(ref => [ref.sourceKey, ref]))
  if (inventory.originals && scopedSources) {
    for (const ref of inventory.originals) scopedSources.set(ref.sourceKey, ref)
    inventory.files = Array.from(scopedSources.values()).flatMap(ref => {
      const path = ref.locator.filePath
      return ref.sourceType === 'article' && path ? [{ path, relativePath: path, name: ref.title }] : []
    })
  }
  const original = await searchOriginalKnowledge(query, { ...options, limit, dateRange,
    sourceFilter: scopedSources ? source => {
      const wikiSource = scopedSources.get(source.sourceKey)
      return Boolean(wikiSource && isWikiSourceSelected(wikiSource, settings) && (!options.sourceFilter || options.sourceFilter(source)))
    } : options.sourceFilter }, assertCurrent, scopedSources, inventory.files, uncompiled)
  await assertCurrent()
  const results = new Map<string, KnowledgeSearchCandidate>()
  for (const hit of wiki) {
    for (const source of hit.sourceRefs) {
      const current = results.get(source.sourceKey)
      results.set(source.sourceKey, {
        sourceKey: source.sourceKey, sourceType: source.sourceType, stableId: source.stableId,
        sourceId: source.sourceKey.slice(source.sourceKey.indexOf(':') + 1), title: source.title,
        locator: source.locator, updatedAt: source.updatedAt ?? 0,
        relevanceScore: Math.max(current?.relevanceScore ?? 0, hit.score),
        fragments: current?.fragments ?? [],
        wikiPageIds: [...new Set([...(current?.wikiPageIds ?? []), hit.page.id])], evidenceKind: 'wiki',
      })
    }
  }
  for (const hit of original) {
    const compiled = results.get(hit.sourceKey)
    const previous = hit.sourceType === 'record' && hit.stableId !== compiled?.stableId ? undefined : compiled
    results.set(hit.sourceKey, previous ? { ...hit, updatedAt: previous.updatedAt || hit.updatedAt,
      relevanceScore: Math.max(previous.relevanceScore, hit.relevanceScore),
      fragments: [...previous.fragments, ...hit.fragments].slice(0, 3),
      wikiPageIds: previous.wikiPageIds, evidenceKind: 'wiki' } : { ...hit, evidenceKind: 'source' })
  }
  const scope = { sourceTypes: wikiOptions.sourceTypes, sourceMode: wikiOptions.sourceMode,
    folderPath: wikiOptions.folderPath, tagId: wikiOptions.tagId, dateRange, sourceFilter: wikiOptions.sourceFilter }
  const sources = [...results.values()].sort((left, right) => right.relevanceScore - left.relevanceScore).slice(0, limit)
  const originalKeys = new Set(original.map(hit => hit.sourceKey))
  const sourceGrants: Record<string, KnowledgeOriginalGrant> = {}
  for (const source of sources) {
    const stableId = source.sourceType === 'record' ? source.stableId : source.sourceKey
    if (stableId) sourceGrants[source.sourceKey] = { stableId, contextId: context.id, scope,
      wikiScoped: Boolean(scopedSources) || !originalKeys.has(source.sourceKey),
      ...(uncompiled.has(source.sourceKey) && originalKeys.has(source.sourceKey) ? { uncompiledArticle: true } : {}) }
  }
  return {
    sourceGrants, sources,
    wikiPages: wiki.map(hit => ({
      contextId: context.id,
      pageId: hit.page.id, title: hit.page.title, excerpt: hit.content.slice(0, 2400),
      relevanceScore: hit.score, updatedAt: hit.page.updatedAt,
      sourceRefs: hit.sourceRefs.map(source => ({ sourceKey: source.sourceKey,
        stableId: source.stableId, contentHash: source.contentHash })),
      scope,
    })),
  }
}

/** Preserve source-oriented callers while keeping each Wiki preview only once. */
export async function searchKnowledge(query: string, options: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchCandidate[]> {
  const results = await searchKnowledgeWithWiki(query, options)
  const pages = new Map(results.wikiPages.map(page => [page.pageId, page]))
  const previewed = new Set<string>()
  return results.sources.map(source => {
    const previews: KnowledgeSearchFragment[] = []
    for (const pageId of source.wikiPageIds ?? []) {
      if (previews.length >= 3) break
      const page = pages.get(pageId)
      if (!page || previewed.has(pageId)) continue
      previewed.add(pageId)
      previews.push({ content: `[Wiki: ${page.title}]\n${page.excerpt}` })
    }
    return { ...source, fragments: [...previews, ...source.fragments].slice(0, 3) }
  })
}

async function originalReadAllowed(document: KnowledgeSourceDocument, grants: KnowledgeOriginalGrant[], contextId: string) {
  const stableId = document.sourceType === 'record' ? document.stableId : document.sourceKey
  const matching = grants.filter(grant => grant.contextId === contextId && grant.stableId === stableId
    && (!grant.contentHash || grant.contentHash === document.contentHash)
    && matchesKnowledgeSearchScope(document, grant.scope))
  if (!matching.length) return false
  const [{ getWikiSettings, isWikiSourceSelected }, knowledge, store] = await Promise.all([
    import('@/lib/wiki/settings'), getKnowledgeSettings(), Store.load('store.json'),
  ])
  if (!isKnowledgeSourceEnabled(document, knowledge)) return false
  if (document.sourceType === 'article') {
    const path = document.locator.filePath || document.sourceId
    const excludedPaths = await store.get<string[]>('ragExcludedPaths') ?? DEFAULT_EXCLUDED_RAG_PATHS
    const excludedFiles = await store.get<string[]>('vectorExcludedFiles') ?? []
    if (excludedFiles.includes(path) || !isPathAllowedForRag(path, { excludedPaths })) return false
  }
  const settings = await getWikiSettings(contextId)
  if ((!settings.enabled || settings.semanticSearchEnabled) && matching.some(grant => !grant.wikiScoped)) return true
  if (!settings.enabled || !stableId) return false
  const [{ getWikiSourceState }, { getWikiSourceDocument, getWikiSourcePolicy }] = await Promise.all([
    import('@/db/wiki'), import('@/lib/wiki/sources'),
  ])
  const [state, original, policy] = await Promise.all([
    getWikiSourceState(contextId, stableId), getWikiSourceDocument(document.sourceKey), getWikiSourcePolicy(contextId, settings),
  ])
  const readableState = state ? !['deleted', 'excluded', 'unavailable'].includes(state.status)
    : document.sourceType === 'article' && matching.some(grant => grant.uncompiledArticle)
  return Boolean(readableState
    && original && original.source.stableId === stableId && policy.allows(original.source, original.derived)
    && isWikiSourceSelected(original.source, settings))
}

export async function readKnowledgeSourcePage(
  sourceKey: string, cursor?: string, grants?: KnowledgeOriginalGrant[],
): Promise<KnowledgeReadPage | null> {
  const { assertWikiContextCurrent, captureWikiSelectionGuard, captureWikiWorkspaceGuard, getWikiContext } = await import('@/lib/wiki/context')
  const selectionIsCurrent = grants ? captureWikiSelectionGuard() : undefined
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  const source = await getKnowledgeSource(sourceKey)
  if (grants && !grants.some(grant => grant.contextId === context.id)) return null
  if (!source && !(sourceKey.startsWith('article:') && grants?.some(grant =>
    grant.contextId === context.id && grant.stableId === sourceKey))) return null
  const document = await getKnowledgeSourceDocument(sourceKey)
  if (!document || (grants && !await originalReadAllowed(document, grants, context.id))) return null
  await assertWikiContextCurrent(context.id)
  if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  selectionIsCurrent?.()
  if (document.sourceType !== 'article') {
    const chunkOffset = Math.max(0, Number.parseInt(cursor?.replace(/^chunk:/, '') || '0', 10) || 0)
    const pageChunks: string[] = []
    let nextChunk = chunkOffset
    let size = 0
    while (nextChunk < document.chunks.length) {
      const chunk = document.chunks[nextChunk].content
      if (pageChunks.length > 0 && size + chunk.length > READ_PAGE_SIZE) break
      pageChunks.push(chunk)
      size += chunk.length
      nextChunk += 1
    }
    const nextCursor = nextChunk < document.chunks.length ? `chunk:${nextChunk}` : undefined
    return {
      sourceKey, stableId: document.stableId ?? sourceKey, contentHash: document.contentHash,
      sourceType: document.sourceType,
      title: source?.title ?? document.title,
      content: pageChunks.join('\n\n---\n\n'),
      cursor: `chunk:${chunkOffset}`,
      nextCursor,
      complete: !nextCursor,
      updatedAt: document.updatedAt,
      locator: document.locator,
    }
  }

  const offset = Math.max(0, Number.parseInt(cursor || '0', 10) || 0)
  const end = Math.min(document.content.length, offset + READ_PAGE_SIZE)
  const nextCursor = end < document.content.length ? String(end) : undefined
  return {
    sourceKey, stableId: document.stableId ?? sourceKey, contentHash: document.contentHash,
    sourceType: document.sourceType,
    title: source?.title ?? document.title,
    content: document.content.slice(offset, end),
    cursor: String(offset),
    nextCursor,
    complete: !nextCursor,
    updatedAt: document.updatedAt,
    locator: document.locator,
  }
}
