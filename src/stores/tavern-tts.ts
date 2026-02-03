import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// TTS 配置
export interface TavernTTSConfig {
  enabled: boolean
  
  // 自动朗读设置
  autoPlay: boolean              // 自动朗读 AI 回复
  autoPlayDelay: number          // 自动朗读延迟 (ms)
  
  // 语音设置
  voice: string                  // 语音类型
  speed: number                  // 语速 (0.5-2.0)
  
  // 显示设置
  showPlayButton: boolean        // 显示播放按钮
  highlightWhilePlaying: boolean // 播放时高亮文本
  
  // 高级设置
  useSystemVoice: boolean        // 使用系统语音 (无需 AI 模型)
  chunkSize: number              // 分段大小 (字符数，0 表示不分段)
  skipCodeBlocks: boolean        // 跳过代码块
  skipEmoji: boolean             // 跳过表情符号
}

// 角色语音配置
export interface CharacterVoiceConfig {
  voice: string
  speed: number
  // 扩展字段
  pitch?: number           // 音调 (0.5-2.0)
  volume?: number          // 音量 (0-1)
  language?: string        // 语言代码
  provider?: string        // TTS 提供商 (openai, edge, system)
  customVoiceId?: string   // 自定义音色 ID
  // 预览文本
  previewText?: string
  // 元数据
  createdAt?: number
  updatedAt?: number
}

// 语音预设
 export interface VoicePreset {
  id: string
  name: string
  description?: string
  config: CharacterVoiceConfig
  tags?: string[]
}

// 群聊角色语音映射
export interface GroupChatVoiceMapping {
  chatId: number
  // 角色名称 -> 语音配置
  characterVoices: Record<string, CharacterVoiceConfig>
}

interface TavernTTSState {
  // 全局配置
  config: TavernTTSConfig
  
  // 角色特定语音配置 (cardId -> config)
  characterVoices: Record<number, CharacterVoiceConfig>
  
  // 语音预设
  voicePresets: VoicePreset[]
  
  // 群聊语音映射
  groupChatMappings: Record<number, GroupChatVoiceMapping>
  
  // 播放状态
  isPlaying: boolean
  currentMessageId: number | null
  playbackQueue: number[]  // 消息 ID 队列
  
  // 获取有效配置
  getEffectiveConfig: (cardId?: number, characterName?: string, chatId?: number) => TavernTTSConfig
  
  // 更新全局配置
  updateConfig: (updates: Partial<TavernTTSConfig>) => void
  
  // 角色语音配置
  setCharacterVoice: (cardId: number, config: CharacterVoiceConfig) => void
  getCharacterVoice: (cardId: number) => CharacterVoiceConfig | null
  updateCharacterVoice: (cardId: number, updates: Partial<CharacterVoiceConfig>) => void
  clearCharacterVoice: (cardId: number) => void
  
  // 语音预设管理
  addVoicePreset: (preset: Omit<VoicePreset, 'id'>) => string
  updateVoicePreset: (id: string, updates: Partial<Omit<VoicePreset, 'id'>>) => void
  deleteVoicePreset: (id: string) => void
  applyPresetToCharacter: (presetId: string, cardId: number) => void
  
  // 群聊语音映射
  setGroupChatVoice: (chatId: number, characterName: string, config: CharacterVoiceConfig) => void
  getGroupChatVoice: (chatId: number, characterName: string) => CharacterVoiceConfig | null
  clearGroupChatVoices: (chatId: number) => void
  
  // 播放状态管理
  setPlaying: (isPlaying: boolean, messageId?: number | null) => void
  addToQueue: (messageIds: number[]) => void
  clearQueue: () => void
  getNextInQueue: () => number | null
  
  // 导入导出
  exportVoiceSettings: () => string
  importVoiceSettings: (data: string) => { success: boolean; error?: string }
}

// 可用的语音列表 (OpenAI TTS 兼容)
export const AVAILABLE_VOICES = [
  { id: 'alloy', name: 'Alloy', description: '中性、平衡' },
  { id: 'echo', name: 'Echo', description: '温暖、清晰' },
  { id: 'fable', name: 'Fable', description: '表现力强' },
  { id: 'onyx', name: 'Onyx', description: '深沉、权威' },
  { id: 'nova', name: 'Nova', description: '友好、活泼' },
  { id: 'shimmer', name: 'Shimmer', description: '柔和、温柔' },
]

// 默认配置
const DEFAULT_CONFIG: TavernTTSConfig = {
  enabled: true,
  autoPlay: false,
  autoPlayDelay: 500,
  voice: 'alloy',
  speed: 1.0,
  showPlayButton: true,
  highlightWhilePlaying: false,
  useSystemVoice: false,
  chunkSize: 0,
  skipCodeBlocks: true,
  skipEmoji: false,
}

