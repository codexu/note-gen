import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  TavernChat,
  TavernMessage,
  getMessagesByChatId,
  getChatById,
  insertChat,
  insertMessage,
} from '@/db/tavern'
import {
  exportChat,
  importChat,
  downloadExport,
  selectChatFile,
  previewChatFile,
  detectChatFormat,
  type ExportOptions,
  type ImportResult,
  type ExportResult,
} from '@/lib/tavern/chat-io'

// 备份数据结构
export interface ChatBackup {
  id: string                    // 唯一标识 (timestamp-chatId)
  chatId: number                // 原聊天会话 ID
  chatName: string              // 聊天名称
  cardId: number                // 角色卡 ID
  cardName: string              // 角色名称
  messageCount: number          // 消息数量
  lastMessagePreview: string    // 最后消息预览
  createdAt: number             // 备份创建时间
  messages: TavernMessage[]     // 消息数据
  metadata: string              // 聊天元数据
}

// 备份设置
export interface BackupSettings {
  enabled: boolean              // 是否启用自动备份
  interval: number              // 备份间隔 (消息数)
  maxBackups: number            // 最大备份数量
  autoBackupOnClose: boolean    // 关闭聊天时自动备份
}

interface TavernChatBackupState {
  // 设置
  settings: BackupSettings
  
  // 备份数据 (按 chatId 分组)
  backupsByChatId: Map<number, ChatBackup[]>
  
  // 上次备份的消息数 (用于判断是否需要备份)
  lastBackupMessageCount: Map<number, number>
  
  // 设置操作
  updateSettings: (updates: Partial<BackupSettings>) => void
  
  // 备份操作
  createBackup: (
    chatId: number,
    cardName: string,
    force?: boolean
  ) => Promise<ChatBackup | null>
  
  // 检查是否需要备份
  shouldBackup: (chatId: number, currentMessageCount: number) => boolean
  
  // 获取聊天的备份列表
  getBackups: (chatId: number) => ChatBackup[]
  
  // 删除备份
  deleteBackup: (backupId: string) => void
  
  // 清理旧备份
  cleanupOldBackups: (chatId: number) => void
  
  // 恢复备份 (创建新聊天)
  restoreBackup: (backupId: string) => Promise<number | null>
  
  // 导出备份为 JSON
  exportBackup: (backupId: string) => string | null
  
  // 导入备份
  importBackup: (jsonData: string) => Promise<boolean>
  
  // === ST 格式支持 ===
  
  // 导出聊天为 ST JSONL 格式
  exportChatST: (chatId: number, characterName?: string, userName?: string) => Promise<ExportResult>
  
  // 导出聊天为 JSON 格式
  exportChatJSON: (chatId: number) => Promise<ExportResult>
  
  // 导入聊天文件 (自动检测格式)
  importChatFile: (cardId: number) => Promise<ImportResult>
  
  // 从内容导入聊天
  importChatContent: (content: string, cardId: number) => Promise<ImportResult>
  
  // 下载导出结果
  downloadExportResult: (result: ExportResult) => void
  
  // 选择并预览文件 (不导入)
  selectAndPreviewFile: () => Promise<{
    content: string
    filename: string
    preview: ReturnType<typeof previewChatFile>
  } | null>
  
  // 从内容确认导入
  confirmImport: (content: string, cardId: number) => Promise<ImportResult>
}

const DEFAULT_SETTINGS: BackupSettings = {
  enabled: true,
  interval: 10,           // 每 10 条消息备份一次
  maxBackups: 5,          // 每个聊天最多保留 5 个备份
  autoBackupOnClose: true,
}

