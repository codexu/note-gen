import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Logit Bias 条目
export interface LogitBiasEntry {
  id: string
  text: string      // 文本或 token ID
  value: number     // 偏置值 (-100 到 100)
  enabled: boolean  // 是否启用
}

// Logit Bias 预设
export interface LogitBiasPreset {
  id: string
  name: string
  entries: LogitBiasEntry[]
  isDefault: boolean
}

interface TavernLogitBiasState {
  // 预设列表
  presets: LogitBiasPreset[]
  
  // 当前选中的预设 ID
  currentPresetId: string | null
  
  // 角色绑定的预设 (cardId -> presetId)
  cardBindings: Record<number, string>
  
  // 获取当前预设
  getCurrentPreset: () => LogitBiasPreset | null
  
  // 获取角色绑定的预设
  getPresetForCard: (cardId: number) => LogitBiasPreset | null
  
  // 预设操作
  createPreset: (name: string) => string
  updatePreset: (id: string, updates: Partial<Omit<LogitBiasPreset, 'id'>>) => void
  deletePreset: (id: string) => void
  selectPreset: (id: string | null) => void
  
  // 条目操作
  addEntry: (presetId: string) => void
  updateEntry: (presetId: string, entryId: string, updates: Partial<Omit<LogitBiasEntry, 'id'>>) => void
  removeEntry: (presetId: string, entryId: string) => void
  reorderEntries: (presetId: string, fromIndex: number, toIndex: number) => void
  
  // 角色绑定
  bindPresetToCard: (cardId: number, presetId: string | null) => void
  
  // 转换为 API 格式
  toApiFormat: (presetId?: string) => Record<string, number>
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 默认预设
const DEFAULT_PRESETS: LogitBiasPreset[] = [
  {
    id: 'default',
    name: '默认',
    entries: [],
    isDefault: true,
  },
]

export const useTavernLogitBiasStore = create<TavernLogitBiasState>()(
  persist(
    (set, get) => ({
      presets: DEFAULT_PRESETS,
      currentPresetId: 'default',
      cardBindings: {},
      
      getCurrentPreset: () => {
        const { presets, currentPresetId } = get()
        return presets.find(p => p.id === currentPresetId) || null
      },
      
      getPresetForCard: (cardId) => {
        const { presets, cardBindings, currentPresetId } = get()
        const boundPresetId = cardBindings[cardId]
        if (boundPresetId) {
          return presets.find(p => p.id === boundPresetId) || null
        }
        // 回退到当前选中的预设
        return presets.find(p => p.id === currentPresetId) || null
      },
      
      createPreset: (name) => {
        const id = generateId()
        set((state) => ({
          presets: [
            ...state.presets,
            {
              id,
              name,
              entries: [],
              isDefault: false,
            },
          ],
          currentPresetId: id,
        }))
        return id
      },
      
      updatePreset: (id, updates) => {
        set((state) => ({
          presets: state.presets.map(p =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },
      
      deletePreset: (id) => {
        const { presets, currentPresetId, cardBindings } = get()
        const preset = presets.find(p => p.id === id)
        if (!preset || preset.isDefault) return
        
        // 清理角色绑定
        const newBindings = { ...cardBindings }
        for (const [cardId, presetId] of Object.entries(newBindings)) {
          if (presetId === id) {
            delete newBindings[Number(cardId)]
          }
        }
        
        set({
          presets: presets.filter(p => p.id !== id),
          currentPresetId: currentPresetId === id ? 'default' : currentPresetId,
          cardBindings: newBindings,
        })
      },
      
      selectPreset: (id) => {
        set({ currentPresetId: id })
      },
      
      addEntry: (presetId) => {
        set((state) => ({
          presets: state.presets.map(p =>
            p.id === presetId
              ? {
                  ...p,
                  entries: [
                    ...p.entries,
                    {
                      id: generateId(),
                      text: '',
                      value: 0,
                      enabled: true,
                    },
                  ],
                }
              : p
          ),
        }))
      },
      
      updateEntry: (presetId, entryId, updates) => {
        set((state) => ({
          presets: state.presets.map(p =>
            p.id === presetId
              ? {
                  ...p,
                  entries: p.entries.map(e =>
                    e.id === entryId ? { ...e, ...updates } : e
                  ),
                }
              : p
          ),
        }))
      },
      
      removeEntry: (presetId, entryId) => {
        set((state) => ({
          presets: state.presets.map(p =>
            p.id === presetId
              ? {
                  ...p,
                  entries: p.entries.filter(e => e.id !== entryId),
                }
              : p
          ),
        }))
      },
      
      reorderEntries: (presetId, fromIndex, toIndex) => {
        set((state) => ({
          presets: state.presets.map(p => {
            if (p.id !== presetId) return p
            const entries = [...p.entries]
            const [removed] = entries.splice(fromIndex, 1)
            entries.splice(toIndex, 0, removed)
            return { ...p, entries }
          }),
        }))
      },
      
      bindPresetToCard: (cardId, presetId) => {
        set((state) => {
          const newBindings = { ...state.cardBindings }
          if (presetId) {
            newBindings[cardId] = presetId
          } else {
            delete newBindings[cardId]
          }
          return { cardBindings: newBindings }
        })
      },
      
      // 转换为 OpenAI API 格式
      // 返回 { "token_text": bias_value } 格式
      toApiFormat: (presetId) => {
        const { presets, currentPresetId } = get()
        const preset = presets.find(p => p.id === (presetId || currentPresetId))
        if (!preset) return {}
        
        const result: Record<string, number> = {}
        
        for (const entry of preset.entries) {
          if (!entry.enabled || !entry.text.trim()) continue
          
          const text = entry.text.trim()
          // 将偏置值限制在 -100 到 100 之间
          const value = Math.max(-100, Math.min(100, entry.value))
          
          // 支持多种格式:
          // 1. 普通文本: "hello" -> 添加前导空格
          // 2. 精确文本: {hello} -> 不添加空格
          // 3. Token ID: [123, 456] -> 直接使用
          
          if (text.startsWith('{') && text.endsWith('}')) {
            // 精确文本
            result[text.slice(1, -1)] = value
          } else if (text.startsWith('[') && text.endsWith(']')) {
            // Token ID 数组 - 暂时跳过，需要后端支持
            // TODO: 实现 token ID 支持
          } else {
            // 普通文本，添加前导空格
            result[` ${text}`] = value
          }
        }
        
        return result
      },
    }),
    {
      name: 'tavern-logit-bias',
    }
  )
)
