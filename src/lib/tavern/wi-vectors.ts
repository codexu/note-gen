/**
 * World Info 向量索引服务
 * 为 World Info 条目提供向量化索引和语义搜索功能
 */

import { TavernWorldInfoEntry, getWorldInfoEntries, updateWorldInfoEntry } from '@/db/tavern'
import { fetchEmbedding } from '@/lib/ai/embedding'
import { checkEmbeddingModelAvailable } from '@/lib/rag'
import { extractKeywordsSimple } from './vectors-service'

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  if (normA === 0 || normB === 0) return 0
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 生成嵌入向量
 */
async function generateEmbedding(text: string): Promise<number[] | null> {
  return fetchEmbedding(text)
}

// ============ 类型定义 ============

/**
 * 向量化的 World Info 条目
 */
export interface VectorizedWIEntry {
  entryId: number
  worldInfoId: number
  content: string
  keys: string[]
  embedding: number[]
  lastUpdated: number
}

/**
 * World Info 搜索结果
 */
export interface WISearchResult {
  entry: TavernWorldInfoEntry
  score: number
  matchType: 'semantic' | 'keyword' | 'both'
}

/**
 * 索引状态
 */
export interface WIIndexState {
  worldInfoId: number
  totalEntries: number
  vectorizedCount: number
  lastIndexed: number
}

// ============ 存储管理 ============

// 内存中的向量索引缓存
const vectorCache = new Map<number, VectorizedWIEntry>()

// 索引状态
const indexStates = new Map<number, WIIndexState>()

/**
 * 获取缓存键
 */
function getCacheKey(entryId: number): number {
  return entryId
}

/**
 * 从缓存获取向量
 */
export function getCachedVector(entryId: number): VectorizedWIEntry | undefined {
  return vectorCache.get(getCacheKey(entryId))
}

/**
 * 设置缓存向量
 */
export function setCachedVector(entry: VectorizedWIEntry): void {
  vectorCache.set(getCacheKey(entry.entryId), entry)
}

/**
 * 清除条目缓存
 */
export function clearCachedVector(entryId: number): void {
  vectorCache.delete(getCacheKey(entryId))
}

/**
 * 清除世界书的所有缓存
 */
export function clearWorldInfoCache(worldInfoId: number): void {
  for (const [key, entry] of vectorCache.entries()) {
    if (entry.worldInfoId === worldInfoId) {
      vectorCache.delete(key)
    }
  }
  indexStates.delete(worldInfoId)
}

// ============ 向量化功能 ============

/**
 * 生成条目的搜索文本
 * 结合关键词和内容，提高向量质量
 */
function buildEntryText(entry: TavernWorldInfoEntry): string {
  const parts: string[] = []
  
  // 解析关键词
  try {
    const keys = JSON.parse(entry.keys) as string[]
    if (keys.length > 0) {
      parts.push(`Keywords: ${keys.join(', ')}`)
    }
  } catch {
    // 如果不是 JSON，直接使用
    if (entry.keys.trim()) {
      parts.push(`Keywords: ${entry.keys}`)
    }
  }
  
  // 添加次要关键词
  try {
    const secondaryKeys = JSON.parse(entry.secondaryKeys) as string[]
    if (secondaryKeys.length > 0) {
      parts.push(`Related: ${secondaryKeys.join(', ')}`)
    }
  } catch {
    if (entry.secondaryKeys?.trim()) {
      parts.push(`Related: ${entry.secondaryKeys}`)
    }
  }
  
  // 添加备注 (如果有)
  if (entry.comment?.trim()) {
    parts.push(`Note: ${entry.comment}`)
  }
  
  // 添加内容
  if (entry.content?.trim()) {
    parts.push(entry.content)
  }
  
  return parts.join('\n')
}

/**
 * 向量化单个条目
 */
