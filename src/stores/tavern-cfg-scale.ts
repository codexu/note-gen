import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// CFG Scale 配置
export interface CfgScaleConfig {
  guidanceScale: number      // 引导缩放值 (1.0 = 禁用, >1 启用)
  negativePrompt: string     // 负面提示词
  positivePrompt: string     // 正面提示词 (可选增强)
}

// 配置级别
export type CfgLevel = 'global' | 'character' | 'chat'

interface TavernCfgScaleState {
  // 全局配置
  globalConfig: CfgScaleConfig
  
  // 角色配置 (cardId -> config)
  characterConfigs: Record<number, CfgScaleConfig>
  
  // 聊天配置 (chatId -> config)
  chatConfigs: Record<number, CfgScaleConfig>
  
  // 提示词组合设置 (哪些级别的提示词要合并)
  promptCombine: CfgLevel[]
  
  // 提示词插入深度
  insertionDepth: number
  
  // 提示词分隔符
  promptSeparator: string
  
  // 获取有效配置 (按优先级: chat > character > global)
  getEffectiveConfig: (cardId?: number, chatId?: number) => {
    config: CfgScaleConfig
    level: CfgLevel
  } | null
  
  // 获取合并后的提示词
  getCombinedPrompts: (cardId?: number, chatId?: number) => {
    negative: string
    positive: string
    guidanceScale: number
    depth: number
  } | null
  
  // 更新全局配置
  updateGlobalConfig: (updates: Partial<CfgScaleConfig>) => void
  
  // 更新角色配置
  updateCharacterConfig: (cardId: number, updates: Partial<CfgScaleConfig>) => void
  clearCharacterConfig: (cardId: number) => void
  
  // 更新聊天配置
  updateChatConfig: (chatId: number, updates: Partial<CfgScaleConfig>) => void
  clearChatConfig: (chatId: number) => void
  
  // 更新提示词组合设置
  setPromptCombine: (levels: CfgLevel[]) => void
  togglePromptCombine: (level: CfgLevel) => void
  
  // 更新插入深度
  setInsertionDepth: (depth: number) => void
  
  // 更新分隔符
  setPromptSeparator: (separator: string) => void
  
  // 检查 CFG 是否启用
  isEnabled: (cardId?: number, chatId?: number) => boolean
}

// 默认配置
const DEFAULT_CONFIG: CfgScaleConfig = {
  guidanceScale: 1.0,
  negativePrompt: '',
  positivePrompt: '',
}

export const useTavernCfgScaleStore = create<TavernCfgScaleState>()(
  persist(
    (set, get) => ({
      globalConfig: { ...DEFAULT_CONFIG },
      characterConfigs: {},
      chatConfigs: {},
      promptCombine: [],
      insertionDepth: 1,
      promptSeparator: '\n',
      
      getEffectiveConfig: (cardId, chatId) => {
        const { globalConfig, characterConfigs, chatConfigs } = get()
        
        // 优先级: chat > character > global
        if (chatId && chatConfigs[chatId]) {
          const config = chatConfigs[chatId]
          if (config.guidanceScale !== 1.0) {
            return { config, level: 'chat' }
          }
        }
        
        if (cardId && characterConfigs[cardId]) {
          const config = characterConfigs[cardId]
          if (config.guidanceScale !== 1.0) {
            return { config, level: 'character' }
          }
        }
        
        if (globalConfig.guidanceScale !== 1.0) {
          return { config: globalConfig, level: 'global' }
        }
        
        return null
      },
      
      getCombinedPrompts: (cardId, chatId) => {
        const { 
          globalConfig, 
          characterConfigs, 
          chatConfigs, 
          promptCombine,
          insertionDepth,
          promptSeparator,
        } = get()
        
        const effectiveResult = get().getEffectiveConfig(cardId, chatId)
        if (!effectiveResult) return null
        
        const { level: effectiveLevel } = effectiveResult
        
        // 收集要合并的提示词
        const negatives: string[] = []
        const positives: string[] = []
        
        // 按优先级添加 (global -> character -> chat)
        const shouldInclude = (level: CfgLevel) => {
          return level === effectiveLevel || promptCombine.includes(level)
        }
        
        if (shouldInclude('global') && globalConfig.negativePrompt) {
          negatives.push(globalConfig.negativePrompt)
        }
        if (shouldInclude('global') && globalConfig.positivePrompt) {
          positives.push(globalConfig.positivePrompt)
        }
        
        if (cardId && characterConfigs[cardId] && shouldInclude('character')) {
          const charConfig = characterConfigs[cardId]
          if (charConfig.negativePrompt) negatives.push(charConfig.negativePrompt)
          if (charConfig.positivePrompt) positives.push(charConfig.positivePrompt)
        }
        
        if (chatId && chatConfigs[chatId] && shouldInclude('chat')) {
          const chatConfig = chatConfigs[chatId]
          if (chatConfig.negativePrompt) negatives.push(chatConfig.negativePrompt)
          if (chatConfig.positivePrompt) positives.push(chatConfig.positivePrompt)
        }
        
        return {
          negative: negatives.filter(p => p.trim()).join(promptSeparator),
          positive: positives.filter(p => p.trim()).join(promptSeparator),
          guidanceScale: effectiveResult.config.guidanceScale,
          depth: insertionDepth,
        }
      },
      
      updateGlobalConfig: (updates) => {
        set((state) => ({
          globalConfig: { ...state.globalConfig, ...updates },
        }))
      },
      
      updateCharacterConfig: (cardId, updates) => {
        set((state) => ({
          characterConfigs: {
            ...state.characterConfigs,
            [cardId]: {
              ...(state.characterConfigs[cardId] || DEFAULT_CONFIG),
              ...updates,
            },
          },
        }))
      },
      
      clearCharacterConfig: (cardId) => {
        set((state) => {
          const newConfigs = { ...state.characterConfigs }
          delete newConfigs[cardId]
          return { characterConfigs: newConfigs }
        })
      },
      
      updateChatConfig: (chatId, updates) => {
        set((state) => ({
          chatConfigs: {
            ...state.chatConfigs,
            [chatId]: {
              ...(state.chatConfigs[chatId] || DEFAULT_CONFIG),
              ...updates,
            },
          },
        }))
      },
      
      clearChatConfig: (chatId) => {
        set((state) => {
          const newConfigs = { ...state.chatConfigs }
          delete newConfigs[chatId]
          return { chatConfigs: newConfigs }
        })
      },
      
      setPromptCombine: (levels) => {
        set({ promptCombine: levels })
      },
      
      togglePromptCombine: (level) => {
        set((state) => {
          const current = state.promptCombine
          if (current.includes(level)) {
            return { promptCombine: current.filter(l => l !== level) }
          } else {
            return { promptCombine: [...current, level] }
          }
        })
      },
      
      setInsertionDepth: (depth) => {
        set({ insertionDepth: Math.max(0, Math.min(100, depth)) })
      },
      
      setPromptSeparator: (separator) => {
        set({ promptSeparator: separator })
      },
      
      isEnabled: (cardId, chatId) => {
        const result = get().getEffectiveConfig(cardId, chatId)
        return result !== null && result.config.guidanceScale !== 1.0
      },
    }),
    {
      name: 'tavern-cfg-scale',
    }
  )
)
