/**
 * Tavern 标签系统 Store
 * 用于管理角色、聊天、世界信息等的标签
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 标签类型
export type TagCategory = 'character' | 'chat' | 'world-info' | 'attachment' | 'custom'

// 标签颜色预设
export const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#6b7280', // gray
] as const

export type TagColor = typeof TAG_COLORS[number]

// 标签接口
export interface Tag {
  id: string
  name: string
  color: TagColor
  category: TagCategory
  description?: string
  // 关联的实体 ID 列表
  associations: {
    characterIds: string[]
    chatIds: number[]
    worldInfoIds: string[]
    attachmentIds: string[]
  }
  createdAt: number
  updatedAt: number
}

// 标签组（用于组织标签）
export interface TagGroup {
  id: string
  name: string
  tagIds: string[]
  collapsed?: boolean
}

// 筛选条件
export interface TagFilter {
  mode: 'any' | 'all' | 'none'
  tagIds: string[]
}

// 筛选配置（用于 UI 组件）
export interface TagFilterConfig {
  includeTags: string[]
  excludeTags: string[]
  matchMode: 'any' | 'all'
}

// Store 状态
interface TavernTagsState {
  tags: Tag[]
  groups: TagGroup[]
  
  // 标签 CRUD
  addTag: (tag: Omit<Tag, 'id' | 'createdAt' | 'updatedAt' | 'associations'>) => string
  updateTag: (id: string, updates: Partial<Omit<Tag, 'id' | 'createdAt' | 'updatedAt'>>) => void
  deleteTag: (id: string) => void
  getTag: (id: string) => Tag | undefined
  getTagsByCategory: (category: TagCategory) => Tag[]
  getTagsByIds: (ids: string[]) => Tag[]
  
  // 标签组管理
  addGroup: (name: string) => string
  updateGroup: (id: string, updates: Partial<Omit<TagGroup, 'id'>>) => void
  deleteGroup: (id: string) => void
  addTagToGroup: (groupId: string, tagId: string) => void
  removeTagFromGroup: (groupId: string, tagId: string) => void
  
  // 关联管理
  associateTag: (tagId: string, type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityId: string | number) => void
  dissociateTag: (tagId: string, type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityId: string | number) => void
  getTagsForEntity: (type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityId: string | number) => Tag[]
  setTagsForEntity: (type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityId: string | number, tagIds: string[]) => void
  
  // 筛选
  filterEntities: <T extends { id: string | number }>(
    entities: T[],
    filter: TagFilter,
    getEntityType: () => 'character' | 'chat' | 'worldInfo' | 'attachment'
  ) => T[]
  
  // 批量操作
  mergeTags: (sourceIds: string[], targetId: string) => void
  bulkAssociate: (tagId: string, type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityIds: (string | number)[]) => void
  bulkDissociate: (tagId: string, type: 'character' | 'chat' | 'worldInfo' | 'attachment', entityIds: (string | number)[]) => void
  
  // 导入导出
  exportTags: () => string
  importTags: (data: string, options?: { merge?: boolean }) => { success: boolean; count: number; error?: string }
}

function generateId(): string {
  return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useTavernTagsStore = create<TavernTagsState>()(
  persist(
    (set, get) => ({
      tags: [],
      groups: [],
      
      // 添加标签
      addTag: (tagData) => {
        const id = generateId()
        const now = Date.now()
        const tag: Tag = {
          ...tagData,
          id,
          associations: {
            characterIds: [],
            chatIds: [],
            worldInfoIds: [],
            attachmentIds: [],
          },
          createdAt: now,
          updatedAt: now,
        }
        set((state) => ({
          tags: [...state.tags, tag],
        }))
        return id
      },
      
      // 更新标签
      updateTag: (id, updates) => {
        set((state) => ({
          tags: state.tags.map((tag) =>
            tag.id === id
              ? { ...tag, ...updates, updatedAt: Date.now() }
              : tag
          ),
        }))
      },
      
      // 删除标签
      deleteTag: (id) => {
        set((state) => ({
          tags: state.tags.filter((tag) => tag.id !== id),
          groups: state.groups.map((group) => ({
            ...group,
            tagIds: group.tagIds.filter((tid) => tid !== id),
          })),
        }))
      },
      
      // 获取标签
      getTag: (id) => {
        return get().tags.find((tag) => tag.id === id)
      },
      
      // 按类别获取标签
      getTagsByCategory: (category) => {
        return get().tags.filter((tag) => tag.category === category)
      },
      
      // 按 ID 列表获取标签
      getTagsByIds: (ids) => {
        const { tags } = get()
        return ids.map((id) => tags.find((t) => t.id === id)).filter(Boolean) as Tag[]
      },
      
      // 添加标签组
      addGroup: (name) => {
        const id = generateId()
        set((state) => ({
          groups: [...state.groups, { id, name, tagIds: [] }],
        }))
        return id
      },
      
      // 更新标签组
      updateGroup: (id, updates) => {
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === id ? { ...group, ...updates } : group
          ),
        }))
      },
      
      // 删除标签组
      deleteGroup: (id) => {
        set((state) => ({
          groups: state.groups.filter((group) => group.id !== id),
        }))
      },
      
      // 添加标签到组
      addTagToGroup: (groupId, tagId) => {
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId && !group.tagIds.includes(tagId)
              ? { ...group, tagIds: [...group.tagIds, tagId] }
              : group
          ),
        }))
      },
      
      // 从组移除标签
      removeTagFromGroup: (groupId, tagId) => {
        set((state) => ({
          groups: state.groups.map((group) =>
            group.id === groupId
              ? { ...group, tagIds: group.tagIds.filter((id) => id !== tagId) }
              : group
          ),
        }))
      },
      
      // 关联标签
      associateTag: (tagId, type, entityId) => {
        set((state) => ({
          tags: state.tags.map((tag) => {
            if (tag.id !== tagId) return tag
            
            const associations = { ...tag.associations }
            const idStr = String(entityId)
            const idNum = Number(entityId)
            
            switch (type) {
              case 'character':
                if (!associations.characterIds.includes(idStr)) {
                  associations.characterIds = [...associations.characterIds, idStr]
                }
                break
              case 'chat':
                if (!associations.chatIds.includes(idNum)) {
                  associations.chatIds = [...associations.chatIds, idNum]
                }
                break
              case 'worldInfo':
                if (!associations.worldInfoIds.includes(idStr)) {
                  associations.worldInfoIds = [...associations.worldInfoIds, idStr]
                }
                break
              case 'attachment':
                if (!associations.attachmentIds.includes(idStr)) {
                  associations.attachmentIds = [...associations.attachmentIds, idStr]
                }
                break
            }
            
            return { ...tag, associations, updatedAt: Date.now() }
          }),
        }))
      },
      
      // 解除关联
      dissociateTag: (tagId, type, entityId) => {
        set((state) => ({
          tags: state.tags.map((tag) => {
            if (tag.id !== tagId) return tag
            
            const associations = { ...tag.associations }
            const idStr = String(entityId)
            const idNum = Number(entityId)
            
            switch (type) {
              case 'character':
                associations.characterIds = associations.characterIds.filter((id) => id !== idStr)
                break
              case 'chat':
                associations.chatIds = associations.chatIds.filter((id) => id !== idNum)
                break
              case 'worldInfo':
                associations.worldInfoIds = associations.worldInfoIds.filter((id) => id !== idStr)
                break
              case 'attachment':
                associations.attachmentIds = associations.attachmentIds.filter((id) => id !== idStr)
                break
            }
            
            return { ...tag, associations, updatedAt: Date.now() }
          }),
        }))
      },
      
      // 获取实体的标签
      getTagsForEntity: (type, entityId) => {
        const { tags } = get()
        const idStr = String(entityId)
        const idNum = Number(entityId)
        
        return tags.filter((tag) => {
          switch (type) {
            case 'character':
              return tag.associations.characterIds.includes(idStr)
            case 'chat':
              return tag.associations.chatIds.includes(idNum)
            case 'worldInfo':
              return tag.associations.worldInfoIds.includes(idStr)
            case 'attachment':
              return tag.associations.attachmentIds.includes(idStr)
            default:
              return false
          }
        })
      },
      
      // 设置实体的标签（替换）
      setTagsForEntity: (type, entityId, tagIds) => {
        const { tags, associateTag, dissociateTag } = get()
        
        // 先移除所有现有关联
        tags.forEach((tag) => {
          const hasAssociation = (() => {
            const idStr = String(entityId)
            const idNum = Number(entityId)
            switch (type) {
              case 'character':
                return tag.associations.characterIds.includes(idStr)
              case 'chat':
                return tag.associations.chatIds.includes(idNum)
              case 'worldInfo':
                return tag.associations.worldInfoIds.includes(idStr)
              case 'attachment':
                return tag.associations.attachmentIds.includes(idStr)
              default:
                return false
            }
          })()
          
          if (hasAssociation && !tagIds.includes(tag.id)) {
            dissociateTag(tag.id, type, entityId)
          }
        })
        
        // 添加新关联
        tagIds.forEach((tagId) => {
          associateTag(tagId, type, entityId)
        })
      },
      
      // 筛选实体
      filterEntities: (entities, filter, getEntityType) => {
        if (filter.tagIds.length === 0) return entities
        
        const { getTagsForEntity } = get()
        const type = getEntityType()
        
        return entities.filter((entity) => {
          const entityTags = getTagsForEntity(type, entity.id)
          const entityTagIds = entityTags.map((t) => t.id)
          
          switch (filter.mode) {
            case 'any':
              return filter.tagIds.some((id) => entityTagIds.includes(id))
            case 'all':
              return filter.tagIds.every((id) => entityTagIds.includes(id))
            case 'none':
              return !filter.tagIds.some((id) => entityTagIds.includes(id))
            default:
              return true
          }
        })
      },
      
      // 合并标签
      mergeTags: (sourceIds, targetId) => {
        const { tags } = get()
        const targetTag = tags.find((t) => t.id === targetId)
        if (!targetTag) return
        
        // 收集所有源标签的关联
        const mergedAssociations = {
          characterIds: [...targetTag.associations.characterIds],
          chatIds: [...targetTag.associations.chatIds],
          worldInfoIds: [...targetTag.associations.worldInfoIds],
          attachmentIds: [...targetTag.associations.attachmentIds],
        }
        
        sourceIds.forEach((sourceId) => {
          const sourceTag = tags.find((t) => t.id === sourceId)
          if (!sourceTag) return
          
          sourceTag.associations.characterIds.forEach((id) => {
            if (!mergedAssociations.characterIds.includes(id)) {
              mergedAssociations.characterIds.push(id)
            }
          })
          sourceTag.associations.chatIds.forEach((id) => {
            if (!mergedAssociations.chatIds.includes(id)) {
              mergedAssociations.chatIds.push(id)
            }
          })
          sourceTag.associations.worldInfoIds.forEach((id) => {
            if (!mergedAssociations.worldInfoIds.includes(id)) {
              mergedAssociations.worldInfoIds.push(id)
            }
          })
          sourceTag.associations.attachmentIds.forEach((id) => {
            if (!mergedAssociations.attachmentIds.includes(id)) {
              mergedAssociations.attachmentIds.push(id)
            }
          })
        })
        
        set((state) => ({
          tags: state.tags
            .filter((t) => !sourceIds.includes(t.id))
            .map((t) =>
              t.id === targetId
                ? { ...t, associations: mergedAssociations, updatedAt: Date.now() }
                : t
            ),
          groups: state.groups.map((group) => ({
            ...group,
            tagIds: group.tagIds.filter((id) => !sourceIds.includes(id)),
          })),
        }))
      },
      
      // 批量关联
      bulkAssociate: (tagId, type, entityIds) => {
        const { associateTag } = get()
        entityIds.forEach((id) => associateTag(tagId, type, id))
      },
      
      // 批量解除关联
      bulkDissociate: (tagId, type, entityIds) => {
        const { dissociateTag } = get()
        entityIds.forEach((id) => dissociateTag(tagId, type, id))
      },
      
      // 导出标签
      exportTags: () => {
        const { tags, groups } = get()
        return JSON.stringify({
          version: 1,
          type: 'tavern-tags',
          tags,
          groups,
          exportedAt: Date.now(),
        }, null, 2)
      },
      
      // 导入标签
      importTags: (data, options) => {
        try {
          const parsed = JSON.parse(data)
          
          if (parsed.type !== 'tavern-tags' || !Array.isArray(parsed.tags)) {
            return { success: false, count: 0, error: '无效的数据格式' }
          }
          
          const { merge = true } = options || {}
          
          set((state) => {
            const existingTags = merge ? state.tags : []
            const existingGroups = merge ? state.groups : []
            
            // 导入标签，生成新 ID 避免冲突
            const idMap = new Map<string, string>()
            const newTags = parsed.tags.map((tag: Tag) => {
              const newId = generateId()
              idMap.set(tag.id, newId)
              return {
                ...tag,
                id: newId,
                createdAt: Date.now(),
                updatedAt: Date.now(),
              }
            })
            
            // 导入标签组，更新标签 ID 引用
            const newGroups = (parsed.groups || []).map((group: TagGroup) => ({
              ...group,
              id: generateId(),
              tagIds: group.tagIds.map((id) => idMap.get(id) || id),
            }))
            
            return {
              tags: [...existingTags, ...newTags],
              groups: [...existingGroups, ...newGroups],
            }
          })
          
          return { success: true, count: parsed.tags.length }
        } catch (error) {
          return {
            success: false,
            count: 0,
            error: error instanceof Error ? error.message : '解析失败',
          }
        }
      },
    }),
    {
      name: 'tavern-tags-storage',
      version: 1,
    }
  )
)

// ============ 辅助函数 ============

/**
 * 获取随机标签颜色
 */
