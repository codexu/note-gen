import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 图片描述配置
export interface ImageCaptionConfig {
  enabled: boolean
  
  // 描述设置
  captionPrompt: string       // 描述提示词
  maxTokens: number           // 最大 token 数
  detailLevel: 'low' | 'medium' | 'high'  // 描述详细程度
  
  // 显示设置
  showCaption: boolean        // 显示描述
  showThumbnail: boolean      // 显示缩略图
  thumbnailSize: number       // 缩略图大小 (px)
  
  // 上下文设置
  includeInContext: boolean   // 将描述包含在上下文中
  contextTemplate: string     // 上下文模板
  
  // 高级设置
  autoCaption: boolean        // 自动描述 (发送时自动生成)
  cacheDescriptions: boolean  // 缓存描述
}

// 图片附件
export interface ImageAttachment {
  id: string
  filename: string
  path: string                // 本地路径
  dataUrl?: string            // Base64 数据 URL
  mimeType: string
  size: number
  width?: number
  height?: number
  caption?: string            // AI 生成的描述
  captionGeneratedAt?: number
  thumbnailDataUrl?: string   // 缩略图
}

// 聊天图片记录
export interface ChatImageRecord {
  messageId: number
  images: ImageAttachment[]
}

interface TavernImageCaptionState {
  // 全局配置
  config: ImageCaptionConfig
  
  // 角色特定配置 (cardId -> config)
  cardConfigs: Record<number, Partial<ImageCaptionConfig>>
  
  // 聊天图片记录 (chatId -> records)
  chatImages: Record<number, ChatImageRecord[]>
  
  // 待发送的图片
  pendingImages: ImageAttachment[]
  
  // 获取有效配置
  getEffectiveConfig: (cardId?: number) => ImageCaptionConfig
  
  // 更新全局配置
  updateConfig: (updates: Partial<ImageCaptionConfig>) => void
  
  // 更新角色配置
  updateCardConfig: (cardId: number, updates: Partial<ImageCaptionConfig>) => void
  clearCardConfig: (cardId: number) => void
  
  // 待发送图片操作
  addPendingImage: (image: ImageAttachment) => void
  removePendingImage: (imageId: string) => void
  clearPendingImages: () => void
  updatePendingImageCaption: (imageId: string, caption: string) => void
  
  // 聊天图片记录操作
  addChatImage: (chatId: number, messageId: number, image: ImageAttachment) => void
  getChatImages: (chatId: number, messageId: number) => ImageAttachment[]
  clearChatImages: (chatId: number) => void
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 默认配置
const DEFAULT_CONFIG: ImageCaptionConfig = {
  enabled: true,
  captionPrompt: '请详细描述这张图片的内容，包括场景、人物、物体、颜色、氛围等。',
  maxTokens: 300,
  detailLevel: 'medium',
  showCaption: true,
  showThumbnail: true,
  thumbnailSize: 150,
  includeInContext: true,
  contextTemplate: '[图片描述: {{caption}}]',
  autoCaption: true,
  cacheDescriptions: true,
}

export const useTavernImageCaptionStore = create<TavernImageCaptionState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      cardConfigs: {},
      chatImages: {},
      pendingImages: [],
      
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
      
      addPendingImage: (image) => {
        set((state) => ({
          pendingImages: [...state.pendingImages, { ...image, id: image.id || generateId() }],
        }))
      },
      
      removePendingImage: (imageId) => {
        set((state) => ({
          pendingImages: state.pendingImages.filter(img => img.id !== imageId),
        }))
      },
      
      clearPendingImages: () => {
        set({ pendingImages: [] })
      },
      
      updatePendingImageCaption: (imageId, caption) => {
        set((state) => ({
          pendingImages: state.pendingImages.map(img =>
            img.id === imageId
              ? { ...img, caption, captionGeneratedAt: Date.now() }
              : img
          ),
        }))
      },
      
      addChatImage: (chatId, messageId, image) => {
        set((state) => {
          const chatRecords = state.chatImages[chatId] || []
          const existingRecord = chatRecords.find(r => r.messageId === messageId)
          
          if (existingRecord) {
            return {
              chatImages: {
                ...state.chatImages,
                [chatId]: chatRecords.map(r =>
                  r.messageId === messageId
                    ? { ...r, images: [...r.images, image] }
                    : r
                ),
              },
            }
          } else {
            return {
              chatImages: {
                ...state.chatImages,
                [chatId]: [...chatRecords, { messageId, images: [image] }],
              },
            }
          }
        })
      },
      
      getChatImages: (chatId, messageId) => {
        const { chatImages } = get()
        const records = chatImages[chatId] || []
        const record = records.find(r => r.messageId === messageId)
        return record?.images || []
      },
      
      clearChatImages: (chatId) => {
        set((state) => {
          const newChatImages = { ...state.chatImages }
          delete newChatImages[chatId]
          return { chatImages: newChatImages }
        })
      },
    }),
    {
      name: 'tavern-image-caption',
      partialize: (state) => ({
        config: state.config,
        cardConfigs: state.cardConfigs,
        // 不持久化图片数据，避免存储过大
      }),
    }
  )
)
