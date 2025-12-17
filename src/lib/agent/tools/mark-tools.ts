import { Tool, ToolResult } from '../types'
import { getMarks, insertMark, updateMark, delMark, restoreMark, Mark } from '@/db/marks'

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

export const markTools: Tool[] = [
  readMarksTool,
  createMarkTool,
  updateMarkTool,
  deleteMarkTool,
  restoreMarkTool,
  searchMarksTool,
]
