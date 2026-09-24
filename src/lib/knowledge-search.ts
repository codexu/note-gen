import { Store } from '@tauri-apps/plugin-store'
import { getKnowledgeSource, getKnowledgeSources } from '@/db/knowledge'
import { getSimilarDocuments } from '@/db/vector'
import { fetchEmbedding, rerankDocuments } from '@/lib/ai'
import { getBM25Index, parseBM25ChunkKey } from '@/lib/bm25'
import { getKnowledgeSourceDocument } from '@/lib/knowledge-content'
import { getKnowledgeSettings, isKnowledgeSourceEnabled } from '@/lib/knowledge-settings'
import {
  isKnowledgeSourceType,
  type KnowledgeReadPage,
  type KnowledgeSearchCandidate,
  type KnowledgeSearchFragment,
  type KnowledgeSource,
  type KnowledgeSourceType,
} from '@/types/knowledge'

export interface KnowledgeSearchOptions {
  mode?: 'rag' | 'keyword'
  sourceTypes?: KnowledgeSourceType[]
  sourceMode?: 'prefer' | 'only'
  folderPath?: string
  tagId?: number
  limit?: number
}

interface ChunkCandidate {
  sourceKey: string
  chunkId: number
  content: string
  score: number
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

function matchesScope(source: KnowledgeSource, options: KnowledgeSearchOptions) {
  if (options.folderPath && source.sourceType === 'article') {
    const path = source.locator.filePath || source.sourceId
    const folder = options.folderPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
    if (!(path === folder || path.startsWith(`${folder}/`))) return false
  }
  if (typeof options.tagId === 'number' && options.tagId > 0 && source.sourceType === 'record' &&
    source.locator.tagId !== options.tagId && !source.locator.tagIds?.includes(options.tagId)) {
    return false
  }
  return true
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

async function resolveFragment(sourceKey: string, chunkId: number, content: string): Promise<KnowledgeSearchFragment> {
  const document = await getKnowledgeSourceDocument(sourceKey)
  return {
    content,
    nodeId: document?.chunks[chunkId]?.nodeId,
  }
}

export async function searchKnowledge(
  query: string,
  options: KnowledgeSearchOptions = {}
): Promise<KnowledgeSearchCandidate[]> {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []
  const store = await Store.load('store.json')
  const resultCount = options.limit ?? await store.get<number>('ragResultCount') ?? 5
  const similarityThreshold = await store.get<number>('ragSimilarityThreshold') ?? 0.25
  const settings = await getKnowledgeSettings()
  const shares = sourceShares(normalizedQuery, options)
  const allowedTypes = Object.keys(shares).filter(isKnowledgeSourceType)
  const dateRange = inferDateRange(normalizedQuery)
  const sources = (await getKnowledgeSources({ sourceTypes: allowedTypes, statuses: ['ready', 'failed'] }))
    .filter(source => (
      isKnowledgeSourceEnabled(source, settings)
      && matchesScope(source, options)
      && (!dateRange || (source.updatedAt >= dateRange.start && source.updatedAt < dateRange.end))
    ))
  const sourceByKey = new Map(sources.map(source => [source.sourceKey, source]))
  const lexicalKeys = new Set(sources.map(source => source.sourceKey))
  const readyVectorKeys = new Set(sources
    .filter(source => source.status === 'ready' && source.indexedHash === source.contentHash)
    .map(source => source.sourceKey))
  const candidatePoolSize = Math.max(resultCount * 8, 40)
  const candidates = new Map<string, ChunkCandidate>()
  const addCandidate = (candidate: ChunkCandidate) => {
    const key = `${candidate.sourceKey}:${candidate.chunkId}`
    const current = candidates.get(key)
    if (!current || candidate.score > current.score) candidates.set(key, candidate)
  }

  if (options.mode !== 'keyword') {
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

  const bm25 = getBM25Index()
  if (bm25) {
    bm25.search(normalizedQuery, candidatePoolSize).forEach(result => {
      const parsed = parseBM25ChunkKey(result.id)
      if (!parsed || !lexicalKeys.has(parsed.filename)) return
      const content = bm25.getDocument(result.id)
      if (!content) return
      addCandidate({
        sourceKey: parsed.filename,
        chunkId: parsed.chunkId,
        content,
        score: Math.min(1, result.score / Math.max(1, result.score + 5)),
      })
    })
  }

  for (const source of sources) {
    if (candidates.size >= candidatePoolSize * 2) break
    const document = await getKnowledgeSourceDocument(source.sourceKey)
    if (!document) continue
    document.chunks.forEach((chunk, chunkId) => {
      const score = lexicalScore(chunk.content, normalizedQuery)
      if (score > 0) addCandidate({ sourceKey: source.sourceKey, chunkId, content: chunk.content, score })
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
  const reranked = await rerankDocuments(
    normalizedQuery,
    sourceCandidates.map((candidate, id) => ({
      id,
      filename: candidate.sourceKey,
      content: candidate.content,
      similarity: candidate.score,
    })),
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
    const fragments = await Promise.all(candidate.fragments.map(fragment => (
      resolveFragment(source.sourceKey, fragment.chunkId, fragment.content)
    )))
    results.push({
      sourceKey: source.sourceKey,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
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

export async function readKnowledgeSourcePage(sourceKey: string, cursor?: string): Promise<KnowledgeReadPage | null> {
  const source = await getKnowledgeSource(sourceKey)
  const document = await getKnowledgeSourceDocument(sourceKey)
  if (!source || !document) return null
  if (source.sourceType !== 'article') {
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
      sourceKey,
      sourceType: source.sourceType,
      title: source.title,
      content: pageChunks.join('\n\n---\n\n'),
      cursor: `chunk:${chunkOffset}`,
      nextCursor,
      complete: !nextCursor,
      updatedAt: source.updatedAt,
      locator: source.locator,
    }
  }

  const offset = Math.max(0, Number.parseInt(cursor || '0', 10) || 0)
  const end = Math.min(document.content.length, offset + READ_PAGE_SIZE)
  const nextCursor = end < document.content.length ? String(end) : undefined
  return {
    sourceKey,
    sourceType: source.sourceType,
    title: source.title,
    content: document.content.slice(offset, end),
    cursor: String(offset),
    nextCursor,
    complete: !nextCursor,
    updatedAt: source.updatedAt,
    locator: source.locator,
  }
}