export async function vectorizeEntry(entry: TavernWorldInfoEntry): Promise<VectorizedWIEntry | null> {
  try {
    // 检查嵌入模型可用性
    const available = await checkEmbeddingModelAvailable()
    if (!available) {
      console.warn('[WI-Vectors] 嵌入模型不可用')
      return null
    }
    
    const text = buildEntryText(entry)
    if (!text.trim()) {
      console.warn('[WI-Vectors] 条目内容为空:', entry.id)
      return null
    }
    
    // 生成嵌入向量
    const embedding = await generateEmbedding(text)
    if (!embedding || embedding.length === 0) {
      console.warn('[WI-Vectors] 生成嵌入失败:', entry.id)
      return null
    }
    
    // 解析关键词
    let keys: string[] = []
    try {
      keys = JSON.parse(entry.keys) as string[]
    } catch {
      keys = entry.keys ? [entry.keys] : []
    }
    
    const vectorized: VectorizedWIEntry = {
      entryId: entry.id,
      worldInfoId: entry.worldInfoId,
      content: entry.content,
      keys,
      embedding,
      lastUpdated: Date.now(),
    }
    
    // 缓存结果
    setCachedVector(vectorized)
    
    // 更新数据库标记
    await updateWorldInfoEntry(entry.id, { vectorized: true })
    
    return vectorized
  } catch (error) {
    console.error('[WI-Vectors] 向量化条目失败:', entry.id, error)
    return null
  }
}

/**
 * 批量向量化条目
 */
export async function vectorizeEntries(
  entries: TavernWorldInfoEntry[],
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    
    // 跳过已缓存的
    if (getCachedVector(entry.id)) {
      success++
      onProgress?.(i + 1, entries.length)
      continue
    }
    
    const result = await vectorizeEntry(entry)
    if (result) {
      success++
    } else {
      failed++
    }
    
    onProgress?.(i + 1, entries.length)
  }
  
  return { success, failed }
}

/**
 * 索引整个世界书
 */
export async function indexWorldInfo(
  worldInfoId: number,
  onProgress?: (current: number, total: number) => void
): Promise<WIIndexState> {
  const entries = await getWorldInfoEntries(worldInfoId)
  const enabledEntries = entries.filter(e => e.enabled)
  
  const { success, failed } = await vectorizeEntries(enabledEntries, onProgress)
  
  const state: WIIndexState = {
    worldInfoId,
    totalEntries: entries.length,
    vectorizedCount: success,
    lastIndexed: Date.now(),
  }
  
  indexStates.set(worldInfoId, state)
  
  console.log(`[WI-Vectors] 世界书 ${worldInfoId} 索引完成: ${success} 成功, ${failed} 失败`)
  
  return state
}

/**
 * 获取索引状态
 */
export function getIndexState(worldInfoId: number): WIIndexState | undefined {
  return indexStates.get(worldInfoId)
}

// ============ 搜索功能 ============

/**
 * 关键词匹配搜索
 */
function keywordSearch(
  query: string,
  entries: TavernWorldInfoEntry[],
  caseSensitive: boolean = false
): Map<number, number> {
  const scores = new Map<number, number>()
  const keywords = extractKeywordsSimple(query)
  
  const normalizedQuery = caseSensitive ? query : query.toLowerCase()
  
  for (const entry of entries) {
    let score = 0
    
    // 解析关键词
    let keys: string[] = []
    try {
      keys = JSON.parse(entry.keys) as string[]
    } catch {
      keys = entry.keys ? [entry.keys] : []
    }
    
    // 检查关键词匹配
    for (const key of keys) {
      const normalizedKey = caseSensitive ? key : key.toLowerCase()
      if (normalizedQuery.includes(normalizedKey)) {
        score += 1.0  // 完全匹配关键词
      } else {
        // 检查部分匹配
        for (const kw of keywords) {
          if (normalizedKey.includes(kw.text)) {
            score += 0.5 * kw.weight
          }
        }
      }
    }
    
    if (score > 0) {
      scores.set(entry.id, Math.min(score, 1.0))  // 归一化到 0-1
    }
  }
  
  return scores
}

/**
 * 语义搜索
 */
async function semanticSearch(
  query: string,
  entries: TavernWorldInfoEntry[],
  threshold: number = 0.5
): Promise<Map<number, number>> {
  const scores = new Map<number, number>()
  
  try {
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(query)
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return scores
    }
    
    for (const entry of entries) {
      const cached = getCachedVector(entry.id)
      if (!cached?.embedding) continue
      
      // 计算余弦相似度
      const similarity = cosineSimilarity(queryEmbedding, cached.embedding)
      
      if (similarity >= threshold) {
        scores.set(entry.id, similarity)
      }
    }
  } catch (error) {
    console.error('[WI-Vectors] 语义搜索失败:', error)
  }
  
  return scores
}

