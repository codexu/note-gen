import { getKnowledgeSource } from '@/db/knowledge'
import { matchesKnowledgeSearchScope, readKnowledgeSourcePage, searchKnowledgeWithWiki } from '@/lib/knowledge-search'
import { isKnowledgeSourceType } from '@/types/knowledge'
import type { KnowledgeWikiPageGrant } from '@/types/knowledge'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from '@/lib/wiki/context'
import { wikiCitationText } from '@/lib/wiki/citations'
import MarkdownIt from 'markdown-it'
import type { AgentTool } from '../types'

const wikiMarkdown = new MarkdownIt({ html: false, linkify: false, typographer: false })

function wikiPageChunk(body: string, offset: number) {
  let end = Math.min(body.length, offset + 7000)
  if (end < body.length) {
    const newline = body.lastIndexOf('\n', end - 1)
    if (newline >= offset + 3500) end = newline + 1
    // An unusually long line still must not split a source marker in half.
    const marker = body.slice(offset, end).match(/\[\d*$/)
    if (marker) {
      const tail = body.slice(end).match(/^\d*\]/)
      if (tail) end = marker.index !== undefined && marker.index > 0 ? offset + marker.index : end + tail[0].length
    }
    if (end > offset && /[\uD800-\uDBFF]/.test(body[end - 1])) end--
  }
  const lineOffsets = [0]
  for (let index = 0; index < body.length; index++) if (body[index] === '\n') lineOffsets.push(index + 1)
  const allReferences = new Set<number>()
  const chunkReferences = new Set<number>()
  let partialBlock = false
  let rowLines: [number, number] | null = null
  // Parse the complete page so a continuation inside fenced/inline code or a
  // reference-style link cannot turn literal [n] data into source evidence.
  for (const token of wikiMarkdown.parse(body, {})) {
    if (token.type === 'tr_open') rowLines = token.map
    if (token.type === 'tr_close') rowLines = null
    if (token.type !== 'inline') continue
    const references = [...wikiCitationText(token).matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))
    references.forEach(reference => allReferences.add(reference))
    const lines = token.map ?? rowLines
    if (!lines) continue
    const start = lineOffsets[lines[0]] ?? body.length
    const finish = lineOffsets[lines[1]] ?? body.length
    if (start >= end || finish <= offset) continue
    references.forEach(reference => chunkReferences.add(reference))
    // A very long paragraph may span cursors. Its sources describe the whole
    // supporting block, rather than claiming each clipped sentence was cited.
    if (references.length && (start < offset || finish > end)) partialBlock = true
  }
  return { end, content: body.slice(offset, end), allReferences, chunkReferences, partialBlock }
}

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
    'Use auto for questions: it searches compiled Wiki and uses semantic retrieval only when the user enabled it. Keyword mode is local literal lookup.',
    'Results contain separately budgeted original-source candidates in data and compiled page previews in wikiPages. Read relevant wikiPages with knowledge_read_wiki; page evidence can include more sources than the original-source candidate limit. Read current originals with knowledge_read_sources for precise quotes, numbers, or source details. Cite only source keys actually read and used.',
  ].join(' '),
  category: 'note',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The complete question about the content. Omit search instructions and generic test-note prefixes that do not describe the requested knowledge.' },
      mode: { type: 'string', enum: ['auto', 'rag', 'keyword'], description: 'auto (default) follows the knowledge capabilities configured by the user; rag is a legacy alias. keyword performs local literal lookup.' },
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
    const results = await searchKnowledgeWithWiki(query, {
      mode: input.mode === 'keyword' ? 'keyword' : 'auto',
      sourceTypes: sourceTypes.length ? sourceTypes : undefined,
      sourceMode,
      folderPath: typeof input.folderPath === 'string' && input.folderPath.length > 0
        ? input.folderPath
        : undefined,
      tagId: typeof input.tagId === 'number' && Number.isInteger(input.tagId) && input.tagId > 0
        ? input.tagId
        : undefined,
    })
    return {
      ok: true,
      message: `找到 ${results.wikiPages.length} 个 Wiki 页面和 ${results.sources.length} 个文章、记录或画布候选。`,
      data: results.sources,
      wikiPages: results.wikiPages,
    }
  },
}

