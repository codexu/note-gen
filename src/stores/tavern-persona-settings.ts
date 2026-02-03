import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Persona 全局设置
 * 对齐 SillyTavern 的 power_user persona 设置
 */
export interface PersonaSettings {
  /** 切换 Persona 时显示通知 */
  showNotifications: boolean
  /** 允许多个 Persona 连接到同一角色 (弹窗选择) */
  allowMultiConnections: boolean
  /** 选择 Persona 时自动锁定到聊天 */
  autoLock: boolean
  /** 列表排序方式 */
  sortOrder: 'asc' | 'desc'
}

interface PersonaSettingsState extends PersonaSettings {
  /** 更新单个设置 */
  updateSetting: <K extends keyof PersonaSettings>(key: K, value: PersonaSettings[K]) => void
  /** 重置为默认设置 */
  resetSettings: () => void
}

const defaultSettings: PersonaSettings = {
  showNotifications: true,
  allowMultiConnections: false,
  autoLock: false,
  sortOrder: 'asc',
}

export const useTavernPersonaSettingsStore = create<PersonaSettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      updateSetting: (key, value) => {
        set({ [key]: value })
      },

      resetSettings: () => {
        set(defaultSettings)
      },
    }),
    {
      name: 'tavern-persona-settings',
    }
  )
)

/**
 * 获取 Persona 设置 (非响应式)
 */
export function getPersonaSettings(): PersonaSettings {
  return useTavernPersonaSettingsStore.getState()
}

/**
 * 检查是否应该显示通知
 */
export function shouldShowPersonaNotification(): boolean {
  return useTavernPersonaSettingsStore.getState().showNotifications
}

/**
 * 检查是否允许多连接
 */
export function allowsMultiConnections(): boolean {
  return useTavernPersonaSettingsStore.getState().allowMultiConnections
}

/**
 * 检查是否自动锁定
 */
export function shouldAutoLock(): boolean {
  return useTavernPersonaSettingsStore.getState().autoLock
}

/**
 * 获取排序方式
 */
export function getPersonaSortOrder(): 'asc' | 'desc' {
  return useTavernPersonaSettingsStore.getState().sortOrder
}
