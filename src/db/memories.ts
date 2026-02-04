import { getDb } from './index'
import { fetchEmbedding } from '@/lib/ai/embedding'

export type MemoryCategory = 'preference' | 'memory'

export interface Memory {
  id: string
  content: string
  embedding: string // JSON string of vector
  category: MemoryCategory
  replacedId?: string
  accessCount: number
  lastAccessedAt: number
  createdAt: number
  updatedAt: number
}

// 偏好类记忆的关键词
const PREFERENCE_KEYWORDS = [
  '中文', '英文', '清单体', '段落', '简洁', '详细', 'TL;DR',
  '格式', '风格', '语言', '回答', '输出', '回复'
]

/**
 * 自动分类记忆
 */
function categorizeMemory(content: string): MemoryCategory {
  const lowerContent = content.toLowerCase()
  const hasPreferenceKeyword = PREFERENCE_KEYWORDS.some(keyword =>
    lowerContent.includes(keyword.toLowerCase())
  )
  return hasPreferenceKeyword ? 'preference' : 'memory'
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 生成 UUID
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

/**
 * 初始化记忆表
 */
export async function initMemoriesDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists memories (
      id text primary key,
      content text not null,
      embedding text,
      category text not null check(category IN ('preference', 'memory')),
      replaced_id text,
      access_count integer default 0,
      last_accessed_at integer,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  // 创建索引
  await db.execute(`
    create index if not exists idx_memories_category on memories(category)
  `)

  await db.execute(`
    create index if not exists idx_memories_access_count on memories(access_count)
  `)
}

/**
 * 插入或更新记忆（带去重功能）
 */
export async function upsertMemory(
  memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt' | 'category'> & { category?: MemoryCategory }
): Promise<{ id: string; replaced: boolean; replacedId?: string }> {
  const db = await getDb()

  // 自动分类（如果未指定）
  const category = memory.category || categorizeMemory(memory.content)

  // 计算向量嵌入
  let embedding: number[] | null = null
  if (memory.embedding) {
    try {
      embedding = JSON.parse(memory.embedding) as number[]
    } catch {
      // 如果解析失败，重新计算
    }
  }

  if (!embedding) {
    embedding = await fetchEmbedding(memory.content)
  }

  if (!embedding) {
    throw new Error('无法计算向量嵌入，请检查嵌入模型配置')
  }

  const embeddingStr = JSON.stringify(embedding)

  // 检查是否存在相似记忆（去重）
  const allMemories = await getAllMemories()
  const SIMILARITY_THRESHOLD = 0.85

  let similarMemory: Memory | null = null
  let maxSimilarity = 0

  for (const existingMemory of allMemories) {
    // 只在同一类别内查找相似记忆
    if (existingMemory.category !== category) continue

    if (!existingMemory.embedding) continue

    try {
      const existingEmbedding = JSON.parse(existingMemory.embedding) as number[]
      const similarity = cosineSimilarity(embedding, existingEmbedding)

      if (similarity > maxSimilarity) {
        maxSimilarity = similarity
        similarMemory = existingMemory
      }
    } catch {
      continue
    }
  }

  const now = Date.now()
  let replaced = false
  let replacedId: string | undefined
  let newId: string

  if (similarMemory && maxSimilarity >= SIMILARITY_THRESHOLD) {
    // 替换旧记忆
    newId = similarMemory.id
    replacedId = similarMemory.id
    replaced = true

    await db.execute(
      `update memories set content = $1, embedding = $2, category = $3,
       replaced_id = $4, updated_at = $5 where id = $6`,
      [memory.content, embeddingStr, category, similarMemory.id, now, newId]
    )
  } else {
    // 插入新记忆
    newId = generateUUID()

    await db.execute(
      `insert into memories (id, content, embedding, category, replaced_id,
       access_count, last_accessed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId, memory.content, embeddingStr, category, null, 0, now, now, now]
    )
  }

  return { id: newId, replaced, replacedId }
}

/**
 * 获取所有记忆
 */
export async function getAllMemories(): Promise<Memory[]> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories order by updated_at desc`
  )
  return result
}

/**
 * 根据类别获取记忆
 */
export async function getMemoriesByCategory(category: MemoryCategory): Promise<Memory[]> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories where category = $1 order by updated_at desc`,
    [category]
  )
  return result
}

/**
 * 获取相似记忆（用于去重）
 */
export async function getSimilarMemories(
  embedding: number[],
  threshold: number = 0.85
): Promise<Array<{ memory: Memory; similarity: number }>> {
  const allMemories = await getAllMemories()
  const results: Array<{ memory: Memory; similarity: number }> = []

  for (const memory of allMemories) {
    if (!memory.embedding) continue

    try {
      const memoryEmbedding = JSON.parse(memory.embedding) as number[]
      const similarity = cosineSimilarity(embedding, memoryEmbedding)

      if (similarity >= threshold) {
        results.push({ memory, similarity })
      }
    } catch {
      continue
    }
  }

  // 按相似度降序排序
  results.sort((a, b) => b.similarity - a.similarity)

  return results
}

/**
 * 根据 ID 获取记忆
 */
export async function getMemoryById(id: string): Promise<Memory | null> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories where id = $1`,
    [id]
  )
  return result[0] || null
}

/**
 * 更新记忆访问统计
 */
export async function updateMemoryAccess(id: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    "update memories set access_count = access_count + 1, last_accessed_at = $1 where id = $2",
    [Date.now(), id]
  )
}

/**
 * 更新记忆内容
 */
export async function updateMemory(
  id: string,
  updates: Partial<Pick<Memory, 'content' | 'category' | 'embedding'>>
): Promise<void> {
  const db = await getDb()

  // 如果更新内容，需要重新计算嵌入和分类
  let newEmbedding = updates.embedding
  let newCategory = updates.category

  if (updates.content && !updates.embedding) {
    newEmbedding = JSON.stringify(await fetchEmbedding(updates.content) || [])
  }

  if (updates.content && !updates.category) {
    newCategory = categorizeMemory(updates.content)
  }

  await db.execute(
    `update memories set
     content = coalesce($1, content),
     embedding = coalesce($2, embedding),
     category = coalesce($3, category),
     updated_at = $4
     where id = $5`,
    [updates.content, newEmbedding, newCategory, Date.now(), id]
  )
}

/**
 * 删除记忆
 */
export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    "delete from memories where id = $1",
    [id]
  )
}

/**
 * 清空所有记忆
 */
export async function clearAllMemories(): Promise<void> {
  const db = await getDb()
  await db.execute(
    "delete from memories"
  )
}

/**
 * 获取记忆统计信息
 */
export async function getMemoryStats(): Promise<{
  total: number
  preferences: number
  memories: number
  totalAccessCount: number
}> {
  const allMemories = await getAllMemories()
  const preferences = allMemories.filter(m => m.category === 'preference').length
  const memories = allMemories.filter(m => m.category === 'memory').length
  const totalAccessCount = allMemories.reduce((sum, m) => sum + m.accessCount, 0)

  return {
    total: allMemories.length,
    preferences,
    memories,
    totalAccessCount
  }
}
