/**
 * Tavern Vectors/RAG 服务
 * 复用 NoteGen 已有的 RAG 功能，为 Tavern 对话提供知识检索增强
 */

import { 
  useTavernVectorsStore, 
  VectorSearchResult, 
  VectorSource 
} from '@/stores/tavern-vectors'
import { 
  getContextForQuery, 
  Keyword,
  checkEmbeddingModelAvailable 
} from '@/lib/rag'
import { 
  TavernWorldInfoEntry,
  getWorldInfoEntries,
  getWorldInfos,
} from '@/db/tavern'
import {
  searchWorldInfo as wiVectorSearch,
  WISearchResult,
} from './wi-vectors'
import {
  searchChat as chatVectorSearch,
  ChatSearchResult,
} from './chat-vectors'

/**
 * 从文本中提取关键词 (简单模式)
 */
export function extractKeywordsSimple(text: string): Keyword[] {
  // 移除标点符号，分词
  const cleanText = text
    .replace(/[，。！？、；：""''（）【】《》\[\]{}.,!?;:"'()\-]/g, ' ')
    .toLowerCase()
  
  const words = cleanText.split(/\s+/).filter(w => w.length > 1)
  
  // 统计词频
  const wordCount: Record<string, number> = {}
  words.forEach(word => {
    wordCount[word] = (wordCount[word] || 0) + 1
  })
  
  // 过滤停用词
  const stopWords = new Set([
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '们',
    '这', '那', '有', '和', '与', '或', '但', '如果', '因为',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'can', 'to', 'of',
    'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below',
    'between', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
    'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
    'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    'just', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
    'while', 'although', 'though', 'even', 'also', 'still',
  ])
  
  // 转换为关键词数组，按词频排序
  const keywords: Keyword[] = Object.entries(wordCount)
    .filter(([word]) => !stopWords.has(word))
    .map(([text, count]) => ({
      text,
      weight: Math.min(count / words.length * 10, 1), // 归一化权重
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10) // 最多取10个关键词
  
  return keywords
}

/**
 * 从笔记中搜索相关内容
 */
async function searchNotes(keywords: Keyword[]): Promise<VectorSearchResult[]> {
  try {
    const { context, sources } = await getContextForQuery(keywords)
    
    if (!context) return []
    
    // 解析上下文为结果数组
    const results: VectorSearchResult[] = []
    const sections = context.split('\n---\n\n')
    
    sections.forEach((section, index) => {
      const filenameMatch = section.match(/文件：(.+)\n/)
      if (filenameMatch) {
        const filename = filenameMatch[1]
        const content = section.replace(/文件：.+\n/, '').trim()
        
        results.push({
          id: `notes-${index}-${Date.now()}`,
          source: 'notes',
          filename,
          content,
          score: 1 - (index * 0.1), // 简单的分数递减
        })
      }
    })
    
    return results
  } catch (error) {
    console.error('[Vectors] 搜索笔记失败:', error)
    return []
  }
}

/**
 * 从 World Info 中搜索相关内容
 * 支持语义搜索和关键词匹配
 */
async function searchWorldInfoEntries(
  query: string,
  cardId?: number,
  threshold: number = 0.4
): Promise<VectorSearchResult[]> {
  try {
    // 获取所有启用的世界书
    const worldInfos = await getWorldInfos()
    const enabledWorldInfos = worldInfos.filter(wi => wi.enabled)
    
    // 如果指定了角色，也获取角色绑定的世界书
    if (cardId) {
      const characterWorldInfos = await getWorldInfos('character', cardId)
      const enabledCharacterWIs = characterWorldInfos.filter(wi => wi.enabled)
      enabledWorldInfos.push(...enabledCharacterWIs)
    }
    
    if (enabledWorldInfos.length === 0) return []
    
    // 收集所有条目
    const allEntries: TavernWorldInfoEntry[] = []
    for (const wi of enabledWorldInfos) {
      const entries = await getWorldInfoEntries(wi.id)
      allEntries.push(...entries)
    }
    
    if (allEntries.length === 0) return []
    
    // 使用 wi-vectors 进行搜索
    const searchResults = await wiVectorSearch(query, allEntries, {
      threshold,
      maxResults: 10,
      useSemantic: true,
      useKeyword: true,
    })
    
    // 转换为 VectorSearchResult 格式
    return searchResults.map((result: WISearchResult) => {
      // 解析关键词作为标题
      let title = ''
      try {
        const keys = JSON.parse(result.entry.keys) as string[]
        title = keys.slice(0, 3).join(', ')
      } catch {
        title = result.entry.keys || 'World Info Entry'
      }
      
      return {
        id: `wi-${result.entry.id}`,
        source: 'worldInfo' as const,
        filename: title,  // 使用 title 作为 filename
        content: result.entry.content,
        score: result.score,
        metadata: {
          entryId: result.entry.id,
          worldInfoId: result.entry.worldInfoId,
          matchType: result.matchType,
        },
      }
    })
  } catch (error) {
    console.error('[Vectors] World Info 搜索失败:', error)
    return []
  }
}

/**
 * 从聊天历史中搜索相关内容
 */
async function searchChatHistoryEntries(
  query: string,
  chatId: number,
  threshold: number = 0.4
): Promise<VectorSearchResult[]> {
  try {
    // 使用 chat-vectors 进行搜索
    const searchResults = await chatVectorSearch(query, chatId, {
      threshold,
      maxResults: 10,
      useSemantic: true,
      useKeyword: true,
      includeContext: false,
    })
    
    // 转换为 VectorSearchResult 格式
    return searchResults.map((result: ChatSearchResult) => {
      // 截取内容作为摘要
      const title = `${result.message.name} (${new Date(result.message.sendDate || result.message.createdAt).toLocaleDateString()})`
      
      return {
        id: `chat-${result.message.id}`,
        source: 'chatHistory' as const,
        filename: title,  // 使用 title 作为 filename
        content: result.message.content,
        score: result.score,
        metadata: {
          messageId: result.message.id,
          chatId: result.message.chatId,
          role: result.message.role,
          name: result.message.name,
          matchType: result.matchType,
        },
      }
    })
  } catch (error) {
    console.error('[Vectors] 聊天历史搜索失败:', error)
    return []
  }
}

/**
 * 搜索上下文
 */
export interface VectorSearchContext {
  chatId?: number
  cardId?: number
}

/**
 * 执行向量搜索
 */
export async function performVectorSearch(
  query: string,
  sources?: VectorSource[],
  context?: VectorSearchContext
): Promise<VectorSearchResult[]> {
  const store = useTavernVectorsStore.getState()
  const { config } = store
  
  if (!config.enabled) return []
  
  const enabledSources = sources || config.sources
  if (enabledSources.length === 0) return []
  
  store.setSearching(true)
  store.setLastQuery(query)
  
  try {
    // 提取关键词 (用于笔记搜索)
    const keywords = extractKeywordsSimple(query)
    
    const allResults: VectorSearchResult[] = []
    
    // 从各个来源搜索
    for (const source of enabledSources) {
      let sourceResults: VectorSearchResult[] = []
      
      switch (source) {
        case 'notes':
          if (keywords.length > 0) {
            sourceResults = await searchNotes(keywords)
          }
          break
        case 'worldInfo':
          sourceResults = await searchWorldInfoEntries(
            query, 
            context?.cardId, 
            config.similarityThreshold
          )
          break
        case 'chatHistory':
          if (context?.chatId) {
            sourceResults = await searchChatHistoryEntries(
              query,
              context.chatId,
              config.similarityThreshold
            )
          }
          break
        case 'custom':
          // TODO: 实现自定义文档搜索
          break
      }
      
      allResults.push(...sourceResults)
    }
    
    // 按分数排序并限制数量
    const sortedResults = allResults
      .filter(r => r.score >= config.similarityThreshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.maxResults)
    
    store.setSearchResults(sortedResults)
    store.setSearching(false)
    
    return sortedResults
  } catch (error) {
    console.error('[Vectors] 搜索失败:', error)
    store.setSearching(false)
    return []
  }
}

/**
 * 为聊天消息自动搜索相关上下文
 */
export async function searchForChatMessage(
  chatId: number,
  message: string,
  cardId?: number
): Promise<string> {
  const store = useTavernVectorsStore.getState()
  const { config } = store
  
  if (!config.enabled || !config.autoSearch) return ''
  
  const results = await performVectorSearch(message, undefined, { chatId, cardId })
  
  if (results.length > 0) {
    // 缓存搜索结果
    store.setChatContext(chatId, {
      results,
      query: message,
      timestamp: Date.now(),
    })
    
    return store.buildContextString(results)
  }
  
  return ''
}

/**
 * 检查向量功能是否可用
 */
export async function checkVectorsAvailable(): Promise<{
  available: boolean
  reason?: string
}> {
  try {
    const hasEmbedding = await checkEmbeddingModelAvailable()
    
    if (!hasEmbedding) {
      return {
        available: false,
        reason: '未配置嵌入模型，请在 AI 设置中配置嵌入模型',
      }
    }
    
    return { available: true }
  } catch (error) {
    return {
      available: false,
      reason: `检查失败: ${error}`,
    }
  }
}

/**
 * 获取向量上下文注入位置的深度
 */
export function getVectorInjectionDepth(): number {
  const { config } = useTavernVectorsStore.getState()
  return config.injectDepth
}

/**
 * 获取向量上下文注入位置
 */
export function getVectorInjectionPosition(): string {
  const { config } = useTavernVectorsStore.getState()
  return config.injectPosition
}