const knowledgeReadWikiTool: AgentTool = {
  name: 'knowledge_read_wiki',
  title: '读取知识 Wiki',
  description: 'Read compiled Wiki pages returned by knowledge_search. These are AI-maintained summaries, not verbatim originals. Use only their valid source evidence; state when relying on Wiki. Source reference numbers retain their page-wide numbering across cursors; follow nextCursor for more content. For block-citations, sources belong to an entire supporting paragraph that spans cursors; they do not verify each clipped sentence. Page-linked sources on unnumbered handwritten text establish page provenance, not paragraph-level verification. Read originals before quoting exact wording, verifying numbers, or answering source-specific details.',
  category: 'note',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: { requests: { type: 'array', minItems: 1, maxItems: 5,
      items: { type: 'object', properties: { pageId: { type: 'string' }, cursor: { type: 'string' } },
        required: ['pageId'], additionalProperties: false } } },
    required: ['requests'], additionalProperties: false,
  },
  execute: async input => {
    const isCurrent = captureWikiWorkspaceGuard()
    const context = await getWikiContext()
    const assertCurrent = async () => {
      if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
      await assertWikiContextCurrent(context.id)
      if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    }
    await assertCurrent()
    const { readWikiPage } = await import('@/lib/wiki/search')
    const grants = input.wikiGrants && typeof input.wikiGrants === 'object'
      ? input.wikiGrants as Record<string, KnowledgeWikiPageGrant[]> : {}
    const requests = Array.isArray(input.requests) ? input.requests : []
    const pages = []
    for (const request of requests) {
      if (!request || typeof request !== 'object') continue
      const value = request as { pageId?: unknown; cursor?: unknown }
      if (typeof value.pageId !== 'string' || !grants[value.pageId]?.length) continue
      await assertCurrent()
      const pageGrants = grants[value.pageId].filter(grant => grant.contextId === context.id)
      if (!pageGrants.length) continue
      // Match portable identities, never a sending device's SQLite row ID.
      // Recheck the query scope against the current resolved source metadata.
      const view = await readWikiPage(value.pageId, {}, source => pageGrants.some(grant =>
        grant.sourceRefs.some(reference => reference.stableId === source.stableId
          && reference.contentHash === source.contentHash)
        && matchesKnowledgeSearchScope({ sourceKey: source.sourceKey, sourceType: source.sourceType,
          sourceId: source.sourceKey.slice(source.sourceKey.indexOf(':') + 1), title: source.title,
          contentHash: source.contentHash, locator: source.locator, status: 'ready', updatedAt: 0 }, grant.scope)))
      await assertCurrent()
      if (!view) continue
      const offset = typeof value.cursor === 'string' ? Math.max(0, Number.parseInt(value.cursor, 10) || 0) : 0
      const { end, content, allReferences, chunkReferences, partialBlock } = wikiPageChunk(view.content, offset)
      const numbered = [...allReferences].some(number => number >= 1 && number <= view.sourceRefs.length)
      pages.push({ pageId: value.pageId, title: view.page.title, content,
        sourceRefs: view.sourceRefs.flatMap((source, index) => numbered && !chunkReferences.has(index + 1) ? [] : [{
          sourceKey: source.sourceKey, sourceType: source.sourceType, title: source.title,
          locator: { filePath: source.locator.filePath, markId: source.locator.markId,
            canvasId: source.locator.canvasId, nodeIds: source.locator.nodeIds },
          reference: index + 1,
        }]), evidenceKind: 'wiki', sourceReferenceMode: numbered
          ? partialBlock ? 'block-citations' : 'chunk-citations' : 'page-linked-sources',
        nextCursor: end < view.content.length ? String(end) : undefined, complete: end >= view.content.length,
        updatedAt: view.page.updatedAt })
    }
    await assertCurrent()
    return pages.length ? { ok: true, message: `已读取 ${pages.length} 个 Wiki 页面。`, data: pages }
      : { ok: false, message: 'Wiki 页面已过期、超出本次检索范围或不可读取，请重新搜索。', error: 'WIKI_NOT_READABLE' }
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
    const [{ getWikiContext }, { getWikiSettings, isWikiSourceSelected }, { listWikiSourceStates },
      { isWikiSourceCurrent }, { resolveWikiSourceReference }] = await Promise.all([
      import('@/lib/wiki/context'), import('@/lib/wiki/settings'), import('@/db/wiki'),
      import('@/lib/wiki/sync'), import('@/lib/wiki/sources'),
    ])
    const context = await getWikiContext()
    const settings = await getWikiSettings(context.id)
    const wikiSources = settings.enabled ? await listWikiSourceStates(context.id) : []
    for (const sourceKey of sourceKeys) {
      if (await getKnowledgeSource(sourceKey)) { valid.push(sourceKey); continue }
      for (const state of wikiSources) {
        if (state.status !== 'ready' || !isWikiSourceSelected(state.source, settings)) continue
        const local = await resolveWikiSourceReference(state.source)
        const readableKey = local?.source.sourceKey
          ?? (state.sourceType === 'record' ? state.source.stableId : state.sourceKey)
        if (readableKey === sourceKey && await isWikiSourceCurrent(state.source)) {
          valid.push(sourceKey)
          break
        }
      }
    }
    return valid.length
      ? { ok: true, message: `已确认 ${valid.length} 个知识来源。`, data: { sourceKeys: valid } }
      : { ok: false, message: 'sourceKeys 必须包含实际使用的知识来源。', error: 'EMPTY_KNOWLEDGE_SOURCES' }
  },
}

export const knowledgeTools: AgentTool[] = [
  knowledgeSearchTool,
  knowledgeReadWikiTool,
  knowledgeReadSourcesTool,
  knowledgeCiteSourcesTool,
]
