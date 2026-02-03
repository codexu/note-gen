/**
 * SysPrompt (系统提示词预设) 状态管理
 * 对齐 SillyTavern 的 System Prompt 功能
 * 
 * 特点:
 * - 独立于 Instruct 预设，专注于系统提示词
 * - 支持主提示词 (content) 和历史后提示词 (postHistory/jailbreak)
 * - 同时只能启用一个 SysPrompt
 * - 可完全禁用以使用角色卡自带的 systemPrompt
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  type TavernSysPrompt,
  getSysPrompts,
  getEnabledSysPrompt,
  getSysPromptById,
  insertSysPrompt,
  updateSysPrompt,
  enableSysPrompt,
  disableAllSysPrompts,
  deleteSysPrompt,
} from '@/db/tavern'

// ============ 类型定义 ============

interface SysPromptState {
  /** 所有 SysPrompt 预设 */
  prompts: TavernSysPrompt[]
  /** 当前启用的 SysPrompt */
  enabled: TavernSysPrompt | null
  /** 是否已初始化 */
  initialized: boolean
  /** 加载中状态 */
  loading: boolean
  
  // ============ 操作方法 ============
  
  /** 初始化 (从数据库加载) */
  init: () => Promise<void>
  
  /** 刷新预设列表 */
  refresh: () => Promise<void>
  
  /** 获取当前启用的 SysPrompt */
  getEnabled: () => TavernSysPrompt | null
  
  /** 启用指定 SysPrompt */
  enable: (id: number) => Promise<void>
  
  /** 禁用所有 SysPrompt (使用角色卡自带的) */
  disableAll: () => Promise<void>
  
  /** 创建新 SysPrompt */
  create: (name: string, content?: string, postHistory?: string) => Promise<number | undefined>
  
  /** 更新 SysPrompt */
  update: (id: number, updates: Partial<Pick<TavernSysPrompt, 'name' | 'content' | 'postHistory'>>) => Promise<void>
  
  /** 删除 SysPrompt */
  delete: (id: number) => Promise<boolean>
  
  /** 快速切换启用/禁用 */
  toggle: (id: number) => Promise<void>
}

// ============ Store 实现 ============

export const useTavernSysPromptStore = create<SysPromptState>()(
  persist(
    (set, get) => ({
      prompts: [],
      enabled: null,
      initialized: false,
      loading: false,
      
      init: async () => {
        if (get().initialized) return
        
        set({ loading: true })
        try {
          const [prompts, enabled] = await Promise.all([
            getSysPrompts(),
            getEnabledSysPrompt(),
          ])
          set({
            prompts,
            enabled,
            initialized: true,
          })
        } catch (error) {
          console.error('初始化 SysPrompt 失败:', error)
        } finally {
          set({ loading: false })
        }
      },
      
      refresh: async () => {
        set({ loading: true })
        try {
          const [prompts, enabled] = await Promise.all([
            getSysPrompts(),
            getEnabledSysPrompt(),
          ])
          set({ prompts, enabled })
        } catch (error) {
          console.error('刷新 SysPrompt 失败:', error)
        } finally {
          set({ loading: false })
        }
      },
      
      getEnabled: () => {
        return get().enabled
      },
      
      enable: async (id: number) => {
        try {
          await enableSysPrompt(id)
          const enabled = await getSysPromptById(id)
          set({ enabled })
          // 刷新列表
          const prompts = await getSysPrompts()
          set({ prompts })
        } catch (error) {
          console.error('启用 SysPrompt 失败:', error)
          throw error
        }
      },
      
      disableAll: async () => {
        try {
          await disableAllSysPrompts()
          set({ enabled: null })
          // 刷新列表
          const prompts = await getSysPrompts()
          set({ prompts })
        } catch (error) {
          console.error('禁用 SysPrompt 失败:', error)
          throw error
        }
      },
      
      create: async (name: string, content?: string, postHistory?: string) => {
        try {
          const id = await insertSysPrompt({
            name,
            content: content || '',
            postHistory: postHistory || '',
            enabled: false,
            isDefault: false,
          })
          await get().refresh()
          return id
        } catch (error) {
          console.error('创建 SysPrompt 失败:', error)
          throw error
        }
      },
      
      update: async (id: number, updates: Partial<Pick<TavernSysPrompt, 'name' | 'content' | 'postHistory'>>) => {
        try {
          await updateSysPrompt(id, updates)
          await get().refresh()
        } catch (error) {
          console.error('更新 SysPrompt 失败:', error)
          throw error
        }
      },
      
      delete: async (id: number) => {
        try {
          const result = await deleteSysPrompt(id)
          await get().refresh()
          return result.rowsAffected > 0
        } catch (error) {
          console.error('删除 SysPrompt 失败:', error)
          throw error
        }
      },
      
      toggle: async (id: number) => {
        const { enabled } = get()
        if (enabled?.id === id) {
          await get().disableAll()
        } else {
          await get().enable(id)
        }
      },
    }),
    {
      name: 'tavern-sysprompt',
      partialize: (state) => ({
        // 只持久化必要的标志
        initialized: state.initialized,
      }),
    }
  )
)

// ============ 辅助函数 ============

/**
 * 获取有效的系统提示词
 * 优先级: 启用的 SysPrompt > 角色卡的 systemPrompt
 */
export function getEffectiveSystemPrompt(
  cardSystemPrompt: string,
  enabledSysPrompt: TavernSysPrompt | null
): string {
  if (enabledSysPrompt) {
    return enabledSysPrompt.content
  }
  return cardSystemPrompt
}

/**
 * 获取有效的 Post-History Instructions (Jailbreak)
 * 优先级: 启用的 SysPrompt.postHistory > 角色卡的 postHistoryInstructions
 */
export function getEffectivePostHistory(
  cardPostHistory: string,
  enabledSysPrompt: TavernSysPrompt | null
): string {
  if (enabledSysPrompt && enabledSysPrompt.postHistory) {
    return enabledSysPrompt.postHistory
  }
  return cardPostHistory
}

export default useTavernSysPromptStore
