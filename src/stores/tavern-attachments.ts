import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 附件类型
export type AttachmentType = 'text' | 'code' | 'document' | 'data' | 'other'

// 附件定义
export interface Attachment {
  id: string
  name: string
  type: AttachmentType
  mimeType: string
  size: number
  content: string           // 文本内容
  path?: string             // 本地路径
  createdAt: number
  
  // 上下文设置
  includeInContext: boolean
  contextTemplate: string   // 上下文模板
  maxLength: number         // 最大长度 (0=不限制)
  
  // 元数据
  description?: string
  tags?: string[]
}

// 数据银行条目 (持久化的附件集合)
export interface DataBankEntry {
  id: string
  name: string
  description: string
  attachments: Attachment[]
  createdAt: number
  updatedAt: number
}

// 附件配置
export interface AttachmentsConfig {
  enabled: boolean
  
  // 上下文设置
  defaultIncludeInContext: boolean
  defaultContextTemplate: string
  defaultMaxLength: number
  
  // 显示设置
  showPreview: boolean
  previewMaxLines: number
  
  // 文件类型设置
  allowedTypes: string[]    // MIME 类型
  maxFileSize: number       // 最大文件大小 (bytes)
}

interface TavernAttachmentsState {
  // 全局配置
  config: AttachmentsConfig
  
  // 数据银行 (持久化)
  dataBank: DataBankEntry[]
  
  // 聊天附件 (chatId -> attachments)
  chatAttachments: Record<number, Attachment[]>
  
  // 待发送附件
  pendingAttachments: Attachment[]
  
  // 配置管理
  updateConfig: (updates: Partial<AttachmentsConfig>) => void
  
  // 数据银行管理
  addDataBankEntry: (entry: Omit<DataBankEntry, 'id' | 'createdAt' | 'updatedAt'>) => string
  updateDataBankEntry: (id: string, updates: Partial<DataBankEntry>) => void
  deleteDataBankEntry: (id: string) => void
  getDataBankEntry: (id: string) => DataBankEntry | null
  
  // 待发送附件管理
  addPendingAttachment: (attachment: Omit<Attachment, 'id' | 'createdAt'>) => void
  removePendingAttachment: (id: string) => void
  clearPendingAttachments: () => void
  updatePendingAttachment: (id: string, updates: Partial<Attachment>) => void
  
  // 聊天附件管理
  addChatAttachment: (chatId: number, attachment: Attachment) => void
  getChatAttachments: (chatId: number) => Attachment[]
  removeChatAttachment: (chatId: number, attachmentId: string) => void
  clearChatAttachments: (chatId: number) => void
  
  // 从数据银行添加到待发送
  addFromDataBank: (entryId: string, attachmentIds?: string[]) => void
}

// 生成唯一 ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

// 根据 MIME 类型判断附件类型
export function getAttachmentType(mimeType: string): AttachmentType {
  if (mimeType.startsWith('text/plain')) return 'text'
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || 
      mimeType.includes('python') || mimeType.includes('java') ||
      mimeType.includes('json') || mimeType.includes('xml') ||
      mimeType.includes('html') || mimeType.includes('css')) return 'code'
  if (mimeType.includes('pdf') || mimeType.includes('word') || 
      mimeType.includes('document')) return 'document'
  if (mimeType.includes('csv') || mimeType.includes('excel') ||
      mimeType.includes('spreadsheet')) return 'data'
  return 'other'
}

// 默认配置
const DEFAULT_CONFIG: AttachmentsConfig = {
  enabled: true,
  defaultIncludeInContext: true,
  defaultContextTemplate: '[附件: {{name}}]\n```\n{{content}}\n```',
  defaultMaxLength: 10000,
  showPreview: true,
  previewMaxLines: 10,
  allowedTypes: [
    'text/*',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/pdf',
  ],
  maxFileSize: 5 * 1024 * 1024, // 5MB
}

export const useTavernAttachmentsStore = create<TavernAttachmentsState>()(
  persist(
    (set, get) => ({
      config: { ...DEFAULT_CONFIG },
      dataBank: [],
      chatAttachments: {},
      pendingAttachments: [],
      
      updateConfig: (updates) => {
        set((state) => ({
          config: { ...state.config, ...updates },
        }))
      },
      
      addDataBankEntry: (entry) => {
        const id = generateId()
        const now = Date.now()
        set((state) => ({
          dataBank: [
            ...state.dataBank,
            {
              ...entry,
              id,
              createdAt: now,
              updatedAt: now,
            },
          ],
        }))
        return id
      },
      
      updateDataBankEntry: (id, updates) => {
        set((state) => ({
          dataBank: state.dataBank.map(entry =>
            entry.id === id
              ? { ...entry, ...updates, updatedAt: Date.now() }
              : entry
          ),
        }))
      },
      
      deleteDataBankEntry: (id) => {
        set((state) => ({
          dataBank: state.dataBank.filter(entry => entry.id !== id),
        }))
      },
      
      getDataBankEntry: (id) => {
        return get().dataBank.find(entry => entry.id === id) || null
      },
      
      addPendingAttachment: (attachment) => {
        const { config } = get()
        set((state) => ({
          pendingAttachments: [
            ...state.pendingAttachments,
            {
              ...attachment,
              id: generateId(),
              createdAt: Date.now(),
              includeInContext: attachment.includeInContext ?? config.defaultIncludeInContext,
              contextTemplate: attachment.contextTemplate || config.defaultContextTemplate,
              maxLength: attachment.maxLength ?? config.defaultMaxLength,
            },
          ],
        }))
      },
      
      removePendingAttachment: (id) => {
        set((state) => ({
          pendingAttachments: state.pendingAttachments.filter(a => a.id !== id),
        }))
      },
      
      clearPendingAttachments: () => {
        set({ pendingAttachments: [] })
      },
      
      updatePendingAttachment: (id, updates) => {
        set((state) => ({
          pendingAttachments: state.pendingAttachments.map(a =>
            a.id === id ? { ...a, ...updates } : a
          ),
        }))
      },
      
      addChatAttachment: (chatId, attachment) => {
        set((state) => ({
          chatAttachments: {
            ...state.chatAttachments,
            [chatId]: [...(state.chatAttachments[chatId] || []), attachment],
          },
        }))
      },
      
      getChatAttachments: (chatId) => {
        return get().chatAttachments[chatId] || []
      },
      
      removeChatAttachment: (chatId, attachmentId) => {
        set((state) => ({
          chatAttachments: {
            ...state.chatAttachments,
            [chatId]: (state.chatAttachments[chatId] || []).filter(a => a.id !== attachmentId),
          },
        }))
      },
      
      clearChatAttachments: (chatId) => {
        set((state) => {
          const newAttachments = { ...state.chatAttachments }
          delete newAttachments[chatId]
          return { chatAttachments: newAttachments }
        })
      },
      
      addFromDataBank: (entryId, attachmentIds) => {
        const entry = get().getDataBankEntry(entryId)
        if (!entry) return
        
        const attachmentsToAdd = attachmentIds
          ? entry.attachments.filter(a => attachmentIds.includes(a.id))
          : entry.attachments
        
        attachmentsToAdd.forEach(attachment => {
          // 解构排除 id 和 createdAt，因为 addPendingAttachment 会生成新的
          const { id: _id, createdAt: _createdAt, ...attachmentData } = attachment
          get().addPendingAttachment(attachmentData)
        })
      },
    }),
    {
      name: 'tavern-attachments',
      partialize: (state) => ({
        config: state.config,
        dataBank: state.dataBank,
      }),
    }
  )
)