export const useTavernChatBackupStore = create<TavernChatBackupState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      backupsByChatId: new Map(),
      lastBackupMessageCount: new Map(),
      
      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }))
      },
      
      createBackup: async (chatId, cardName, force = false) => {
        const { settings, backupsByChatId, lastBackupMessageCount } = get()
        
        if (!settings.enabled && !force) {
          return null
        }
        
        try {
          // 获取聊天信息
          const chat = await getChatById(chatId)
          if (!chat) return null
          
          // 获取所有消息
          const messages = await getMessagesByChatId(chatId)
          if (messages.length === 0) return null
          
          // 检查是否需要备份 (非强制时)
          if (!force) {
            const lastCount = lastBackupMessageCount.get(chatId) || 0
            if (messages.length - lastCount < settings.interval) {
              return null
            }
          }
          
          // 创建备份
          const lastMessage = messages[messages.length - 1]
          const backup: ChatBackup = {
            id: `${Date.now()}-${chatId}`,
            chatId,
            chatName: chat.name,
            cardId: chat.cardId,
            cardName,
            messageCount: messages.length,
            lastMessagePreview: lastMessage.content.slice(0, 100),
            createdAt: Date.now(),
            messages: messages,
            metadata: chat.metadata || '',
          }
          
          // 更新状态
          const newBackupsByChatId = new Map(backupsByChatId)
          const chatBackups = newBackupsByChatId.get(chatId) || []
          chatBackups.unshift(backup)
          newBackupsByChatId.set(chatId, chatBackups)
          
          const newLastBackupMessageCount = new Map(lastBackupMessageCount)
          newLastBackupMessageCount.set(chatId, messages.length)
          
          set({
            backupsByChatId: newBackupsByChatId,
            lastBackupMessageCount: newLastBackupMessageCount,
          })
          
          // 清理旧备份
          get().cleanupOldBackups(chatId)
          
          return backup
        } catch (error) {
          console.error('创建备份失败:', error)
          return null
        }
      },
      
      shouldBackup: (chatId, currentMessageCount) => {
        const { settings, lastBackupMessageCount } = get()
        if (!settings.enabled) return false
        
        const lastCount = lastBackupMessageCount.get(chatId) || 0
        return currentMessageCount - lastCount >= settings.interval
      },
      
      getBackups: (chatId) => {
        return get().backupsByChatId.get(chatId) || []
      },
      
      deleteBackup: (backupId) => {
        const { backupsByChatId } = get()
        const newBackupsByChatId = new Map(backupsByChatId)
        
        for (const [chatId, backups] of newBackupsByChatId) {
          const filtered = backups.filter(b => b.id !== backupId)
          if (filtered.length !== backups.length) {
            newBackupsByChatId.set(chatId, filtered)
            break
          }
        }
        
        set({ backupsByChatId: newBackupsByChatId })
      },
      
      cleanupOldBackups: (chatId) => {
        const { settings, backupsByChatId } = get()
        const chatBackups = backupsByChatId.get(chatId) || []
        
        if (chatBackups.length > settings.maxBackups) {
          const newBackupsByChatId = new Map(backupsByChatId)
          newBackupsByChatId.set(chatId, chatBackups.slice(0, settings.maxBackups))
          set({ backupsByChatId: newBackupsByChatId })
        }
      },
      
      restoreBackup: async (backupId) => {
        const { backupsByChatId } = get()
        
        // 查找备份
        let backup: ChatBackup | null = null
        for (const backups of backupsByChatId.values()) {
          const found = backups.find(b => b.id === backupId)
          if (found) {
            backup = found
            break
          }
        }
        
        if (!backup) return null
        
        try {
          // 创建新聊天
          const newChatId = await insertChat({
            cardId: backup.cardId,
            groupId: null,
            name: `${backup.chatName} (恢复自 ${new Date(backup.createdAt).toLocaleString()})`,
            metadata: backup.metadata,
            integrity: '',
          })
          
          if (!newChatId) return null
          
          // 恢复消息
          for (const msg of backup.messages) {
            await insertMessage({
              chatId: newChatId,
              role: msg.role,
              name: msg.name,
              content: msg.content,
              isHidden: msg.isHidden,
              swipeId: msg.swipeId,
              swipes: msg.swipes,
              sendDate: msg.sendDate,
              genStarted: msg.genStarted,
              genFinished: msg.genFinished,
              forceAvatar: msg.forceAvatar,
              originalAvatar: msg.originalAvatar,
              swipeInfo: msg.swipeInfo,
              extra: msg.extra,
            })
          }
          
          return newChatId
        } catch (error) {
          console.error('恢复备份失败:', error)
          return null
        }
      },
      
      exportBackup: (backupId) => {
        const { backupsByChatId } = get()
        
        for (const backups of backupsByChatId.values()) {
          const backup = backups.find(b => b.id === backupId)
          if (backup) {
            return JSON.stringify(backup, null, 2)
          }
        }
        
        return null
      },
      
      importBackup: async (jsonData) => {
        try {
          const backup = JSON.parse(jsonData) as ChatBackup
          
          // 验证数据结构
          if (!backup.id || !backup.chatId || !backup.messages) {
            throw new Error('无效的备份数据')
          }
          
          // 生成新 ID
          backup.id = `${Date.now()}-imported`
          
          // 添加到备份列表
          const { backupsByChatId } = get()
          const newBackupsByChatId = new Map(backupsByChatId)
          const chatBackups = newBackupsByChatId.get(backup.chatId) || []
          chatBackups.unshift(backup)
          newBackupsByChatId.set(backup.chatId, chatBackups)
          
          set({ backupsByChatId: newBackupsByChatId })
          
          return true
        } catch (error) {
          console.error('导入备份失败:', error)
          return false
        }
      },
      
      // === ST 格式支持 ===
      
      exportChatST: async (chatId, characterName, userName) => {
        return exportChat(chatId, {
          format: 'st_jsonl',
          characterName,
          userName,
        })
      },
      
      exportChatJSON: async (chatId) => {
        return exportChat(chatId, { format: 'json' })
      },
      
      importChatFile: async (cardId) => {
        const file = await selectChatFile()
        if (!file) {
          return { success: false, error: '未选择文件' }
        }
        return importChat(file.content, cardId)
      },
      
      importChatContent: async (content, cardId) => {
        return importChat(content, cardId)
      },
      
      downloadExportResult: (result) => {
        downloadExport(result)
      },
      
      selectAndPreviewFile: async () => {
        const file = await selectChatFile()
        if (!file) {
          return null
        }
        const preview = previewChatFile(file.content)
        return {
          content: file.content,
          filename: file.filename,
          preview,
        }
      },
      
      confirmImport: async (content, cardId) => {
        return importChat(content, cardId)
      },
    }),
    {
      name: 'tavern-chat-backup',
      // 自定义序列化以支持 Map
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name)
          if (!str) return null
          const data = JSON.parse(str)
          // 将数组转回 Map
          if (data.state?.backupsByChatId) {
            data.state.backupsByChatId = new Map(data.state.backupsByChatId)
          }
          if (data.state?.lastBackupMessageCount) {
            data.state.lastBackupMessageCount = new Map(data.state.lastBackupMessageCount)
          }
          return data
        },
        setItem: (name, value) => {
          // 将 Map 转为数组以便序列化
          const data = JSON.parse(JSON.stringify(value))
          if (value.state?.backupsByChatId instanceof Map) {
            data.state.backupsByChatId = Array.from(value.state.backupsByChatId.entries())
          }
          if (value.state?.lastBackupMessageCount instanceof Map) {
            data.state.lastBackupMessageCount = Array.from(value.state.lastBackupMessageCount.entries())
          }
          localStorage.setItem(name, JSON.stringify(data))
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
)
