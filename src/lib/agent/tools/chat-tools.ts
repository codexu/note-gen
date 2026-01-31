import { Tool, ToolResult } from '../types'
import { getChats, insertChat, updateChat, deleteChat, clearChatsByTagId, Chat, insertChats, updateChats, deleteChats } from '@/db/chats'

export const readChatsTool: Tool = {
  name: 'read_chats',
  description: '读取指定标签下的所有对话记录',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: '标签ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId)
      return {
        success: true,
        data: chats,
        message: `找到 ${chats.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取对话记录失败: ${error}`,
      }
    }
  },
}

export const createChatTool: Tool = {
  name: 'create_chat',
  description: '创建一条新的对话记录',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: '标签ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '对话内容',
      required: true,
    },
    {
      name: 'role',
      type: 'string',
      description: '角色：system 或 user',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: '类型：chat, note, clipboard, clear',
      required: false,
      default: 'chat',
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chat: Omit<Chat, 'id' | 'createdAt'> = {
        tagId: params.tagId,
        content: params.content,
        role: params.role as 'system' | 'user',
        type: (params.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
      }
      const result = await insertChat(chat)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建对话记录，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建对话记录失败: ${error}`,
      }
    }
  },
}

export const updateChatTool: Tool = {
  name: 'update_chat',
  description: '更新指定的对话记录',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: '对话记录ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '新的对话内容',
      required: false,
    },
    {
      name: 'inserted',
      type: 'boolean',
      description: '是否已插入到笔记中',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const chat = chats.find(c => c.id === params.id)
      
      if (!chat) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的对话记录`,
        }
      }
      
      const updatedChat: Chat = {
        ...chat,
        content: params.content !== undefined ? params.content : chat.content,
        inserted: params.inserted !== undefined ? params.inserted : chat.inserted,
      }
      
      await updateChat(updatedChat)
      return {
        success: true,
        message: `成功更新对话记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新对话记录失败: ${error}`,
      }
    }
  },
}

export const deleteChatTool: Tool = {
  name: 'delete_chat',
  description: '删除指定的对话记录',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: '要删除的对话记录ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await deleteChat(params.id)
      return {
        success: true,
        message: `成功删除对话记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除对话记录失败: ${error}`,
      }
    }
  },
}

export const clearChatsTool: Tool = {
  name: 'clear_chats',
  description: '清空指定标签下的所有对话记录',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: '标签ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await clearChatsByTagId(params.tagId)
      return {
        success: true,
        message: `成功清空标签 ${params.tagId} 下的所有对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `清空对话记录失败: ${error}`,
      }
    }
  },
}

export const searchChatsTool: Tool = {
  name: 'search_chats',
  description: '在对话记录中搜索包含关键词的内容',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: '搜索关键词',
      required: true,
    },
    {
      name: 'tagId',
      type: 'number',
      description: '可选：限制在指定标签下搜索',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const chats = await getChats(params.tagId || 1)
      const results = chats.filter(chat => 
        chat.content?.toLowerCase().includes(params.query.toLowerCase())
      )
      
      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 条匹配的对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索对话记录失败: ${error}`,
      }
    }
  },
}

export const createChatsBatchTool: Tool = {
  name: 'create_chats_batch',
  description: '批量创建多条对话记录，避免循环调用。适用于需要一次性创建多条对话的场景。',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: '要创建的对话记录数组，每条记录包含 tagId, content, role, type 等字段',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: '参数 chats 必须是非空数组',
        }
      }

      const chatsToInsert: Chat[] = params.chats.map((chat: any) => ({
        id: 0,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role as 'system' | 'user',
        type: (chat.type || 'chat') as 'chat' | 'note' | 'clipboard' | 'clear',
        inserted: false,
        createdAt: Date.now(),
      }))

      await insertChats(chatsToInsert)
      
      return {
        success: true,
        data: { count: chatsToInsert.length },
        message: `成功批量创建 ${chatsToInsert.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建对话记录失败: ${error}`,
      }
    }
  },
}

export const updateChatsBatchTool: Tool = {
  name: 'update_chats_batch',
  description: '批量更新多条对话记录，避免循环调用。每条记录必须包含 id 字段。',
  category: 'chat',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'chats',
      type: 'array',
      description: '要更新的对话记录数组，每条记录必须包含 id 以及要更新的字段',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.chats) || params.chats.length === 0) {
        return {
          success: false,
          error: '参数 chats 必须是非空数组',
        }
      }

      const chatsToUpdate: Chat[] = params.chats.map((chat: any) => ({
        id: chat.id,
        tagId: chat.tagId,
        content: chat.content,
        role: chat.role,
        type: chat.type,
        inserted: chat.inserted ?? false,
        createdAt: chat.createdAt || Date.now(),
        image: chat.image,
        images: chat.images,
        ragSources: chat.ragSources,
        agentHistory: chat.agentHistory,
        thinking: chat.thinking,
        quoteData: chat.quoteData,
      }))

      await updateChats(chatsToUpdate)
      
      return {
        success: true,
        data: { count: chatsToUpdate.length },
        message: `成功批量更新 ${chatsToUpdate.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量更新对话记录失败: ${error}`,
      }
    }
  },
}

export const deleteChatsBatchTool: Tool = {
  name: 'delete_chats_batch',
  description: '批量删除多条对话记录，避免循环调用。',
  category: 'chat',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: '要删除的对话记录ID数组',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.ids) || params.ids.length === 0) {
        return {
          success: false,
          error: '参数 ids 必须是非空数组',
        }
      }

      await deleteChats(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量删除 ${params.ids.length} 条对话记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除对话记录失败: ${error}`,
      }
    }
  },
}

export const chatTools: Tool[] = [
  readChatsTool,
  createChatTool,
  updateChatTool,
  deleteChatTool,
  clearChatsTool,
  searchChatsTool,
  createChatsBatchTool,
  updateChatsBatchTool,
  deleteChatsBatchTool,
]