export function getRandomTagColor(): TagColor {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
}

/**
 * 获取标签使用统计
 */
export function getTagUsageStats(tag: Tag): {
  total: number
  byType: Record<string, number>
} {
  const byType = {
    character: tag.associations.characterIds.length,
    chat: tag.associations.chatIds.length,
    worldInfo: tag.associations.worldInfoIds.length,
    attachment: tag.associations.attachmentIds.length,
  }
  
  return {
    total: Object.values(byType).reduce((a, b) => a + b, 0),
    byType,
  }
}

/**
 * 搜索标签
 */
export function searchTags(
  tags: Tag[],
  query: string,
  options?: { category?: TagCategory }
): Tag[] {
  const queryLower = query.toLowerCase()
  
  return tags.filter((tag) => {
    if (options?.category && tag.category !== options.category) {
      return false
    }
    
    return (
      tag.name.toLowerCase().includes(queryLower) ||
      tag.description?.toLowerCase().includes(queryLower)
    )
  })
}

/**
 * 按使用频率排序标签
 */
export function sortTagsByUsage(tags: Tag[]): Tag[] {
  return [...tags].sort((a, b) => {
    const usageA = getTagUsageStats(a).total
    const usageB = getTagUsageStats(b).total
    return usageB - usageA
  })
}
