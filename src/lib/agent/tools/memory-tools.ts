import { Tool, ToolResult } from '../types'
import { upsertMemory, getAllMemories, getMemoriesByCategory, deleteMemory, clearAllMemories, Memory } from '@/db/memories'
import { fetchEmbedding } from '@/lib/ai/embedding'

/**
 * Tool: List all memories
 */
export const listMemoriesTool: Tool = {
  name: 'list_memories',
  description: `Query all saved memories (preferences and memory).

Use cases:
- Before adding a new memory, use this tool to check existing memories
- Check for conflicting memories (e.g., existing "answer in Chinese" vs new "answer in English")
- Get memory IDs for delete operations

Returns memory ID, content, and type (preference/memory).`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'category',
      type: 'string',
      description: 'Optional: Filter memory type (preference or memory)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let memories: Memory[]
      if (params.category) {
        memories = await getMemoriesByCategory(params.category as 'preference' | 'memory')
      } else {
        memories = await getAllMemories()
      }

      const formatted = memories.map(m =>
        `ID: ${m.id} [${m.category === 'preference' ? 'Preference' : 'Memory'}] ${m.content}`
      ).join('\n')

      return {
        success: true,
        message: `Found ${memories.length} memories:\n${formatted}`,
      }
    } catch {
      return {
        success: false,
        error: `Failed to get memory list`,
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
        message: `Memory deleted`,
      }
    } catch {
      return {
        success: false,
        error: `Failed to delete memory`,
      }
    }
  },
}

/**
 * Tool: Save or update memory
 */
export const saveMemoryTool: Tool = {
  name: 'save_memory',
  description: `Save or update a memory. MUST call this tool when user says "remember...", "in English", etc.

IMPORTANT WORKFLOW:
1. When user wants to remember something, first use list_memories to check existing memories
2. If conflict found (e.g., existing "answer in Japanese", now changing to "answer in English"):
   - First call delete_memory to remove old memory (requires user confirmation)
   - After deletion completes, MUST call this tool (save_memory) to save the new memory
3. If no conflict, directly call this tool to save

Supports two types:
- preference: User preferences like language, format, style - always included in conversations
- memory: User's facts, experience, expertise - matched intelligently via context

Examples:
- "Please answer in English" -> save as preference
- "Remember I'm a React expert" -> save as memory
- "I prefer English" -> save as preference
- "Use Japanese" -> save as preference`,
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
      description: 'Memory type: preference (user settings) or memory (facts/expertise). Auto-detected if not specified',
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
          error: 'Cannot generate vector embedding, please check embedding model configuration',
        }
      }

      // Save memory
      const result = await upsertMemory({
        content: params.content,
        embedding: JSON.stringify(embedding),
        category: params.category as 'preference' | 'memory' || undefined,
      })

      if (result.replaced) {
        return {
          success: true,
          message: `Memory updated (similar memory replaced)`,
        }
      }

      return {
        success: true,
        message: `Memory saved`,
      }
    } catch {
      return {
        success: false,
        error: `Failed to save memory`,
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
        message: `All memories cleared`,
      }
    } catch {
      return {
        success: false,
        error: `Failed to clear memories`,
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
