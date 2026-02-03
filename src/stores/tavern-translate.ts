import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 支持的语言
export const SUPPORTED_LANGUAGES = [
  { code: 'zh', name: '中文', nativeName: '中文' },
  { code: 'en', name: '英语', nativeName: 'English' },
  { code: 'ja', name: '日语', nativeName: '日本語' },
  { code: 'ko', name: '韩语', nativeName: '한국어' },
  { code: 'es', name: '西班牙语', nativeName: 'Español' },
  { code: 'fr', name: '法语', nativeName: 'Français' },
  { code: 'de', name: '德语', nativeName: 'Deutsch' },
  { code: 'ru', name: '俄语', nativeName: 'Русский' },
  { code: 'pt', name: '葡萄牙语', nativeName: 'Português' },
  { code: 'it', name: '意大利语', nativeName: 'Italiano' },
] as const

export type LanguageCode = typeof SUPPORTED_LANGUAGES[number]['code']

// 翻译模式
export type TranslateMode = 'off' | 'input' | 'output' | 'both'

// 翻译配置
export interface TranslateConfig {
  enabled: boolean
  mode: TranslateMode
  
  // 输入翻译 (用户消息 -> 目标语言)
  inputSourceLang: LanguageCode | 'auto'
  inputTargetLang: LanguageCode
  
  // 输出翻译 (AI 回复 -> 用户语言)
  outputSourceLang: LanguageCode | 'auto'
  outputTargetLang: LanguageCode
  
  // 显示设置
  showOriginal: boolean        // 显示原文
  showTranslation: boolean     // 显示翻译
  inlineDisplay: boolean       // 内联显示 vs 分开显示
  
  // 高级设置
  preserveFormatting: boolean  // 保留格式 (换行、标点等)
  preserveNames: boolean       // 保留角色名不翻译
  customPrompt: string         // 自定义翻译提示词
}

// 翻译缓存条目
export interface TranslationCacheEntry {
  original: string
  translated: string
  sourceLang: string
  targetLang: string
  timestamp: number
}

interface TavernTranslateState {
  // 全局配置
  config: TranslateConfig
  
  // 角色特定配置 (cardId -> config)
  cardConfigs: Record<number, Partial<TranslateConfig>>
  
  // 翻译缓存 (hash -> entry)
  cache: Record<string, TranslationCacheEntry>
  
  // 获取有效配置
  getEffectiveConfig: (cardId?: number) => TranslateConfig
  
  // 更新全局配置
  updateConfig: (updates: Partial<TranslateConfig>) => void
  
  // 更新角色配置
  updateCardConfig: (cardId: number, updates: Partial<TranslateConfig>) => void
  clearCardConfig: (cardId: number) => void
  
  // 缓存操作
  getCachedTranslation: (text: string, sourceLang: string, targetLang: string) => string | null
  setCachedTranslation: (text: string, translated: string, sourceLang: string, targetLang: string) => void
  clearCache: () => void
  
  // 检查是否需要翻译
  shouldTranslateInput: (cardId?: number) => boolean
  shouldTranslateOutput: (cardId?: number) => boolean
}

// 生成缓存 key
function getCacheKey(text: string, sourceLang: string, targetLang: string): string {
  // 简单 hash
  const str = `${sourceLang}:${targetLang}:${text}`
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return hash.toString(36)
}

// 默认配置
const DEFAULT_CONFIG: TranslateConfig = {
  enabled: false,
  mode: 'off',
  inputSourceLang: 'auto',
  inputTargetLang: 'en',
  outputSourceLang: 'auto',
  outputTargetLang: 'zh',
  showOriginal: true,
  showTranslation: true,
  inlineDisplay: false,
  preserveFormatting: true,
  preserveNames: true,
  customPrompt: '',
}

// 缓存最大条目数
const MAX_CACHE_SIZE = 500

export const useTavernTranslateStore = create<TavernTranslateState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      cardConfigs: {},
      cache: {},
      
      getEffectiveConfig: (cardId) => {
        const { config, cardConfigs } = get()
        if (cardId && cardConfigs[cardId]) {
          return { ...config, ...cardConfigs[cardId] }
        }
        return config
      },
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      updateCardConfig: (cardId, updates) => {
        set((state) => ({
          cardConfigs: {
            ...state.cardConfigs,
            [cardId]: {
              ...(state.cardConfigs[cardId] || {}),
              ...updates,
            },
          },
        }))
      },
      
      clearCardConfig: (cardId) => {
        set((state) => {
          const newConfigs = { ...state.cardConfigs }
          delete newConfigs[cardId]
          return { cardConfigs: newConfigs }
        })
      },
      
      getCachedTranslation: (text, sourceLang, targetLang) => {
        const { cache } = get()
        const key = getCacheKey(text, sourceLang, targetLang)
        const entry = cache[key]
        if (entry && entry.original === text) {
          return entry.translated
        }
        return null
      },
      
      setCachedTranslation: (text, translated, sourceLang, targetLang) => {
        set((state) => {
          const key = getCacheKey(text, sourceLang, targetLang)
          const newCache = { ...state.cache }
          
          // 限制缓存大小
          const keys = Object.keys(newCache)
          if (keys.length >= MAX_CACHE_SIZE) {
            // 删除最旧的条目
            const oldestKey = keys.reduce((oldest, k) => {
              if (!oldest || newCache[k].timestamp < newCache[oldest].timestamp) {
                return k
              }
              return oldest
            }, '')
            if (oldestKey) {
              delete newCache[oldestKey]
            }
          }
          
          newCache[key] = {
            original: text,
            translated,
            sourceLang,
            targetLang,
            timestamp: Date.now(),
          }
          
          return { cache: newCache }
        })
      },
      
      clearCache: () => {
        set({ cache: {} })
      },
      
      shouldTranslateInput: (cardId) => {
        const config = get().getEffectiveConfig(cardId)
        return config.enabled && (config.mode === 'input' || config.mode === 'both')
      },
      
      shouldTranslateOutput: (cardId) => {
        const config = get().getEffectiveConfig(cardId)
        return config.enabled && (config.mode === 'output' || config.mode === 'both')
      },
    }),
    {
      name: 'tavern-translate',
      partialize: (state) => ({
        config: state.config,
        cardConfigs: state.cardConfigs,
        // 不持久化缓存，避免存储过大
      }),
    }
  )
)
