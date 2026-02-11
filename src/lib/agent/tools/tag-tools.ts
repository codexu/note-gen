import { Tool, ToolResult } from '../types'
import { getTags, insertTag, updateTag, delTag, Tag, insertTags } from '@/db/tags'

export const listTagsTool: Tool = {
  name: 'list_tags',
  description: 'List all tags (organization categories for marks).',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      return {
        success: true,
        data: tags,
        message: `找到 ${tags.length} 个标签`,
      }
    } catch (error) {
      return {
        success: false,
        error: `获取标签列表失败: ${error}`,
      }
    }
  },
}

export const createTagTool: Tool = {
  name: 'create_tag',
  description: 'Create a new tag (category) for organizing marks.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'name',
      type: 'string',
      description: 'Tag name (e.g., "Inbox", "Bookmarks", "Recipes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const result = await insertTag({ name: params.name })
      return {
        success: true,
        data: { id: result.lastInsertId },
        message: `成功创建标签 "${params.name}"，ID: ${result.lastInsertId}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建标签失败: ${error}`,
      }
    }
  },
}

export const updateTagTool: Tool = {
  name: 'update_tag',
  description: 'Update tag name or properties (pin status).',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Tag ID (use list_tags first to get tag IDs)',
      required: true,
    },
    {
      name: 'name',
      type: 'string',
      description: 'New tag name',
      required: false,
    },
    {
      name: 'isPin',
      type: 'boolean',
      description: 'Pin or unpin the tag',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const tag = tags.find(t => t.id === params.id)
      
      if (!tag) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的标签`,
        }
      }
      
      const updatedTag: Tag = {
        ...tag,
        name: params.name !== undefined ? params.name : tag.name,
        isPin: params.isPin !== undefined ? params.isPin : tag.isPin,
      }
      
      await updateTag(updatedTag)
      return {
        success: true,
        message: `成功更新标签 ID: ${params.id}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新标签失败: ${error}`,
      }
    }
  },
}

export const searchTagsTool: Tool = {
  name: 'search_tags',
  description: 'Search tags by name (fuzzy match).',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword (fuzzy match on tag name)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const queryLower = params.query.toLowerCase()

      const results = tags.filter(tag =>
        tag.name.toLowerCase().includes(queryLower)
      )

      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 个匹配的标签`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索标签失败: ${error}`,
      }
    }
  },
}

export const deleteTagTool: Tool = {
  name: 'delete_tag',
  description: 'Delete a tag and ALL marks under it. Use with caution.',
  category: 'tag',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'id',
      type: 'number',
      description: 'Tag ID to delete (use list_tags first to get tag IDs)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const tags = await getTags()
      const tag = tags.find(t => t.id === params.id)
      
      if (!tag) {
        return {
          success: false,
          error: `未找到ID为 ${params.id} 的标签`,
        }
      }
      
      if (tag.isLocked) {
        return {
          success: false,
          error: `标签 "${tag.name}" 已锁定，无法删除`,
        }
      }
      
      await delTag(params.id)
      return {
        success: true,
        message: `成功删除标签 "${tag.name}"`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除标签失败: ${error}`,
      }
    }
  },
}

export const createTagsBatchTool: Tool = {
  name: 'create_tags_batch',
  description: 'Batch create multiple tags to avoid loop calls. Use for scenarios requiring multiple tags to be created at once.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tags',
      type: 'array',
      description: 'Array of tags to create, each tag contains name and other fields',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.tags) || params.tags.length === 0) {
        return {
          success: false,
          error: '参数 tags 必须是非空数组',
        }
      }

      const results = []
      for (const tag of params.tags) {
        const result = await insertTag({ name: tag.name })
        results.push({ name: tag.name, id: result.lastInsertId })
      }
      
      return {
        success: true,
        data: { count: results.length, tags: results },
        message: `成功批量创建 ${results.length} 个标签`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建标签失败: ${error}`,
      }
    }
  },
}

export const updateTagsBatchTool: Tool = {
  name: 'update_tags_batch',
  description: 'Batch update multiple tags to avoid loop calls. Each tag must include the id field.',
  category: 'tag',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'tags',
      type: 'array',
      description: 'Array of tags to update, each tag must include id and fields to update',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.tags) || params.tags.length === 0) {
        return {
          success: false,
          error: '参数 tags 必须是非空数组',
        }
      }

      const allTags = await getTags()
      const tagsToUpdate: Tag[] = []
      
      for (const tagUpdate of params.tags) {
        const existingTag = allTags.find(t => t.id === tagUpdate.id)
        if (!existingTag) {
          return {
            success: false,
            error: `未找到ID为 ${tagUpdate.id} 的标签`,
          }
        }
        
        tagsToUpdate.push({
          ...existingTag,
          name: tagUpdate.name !== undefined ? tagUpdate.name : existingTag.name,
          isPin: tagUpdate.isPin !== undefined ? tagUpdate.isPin : existingTag.isPin,
          isLocked: tagUpdate.isLocked !== undefined ? tagUpdate.isLocked : existingTag.isLocked,
          sortOrder: tagUpdate.sortOrder !== undefined ? tagUpdate.sortOrder : existingTag.sortOrder,
        })
      }

      await insertTags(tagsToUpdate)
      
      return {
        success: true,
        data: { count: tagsToUpdate.length },
        message: `成功批量更新 ${tagsToUpdate.length} 个标签`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量更新标签失败: ${error}`,
      }
    }
  },
}

export const tagTools: Tool[] = [
  listTagsTool,
  createTagTool,
  updateTagTool,
  deleteTagTool,
  searchTagsTool,
  createTagsBatchTool,
  updateTagsBatchTool,
]
