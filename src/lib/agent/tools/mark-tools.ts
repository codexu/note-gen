import { Tool, ToolResult } from '../types'
import { getMarks, insertMark, updateMark, delMark, restoreMark, Mark, insertMarks, updateMarks, deleteMarks, restoreMarks } from '@/db/marks'

export const readMarksTool: Tool = {
  name: 'read_marks',
  description: 'Read all marks under the specified tag',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getMarks(params.tagId)
      const activeMarks = marks.filter(m => m.deleted === 0)
      return {
        success: true,
        data: activeMarks,
        message: `找到 ${activeMarks.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取记录失败: ${error}`,
      }
    }
  },
}

export const createMarkTool: Tool = {
  name: 'create_mark',
  description: 'Create a new mark',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: 'Tag ID',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Mark type: scan, text, image, link, file, recording',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'Mark content',
      required: false,
    },
    {
      name: 'url',
      type: 'string',
      description: 'Related URL or file path',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'Description',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const mark: Partial<Mark> = {
        tagId: params.tagId,
        type: params.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: params.content,
        url: params.url || '',
        desc: params.desc,
      }
      const result = await insertMark(mark)
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建记录，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建记录失败: ${error}`,
      }
    }
  },
}

export const updateMarkTool: Tool = {
  name: 'update_mark',
  description: 'Update the specified mark',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Mark ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: 'New description',
      required: false,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Move to new tag',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getMarks(params.tagId || 1)
      const mark = marks.find(m => m.id === params.id)
      
      if (!mark) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的记录`,
        }
      }
      
      const updatedMark: Mark = {
        ...mark,
        content: params.content !== undefined ? params.content : mark.content,
        desc: params.desc !== undefined ? params.desc : mark.desc,
        tagId: params.tagId !== undefined ? params.tagId : mark.tagId,
      }
      
      await updateMark(updatedMark)
      return {
        success: true,
        message: `成功更新记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新记录失败: ${error}`,
      }
    }
  },
}

export const deleteMarkTool: Tool = {
  name: 'delete_mark',
  description: 'Delete the specified mark (soft delete, can be restored)',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the mark to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await delMark(params.id)
      return {
        success: true,
        message: `成功删除记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除记录失败: ${error}`,
      }
    }
  },
}

export const restoreMarkTool: Tool = {
  name: 'restore_mark',
  description: 'Restore deleted marks',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'ID of the mark to restore',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      await restoreMark(params.id)
      return {
        success: true,
        message: `成功恢复记录 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `恢复记录失败: ${error}`,
      }
    }
  },
}

export const searchMarksTool: Tool = {
  name: 'search_marks',
  description: 'Search marks for content containing keywords',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword',
      required: true,
    },
    {
      name: 'tagId',
      type: 'number',
      description: 'Optional: limit search to specified tag',
      required: false,
    },
    {
      name: 'type',
      type: 'string',
      description: 'Optional: filter by type (scan, text, image, link, file, recording)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const marks = await getMarks(params.tagId || 1)
      let results = marks.filter(mark => 
        mark.deleted === 0 &&
        (mark.content?.toLowerCase().includes(params.query.toLowerCase()) ||
         mark.desc?.toLowerCase().includes(params.query.toLowerCase()))
      )
      
      if (params.type) {
        results = results.filter(mark => mark.type === params.type)
      }
      
      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 条匹配的记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索记录失败: ${error}`,
      }
    }
  },
}

export const createMarksBatchTool: Tool = {
  name: 'create_marks_batch',
  description: 'Batch create multiple marks to avoid loop calls. Use for scenarios requiring multiple marks to be created at once.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to create, each mark contains tagId, type, content, url, desc and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: '参数 marks 必须是非空数组',
        }
      }

      const marksToInsert: Partial<Mark>[] = params.marks.map((mark: any) => ({
        tagId: mark.tagId,
        type: mark.type as 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording',
        content: mark.content,
        url: mark.url || '',
        desc: mark.desc,
        createdAt: Date.now(),
        deleted: 0,
      }))

      await insertMarks(marksToInsert)
      
      return {
        success: true,
        data: { count: marksToInsert.length },
        message: `成功批量创建 ${marksToInsert.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建记录失败: ${error}`,
      }
    }
  },
}

export const updateMarksBatchTool: Tool = {
  name: 'update_marks_batch',
  description: 'Batch update multiple marks to avoid loop calls. Each mark must include the id field.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: 'Array of marks to update, each mark must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.marks) || params.marks.length === 0) {
        return {
          success: false,
          error: '参数 marks 必须是非空数组',
        }
      }

      const marksToUpdate: Mark[] = params.marks.map((mark: any) => ({
        id: mark.id,
        tagId: mark.tagId,
        type: mark.type,
        content: mark.content,
        url: mark.url,
        desc: mark.desc,
        deleted: mark.deleted ?? 0,
        createdAt: mark.createdAt || Date.now(),
      }))

      await updateMarks(marksToUpdate)
      
      return {
        success: true,
        data: { count: marksToUpdate.length },
        message: `成功批量更新 ${marksToUpdate.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量更新记录失败: ${error}`,
      }
    }
  },
}

export const deleteMarksBatchTool: Tool = {
  name: 'delete_marks_batch',
  description: 'Batch delete multiple marks (soft delete, can be restored) to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to delete',
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

      await deleteMarks(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量删除 ${params.ids.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除记录失败: ${error}`,
      }
    }
  },
}

export const restoreMarksBatchTool: Tool = {
  name: 'restore_marks_batch',
  description: 'Batch restore deleted marks to avoid loop calls.',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: 'Array of mark IDs to restore',
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

      await restoreMarks(params.ids)
      
      return {
        success: true,
        data: { count: params.ids.length },
        message: `成功批量恢复 ${params.ids.length} 条记录`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量恢复记录失败: ${error}`,
      }
    }
  },
}

export const markTools: Tool[] = [
  readMarksTool,
  createMarkTool,
  updateMarkTool,
  deleteMarkTool,
  restoreMarkTool,
  searchMarksTool,
  createMarksBatchTool,
  updateMarksBatchTool,
  deleteMarksBatchTool,
  restoreMarksBatchTool,
]
