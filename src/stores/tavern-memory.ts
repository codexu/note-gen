import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 摘要条目
export interface MemorySummary {
  id: string
  content: string           // 摘要内容
  messageRange: {           // 覆盖的消息范围
    start: number           // 起始消息索引
    end: number             // 结束消息索引
  }
  tokenCount: number        // 摘要的 token 数
  createdAt: number         // 创建时间
  isManual: boolean         // 是否手动编辑
}

// 聊天记忆数据
export interface ChatMemory {
  summaries: MemorySummary[]  // 摘要列表
  lastSummarizedIndex: number // 最后摘要的消息索引
  totalTokensSaved: number    // 节省的 token 数
}

// 生成模式枚举
export const PromptBuilders = {
  DEFAULT: 0,         // 默认模式，使用安静提示词
  RAW_BLOCKING: 1,    // 原始阻塞模式，禁用发送按钮
  RAW_NON_BLOCKING: 2 // 原始非阻塞模式，后台生成
} as const

export type PromptBuilder = typeof PromptBuilders[keyof typeof PromptBuilders]

// 记忆配置
export interface MemoryConfig {
  enabled: boolean
  
  // 触发设置
  triggerThreshold: number    // 触发阈值 (消息数)
  triggerTokens: number       // 触发阈值 (token 数)
  
  // 摘要设置
  summaryMaxTokens: number    // 摘要最大 token 数
  summaryPrompt: string       // 摘要提示词
  summaryTemplate: string     // 摘要模板
  promptWords: number         // 摘要目标字数
  promptForceWords: number    // 强制摘要字数阈值 (0=禁用)
  
  // 生成模式
  promptBuilder: PromptBuilder // 生成模式
  
  // 上下文设置
  insertPosition: 'before_system' | 'after_system' | 'before_examples' | 'in_chat'
  insertDepth: number         // 插入深度 (in_chat 模式)
  
  // 高级设置
  preserveLastN: number       // 保留最近 N 条消息不摘要
  includeNames: boolean       // 摘要中包含角色名
  separateSummaries: boolean  // 分段摘要 vs 合并摘要
  
  // WI 扫描整合
  scan: boolean               // 将摘要内容纳入世界书扫描
  skipWIAN: boolean           // 跳过作者注释世界书
  
  // 其他设置
  maxMessagesPerRequest: number // 每次摘要最大消息数 (0=不限制)
  memoryFrozen: boolean       // 冻结记忆 (不自动更新)
}

interface TavernMemoryState {
  // 全局配置
  config: MemoryConfig
  
  // 聊天记忆 (chatId -> ChatMemory)
  chatMemories: Record<number, ChatMemory>
  
  // 角色特定配置覆盖 (cardId -> Partial<MemoryConfig>)
  cardOverrides: Record<number, Partial<MemoryConfig>>
  
  // 获取有效配置
  getEffectiveConfig: (cardId?: number) => MemoryConfig
  
  // 更新全局配置
  updateConfig: (updates: Partial<MemoryConfig>) => void
  
  // 更新角色配置覆盖
  updateCardOverride: (cardId: number, updates: Partial<MemoryConfig>) => void
  clearCardOverride: (cardId: number) => void
  
  // 获取聊天记忆
  getChatMemory: (chatId: number) => ChatMemory
  
  // 添加摘要
  addSummary: (chatId: number, summary: Omit<MemorySummary, 'id' | 'createdAt'>) => void
  
  // 更新摘要
  updateSummary: (chatId: number, summaryId: string, content: string) => void
  
  // 删除摘要
  deleteSummary: (chatId: number, summaryId: string) => void
  
  // 清除聊天记忆
  clearChatMemory: (chatId: number) => void
  
  // 获取合并后的摘要文本
  getCombinedSummary: (chatId: number) => string
  
  // 检查是否需要生成摘要
  shouldSummarize: (chatId: number, messageCount: number, tokenCount: number, wordCount?: number) => boolean
  
  // 更新最后摘要索引
  updateLastSummarizedIndex: (chatId: number, index: number) => void
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 默认配置
const DEFAULT_CONFIG: MemoryConfig = {
  enabled: false,
  triggerThreshold: 20,
  triggerTokens: 2000,
  summaryMaxTokens: 500,
  summaryPrompt: `请为以下对话生成一个简洁的摘要，保留关键信息和重要细节：

{{conversation}}

摘要要求：
1. 保留重要的情节发展和角色互动
2. 记录关键的决定和事件
3. 保持角色的性格特点
4. 控制在 {{words}} 字以内`,
  summaryTemplate: '[摘要]\n{{summary}}\n[/摘要]',
  promptWords: 200,
  promptForceWords: 0,
  promptBuilder: PromptBuilders.DEFAULT,
  insertPosition: 'after_system',
  insertDepth: 4,
  preserveLastN: 10,
  includeNames: true,
  separateSummaries: false,
  scan: false,
  skipWIAN: false,
  maxMessagesPerRequest: 0,
  memoryFrozen: false,
}

// 默认聊天记忆
const DEFAULT_CHAT_MEMORY: ChatMemory = {
  summaries: [],
  lastSummarizedIndex: -1,
  totalTokensSaved: 0,
}

export const useTavernMemoryStore = create<TavernMemoryState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      chatMemories: {},
      cardOverrides: {},
      
