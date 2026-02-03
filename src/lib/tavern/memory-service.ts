/**
 * Memory/Summary 服务
 * 负责生成对话摘要和管理长期记忆
 * 实现类似 SillyTavern 的记忆系统
 */

import { TavernMessage } from '@/db/tavern'
import { useTavernMemoryStore, MemoryConfig, PromptBuilders } from '@/stores/tavern-memory'
import { AIMessage } from './context-builder-v2'
import { streamTavernResponse, checkAIServiceAvailable } from './ai-service'

// ============================================================================
// Types
// ============================================================================

/**
 * 摘要生成上下文
 */
export interface SummaryContext {
  chatId: number
  groupId?: number
  characterId?: number
}

/**
 * Raw 摘要提示词结果
 */
export interface RawSummaryPrompt {
  rawPrompt: string
  lastUsedIndex: number
  wordCount: number
}

/**
 * 生成回调
 */
export interface GenerationCallbacks {
  onStart?: () => void
  onProgress?: (content: string) => void
  onComplete?: (summary: string) => void
  onError?: (error: Error) => void
  onLock?: () => void
  onUnlock?: () => void
}

// ============================================================================
// Utility Functions
// ============================================================================

// 估算 token 数 (简单估算: 中文约 1.5 字符/token, 英文约 4 字符/token)
export function estimateTokens(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 提取文本中的所有单词
 */
export function extractAllWords(text: string): string[] {
  // 中文字符
  const chineseWords = text.match(/[\u4e00-\u9fff]/g) || []
  // 英文单词
  const englishWords = text.match(/[a-zA-Z]+/g) || []
  return [...chineseWords, ...englishWords]
}

/**
 * 计算文本字数
 */
export function countWords(text: string): number {
  return extractAllWords(text).length
}

// 格式化消息为对话文本
export function formatMessagesForSummary(
  messages: TavernMessage[],
  includeNames: boolean = true
): string {
  return messages
    .filter(m => !m.isHidden)
    .map(m => {
      if (includeNames) {
        return `${m.name}: ${m.content}`
      }
      return m.content
    })
    .join('\n\n')
}

/**
 * 获取 Raw 摘要提示词
 * 收集要摘要的消息并返回原始提示词
 */
export async function getRawSummaryPrompt(
  messages: TavernMessage[],
  config: MemoryConfig,
  startIndex: number,
  endIndex: number
): Promise<RawSummaryPrompt> {
  const delimiter = '\n\n'
  const chatBuffer: string[] = []
  let lastUsedIndex = -1
  let totalWords = 0
  
  // 从 endIndex 开始向前收集消息
  for (let i = endIndex; i >= startIndex; i--) {
    const message = messages[i]
    if (!message || message.isHidden) continue
    
    const content = config.includeNames 
      ? `${message.name}: ${message.content}`
      : message.content
    
    const messageWords = countWords(content)
    
    // 检查消息数限制
    if (config.maxMessagesPerRequest > 0 && chatBuffer.length >= config.maxMessagesPerRequest) {
      break
    }
    
    chatBuffer.unshift(content)
    totalWords += messageWords
    lastUsedIndex = i
  }
  
  return {
    rawPrompt: chatBuffer.join(delimiter),
    lastUsedIndex,
    wordCount: totalWords,
  }
}

/**
 * 获取记忆字符串 (用于 WI 扫描)
 */
export function getMemoryString(chatId: number, includePrompt: boolean = false): string {
  const store = useTavernMemoryStore.getState()
  const summary = store.getCombinedSummary(chatId)
  
  if (!summary) return ''
  
  if (includePrompt) {
    const config = store.getEffectiveConfig()
    return `${config.summaryPrompt}\n\n${summary}`
  }
  
  return summary
}

// 构建摘要提示词
export function buildSummaryPrompt(
  config: MemoryConfig,
  conversation: string
): string {
  return config.summaryPrompt
    .replace('{{conversation}}', conversation)
    .replace('{{maxTokens}}', config.summaryMaxTokens.toString())
    .replace('{{words}}', config.promptWords.toString())
}

// 生成摘要的 AI 消息
export function buildSummaryMessages(
  config: MemoryConfig,
  conversation: string
): AIMessage[] {
  const prompt = buildSummaryPrompt(config, conversation)
  
  return [
    {
      role: 'system',
      content: '你是一个专业的对话摘要助手。请根据用户的要求生成简洁准确的摘要。',
    },
    {
      role: 'user',
      content: prompt,
    },
  ]
}

// 摘要生成结果
export interface SummaryResult {
  success: boolean
  summary?: string
  tokenCount?: number
  wordCount?: number
  lastUsedIndex?: number
  error?: string
}

// 生成摘要 (使用后端系统)
export async function generateSummary(
  messages: TavernMessage[],
  config: MemoryConfig,
  startIndex: number,
  endIndex: number,
  callbacks?: GenerationCallbacks
): Promise<SummaryResult> {
  const { onStart, onProgress, onComplete, onError, onLock, onUnlock } = callbacks || {}
  
  try {
    // 检查冻结状态
    if (config.memoryFrozen) {
      return { success: false, error: '记忆已冻结' }
    }
    
    // 获取要摘要的消息
    const messagesToSummarize = messages.slice(startIndex, endIndex + 1)
    if (messagesToSummarize.length === 0) {
      return { success: false, error: '没有需要摘要的消息' }
    }
    
    // 根据生成模式处理
    const isBlocking = config.promptBuilder === PromptBuilders.RAW_BLOCKING
    const isRawMode = config.promptBuilder === PromptBuilders.RAW_BLOCKING || 
                      config.promptBuilder === PromptBuilders.RAW_NON_BLOCKING
    
    // 阻塞模式锁定
    if (isBlocking) {
      onLock?.()
    }
    
    onStart?.()
    
    let conversation: string
    let lastUsedIndex = endIndex
    let wordCount = 0
    
    if (isRawMode) {
      // Raw 模式: 使用 getRawSummaryPrompt
      const rawPromptResult = await getRawSummaryPrompt(messages, config, startIndex, endIndex)
      conversation = rawPromptResult.rawPrompt
      lastUsedIndex = rawPromptResult.lastUsedIndex
      wordCount = rawPromptResult.wordCount
    } else {
      // 默认模式: 直接格式化消息
      conversation = formatMessagesForSummary(messagesToSummarize, config.includeNames)
      wordCount = countWords(conversation)
    }
    
    // 构建 AI 消息
    const aiMessages = buildSummaryMessages(config, conversation)
    
    // 检查 AI 服务是否可用
    const isAvailable = await checkAIServiceAvailable()
    if (!isAvailable) {
      if (isBlocking) onUnlock?.()
      return { success: false, error: 'AI 服务不可用' }
    }
    
    // 生成摘要
    let summaryContent = ''
    
    await streamTavernResponse(
      aiMessages,
      (content: string) => {
        summaryContent = content
        onProgress?.(content)
      },
      undefined,
      {
        temperature: 0.3, // 低温度以获得更一致的摘要
        maxTokens: config.summaryMaxTokens,
      }
    )
    
    // 解锁
    if (isBlocking) {
      onUnlock?.()
    }
    
    if (!summaryContent) {
      return { success: false, error: '摘要生成失败' }
    }
    
    onComplete?.(summaryContent)
    
    // 估算 token 数
    const tokenCount = estimateTokens(summaryContent)
    
    return {
      success: true,
      summary: summaryContent,
      tokenCount,
      wordCount,
      lastUsedIndex,
    }
  } catch (error) {
    console.error('生成摘要失败:', error)
    onError?.(error instanceof Error ? error : new Error(String(error)))
    return {
      success: false,
      error: error instanceof Error ? error.message : '未知错误',
    }
  }
}

// 自动摘要检查和执行
export async function autoSummarizeIfNeeded(
  chatId: number,
  messages: TavernMessage[],
  cardId?: number,
  callbacks?: GenerationCallbacks
): Promise<SummaryResult | null> {
  const store = useTavernMemoryStore.getState()
  const config = store.getEffectiveConfig(cardId)
  
  if (!config.enabled || config.memoryFrozen) return null
  
  const memory = store.getChatMemory(chatId)
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  
  // 计算自上次摘要以来的字数
  let wordsSinceLastSummary = 0
  for (let i = messages.length - 1; i > memory.lastSummarizedIndex; i--) {
    if (messages[i] && !messages[i].isHidden) {
      wordsSinceLastSummary += countWords(messages[i].content)
    }
  }
  
  // 检查是否需要摘要
  if (!store.shouldSummarize(chatId, messages.length, totalTokens, wordsSinceLastSummary)) {
    return null
  }
  
  // 计算要摘要的消息范围
  const startIndex = memory.lastSummarizedIndex + 1
  const endIndex = messages.length - 1 - config.preserveLastN
  
  if (endIndex <= startIndex) {
    return null // 没有足够的消息需要摘要
  }
  
  console.log(`[Memory] 开始生成摘要，消息范围: ${startIndex}-${endIndex}, 字数: ${wordsSinceLastSummary}`)
  
  // 生成摘要
  const result = await generateSummary(
    messages,
    config,
    startIndex,
    endIndex,
    callbacks
  )
  
  if (result.success && result.summary) {
    // 保存摘要
    store.addSummary(chatId, {
      content: result.summary,
      messageRange: { start: startIndex, end: result.lastUsedIndex || endIndex },
      tokenCount: result.tokenCount || 0,
      isManual: false,
    })
  }
  
  return result
}

/**
 * 强制生成摘要 (忽略触发条件)
 */
export async function forceSummarize(
  chatId: number,
  messages: TavernMessage[],
  cardId?: number,
  callbacks?: GenerationCallbacks
): Promise<SummaryResult | null> {
  const store = useTavernMemoryStore.getState()
  const config = store.getEffectiveConfig(cardId)
  
  if (!config.enabled) return null
  
  const memory = store.getChatMemory(chatId)
  
  // 计算要摘要的消息范围
  const startIndex = memory.lastSummarizedIndex + 1
  const endIndex = messages.length - 1 - config.preserveLastN
  
  if (endIndex <= startIndex) {
    return { success: false, error: '没有足够的消息需要摘要' }
  }
  
  console.log(`[Memory] 强制生成摘要，消息范围: ${startIndex}-${endIndex}`)
  
  // 生成摘要
  const result = await generateSummary(
    messages,
    config,
    startIndex,
    endIndex,
    callbacks
  )
  
  if (result.success && result.summary) {
    // 保存摘要
    store.addSummary(chatId, {
      content: result.summary,
      messageRange: { start: startIndex, end: result.lastUsedIndex || endIndex },
      tokenCount: result.tokenCount || 0,
      isManual: false,
    })
  }
  
  return result
}

// 将摘要注入到上下文中
export function injectSummaryToContext(
  messages: AIMessage[],
  chatId: number,
  config: MemoryConfig
): AIMessage[] {
  const store = useTavernMemoryStore.getState()
  const summary = store.getCombinedSummary(chatId)
  
  if (!summary) return messages
  
  const summaryMessage: AIMessage = {
    role: 'system',
    content: summary,
  }
  
  const result = [...messages]
  
  switch (config.insertPosition) {
    case 'before_system':
      result.unshift(summaryMessage)
      break
      
    case 'after_system':
      // 找到第一个非 system 消息的位置
      const firstNonSystemIndex = result.findIndex(m => m.role !== 'system')
      if (firstNonSystemIndex > 0) {
        result.splice(firstNonSystemIndex, 0, summaryMessage)
      } else {
        result.push(summaryMessage)
      }
      break
      
    case 'before_examples':
      // 找到 examples 开始的位置 (通常是 user/assistant 交替开始的地方)
      const exampleIndex = result.findIndex((m, i) => 
        i > 0 && m.role === 'user' && result[i - 1].role === 'system'
      )
      if (exampleIndex > 0) {
        result.splice(exampleIndex, 0, summaryMessage)
      } else {
        result.push(summaryMessage)
      }
      break
      
    case 'in_chat':
      // 从底部算起插入到指定深度
      const insertIndex = Math.max(0, result.length - config.insertDepth)
      result.splice(insertIndex, 0, summaryMessage)
      break
  }
  
  return result
}