function generateId(): string {
  return `preset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useTavernTTSStore = create<TavernTTSState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      characterVoices: {},
      voicePresets: [],
      groupChatMappings: {},
      isPlaying: false,
      currentMessageId: null,
      playbackQueue: [],
      
      getEffectiveConfig: (cardId, characterName, chatId) => {
        const { config, characterVoices, groupChatMappings } = get()
        
        // 1. 先检查群聊语音映射
        if (chatId && characterName && groupChatMappings[chatId]) {
          const mapping = groupChatMappings[chatId]
          const voiceConfig = mapping.characterVoices[characterName]
          if (voiceConfig) {
            return {
              ...config,
              voice: voiceConfig.voice,
              speed: voiceConfig.speed,
            }
          }
        }
        
        // 2. 再检查角色语音配置
        if (cardId && characterVoices[cardId]) {
          return {
            ...config,
            voice: characterVoices[cardId].voice,
            speed: characterVoices[cardId].speed,
          }
        }
        
        return config
      },
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      setCharacterVoice: (cardId, voiceConfig) => {
        set((state) => ({
          characterVoices: {
            ...state.characterVoices,
            [cardId]: {
              ...voiceConfig,
              updatedAt: Date.now(),
              createdAt: state.characterVoices[cardId]?.createdAt || Date.now(),
            },
          },
        }))
      },
      
      getCharacterVoice: (cardId) => {
        return get().characterVoices[cardId] || null
      },
      
      updateCharacterVoice: (cardId, updates) => {
        set((state) => {
          const existing = state.characterVoices[cardId]
          if (!existing) return state
          return {
            characterVoices: {
              ...state.characterVoices,
              [cardId]: { ...existing, ...updates, updatedAt: Date.now() },
            },
          }
        })
      },
      
      clearCharacterVoice: (cardId) => {
        set((state) => {
          const newVoices = { ...state.characterVoices }
          delete newVoices[cardId]
          return { characterVoices: newVoices }
        })
      },
      
      // 语音预设管理
      addVoicePreset: (preset) => {
        const id = generateId()
        set((state) => ({
          voicePresets: [...state.voicePresets, { ...preset, id }],
        }))
        return id
      },
      
      updateVoicePreset: (id, updates) => {
        set((state) => ({
          voicePresets: state.voicePresets.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },
      
      deleteVoicePreset: (id) => {
        set((state) => ({
          voicePresets: state.voicePresets.filter((p) => p.id !== id),
        }))
      },
      
      applyPresetToCharacter: (presetId, cardId) => {
        const { voicePresets, setCharacterVoice } = get()
        const preset = voicePresets.find((p) => p.id === presetId)
        if (preset) {
          setCharacterVoice(cardId, preset.config)
        }
      },
      
      // 群聊语音映射
      setGroupChatVoice: (chatId, characterName, config) => {
        set((state) => {
          const existing = state.groupChatMappings[chatId] || {
            chatId,
            characterVoices: {},
          }
          return {
            groupChatMappings: {
              ...state.groupChatMappings,
              [chatId]: {
                ...existing,
                characterVoices: {
                  ...existing.characterVoices,
                  [characterName]: config,
                },
              },
            },
          }
        })
      },
      
      getGroupChatVoice: (chatId, characterName) => {
        const mapping = get().groupChatMappings[chatId]
        return mapping?.characterVoices[characterName] || null
      },
      
      clearGroupChatVoices: (chatId) => {
        set((state) => {
          const newMappings = { ...state.groupChatMappings }
          delete newMappings[chatId]
          return { groupChatMappings: newMappings }
        })
      },
      
      // 播放状态管理
      setPlaying: (isPlaying, messageId = null) => {
        set({
          isPlaying,
          currentMessageId: isPlaying ? messageId : null,
        })
      },
      
      addToQueue: (messageIds) => {
        set((state) => ({
          playbackQueue: [...state.playbackQueue, ...messageIds],
        }))
      },
      
      clearQueue: () => {
        set({ playbackQueue: [] })
      },
      
      getNextInQueue: () => {
        const { playbackQueue } = get()
        if (playbackQueue.length === 0) return null
        const [next, ...rest] = playbackQueue
        set({ playbackQueue: rest })
        return next
      },
      
      // 导入导出
      exportVoiceSettings: () => {
        const { config, characterVoices, voicePresets, groupChatMappings } = get()
        return JSON.stringify({
          version: 1,
          type: 'tavern-tts-settings',
          config,
          characterVoices,
          voicePresets,
          groupChatMappings,
          exportedAt: Date.now(),
        }, null, 2)
      },
      
      importVoiceSettings: (data) => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.type !== 'tavern-tts-settings') {
            return { success: false, error: '无效的数据格式' }
          }
          
          set({
            config: { ...DEFAULT_CONFIG, ...parsed.config },
            characterVoices: parsed.characterVoices || {},
            voicePresets: parsed.voicePresets || [],
            groupChatMappings: parsed.groupChatMappings || {},
          })
          
          return { success: true }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : '解析失败',
          }
        }
      },
    }),
    {
      name: 'tavern-tts',
      partialize: (state) => ({
        config: state.config,
        characterVoices: state.characterVoices,
        voicePresets: state.voicePresets,
        groupChatMappings: state.groupChatMappings,
      }),
    }
  )
)

// ============ 内置语音预设 ============
export const BUILT_IN_PRESETS: Omit<VoicePreset, 'id'>[] = [
  {
    name: '女性温柔',
    description: '柔和、温暖的女性音色',
    config: { voice: 'shimmer', speed: 1.0, pitch: 1.1 },
    tags: ['女性', '温柔'],
  },
  {
    name: '女性活泼',
    description: '充满活力的女性音色',
    config: { voice: 'nova', speed: 1.1, pitch: 1.05 },
    tags: ['女性', '活泼'],
  },
  {
    name: '男性深沉',
    description: '成熟、有权威的男性音色',
    config: { voice: 'onyx', speed: 0.95, pitch: 0.9 },
    tags: ['男性', '深沉'],
  },
  {
    name: '男性清晰',
    description: '清晰、友好的男性音色',
    config: { voice: 'echo', speed: 1.0, pitch: 1.0 },
    tags: ['男性', '清晰'],
  },
  {
    name: '中性平衡',
    description: '平衡、自然的中性音色',
    config: { voice: 'alloy', speed: 1.0, pitch: 1.0 },
    tags: ['中性'],
  },
  {
    name: '表现力强',
    description: '富有表现力的音色，适合讲故事',
    config: { voice: 'fable', speed: 1.0, pitch: 1.0 },
    tags: ['表现力'],
  },
]
