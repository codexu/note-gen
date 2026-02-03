/**
 * 聊天历史向量索引服务
 * 为聊天消息提供向量化索引和语义搜索功能
 * 支持跨会话搜索相关对话内容
 */

import { TavernMessage, getMessagesByChatId } from '@/db/tavern'
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
 * 向量化的消息
 */
export interface VectorizedMessage {
  messageId: number
  chatId: number
  role: 'user' | 'assistant' | 'system'
  name: string
  content: string
  embedding: number[]
  timestamp: number
  lastUpdated: number
}

/**
 * 消息搜索结果
 */
export interface ChatSearchResult {
  message: TavernMessage
  score: number
  matchType: 'semantic' | 'keyword' | 'both'
  contextBefore?: TavernMessage[]
  contextAfter?: TavernMessage[]
}

/**
 * 聊天索引状态
 */
export interface ChatIndexState {
  chatId: number
  totalMessages: number
  vectorizedCount: number
  lastIndexed: number
}

/**
 * 搜索选项
 */
export interface ChatSearchOptions {
  useKeyword?: boolean
  useSemantic?: boolean
  keywordWeight?: number
  semanticWeight?: number
  threshold?: number
  maxResults?: number
  includeContext?: boolean  // 是否包含上下文消息
  contextSize?: number      // 上下文消息数量
  roleFilter?: ('user' | 'assistant' | 'system')[]  // 筛选角色
}

// ============ 存储管理 ============

// 内存中的向量索引缓存
const vectorCache = new Map<number, VectorizedMessage>()

// 按聊天分组的消息索引
const chatMessageIndex = new Map<number, Set<number>>()

// 索引状态
const indexStates = new Map<number, ChatIndexState>()

/**
 * 从缓存获取向量
 */
export function getCachedVector(messageId: number): VectorizedMessage | undefined {
  return vectorCache.get(messageId)
}

/**
 * 设置缓存向量
 */
export function setCachedVector(entry: VectorizedMessage): void {
  vectorCache.set(entry.messageId, entry)
  
  // 更新聊天索引
  if (!chatMessageIndex.has(entry.chatId)) {
    chatMessageIndex.set(entry.chatId, new Set())
  }
  chatMessageIndex.get(entry.chatId)!.add(entry.messageId)
}

/**
 * 清除消息缓存
 */
export function clearCachedVector(messageId: number): void {
  const cached = vectorCache.get(messageId)
  if (cached) {
    vectorCache.delete(messageId)
    chatMessageIndex.get(cached.chatId)?.delete(messageId)
  }
}

/**
 * 清除聊天的所有缓存
 */
export function clearChatCache(chatId: number): void {
  const messageIds = chatMessageIndex.get(chatId)
  if (messageIds) {
    for (const id of messageIds) {
      vectorCache.delete(id)
    }
    chatMessageIndex.delete(chatId)
  }
  indexStates.delete(chatId)
}

/**
 * 获取聊天中已缓存的消息数量
 */
export function getCachedMessageCount(chatId: number): number {
  return chatMessageIndex.get(chatId)?.size || 0
}

// ============ 向量化功能 ============

/**
 * 判断消息是否值得向量化
 * 过滤掉太短或无意义的消息
 */
function shouldVectorize(message: TavernMessage): boolean {
  // 跳过隐藏消息
  if (message.isHidden) return false
  
  // 内容长度检查 (至少10个字符)
  const content = message.content?.trim() || ''
  if (content.length < 10) return false
  
  // 跳过纯系统指令类消息
  if (message.role === 'system') {
    // 只保留有实质内容的系统消息
    const keywords = ['[', ']', '{{', '}}']
    let bracketCount = 0
    for (const kw of keywords) {
      if (content.includes(kw)) bracketCount++
    }
    // 如果大部分是指令格式，跳过
    if (bracketCount >= 3) return false
  }
  
  return true
}

/**
 * 构建消息的索引文本
 */
