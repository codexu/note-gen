import { Tool, ToolResult } from '../types'
import { getMarks, insertMark, updateMark, delMark, restoreMark, Mark, insertMarks, updateMarks, deleteMarks, restoreMarks } from '@/db/marks'

export const readMarksTool: Tool = {
  name: 'read_marks',
  description: '读取指定标签下的所有记录（marks）',
  category: 'mark',
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
  description: '创建一条新的记录（mark）',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tagId',
      type: 'number',
      description: '标签ID',
      required: true,
    },
    {
      name: 'type',
      type: 'string',
      description: '记录类型：scan, text, image, link, file, recording',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '记录内容',
      required: false,
    },
    {
      name: 'url',
      type: 'string',
      description: '相关URL或文件路径',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: '描述信息',
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
  description: '更新指定的记录',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: '记录ID',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '新的内容',
      required: false,
    },
    {
      name: 'desc',
      type: 'string',
      description: '新的描述',
      required: false,
    },
    {
      name: 'tagId',
      type: 'number',
      description: '移动到新的标签',
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
  description: '删除指定的记录（软删除，可恢复）',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: '要删除的记录ID',
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
  description: '恢复已删除的记录',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: '要恢复的记录ID',
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
  description: '在记录中搜索包含关键词的内容',
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
    {
      name: 'type',
      type: 'string',
      description: '可选：按类型筛选（scan, text, image, link, file, recording）',
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
  description: '批量创建多条记录（marks），避免循环调用。适用于需要一次性创建多条记录的场景。',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: '要创建的记录数组，每个记录包含 tagId, type, content, url, desc 等字段',
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
  description: '批量更新多条记录，避免循环调用。每条记录必须包含 id 字段。',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'marks',
      type: 'array',
      description: '要更新的记录数组，每个记录必须包含 id 以及要更新的字段',
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
  description: '批量删除多条记录（软删除，可恢复），避免循环调用。',
  category: 'mark',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: '要删除的记录ID数组',
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
  description: '批量恢复已删除的记录，避免循环调用。',
  category: 'mark',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'ids',
      type: 'array',
      description: '要恢复的记录ID数组',
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
