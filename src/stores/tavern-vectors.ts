import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 向量搜索来源
export type VectorSource = 'notes' | 'worldInfo' | 'chatHistory' | 'custom'

// 向量配置
export interface VectorsConfig {
  enabled: boolean
  
  // 搜索设置
  sources: VectorSource[]
  maxResults: number
  similarityThreshold: number
  
  // 上下文注入设置
  injectPosition: 'before_scenario' | 'after_scenario' | 'in_chat'
  injectDepth: number
  contextTemplate: string
  
  // 自动搜索设置
  autoSearch: boolean
  autoSearchTrigger: 'always' | 'keywords' | 'manual'
  keywordExtraction: 'simple' | 'ai'
  
  // 分块设置 (用于自定义文档)
  chunkSize: number
  chunkOverlap: number
}

// 搜索结果
export interface VectorSearchResult {
  id: string
  source: VectorSource
  filename: string
  content: string
  score: number
  metadata?: Record<string, unknown>
}

// 聊天向量上下文
export interface ChatVectorContext {
  chatId: number
  results: VectorSearchResult[]
  query: string
  timestamp: number
}

interface TavernVectorsState {
  // 配置
  config: VectorsConfig
  
  // 当前搜索结果
  currentResults: VectorSearchResult[]
  
  // 聊天向量上下文缓存
  chatContexts: Record<number, ChatVectorContext>
  
  // 搜索状态
  isSearching: boolean
  lastQuery: string
  
  // 配置管理
  updateConfig: (updates: Partial<VectorsConfig>) => void
  
  // 搜索管理
  setSearchResults: (results: VectorSearchResult[]) => void
  clearSearchResults: () => void
  setSearching: (isSearching: boolean) => void
  setLastQuery: (query: string) => void
  
  // 聊天上下文管理
  setChatContext: (chatId: number, context: Omit<ChatVectorContext, 'chatId'>) => void
  getChatContext: (chatId: number) => ChatVectorContext | null
  clearChatContext: (chatId: number) => void
  
  // 辅助方法
  getEnabledSources: () => VectorSource[]
  buildContextString: (results?: VectorSearchResult[]) => string
}

// 默认配置
const DEFAULT_CONFIG: VectorsConfig = {
  enabled: false,
  sources: ['notes'],
  maxResults: 5,
  similarityThreshold: 0.7,
  injectPosition: 'after_scenario',
  injectDepth: 4,
  contextTemplate: `[相关知识]
{{#each results}}
来源: {{source}} - {{filename}}
{{content}}
---
{{/each}}`,
  autoSearch: true,
  autoSearchTrigger: 'always',
  keywordExtraction: 'simple',
  chunkSize: 1000,
  chunkOverlap: 200,
}

export const useTavernVectorsStore = create<TavernVectorsState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      currentResults: [],
      chatContexts: {},
      isSearching: false,
      lastQuery: '',
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      setSearchResults: (results) => {
        set({ currentResults: results })
      },
      
      clearSearchResults: () => {
        set({ currentResults: [], lastQuery: '' })
      },
      
      setSearching: (isSearching) => {
        set({ isSearching })
      },
      
      setLastQuery: (query) => {
        set({ lastQuery: query })
      },
      
      setChatContext: (chatId, context) => {
        set((state) => ({
          chatContexts: {
            ...state.chatContexts,
            [chatId]: { ...context, chatId },
          },
        }))
      },
      
      getChatContext: (chatId) => {
        return get().chatContexts[chatId] || null
      },
      
      clearChatContext: (chatId) => {
        set((state) => {
          const newContexts = { ...state.chatContexts }
          delete newContexts[chatId]
          return { chatContexts: newContexts }
        })
      },
      
      getEnabledSources: () => {
        const { config } = get()
        return config.enabled ? config.sources : []
      },
      
      buildContextString: (results) => {
        const { config, currentResults } = get()
        const resultsToUse = results || currentResults
        
        if (resultsToUse.length === 0) return ''
        
        // 简单模板替换
        let context = config.contextTemplate
        
        // 处理 {{#each results}} ... {{/each}} 块
        const eachMatch = context.match(/\{\{#each results\}\}([\s\S]*?)\{\{\/each\}\}/)
        if (eachMatch) {
          const template = eachMatch[1]
          const items = resultsToUse.map(result => {
            let item = template
            item = item.replace(/\{\{source\}\}/g, result.source)
            item = item.replace(/\{\{filename\}\}/g, result.filename)
            item = item.replace(/\{\{content\}\}/g, result.content)
            item = item.replace(/\{\{score\}\}/g, result.score.toFixed(2))
            return item
          }).join('')
          context = context.replace(eachMatch[0], items)
        }
        
        return context.trim()
      },
    }),
    {
      name: 'tavern-vectors',
      partialize: (state) => ({
        config: state.config,
      }),
    }
  )
)
