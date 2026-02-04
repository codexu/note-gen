import { getAllMemories, updateMemoryAccess } from '@/db/memories'
import { fetchEmbedding } from '@/lib/ai/embedding'

/**
 * 上下文结果
 */
export interface ContextResult {
  preferences: string[]
  knowledge: Array<{ content: string; similarity: number; id: string }>
}

/**
 * 记忆加载器 - 智能检索相关记忆
 */
class ContextLoader {
  private cache: Map<string, { data: ContextResult; timestamp: number }> = new Map()
  private cacheTimeout: number = 5 * 60 * 1000 // 5 分钟

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
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
   * 获取查询的相关记忆
   * - 偏好类记忆：始终包含
   * - 知识类记忆：通过嵌入相似度匹配（阈值 0.7）
   */
  async getContextForQuery(query: string): Promise<ContextResult> {
    // 检查缓存
    const cacheKey = query.trim()
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data
    }

    // 获取所有记忆
    const allMemories = await getAllMemories()

    // 分类：偏好和知识
    const preferences = allMemories.filter(m => m.category === 'preference')
    const knowledge = allMemories.filter(m => m.category === 'knowledge')

    // 偏好始终包含
    const preferenceContents = preferences.map(m => m.content)

    // 知识需要语义匹配
    const relevantKnowledge: Array<{ content: string; similarity: number; id: string }> = []

    if (query && knowledge.length > 0) {
      const queryEmbedding = await fetchEmbedding(query)

      if (queryEmbedding) {
        const KNOWLEDGE_THRESHOLD = 0.7

        for (const memory of knowledge) {
          if (!memory.embedding) continue

          try {
            const memoryEmbedding = JSON.parse(memory.embedding) as number[]
            const similarity = this.cosineSimilarity(queryEmbedding, memoryEmbedding)

            if (similarity >= KNOWLEDGE_THRESHOLD) {
              relevantKnowledge.push({
                content: memory.content,
                similarity,
                id: memory.id
              })

              // 更新访问统计
              await updateMemoryAccess(memory.id)
            }
          } catch {
            continue
          }
        }

        // 按相似度降序排序
        relevantKnowledge.sort((a, b) => b.similarity - a.similarity)
      }
    }

    const result: ContextResult = {
      preferences: preferenceContents,
      knowledge: relevantKnowledge
    }

    // 缓存结果
    this.cache.set(cacheKey, { data: result, timestamp: Date.now() })

    return result
  }

  /**
   * 格式化记忆为系统提示词格式
   */
  formatMemoriesForPrompt(context: ContextResult): string {
    const parts: string[] = []

    if (context.preferences.length > 0) {
      parts.push('## 用户偏好\n')
      parts.push(context.preferences.map((p, i) => `${i + 1}. ${p}`).join('\n'))
    }

    if (context.knowledge.length > 0) {
      if (parts.length > 0) parts.push('\n')
      parts.push('## 相关知识\n')
      parts.push(context.knowledge.map((k, i) =>
        `${i + 1}. ${k.content}`
      ).join('\n'))
    }

    return parts.join('')
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear()
  }
}

// 导出单例实例
export const contextLoader = new ContextLoader()
export { ContextLoader }