function buildMessageText(message: TavernMessage): string {
  const parts: string[] = []
  
  // 添加角色/名称前缀
  if (message.name) {
    parts.push(`[${message.name}]:`)
  }
  
  // 添加消息内容
  parts.push(message.content)
  
  return parts.join(' ')
}

/**
 * 向量化单条消息
 */
export async function vectorizeMessage(message: TavernMessage): Promise<VectorizedMessage | null> {
  try {
    // 检查是否值得向量化
    if (!shouldVectorize(message)) {
      return null
    }
    
    // 检查嵌入模型可用性
    const available = await checkEmbeddingModelAvailable()
    if (!available) {
      console.warn('[Chat-Vectors] 嵌入模型不可用')
      return null
    }
    
    const text = buildMessageText(message)
    if (!text.trim()) {
      return null
    }
    
    // 生成嵌入向量
    const embedding = await generateEmbedding(text)
    if (!embedding || embedding.length === 0) {
      console.warn('[Chat-Vectors] 生成嵌入失败:', message.id)
      return null
    }
    
    const vectorized: VectorizedMessage = {
      messageId: message.id,
      chatId: message.chatId,
      role: message.role,
      name: message.name,
      content: message.content,
      embedding,
      timestamp: message.sendDate || message.createdAt,
      lastUpdated: Date.now(),
    }
    
    // 缓存结果
    setCachedVector(vectorized)
    
    return vectorized
  } catch (error) {
    console.error('[Chat-Vectors] 向量化消息失败:', message.id, error)
    return null
  }
}

/**
 * 批量向量化消息
 */
export async function vectorizeMessages(
  messages: TavernMessage[],
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; skipped: number; failed: number }> {
  let success = 0
  let skipped = 0
  let failed = 0
  
  const toProcess = messages.filter(shouldVectorize)
  const total = toProcess.length
  
  for (let i = 0; i < toProcess.length; i++) {
    const message = toProcess[i]
    
    // 跳过已缓存的
    if (getCachedVector(message.id)) {
      success++
      onProgress?.(i + 1, total)
      continue
    }
    
    const result = await vectorizeMessage(message)
    if (result) {
      success++
    } else {
      failed++
    }
    
    onProgress?.(i + 1, total)
  }
  
  skipped = messages.length - toProcess.length
  
  return { success, skipped, failed }
}

/**
 * 索引整个聊天会话
 */
export async function indexChat(
  chatId: number,
  onProgress?: (current: number, total: number) => void
): Promise<ChatIndexState> {
  const messages = await getMessagesByChatId(chatId)
  
  const { success, skipped, failed } = await vectorizeMessages(messages, onProgress)
  
  const state: ChatIndexState = {
    chatId,
    totalMessages: messages.length,
    vectorizedCount: success,
    lastIndexed: Date.now(),
  }
  
  indexStates.set(chatId, state)
  
  console.log(`[Chat-Vectors] 聊天 ${chatId} 索引完成: ${success} 成功, ${skipped} 跳过, ${failed} 失败`)
  
  return state
}

/**
 * 增量索引新消息
 */
export async function indexNewMessage(message: TavernMessage): Promise<boolean> {
  const result = await vectorizeMessage(message)
  if (result) {
    // 更新索引状态
    const state = indexStates.get(message.chatId)
    if (state) {
      state.vectorizedCount++
      state.totalMessages++
      state.lastIndexed = Date.now()
    }
    return true
  }
  return false
}

/**
 * 获取索引状态
 */
export function getIndexState(chatId: number): ChatIndexState | undefined {
  return indexStates.get(chatId)
}

// ============ 搜索功能 ============

/**
 * 关键词搜索
 */
