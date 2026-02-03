/**
 * Tavern Author's Note Store
 * 作者笔记/浮动提示词功能
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 插入位置
export enum AuthorsNotePosition {
  AfterScenario = 0,    // 场景描述之后
  InChat = 1,           // 聊天历史中 (按深度)
  BeforeScenario = 2,   // 场景描述之前
}

// 角色类型
export enum AuthorsNoteRole {
  System = 'system',
  User = 'user',
  Assistant = 'assistant',
}

// 作者笔记配置
export interface AuthorsNoteConfig {
  content: string           // 笔记内容
  position: AuthorsNotePosition
  depth: number             // 插入深度 (0-100, 仅 InChat 时有效)
  interval: number          // 触发间隔 (0=每次, N=每N条消息)
  role: AuthorsNoteRole     // 消息角色
  enabled: boolean          // 是否启用
}

// 角色绑定的作者笔记
export interface CharacterAuthorsNote {
  cardId: number
  config: AuthorsNoteConfig
}

// 默认配置
const DEFAULT_CONFIG: AuthorsNoteConfig = {
  content: '',
  position: AuthorsNotePosition.InChat,
  depth: 4,
  interval: 0,
  role: AuthorsNoteRole.System,
  enabled: true,
}

interface AuthorsNoteState {
  // 全局默认配置
  globalConfig: AuthorsNoteConfig
  // 角色绑定配置
  characterConfigs: CharacterAuthorsNote[]
  // 聊天会话覆盖 (chatId -> config)
  chatOverrides: Record<number, AuthorsNoteConfig>
  
  // Actions
  setGlobalConfig: (config: Partial<AuthorsNoteConfig>) => void
  setCharacterConfig: (cardId: number, config: Partial<AuthorsNoteConfig>) => void
  setChatOverride: (chatId: number, config: Partial<AuthorsNoteConfig>) => void
  clearChatOverride: (chatId: number) => void
  getEffectiveConfig: (cardId?: number, chatId?: number) => AuthorsNoteConfig
  resetToDefault: () => void
}

export const useTavernAuthorsNoteStore = create<AuthorsNoteState>()(
  persist(
    (set, get) => ({
      globalConfig: { ...DEFAULT_CONFIG },
      characterConfigs: [],
      chatOverrides: {},

      setGlobalConfig: (config) => {
        set((state) => ({
          globalConfig: { ...state.globalConfig, ...config },
        }))
      },

      setCharacterConfig: (cardId, config) => {
        set((state) => {
          const existing = state.characterConfigs.find((c) => c.cardId === cardId)
          if (existing) {
            return {
              characterConfigs: state.characterConfigs.map((c) =>
                c.cardId === cardId
                  ? { ...c, config: { ...c.config, ...config } }
                  : c
              ),
            }
          } else {
            return {
              characterConfigs: [
                ...state.characterConfigs,
                { cardId, config: { ...DEFAULT_CONFIG, ...config } },
              ],
            }
          }
        })
      },

      setChatOverride: (chatId, config) => {
        set((state) => ({
          chatOverrides: {
            ...state.chatOverrides,
            [chatId]: { ...(state.chatOverrides[chatId] || DEFAULT_CONFIG), ...config },
          },
        }))
      },

      clearChatOverride: (chatId) => {
        set((state) => {
          const { [chatId]: _, ...rest } = state.chatOverrides
          return { chatOverrides: rest }
        })
      },

      getEffectiveConfig: (cardId, chatId) => {
        const state = get()
        
        // 优先级: 聊天覆盖 > 角色配置 > 全局配置
        if (chatId && state.chatOverrides[chatId]) {
          return state.chatOverrides[chatId]
        }
        
        if (cardId) {
          const charConfig = state.characterConfigs.find((c) => c.cardId === cardId)
          if (charConfig) {
            return charConfig.config
          }
        }
        
        return state.globalConfig
      },

      resetToDefault: () => {
        set({
          globalConfig: { ...DEFAULT_CONFIG },
          characterConfigs: [],
          chatOverrides: {},
        })
      },
    }),
    {
      name: 'tavern-authors-note',
    }
  )
)

/**
 * 构建作者笔记消息
 */
export function buildAuthorsNoteMessage(config: AuthorsNoteConfig): {
  role: 'system' | 'user' | 'assistant'
  content: string
} | null {
  if (!config.enabled || !config.content.trim()) {
    return null
  }
  
  return {
    role: config.role,
    content: config.content.trim(),
  }
}

/**
 * 检查是否应该插入作者笔记 (基于间隔)
 */
export function shouldInsertAuthorsNote(
  config: AuthorsNoteConfig,
  messageCount: number
): boolean {
  if (!config.enabled || !config.content.trim()) {
    return false
  }
  
  if (config.interval === 0) {
    return true // 每次都插入
  }
  
  return messageCount % config.interval === 0
}

/**
 * 获取位置显示名称
 */
export function getPositionDisplayName(position: AuthorsNotePosition): string {
  switch (position) {
    case AuthorsNotePosition.AfterScenario:
      return '场景描述之后'
    case AuthorsNotePosition.InChat:
      return '聊天历史中'
    case AuthorsNotePosition.BeforeScenario:
      return '场景描述之前'
    default:
      return '未知'
  }
}

/**
 * 获取角色显示名称
 */
export function getRoleDisplayName(role: AuthorsNoteRole): string {
  switch (role) {
    case AuthorsNoteRole.System:
      return '系统'
    case AuthorsNoteRole.User:
      return '用户'
    case AuthorsNoteRole.Assistant:
      return '助手'
    default:
      return '未知'
  }
}
