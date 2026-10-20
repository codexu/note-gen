export type KnowledgeSourceType = 'article' | 'record' | 'canvas'

export type KnowledgeIndexStatus = 'pending' | 'indexing' | 'ready' | 'failed'

export interface KnowledgeLocator {
  filePath?: string
  markId?: number
  tagId?: number
  tagIds?: number[]
  canvasId?: string
  nodeIds?: string[]
}

export interface KnowledgeSource {
  sourceKey: string
  sourceType: KnowledgeSourceType
  sourceId: string
  title: string
  contentHash: string
  indexedHash?: string | null
  updatedAt: number
  locator: KnowledgeLocator
  status: KnowledgeIndexStatus
  error?: string | null
}

export interface KnowledgeChunk {
  content: string
  nodeId?: string
}

export interface KnowledgeSourceDocument extends KnowledgeSource {
  content: string
  chunks: KnowledgeChunk[]
}

export interface KnowledgeSearchFragment {
  content: string
  nodeId?: string
}

export interface KnowledgeSearchCandidate {
  sourceKey: string
  sourceType: KnowledgeSourceType
  sourceId: string
  title: string
  fragments: KnowledgeSearchFragment[]
  relevanceScore: number
  updatedAt: number
  locator: KnowledgeLocator
}

export interface KnowledgeReadPage {
  sourceKey: string
  sourceType: KnowledgeSourceType
  title: string
  content: string
  cursor?: string
  nextCursor?: string
  complete: boolean
  updatedAt: number
  locator: KnowledgeLocator
}

export function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return value === 'article' || value === 'record' || value === 'canvas'
}

export function createKnowledgeSourceKey(type: KnowledgeSourceType, id: string | number): string {
  const normalizedId = String(id).replace(/\\/g, '/').replace(/^\.\//, '').trim()
  return `${type}:${normalizedId}`
}

export function parseKnowledgeSourceKey(sourceKey: string): {
  sourceType: KnowledgeSourceType
  sourceId: string
} | null {
  const separatorIndex = sourceKey.indexOf(':')
  if (separatorIndex <= 0) return null
  const sourceType = sourceKey.slice(0, separatorIndex)
  const sourceId = sourceKey.slice(separatorIndex + 1)
  if (!isKnowledgeSourceType(sourceType) || !sourceId) return null
  return { sourceType, sourceId }
}
