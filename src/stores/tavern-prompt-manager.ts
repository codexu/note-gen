/**
 * Tavern Prompt Manager Store
 * 
 * 管理提示词顺序和配置，复刻 ST 的 Prompt Manager 功能
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Re-export extension prompt types from context-builder-v2
export {
  ExtensionPromptPosition,
  ExtensionPromptRole,
  type ExtensionPrompt,
} from '@/lib/tavern/context-builder-v2'

// ============ 类型定义 ============

/**
 * 注入位置
 */
export enum InjectionPosition {
  /** 相对位置 (按顺序) */
  Relative = 0,
  /** 绝对位置 (按深度) */
  Absolute = 1,
}

/**
 * 提示词角色
 */
export type PromptRole = 'system' | 'user' | 'assistant'

/**
 * 提示词条目
 */
export interface PromptEntry {
  /** 唯一标识符 */
  identifier: string
  /** 显示名称 */
  name: string
  /** 角色 */
  role: PromptRole
  /** 内容 */
  content: string
  /** 是否为系统提示词 (不可删除) */
  systemPrompt: boolean
  /** 是否为标记 (动态内容占位符) */
  marker: boolean
  /** 注入位置 */
  injectionPosition: InjectionPosition
  /** 注入深度 (Absolute 模式) */
  injectionDepth: number
  /** 注入顺序 (同深度排序) */
  injectionOrder: number
  /** 禁止覆盖 */
  forbidOverrides: boolean
}

/**
 * 提示词顺序条目
 */
export interface PromptOrderEntry {
  identifier: string
  enabled: boolean
}

/**
 * 角色/群组专属配置
 */
export interface CharacterPromptConfig {
  characterId: number | string  // 角色 ID 或群组 ID
  promptOrder: PromptOrderEntry[]
  customPrompts?: PromptEntry[]
}

// ============ 默认提示词 ============

export const DEFAULT_PROMPTS: PromptEntry[] = [
  {
    identifier: 'main',
    name: '主提示词',
    role: 'system',
    content: '扮演 {{char}}，在与 {{user}} 的虚构对话中撰写下一条回复。',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'worldInfoBefore',
    name: '世界书 (↑角色)',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'charDescription',
    name: '角色描述',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'charPersonality',
    name: '角色性格',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'scenario',
    name: '场景',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'personaDescription',
    name: '用户设定',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'worldInfoAfter',
    name: '世界书 (↓角色)',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'nsfw',
    name: '辅助提示词',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'dialogueExamples',
    name: '对话示例',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'chatHistory',
    name: '聊天历史',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'jailbreak',
    name: '历史后指令',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
]

export const DEFAULT_PROMPT_ORDER: PromptOrderEntry[] = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'nsfw', enabled: false },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
]

// ============ Store ============

interface PromptManagerState {
  // 全局提示词定义
  prompts: PromptEntry[]
  // 全局默认顺序
  globalPromptOrder: PromptOrderEntry[]
  // 角色/群组专属配置
  characterConfigs: CharacterPromptConfig[]
  // 当前策略: 'global' | 'character'
  orderStrategy: 'global' | 'character'
  // 当前活动角色 ID
  activeCharacterId: number | string | null
  
  // Actions
  setPrompts: (prompts: PromptEntry[]) => void
  updatePrompt: (identifier: string, updates: Partial<PromptEntry>) => void
  addPrompt: (prompt: PromptEntry) => void
  deletePrompt: (identifier: string) => boolean
  
  setGlobalPromptOrder: (order: PromptOrderEntry[]) => void
  setCharacterPromptOrder: (characterId: number | string, order: PromptOrderEntry[]) => void
  togglePrompt: (identifier: string, enabled?: boolean) => void
  movePrompt: (identifier: string, newIndex: number) => void
  
  setOrderStrategy: (strategy: 'global' | 'character') => void
  setActiveCharacter: (characterId: number | string | null) => void
  
  // Getters
  getPrompt: (identifier: string) => PromptEntry | undefined
  getActivePromptOrder: () => PromptOrderEntry[]
  getEnabledPrompts: () => PromptEntry[]
  
  // Import/Export
  exportConfig: () => { prompts: PromptEntry[]; promptOrder: PromptOrderEntry[] }
  importConfig: (config: { prompts?: PromptEntry[]; promptOrder?: PromptOrderEntry[] }) => void
  resetToDefault: () => void
}

