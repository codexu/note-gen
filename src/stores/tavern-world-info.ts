/**
 * Tavern World Info 状态管理
 * 管理世界书扫描配置和定时效果
 */

import { create } from 'zustand'
import {
  WorldInfoScanConfig,
  TimedEffectsState,
  DEFAULT_SCAN_CONFIG,
  createTimedEffectsState,
  serializeTimedEffects,
  deserializeTimedEffects,
} from '@/lib/tavern/world-info-scanner'

interface TavernWorldInfoState {
  // 扫描配置
  scanConfig: WorldInfoScanConfig
  
  // 定时效果状态 (按聊天 ID 存储)
  timedEffects: Map<number, TimedEffectsState>
  
  // 初始化
  init: () => Promise<void>
  
  // 配置管理
  updateScanConfig: (updates: Partial<WorldInfoScanConfig>) => void
  resetScanConfig: () => void
  
  // 定时效果管理
  getTimedEffects: (chatId: number) => TimedEffectsState
  setTimedEffects: (chatId: number, effects: TimedEffectsState) => void
  clearTimedEffects: (chatId: number) => void
  
  // 持久化
  save: () => Promise<void>
  load: () => Promise<void>
}

// 本地存储键
const CONFIG_STORAGE_KEY = 'tavern_world_info_config'
const EFFECTS_STORAGE_KEY = 'tavern_world_info_effects'

export const useTavernWorldInfoStore = create<TavernWorldInfoState>((set, get) => ({
  scanConfig: { ...DEFAULT_SCAN_CONFIG },
  timedEffects: new Map(),
  
  init: async () => {
    await get().load()
  },
  
  updateScanConfig: (updates: Partial<WorldInfoScanConfig>) => {
    set(state => ({
      scanConfig: { ...state.scanConfig, ...updates },
    }))
  },
  
  resetScanConfig: () => {
    set({ scanConfig: { ...DEFAULT_SCAN_CONFIG } })
  },
  
  getTimedEffects: (chatId: number) => {
    const effects = get().timedEffects.get(chatId)
    return effects || createTimedEffectsState()
  },
  
  setTimedEffects: (chatId: number, effects: TimedEffectsState) => {
    set(state => {
      const newMap = new Map(state.timedEffects)
      newMap.set(chatId, effects)
      return { timedEffects: newMap }
    })
  },
  
  clearTimedEffects: (chatId: number) => {
    set(state => {
      const newMap = new Map(state.timedEffects)
      newMap.delete(chatId)
      return { timedEffects: newMap }
    })
  },
  
  save: async () => {
    try {
      // 保存配置
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(get().scanConfig))
      
      // 保存定时效果 (转换 Map 为对象)
      const effectsObj: Record<string, string> = {}
      for (const [chatId, effects] of get().timedEffects) {
        effectsObj[chatId.toString()] = serializeTimedEffects(effects)
      }
      localStorage.setItem(EFFECTS_STORAGE_KEY, JSON.stringify(effectsObj))
    } catch (e) {
      console.error('Failed to save world info state:', e)
    }
  },
  
  load: async () => {
    try {
      // 加载配置
      const configStr = localStorage.getItem(CONFIG_STORAGE_KEY)
      if (configStr) {
        const config = JSON.parse(configStr) as Partial<WorldInfoScanConfig>
        set({ scanConfig: { ...DEFAULT_SCAN_CONFIG, ...config } })
      }
      
      // 加载定时效果
      const effectsStr = localStorage.getItem(EFFECTS_STORAGE_KEY)
      if (effectsStr) {
        const effectsObj = JSON.parse(effectsStr) as Record<string, string>
        const effectsMap = new Map<number, TimedEffectsState>()
        for (const [chatIdStr, effectsJson] of Object.entries(effectsObj)) {
          const chatId = parseInt(chatIdStr)
          if (!isNaN(chatId)) {
            effectsMap.set(chatId, deserializeTimedEffects(effectsJson))
          }
        }
        set({ timedEffects: effectsMap })
      }
    } catch (e) {
      console.error('Failed to load world info state:', e)
    }
  },
}))
