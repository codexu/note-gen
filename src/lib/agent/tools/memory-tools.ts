import { Tool, ToolResult } from '../types'
import { upsertMemory, getAllMemories, getMemoriesByCategory, deleteMemory, clearAllMemories, Memory } from '@/db/memories'
import { fetchEmbedding } from '@/lib/ai/embedding'

/**
 * Tool: List all memories
 */
export const listMemoriesTool: Tool = {
  name: 'list_memories',
  description: `Query all saved memories (preferences and knowledge).

Use cases:
- Before adding a new memory, use this tool to check existing memories
- Check for conflicting memories (e.g., existing "answer in Chinese" vs new "answer in English")
- Get memory IDs for delete operations

Returns memory ID, content, and type (preference/knowledge).`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'category',
      type: 'string',
      description: 'Optional: Filter memory type (preference or knowledge)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let memories: Memory[]
      if (params.category) {
        memories = await getMemoriesByCategory(params.category as 'preference' | 'knowledge')
      } else {
        memories = await getAllMemories()
      }

      const formatted = memories.map(m =>
        `ID: ${m.id} [${m.category === 'preference' ? '偏好' : '知识'}] ${m.content}`
      ).join('\n')

      return {
        success: true,
        message: `找到 ${memories.length} 条记忆：\n${formatted}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `获取记忆列表失败`,
      }
    }
  },
}

/**
 * Tool: Delete a specific memory
 */
export const deleteMemoryTool: Tool = {
  name: 'delete_memory',
  description: `Delete a specific memory.

IMPORTANT: After deletion, you MUST call save_memory to save the new memory. Do not just delete without saving.

Use cases:
- When replacing a conflicting memory, first delete the old one, then MUST call save_memory to save the new one
- When user explicitly requests to delete a specific memory

Parameters:
- id: Memory ID (obtained from list_memories result)`,
  category: 'system',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'string',
      description: 'Memory ID (from list_memories result)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await deleteMemory(params.id)
      return {
        success: true,
        message: `记忆已删除`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除记忆失败: ${error}`,
      }
    }
  },
}

/**
 * Tool: Save or update memory
 */
export const saveMemoryTool: Tool = {
  name: 'save_memory',
  description: `Save or update a memory. MUST call this tool when user says "remember...", "in English", "请记住...", etc.

IMPORTANT WORKFLOW:
1. When user wants to remember something, first use list_memories to check existing memories
2. If conflict found (e.g., existing "answer in Japanese", now changing to "answer in English"):
   - First call delete_memory to remove old memory (requires user confirmation)
   - After deletion completes, MUST call this tool (save_memory) to save the new memory
3. If no conflict, directly call this tool to save

Supports two types:
- preference: User preferences like language, format, style - always included in conversations
- knowledge: User's knowledge, facts, experience - matched intelligently via context

Examples:
- "请记住我喜欢用中文回答" -> save as preference
- "记住我是React专家" -> save as knowledge
- "I prefer English" -> save as preference
- "用日语" -> save as preference`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to remember',
      required: true,
    },
    {
      name: 'category',
      type: 'string',
      description: 'Memory type: preference (user settings) or knowledge (facts/expertise). Auto-detected if not specified',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      // Calculate embedding
      const embedding = await fetchEmbedding(params.content)
      if (!embedding) {
        return {
          success: false,
          error: '无法生成向量嵌入，请检查嵌入模型配置',
        }
      }

      // Save memory
      const result = await upsertMemory({
        content: params.content,
        embedding: JSON.stringify(embedding),
        category: params.category as 'preference' | 'knowledge' || undefined,
      })

      if (result.replaced) {
        return {
          success: true,
          message: `记忆已更新（已替换相似记忆）`,
        }
      }

      return {
        success: true,
        message: `记忆已保存`,
      }
    } catch (error) {
      return {
        success: false,
        error: `保存记忆失败: ${error}`,
      }
    }
  },
}

/**
 * Tool: Clear all memories
 */
export const clearMemoriesTool: Tool = {
  name: 'clear_all_memories',
  description: `Clear all memories.

Use cases:
- When user explicitly requests to clear all memories
- Reset all memory data

WARNING: This operation is irreversible, use with caution`,
  category: 'system',
  requiresConfirmation: true,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      await clearAllMemories()
      return {
        success: true,
        message: `所有记忆已清空`,
      }
    } catch (error) {
      return {
        success: false,
        error: `清空记忆失败: ${error}`,
      }
    }
  },
}

export const memoryTools: Tool[] = [
  saveMemoryTool,
  listMemoriesTool,
  deleteMemoryTool,
  clearMemoriesTool,
]