/**
 * 混合搜索 (关键词 + 语义)
 */
export async function searchWorldInfo(
  query: string,
  entries: TavernWorldInfoEntry[],
  options: {
    useKeyword?: boolean
    useSemantic?: boolean
    keywordWeight?: number
    semanticWeight?: number
    threshold?: number
    maxResults?: number
    caseSensitive?: boolean
  } = {}
): Promise<WISearchResult[]> {
  const {
    useKeyword = true,
    useSemantic = true,
    keywordWeight = 0.4,
    semanticWeight = 0.6,
    threshold = 0.3,
    maxResults = 10,
    caseSensitive = false,
  } = options
  
  const enabledEntries = entries.filter(e => e.enabled)
  const entryMap = new Map(enabledEntries.map(e => [e.id, e]))
  
  // 收集分数
  const keywordScores = useKeyword 
    ? keywordSearch(query, enabledEntries, caseSensitive) 
    : new Map<number, number>()
    
  const semanticScores = useSemantic 
    ? await semanticSearch(query, enabledEntries, threshold)
    : new Map<number, number>()
  
  // 合并分数
  const combinedScores = new Map<number, { score: number; matchType: 'semantic' | 'keyword' | 'both' }>()
  
  // 处理关键词分数
  for (const [entryId, score] of keywordScores) {
    combinedScores.set(entryId, {
      score: score * keywordWeight,
      matchType: 'keyword',
    })
  }
  
  // 处理语义分数
  for (const [entryId, score] of semanticScores) {
    const existing = combinedScores.get(entryId)
    if (existing) {
      existing.score += score * semanticWeight
      existing.matchType = 'both'
    } else {
      combinedScores.set(entryId, {
        score: score * semanticWeight,
        matchType: 'semantic',
      })
    }
  }
  
  // 转换为结果数组并排序
  const results: WISearchResult[] = []
  
  for (const [entryId, { score, matchType }] of combinedScores) {
    const entry = entryMap.get(entryId)
    if (entry && score >= threshold) {
      results.push({ entry, score, matchType })
    }
  }
  
  // 按分数降序排序
  results.sort((a, b) => b.score - a.score)
  
  return results.slice(0, maxResults)
}

/**
 * 基于聊天上下文搜索相关 World Info
 */
export async function searchWorldInfoForContext(
  messages: string[],
  entries: TavernWorldInfoEntry[],
  options: {
    maxDepth?: number
    threshold?: number
    maxResults?: number
  } = {}
): Promise<WISearchResult[]> {
  const {
    maxDepth = 5,
    threshold = 0.4,
    maxResults = 5,
  } = options
  
  // 取最近的消息构建查询
  const recentMessages = messages.slice(-maxDepth)
  const query = recentMessages.join('\n')
  
  return searchWorldInfo(query, entries, {
    threshold,
    maxResults,
    useSemantic: true,
    useKeyword: true,
  })
}

// ============ 工具函数 ============

/**
 * 检查条目是否需要重新向量化
 */
export function needsReVectorize(entry: TavernWorldInfoEntry): boolean {
  const cached = getCachedVector(entry.id)
  if (!cached) return true
  
  // 如果内容改变了，需要重新向量化
  return cached.content !== entry.content
}

/**
 * 获取世界书的向量化进度
 */
export async function getVectorizeProgress(worldInfoId: number): Promise<{
  total: number
  vectorized: number
  percentage: number
}> {
  const entries = await getWorldInfoEntries(worldInfoId)
  let vectorized = 0
  
  for (const entry of entries) {
    if (getCachedVector(entry.id) || entry.vectorized) {
      vectorized++
    }
  }
  
  return {
    total: entries.length,
    vectorized,
    percentage: entries.length > 0 ? Math.round(vectorized / entries.length * 100) : 0,
  }
}

/**
 * 导出向量索引 (用于持久化)
 */
export function exportVectorIndex(worldInfoId: number): VectorizedWIEntry[] {
  const entries: VectorizedWIEntry[] = []
  
  for (const entry of vectorCache.values()) {
    if (entry.worldInfoId === worldInfoId) {
      entries.push(entry)
    }
  }
  
  return entries
}

/**
 * 导入向量索引
 */
export function importVectorIndex(entries: VectorizedWIEntry[]): void {
  for (const entry of entries) {
    setCachedVector(entry)
  }
}