function keywordSearch(
  query: string,
  messages: TavernMessage[]
): Map<number, number> {
  const scores = new Map<number, number>()
  const keywords = extractKeywordsSimple(query)
  const queryLower = query.toLowerCase()
  
  for (const message of messages) {
    if (!shouldVectorize(message)) continue
    
    let score = 0
    const contentLower = message.content.toLowerCase()
    
    // 完整查询匹配
    if (contentLower.includes(queryLower)) {
      score += 0.8
    }
    
    // 关键词匹配
    for (const kw of keywords) {
      if (contentLower.includes(kw.text)) {
        score += 0.2 * kw.weight
      }
    }
    
    // 名称匹配
    if (message.name && message.name.toLowerCase().includes(queryLower)) {
      score += 0.3
    }
    
    if (score > 0) {
      scores.set(message.id, Math.min(score, 1.0))
    }
  }
  
  return scores
}

/**
 * 语义搜索
 */
async function semanticSearch(
  query: string,
  messages: TavernMessage[],
  threshold: number = 0.5
): Promise<Map<number, number>> {
  const scores = new Map<number, number>()
  
  try {
    // 生成查询向量
    const queryEmbedding = await generateEmbedding(query)
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return scores
    }
    
    for (const message of messages) {
      const cached = getCachedVector(message.id)
      if (!cached?.embedding) continue
      
      // 计算余弦相似度
      const similarity = cosineSimilarity(queryEmbedding, cached.embedding)
      
      if (similarity >= threshold) {
        scores.set(message.id, similarity)
      }
    }
  } catch (error) {
    console.error('[Chat-Vectors] 语义搜索失败:', error)
  }
  
  return scores
}

/**
 * 获取消息上下文
 */
function getMessageContext(
  message: TavernMessage,
  allMessages: TavernMessage[],
  contextSize: number = 2
): { before: TavernMessage[]; after: TavernMessage[] } {
  const index = allMessages.findIndex(m => m.id === message.id)
  if (index === -1) return { before: [], after: [] }
  
  const before = allMessages.slice(Math.max(0, index - contextSize), index)
  const after = allMessages.slice(index + 1, index + 1 + contextSize)
  
  return { before, after }
}

/**
 * 搜索聊天历史
 */
export async function searchChat(
  query: string,
  chatId: number,
  options: ChatSearchOptions = {}
): Promise<ChatSearchResult[]> {
  const {
    useKeyword = true,
    useSemantic = true,
    keywordWeight = 0.3,
    semanticWeight = 0.7,
    threshold = 0.4,
    maxResults = 10,
    includeContext = false,
    contextSize = 2,
    roleFilter,
  } = options
  
  // 获取消息
  let messages = await getMessagesByChatId(chatId)
  
  // 应用角色过滤
  if (roleFilter && roleFilter.length > 0) {
    messages = messages.filter(m => roleFilter.includes(m.role))
  }
  
  const messageMap = new Map(messages.map(m => [m.id, m]))
  
  // 收集分数
  const keywordScores = useKeyword
    ? keywordSearch(query, messages)
    : new Map<number, number>()
    
  const semanticScores = useSemantic
    ? await semanticSearch(query, messages, threshold)
    : new Map<number, number>()
  
  // 合并分数
  const combinedScores = new Map<number, { score: number; matchType: 'semantic' | 'keyword' | 'both' }>()
  
  for (const [messageId, score] of keywordScores) {
    combinedScores.set(messageId, {
      score: score * keywordWeight,
      matchType: 'keyword',
    })
  }
  
  for (const [messageId, score] of semanticScores) {
    const existing = combinedScores.get(messageId)
    if (existing) {
      existing.score += score * semanticWeight
      existing.matchType = 'both'
    } else {
      combinedScores.set(messageId, {
        score: score * semanticWeight,
        matchType: 'semantic',
      })
    }
  }
  
  // 转换为结果数组
  const results: ChatSearchResult[] = []
  
  for (const [messageId, { score, matchType }] of combinedScores) {
    const message = messageMap.get(messageId)
    if (message && score >= threshold) {
      const result: ChatSearchResult = { message, score, matchType }
      
      // 添加上下文
      if (includeContext) {
        const { before, after } = getMessageContext(message, messages, contextSize)
        result.contextBefore = before
        result.contextAfter = after
      }
      
      results.push(result)
    }
  }
  
  // 按分数降序排序
  results.sort((a, b) => b.score - a.score)
  
  return results.slice(0, maxResults)
}

