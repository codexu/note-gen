/**
 * Tavern Connection Profiles Store
 * 管理 API 配置文件，支持快速切换
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AiConfig, ModelConfig } from '@/app/core/setting/config'

// ============ 类型定义 ============

/**
 * 连接配置文件
 */
export interface ConnectionProfile {
  /** 配置 ID */
  id: string
  /** 配置名称 */
  name: string
  /** 配置描述 */
  description?: string
  /** 配置图标 (emoji 或 URL) */
  icon?: string
  /** 配置颜色 */
  color?: string
  
  // API 配置
  /** 使用的 AI 配置 key */
  aiConfigKey: string
  /** 使用的模型 ID */
  modelId: string
  /** API Key 覆盖 (可选) */
  apiKeyOverride?: string
  /** Base URL 覆盖 (可选) */
  baseURLOverride?: string
  /** 自定义 Headers */
  customHeaders?: Record<string, string>
  
  // 模型参数覆盖
  /** Temperature */
  temperature?: number
  /** Top P */
  topP?: number
  /** Max Tokens */
  maxTokens?: number
  /** 启用流式输出 */
  enableStream?: boolean
  
  // 预设覆盖
  /** 系统提示词覆盖 */
  systemPromptOverride?: string
  /** 预设 ID */
  presetId?: string
  
  // 元数据
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
  /** 上次使用时间 */
  lastUsedAt?: number
  /** 使用次数 */
  useCount: number
}

/**
 * 角色绑定配置
 */
export interface CharacterBinding {
  /** 角色 ID */
  cardId: number
  /** 绑定的配置 ID */
  profileId: string
}

// ============ Store 状态 ============

interface TavernConnectionProfilesState {
  /** 所有配置文件 */
  profiles: ConnectionProfile[]
  /** 当前激活的配置 ID */
  activeProfileId: string | null
  /** 角色绑定 */
  characterBindings: CharacterBinding[]
  /** 是否启用角色自动切换 */
  autoSwitchEnabled: boolean
  
  // 配置管理
  createProfile: (profile: Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>) => string
  updateProfile: (id: string, updates: Partial<ConnectionProfile>) => void
  deleteProfile: (id: string) => void
  duplicateProfile: (id: string, newName?: string) => string | null
  
  // 激活配置
  setActiveProfile: (id: string | null) => void
  getActiveProfile: () => ConnectionProfile | null
  
  // 角色绑定
  bindCharacter: (cardId: number, profileId: string) => void
  unbindCharacter: (cardId: number) => void
  getCharacterProfile: (cardId: number) => ConnectionProfile | null
  setAutoSwitchEnabled: (enabled: boolean) => void
  
  // 导入导出
  exportProfiles: () => string
  importProfiles: (data: string) => { success: boolean; count: number; error?: string }
  
  // 使用统计
  recordProfileUsage: (id: string) => void
  getRecentProfiles: (limit?: number) => ConnectionProfile[]
  getMostUsedProfiles: (limit?: number) => ConnectionProfile[]
}

// ============ Store 实现 ============