export const usePromptManagerStore = create<PromptManagerState>()(
  persist(
    (set, get) => ({
      prompts: [...DEFAULT_PROMPTS],
      globalPromptOrder: [...DEFAULT_PROMPT_ORDER],
      characterConfigs: [],
      orderStrategy: 'global',
      activeCharacterId: null,
      
      setPrompts: (prompts) => set({ prompts }),
      
      updatePrompt: (identifier, updates) => set((state) => ({
        prompts: state.prompts.map(p =>
          p.identifier === identifier ? { ...p, ...updates } : p
        ),
      })),
      
      addPrompt: (prompt) => set((state) => {
        // 检查是否已存在
        if (state.prompts.some(p => p.identifier === prompt.identifier)) {
          return state
        }
        
        // 添加到提示词列表
        const newPrompts = [...state.prompts, prompt]
        
        // 添加到顺序列表
        const newOrder = [...state.globalPromptOrder, {
          identifier: prompt.identifier,
          enabled: true,
        }]
        
        return {
          prompts: newPrompts,
          globalPromptOrder: newOrder,
        }
      }),
      
      deletePrompt: (identifier) => {
        const state = get()
        const prompt = state.prompts.find(p => p.identifier === identifier)
        
        // 不能删除系统提示词
        if (!prompt || prompt.systemPrompt) {
          return false
        }
        
        set({
          prompts: state.prompts.filter(p => p.identifier !== identifier),
          globalPromptOrder: state.globalPromptOrder.filter(e => e.identifier !== identifier),
          characterConfigs: state.characterConfigs.map(c => ({
            ...c,
            promptOrder: c.promptOrder.filter(e => e.identifier !== identifier),
          })),
        })
        
        return true
      },
      
      setGlobalPromptOrder: (order) => set({ globalPromptOrder: order }),
      
      setCharacterPromptOrder: (characterId, order) => set((state) => {
        const existing = state.characterConfigs.find(c => c.characterId === characterId)
        
        if (existing) {
          return {
            characterConfigs: state.characterConfigs.map(c =>
              c.characterId === characterId ? { ...c, promptOrder: order } : c
            ),
          }
        }
        
        return {
          characterConfigs: [...state.characterConfigs, { characterId, promptOrder: order }],
        }
      }),
      
      togglePrompt: (identifier, enabled) => set((state) => {
        const order = get().getActivePromptOrder()
        const entry = order.find(e => e.identifier === identifier)
        
        if (!entry) return state
        
        const newEnabled = enabled ?? !entry.enabled
        const newOrder = order.map(e =>
          e.identifier === identifier ? { ...e, enabled: newEnabled } : e
        )
        
        if (state.orderStrategy === 'character' && state.activeCharacterId) {
          const existing = state.characterConfigs.find(c => c.characterId === state.activeCharacterId)
          if (existing) {
            return {
              characterConfigs: state.characterConfigs.map(c =>
                c.characterId === state.activeCharacterId ? { ...c, promptOrder: newOrder } : c
              ),
            }
          }
          return {
            characterConfigs: [...state.characterConfigs, {
              characterId: state.activeCharacterId,
              promptOrder: newOrder,
            }],
          }
        }
        
        return { globalPromptOrder: newOrder }
      }),
      
      movePrompt: (identifier, newIndex) => set((state) => {
        const order = [...get().getActivePromptOrder()]
        const currentIndex = order.findIndex(e => e.identifier === identifier)
        
        if (currentIndex < 0) return state
        
        const [entry] = order.splice(currentIndex, 1)
        order.splice(newIndex, 0, entry)
        
        if (state.orderStrategy === 'character' && state.activeCharacterId) {
          const existing = state.characterConfigs.find(c => c.characterId === state.activeCharacterId)
          if (existing) {
            return {
              characterConfigs: state.characterConfigs.map(c =>
                c.characterId === state.activeCharacterId ? { ...c, promptOrder: order } : c
              ),
            }
          }
          return {
            characterConfigs: [...state.characterConfigs, {
              characterId: state.activeCharacterId,
              promptOrder: order,
            }],
          }
        }
        
        return { globalPromptOrder: order }
      }),
      
      setOrderStrategy: (strategy) => set({ orderStrategy: strategy }),
      
      setActiveCharacter: (characterId) => set({ activeCharacterId: characterId }),
      
      getPrompt: (identifier) => {
        return get().prompts.find(p => p.identifier === identifier)
      },
      
      getActivePromptOrder: () => {
        const state = get()
        
        if (state.orderStrategy === 'character' && state.activeCharacterId) {
          const config = state.characterConfigs.find(c => c.characterId === state.activeCharacterId)
          if (config) {
            return config.promptOrder
          }
        }
        
        return state.globalPromptOrder
      },
      
      getEnabledPrompts: () => {
        const state = get()
        const order = get().getActivePromptOrder()
        
        return order
          .filter(e => e.enabled)
          .map(e => state.prompts.find(p => p.identifier === e.identifier))
          .filter((p): p is PromptEntry => p !== undefined)
      },
      
      exportConfig: () => {
        const state = get()
        return {
          prompts: state.prompts,
          promptOrder: get().getActivePromptOrder(),
        }
      },
      
      importConfig: (config) => set((state) => {
        const updates: Partial<PromptManagerState> = {}
        
        if (config.prompts) {
          // 合并提示词，保留系统提示词的 systemPrompt 和 marker 属性
          updates.prompts = config.prompts.map(p => {
            const existing = state.prompts.find(e => e.identifier === p.identifier)
            if (existing?.systemPrompt) {
              return { ...p, systemPrompt: true, marker: existing.marker }
            }
            return p
          })
        }
        
        if (config.promptOrder) {
          if (state.orderStrategy === 'character' && state.activeCharacterId) {
            const existing = state.characterConfigs.find(c => c.characterId === state.activeCharacterId)
            if (existing) {
              updates.characterConfigs = state.characterConfigs.map(c =>
                c.characterId === state.activeCharacterId
                  ? { ...c, promptOrder: config.promptOrder! }
                  : c
              )
            } else {
              updates.characterConfigs = [...state.characterConfigs, {
                characterId: state.activeCharacterId,
                promptOrder: config.promptOrder,
              }]
            }
          } else {
            updates.globalPromptOrder = config.promptOrder
          }
        }
        
        return updates
      }),
      
      resetToDefault: () => set({
        prompts: [...DEFAULT_PROMPTS],
        globalPromptOrder: [...DEFAULT_PROMPT_ORDER],
        characterConfigs: [],
      }),
    }),
    {
      name: 'tavern-prompt-manager',
      version: 1,
    }
  )
)
