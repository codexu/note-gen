import { Tool, ToolResult } from '../types'
import { getNoteById, getNotesByTagId, insertNote, delNote, Note } from '@/db/notes'
import { getTags } from '@/db/tags'

export const readNoteTool: Tool = {
  name: 'read_note',
  description: '读取指定的笔记内容',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'noteId',
      type: 'number',
      description: '笔记的ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const note = await getNoteById(params.noteId)
      if (!note) {
        return {
          success: false,
          error: `未找到ID为 ${params.noteId} 的笔记`,
        }
      }
      return {
        success: true,
        data: note,
        message: `成功读取笔记 ID: ${note.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取笔记失败: ${error}`,
      }
    }
  },
}

export const createNoteTool: Tool = {
  name: 'create_note',
  description: '创建一个新的笔记',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: '标签ID，笔记将归属于此标签',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '笔记的内容（Markdown格式）',
      required: true,
    },
    {
      name: 'locale',
      type: 'string',
      description: '语言代码（如 en, zh-CN）',
      required: false,
      default: 'zh-CN',
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const note: Partial<Note> = {
        tagId: params.tagId,
        content: params.content,
        locale: params.locale || 'zh-CN',
        count: String(params.content?.length || 0),
      }
      const result = await insertNote(note)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建笔记，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建笔记失败: ${error}`,
      }
    }
  },
}

export const deleteNoteTool: Tool = {
  name: 'delete_note',
  description: '删除指定的笔记',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'noteId',
      type: 'number',
      description: '要删除的笔记ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await delNote(params.noteId)
      return {
        success: true,
        message: `成功删除笔记 ID: ${params.noteId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除笔记失败: ${error}`,
      }
    }
  },
}

export const listNotesByTagTool: Tool = {
  name: 'list_notes_by_tag',
  description: '列出指定标签下的所有笔记',
  category: 'note',
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
      const notes = await getNotesByTagId(params.tagId)
      return {
        success: true,
        data: notes,
        message: `找到 ${notes.length} 条笔记`,
      }
    } catch (error) {
      return {
        success: false,
        error: `获取笔记列表失败: ${error}`,
      }
    }
  },
}

export const searchNotesTool: Tool = {
  name: 'search_notes',
  description: '在所有笔记中搜索包含关键词的内容',
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
      const tags = await getTags()
      const allNotes: Note[] = []
      
      for (const tag of tags) {
        if (params.tagId && tag.id !== params.tagId) continue
        const notes = await getNotesByTagId(tag.id)
        allNotes.push(...notes)
      }
      
      const results = allNotes.filter(note => 
        note.content?.toLowerCase().includes(params.query.toLowerCase())
      )
      
      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 条匹配的笔记`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索笔记失败: ${error}`,
      }
    }
  },
}

export const noteTools: Tool[] = [
  readNoteTool,
  createNoteTool,
  deleteNoteTool,
  listNotesByTagTool,
  searchNotesTool,
]
