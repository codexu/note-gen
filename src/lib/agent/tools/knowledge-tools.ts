import { getKnowledgeSource } from '@/db/knowledge'
import { readKnowledgeSourcePage, searchKnowledge } from '@/lib/knowledge-search'
import { isKnowledgeSourceType } from '@/types/knowledge'
import type { AgentTool } from '../types'

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

const knowledgeSearchTool: AgentTool = {
  name: 'knowledge_search',
  title: '搜索统一知识库',
  description: [
    'Search NoteGen articles, individual records, and canvases when the answer depends on the user’s saved knowledge, history, plans, prior decisions, or recorded material.',
    'Do not search for general knowledge, pure creation requests, or when the current article, selection, or current canvas already contains enough evidence.',
    'Articles are preferred by default, while clearly requested records or canvases receive a larger candidate share. Use sourceMode=only only when the user explicitly restricts the source.',
    'Use rag for natural-language questions, paraphrases, and cross-language retrieval. Keyword mode only matches literal text and cannot find translations; use it only for an explicitly requested literal lookup.',
    'Results are lightweight candidates. Read only the sources you will actually use with knowledge_read_sources, then cite those source keys with knowledge_cite_sources.',
  ].join(' '),
  category: 'note',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The complete question about the content. Omit search instructions and generic test-note prefixes that do not describe the requested knowledge.' },
      mode: { type: 'string', enum: ['rag', 'keyword'], description: 'rag (default) for questions, semantic meaning, and cross-language search; keyword only for explicitly requested literal text matching.' },
      sourceTypes: {
        type: 'array',
        items: { type: 'string', enum: ['article', 'record', 'canvas'] },
        description: 'Sources explicitly preferred or restricted by the user.',
      },
      sourceMode: { type: 'string', enum: ['prefer', 'only'] },
      folderPath: { type: 'string', description: 'Optional article folder restriction. Omit unless the user explicitly limits the folder.' },
      tagId: { type: 'number', description: 'Optional positive record tag ID. Omit unless the user explicitly limits the search to a known tag.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  execute: async input => {
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) return { ok: false, message: 'query 不能为空。', error: 'EMPTY_QUERY' }
    const sourceTypes = strings(input.sourceTypes).filter(isKnowledgeSourceType)
    const sourceMode = input.sourceMode === 'only' ? 'only' : input.sourceMode === 'prefer' ? 'prefer' : undefined
    const results = await searchKnowledge(query, {
      mode: input.mode === 'keyword' ? 'keyword' : 'rag',
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      sourceMode,
      folderPath: typeof input.folderPath === 'string' && input.folderPath.trim()
        ? input.folderPath.trim()
        : undefined,
      tagId: typeof input.tagId === 'number' && Number.isInteger(input.tagId) && input.tagId > 0
        ? input.tagId
        : undefined,
    })
    return {
      ok: true,
      message: `找到 ${results.length} 个相关文章、记录或画布候选。`,
      data: results,
    }
  },
}

const knowledgeReadSourcesTool: AgentTool = {
  name: 'knowledge_read_sources',
  title: '读取知识来源',
  description: 'Read complete content or the next page for candidates returned by knowledge_search. Read only sources needed for the answer. A record remains independent; a canvas is returned as all semantic nodes and explicit edges without visual styling.',
  category: 'note',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      requests: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            sourceKey: { type: 'string' },
            cursor: { type: 'string' },
          },
          required: ['sourceKey'],
          additionalProperties: false,
        },
      },
    },
    required: ['requests'],
    additionalProperties: false,
  },
  execute: async input => {
    const requests = Array.isArray(input.requests) ? input.requests : []
    const pages = []
    for (const request of requests) {
      if (!request || typeof request !== 'object') continue
      const value = request as { sourceKey?: unknown; cursor?: unknown }
      if (typeof value.sourceKey !== 'string') continue
      const page = await readKnowledgeSourcePage(
        value.sourceKey,
        typeof value.cursor === 'string' ? value.cursor : undefined
      )
      if (page) pages.push(page)
    }
    return pages.length
      ? { ok: true, message: `已读取 ${pages.length} 个知识来源页面。`, data: pages }
      : { ok: false, message: '没有可读取的知识来源。', error: 'NO_READABLE_SOURCES' }
  },
}

const knowledgeCiteSourcesTool: AgentTool = {
  name: 'knowledge_cite_sources',
  title: '确认知识来源',
  description: 'Mark only the retrieved article, record, or canvas sources actually used as evidence or as the basis of an action. Call this before the final answer.',
  category: 'note',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sourceKeys: { type: 'array', minItems: 1, items: { type: 'string' } },
    },
    required: ['sourceKeys'],
    additionalProperties: false,
  },
  execute: async input => {
    const sourceKeys = Array.from(new Set(strings(input.sourceKeys)))
    const valid = []
    for (const sourceKey of sourceKeys) {
      if (await getKnowledgeSource(sourceKey)) valid.push(sourceKey)
    }
    return valid.length
      ? { ok: true, message: `已确认 ${valid.length} 个知识来源。`, data: { sourceKeys: valid } }
      : { ok: false, message: 'sourceKeys 必须包含实际使用的知识来源。', error: 'EMPTY_KNOWLEDGE_SOURCES' }
  },
}

export const knowledgeTools: AgentTool[] = [
  knowledgeSearchTool,
  knowledgeReadSourcesTool,
  knowledgeCiteSourcesTool,
]