export const useTavernConnectionProfilesStore = create<TavernConnectionProfilesState>()(
  persist(
    (set, get) => ({
      profiles: [],
      activeProfileId: null,
      characterBindings: [],
      autoSwitchEnabled: true,
      
      // ============ 配置管理 ============
      
      createProfile: (profile) => {
        const id = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const now = Date.now()
        
        const newProfile: ConnectionProfile = {
          ...profile,
          id,
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        }
        
        set(state => ({
          profiles: [...state.profiles, newProfile],
        }))
        
        return id
      },
      
      updateProfile: (id, updates) => {
        set(state => ({
          profiles: state.profiles.map(p =>
            p.id === id
              ? { ...p, ...updates, updatedAt: Date.now() }
              : p
          ),
        }))
      },
      
      deleteProfile: (id) => {
        set(state => ({
          profiles: state.profiles.filter(p => p.id !== id),
          activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
          characterBindings: state.characterBindings.filter(b => b.profileId !== id),
        }))
      },
      
      duplicateProfile: (id, newName) => {
        const original = get().profiles.find(p => p.id === id)
        if (!original) return null
        
        const newId = `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const now = Date.now()
        
        const duplicated: ConnectionProfile = {
          ...original,
          id: newId,
          name: newName || `${original.name} (副本)`,
          createdAt: now,
          updatedAt: now,
          lastUsedAt: undefined,
          useCount: 0,
        }
        
        set(state => ({
          profiles: [...state.profiles, duplicated],
        }))
        
        return newId
      },
      
      // ============ 激活配置 ============
      
      setActiveProfile: (id) => {
        set({ activeProfileId: id })
        if (id) {
          get().recordProfileUsage(id)
        }
      },
      
      getActiveProfile: () => {
        const { profiles, activeProfileId } = get()
        if (!activeProfileId) return null
        return profiles.find(p => p.id === activeProfileId) || null
      },
      
      // ============ 角色绑定 ============
      
      bindCharacter: (cardId, profileId) => {
        set(state => ({
          characterBindings: [
            ...state.characterBindings.filter(b => b.cardId !== cardId),
            { cardId, profileId },
          ],
        }))
      },
      
      unbindCharacter: (cardId) => {
        set(state => ({
          characterBindings: state.characterBindings.filter(b => b.cardId !== cardId),
        }))
      },
      
      getCharacterProfile: (cardId) => {
        const { profiles, characterBindings } = get()
        const binding = characterBindings.find(b => b.cardId === cardId)
        if (!binding) return null
        return profiles.find(p => p.id === binding.profileId) || null
      },
      
      setAutoSwitchEnabled: (enabled) => {
        set({ autoSwitchEnabled: enabled })
      },
      
      // ============ 导入导出 ============
      
      exportProfiles: () => {
        const { profiles, characterBindings } = get()
        return JSON.stringify({
          version: 1,
          profiles,
          characterBindings,
          exportedAt: Date.now(),
        }, null, 2)
      },
      
      importProfiles: (data) => {
        try {
          const parsed = JSON.parse(data)
          
          if (!parsed.profiles || !Array.isArray(parsed.profiles)) {
            return { success: false, count: 0, error: '无效的配置格式' }
          }
          
          const now = Date.now()
          const existingIds = new Set(get().profiles.map(p => p.id))
          
          // 处理 ID 冲突
          const importedProfiles: ConnectionProfile[] = parsed.profiles.map((p: ConnectionProfile) => {
            let id = p.id
            if (existingIds.has(id)) {
              id = `profile-${now}-${Math.random().toString(36).slice(2, 8)}`
            }
            return {
              ...p,
              id,
              updatedAt: now,
            }
          })
          
          set(state => ({
            profiles: [...state.profiles, ...importedProfiles],
          }))
          
          return { success: true, count: importedProfiles.length }
        } catch (error) {
          return { 
            success: false, 
            count: 0, 
            error: error instanceof Error ? error.message : '解析失败' 
          }
        }
      },
      
      // ============ 使用统计 ============
      
      recordProfileUsage: (id) => {
        set(state => ({
          profiles: state.profiles.map(p =>
            p.id === id
              ? { ...p, lastUsedAt: Date.now(), useCount: p.useCount + 1 }
              : p
          ),
        }))
      },
      
      getRecentProfiles: (limit = 5) => {
        return get().profiles
          .filter(p => p.lastUsedAt)
          .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
          .slice(0, limit)
      },
      
      getMostUsedProfiles: (limit = 5) => {
        return get().profiles
          .sort((a, b) => b.useCount - a.useCount)
          .slice(0, limit)
      },
    }),
    {
      name: 'tavern-connection-profiles',
    }
  )
)

// ============ 辅助函数 ============

/**
 * 从 AiConfig 创建配置文件
 */
export function createProfileFromAiConfig(
  aiConfig: AiConfig,
  model?: ModelConfig,
  name?: string
): Omit<ConnectionProfile, 'id' | 'createdAt' | 'updatedAt' | 'useCount'> {
  return {
    name: name || `${aiConfig.title} - ${model?.model || aiConfig.model || 'default'}`,
    icon: aiConfig.icon,
    aiConfigKey: aiConfig.key,
    modelId: model?.id || aiConfig.key,
    temperature: model?.temperature ?? aiConfig.temperature,
    topP: model?.topP ?? aiConfig.topP,
    enableStream: model?.enableStream ?? aiConfig.enableStream,
  }
}

/**
 * 应用配置文件到 AI 请求
 */
export function applyProfileToRequest(
  profile: ConnectionProfile,
  baseConfig: AiConfig
): {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  modelParams: {
    temperature?: number
    topP?: number
    maxTokens?: number
    stream?: boolean
  }
} {
  return {
    apiKey: profile.apiKeyOverride || baseConfig.apiKey,
    baseURL: profile.baseURLOverride || baseConfig.baseURL,
    headers: {
      ...baseConfig.customHeaders,
      ...profile.customHeaders,
    },
    modelParams: {
      temperature: profile.temperature ?? baseConfig.temperature,
      topP: profile.topP ?? baseConfig.topP,
      maxTokens: profile.maxTokens,
      stream: profile.enableStream ?? baseConfig.enableStream,
    },
  }
}

/**
 * 预设配置模板
 */
export const PROFILE_TEMPLATES: Array<{
  name: string
  description: string
  icon: string
  color: string
  defaults: Partial<ConnectionProfile>
}> = [
  {
    name: '创意写作',
    description: '高温度、更有创意的输出',
    icon: '✨',
    color: 'purple',
    defaults: {
      temperature: 1.2,
      topP: 0.95,
    },
  },
  {
    name: '精确回复',
    description: '低温度、更精确的输出',
    icon: '🎯',
    color: 'blue',
    defaults: {
      temperature: 0.3,
      topP: 0.8,
    },
  },
  {
    name: '平衡模式',
    description: '默认参数、平衡的输出',
    icon: '⚖️',
    color: 'green',
    defaults: {
      temperature: 0.7,
      topP: 0.9,
    },
  },
  {
    name: '长篇内容',
    description: '适合生成长篇内容',
    icon: '📝',
    color: 'yellow',
    defaults: {
      temperature: 0.8,
      maxTokens: 4096,
    },
  },
]