      getEffectiveConfig: (cardId) => {
        const { config, cardOverrides } = get()
        if (cardId && cardOverrides[cardId]) {
          return { ...config, ...cardOverrides[cardId] }
        }
        return config
      },
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      updateCardOverride: (cardId, updates) => {
        set((state) => ({
          cardOverrides: {
            ...state.cardOverrides,
            [cardId]: {
              ...(state.cardOverrides[cardId] || {}),
              ...updates,
            },
          },
        }))
      },
      
      clearCardOverride: (cardId) => {
        set((state) => {
          const newOverrides = { ...state.cardOverrides }
          delete newOverrides[cardId]
          return { cardOverrides: newOverrides }
        })
      },
      
      getChatMemory: (chatId) => {
        const { chatMemories } = get()
        return chatMemories[chatId] || { ...DEFAULT_CHAT_MEMORY }
      },
      
      addSummary: (chatId, summary) => {
        const id = generateId()
        set((state) => {
          const memory = state.chatMemories[chatId] || { ...DEFAULT_CHAT_MEMORY }
          return {
            chatMemories: {
              ...state.chatMemories,
              [chatId]: {
                ...memory,
                summaries: [
                  ...memory.summaries,
                  {
                    ...summary,
                    id,
                    createdAt: Date.now(),
                  },
                ],
                lastSummarizedIndex: summary.messageRange.end,
                totalTokensSaved: memory.totalTokensSaved + summary.tokenCount,
              },
            },
          }
        })
      },
      
      updateSummary: (chatId, summaryId, content) => {
        set((state) => {
          const memory = state.chatMemories[chatId]
          if (!memory) return state
          
          return {
            chatMemories: {
              ...state.chatMemories,
              [chatId]: {
                ...memory,
                summaries: memory.summaries.map(s =>
                  s.id === summaryId
                    ? { ...s, content, isManual: true }
                    : s
                ),
              },
            },
          }
        })
      },
      
      deleteSummary: (chatId, summaryId) => {
        set((state) => {
          const memory = state.chatMemories[chatId]
          if (!memory) return state
          
          const summaryToDelete = memory.summaries.find(s => s.id === summaryId)
          
          return {
            chatMemories: {
              ...state.chatMemories,
              [chatId]: {
                ...memory,
                summaries: memory.summaries.filter(s => s.id !== summaryId),
                totalTokensSaved: memory.totalTokensSaved - (summaryToDelete?.tokenCount || 0),
              },
            },
          }
        })
      },
      
      clearChatMemory: (chatId) => {
        set((state) => {
          const newMemories = { ...state.chatMemories }
          delete newMemories[chatId]
          return { chatMemories: newMemories }
        })
      },
      
      getCombinedSummary: (chatId) => {
        const { chatMemories, config } = get()
        const memory = chatMemories[chatId]
        if (!memory || memory.summaries.length === 0) return ''
        
        if (config.separateSummaries) {
          // 分段摘要
          return memory.summaries
            .map(s => config.summaryTemplate.replace('{{summary}}', s.content))
            .join('\n\n')
        } else {
          // 合并摘要
          const combined = memory.summaries.map(s => s.content).join('\n\n')
          return config.summaryTemplate.replace('{{summary}}', combined)
        }
      },
      
      shouldSummarize: (chatId, messageCount, tokenCount, wordCount = 0) => {
        const { config, chatMemories } = get()
        if (!config.enabled || config.memoryFrozen) return false
        
        const memory = chatMemories[chatId] || DEFAULT_CHAT_MEMORY
        const unsummarizedCount = messageCount - memory.lastSummarizedIndex - 1 - config.preserveLastN
        
        // 检查消息数阈值
        if (unsummarizedCount >= config.triggerThreshold) {
          console.log(`[Memory] 消息数触发: ${unsummarizedCount} >= ${config.triggerThreshold}`)
          return true
        }
        
        // 检查 token 数阈值
        if (tokenCount >= config.triggerTokens) {
          console.log(`[Memory] Token 数触发: ${tokenCount} >= ${config.triggerTokens}`)
          return true
        }
        
        // 检查强制字数阈值
        if (config.promptForceWords > 0 && wordCount >= config.promptForceWords) {
          console.log(`[Memory] 字数触发: ${wordCount} >= ${config.promptForceWords}`)
          return true
        }
        
        return false
      },
      
      updateLastSummarizedIndex: (chatId, index) => {
        set((state) => {
          const memory = state.chatMemories[chatId] || { ...DEFAULT_CHAT_MEMORY }
          return {
            chatMemories: {
              ...state.chatMemories,
              [chatId]: {
                ...memory,
                lastSummarizedIndex: index,
              },
            },
          }
        })
      },
    }),
    {
      name: 'tavern-memory',
    }
  )
)