/**
 * 跨会话搜索
 */
export async function searchAcrossChats(
  query: string,
  chatIds: number[],
  options: ChatSearchOptions = {}
): Promise<Map<number, ChatSearchResult[]>> {
  const results = new Map<number, ChatSearchResult[]>()
  
  for (const chatId of chatIds) {
    const chatResults = await searchChat(query, chatId, options)
    if (chatResults.length > 0) {
      results.set(chatId, chatResults)
    }
  }
  
  return results
}

/**
 * 查找相似消息
 * 用于检测重复或相似的对话
 */
export async function findSimilarMessages(
  message: TavernMessage,
  chatId: number,
  threshold: number = 0.8
): Promise<ChatSearchResult[]> {
  // 先向量化目标消息
  let targetVector = getCachedVector(message.id)
  if (!targetVector) {
    const vectorized = await vectorizeMessage(message)
    if (!vectorized) return []
    targetVector = vectorized
  }
  
  const messages = await getMessagesByChatId(chatId)
  const results: ChatSearchResult[] = []
  
  for (const msg of messages) {
    if (msg.id === message.id) continue  // 跳过自身
    
    const cached = getCachedVector(msg.id)
    if (!cached?.embedding) continue
    
    const similarity = cosineSimilarity(targetVector.embedding, cached.embedding)
    
    if (similarity >= threshold) {
      results.push({
        message: msg,
        score: similarity,
        matchType: 'semantic',
      })
    }
  }
  
  results.sort((a, b) => b.score - a.score)
  
  return results
}

// ============ 工具函数 ============

/**
 * 获取聊天的向量化进度
 */
export async function getVectorizeProgress(chatId: number): Promise<{
  total: number
  vectorized: number
  percentage: number
}> {
  const messages = await getMessagesByChatId(chatId)
  const processable = messages.filter(shouldVectorize)
  let vectorized = 0
  
  for (const message of processable) {
    if (getCachedVector(message.id)) {
      vectorized++
    }
  }
  
  return {
    total: processable.length,
    vectorized,
    percentage: processable.length > 0 ? Math.round(vectorized / processable.length * 100) : 0,
  }
}

/**
 * 导出向量索引
 */
export function exportChatVectorIndex(chatId: number): VectorizedMessage[] {
  const messageIds = chatMessageIndex.get(chatId)
  if (!messageIds) return []
  
  const entries: VectorizedMessage[] = []
  for (const id of messageIds) {
    const cached = vectorCache.get(id)
    if (cached) {
      entries.push(cached)
    }
  }
  
  return entries
}

/**
 * 导入向量索引
 */
export function importChatVectorIndex(entries: VectorizedMessage[]): void {
  for (const entry of entries) {
    setCachedVector(entry)
  }
}

/**
 * 获取最近的相关消息摘要
 * 用于上下文构建
 */
export async function getRelevantMessagesSummary(
  query: string,
  chatId: number,
  maxTokens: number = 500
): Promise<string> {
  const results = await searchChat(query, chatId, {
    maxResults: 5,
    threshold: 0.4,
    includeContext: false,
  })
  
  if (results.length === 0) return ''
  
  const parts: string[] = ['[Relevant earlier messages:]']
  let currentTokens = 0
  const avgCharsPerToken = 4
  
  for (const result of results) {
    const line = `- ${result.message.name}: ${result.message.content.slice(0, 200)}...`
    const estimatedTokens = Math.ceil(line.length / avgCharsPerToken)
    
    if (currentTokens + estimatedTokens > maxTokens) break
    
    parts.push(line)
    currentTokens += estimatedTokens
  }
  
  return parts.join('\n')
}
