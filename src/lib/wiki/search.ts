import { BM25Index } from '@/lib/bm25'
import { getActiveWikiRevisions, getWikiPage, listWikiPages } from '@/db/wiki'
import { getKnowledgeSettings } from '@/lib/knowledge-settings'
import type { KnowledgeSearchOptions } from '@/lib/knowledge-search'
import type { KnowledgeSource } from '@/types/knowledge'
import type { WikiPage, WikiSearchResult, WikiSourceReference, WikiSourceRevision } from '@/types/wiki'
import { assertWikiContextCurrent, captureWikiWorkspaceGuard, getWikiContext } from './context'
import { getWikiSettings, isWikiSourceSelected, normalizeWikiScopeId } from './settings'
import { resolveWikiSourceReference, isWikiSourceDocumentAllowed, wikiHash } from './sources'
import { wikiSourceWithEvidence } from './compiler'
import { refreshWikiFileCache } from './files'

function matchesOptions(source: WikiSourceReference, options: KnowledgeSearchOptions) {
  if (options.sourceMode === 'only' && options.sourceTypes?.length
    && !options.sourceTypes.includes(source.sourceType)) return false
  if (options.folderPath) {
    if (source.sourceType !== 'article') return false
    const path = normalizeWikiScopeId(source.locator.filePath ?? '')
    const folder = normalizeWikiScopeId(options.folderPath)
    if (folder && path !== folder && !path.startsWith(`${folder}/`)) return false
  }
  if (options.tagId && (source.sourceType !== 'record'
    || (source.locator.tagId !== options.tagId && !source.locator.tagIds?.includes(options.tagId)))) return false
  if (options.sourceFilter) {
    const registered: KnowledgeSource = { sourceKey: source.sourceKey, sourceType: source.sourceType,
      sourceId: source.sourceKey.slice(source.sourceKey.indexOf(':') + 1), title: source.title,
      contentHash: source.contentHash, updatedAt: 0, locator: source.locator, status: 'ready' }
    if (!options.sourceFilter(registered)) return false
  }
  return true
}

async function currentRevisions(pageId?: string) {
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  const assertCurrent = async () => {
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  await assertCurrent()
  const configured = await getWikiSettings(context.id)
  if (!configured.enabled) return { context, settings: configured, revisions: [] as WikiSourceRevision[], page: null }
  // Markdown is authoritative. Refresh before reading the disposable cache so
  // user edits and deleted files are reflected in the very next query.
  await refreshWikiFileCache(context)
  const [settings, knowledge, allRevisions, page] = await Promise.all([
    getWikiSettings(context.id), getKnowledgeSettings(), getActiveWikiRevisions(context.id),
    pageId ? getWikiPage(context.id, pageId) : Promise.resolve(null),
  ])
  await assertCurrent()
  if (!settings.enabled) return { context, settings, revisions: [] as WikiSourceRevision[], page }
  const revisions = pageId ? allRevisions.filter(revision => page?.kind === 'source'
    ? page.sourceRefs.some(source => source.stableId === revision.source.stableId)
    : page?.kind === 'topic' && revision.contributions.some(contribution => contribution.topicKey === page.topicKey))
    : allRevisions
  const valid: WikiSourceRevision[] = []
  for (const revision of revisions) {
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    if (!isWikiSourceSelected(revision.source, settings)
      || !knowledge.enabledSourceTypes.includes(revision.source.sourceType)) continue
    const document = await resolveWikiSourceReference(revision.source)
    if (document) {
      if (document.source.contentHash === revision.source.contentHash
        && isWikiSourceSelected(document.source, settings)
        && await isWikiSourceDocumentAllowed(document, context.id)) valid.push({ ...revision, source: document.source })
    } else {
      const { isWikiSourceCurrent } = await import('./sync')
      if (!await isWikiSourceCurrent(revision.source)) continue
      // A sending device's SQLite row number is never a local record identity.
      const source: WikiSourceReference = revision.source.sourceType === 'record'
        ? { ...revision.source, sourceKey: revision.source.stableId,
          locator: { ...revision.source.locator, markId: undefined, tagId: undefined, tagIds: undefined } }
        : revision.source
      if (await isWikiSourceDocumentAllowed({ source, content: '' }, context.id)) valid.push({ ...revision, source })
    }
  }
  await assertCurrent()
  return { context, settings, revisions: valid, page }
}

async function pageView(
  page: WikiPage, revisions: WikiSourceRevision[], options: KnowledgeSearchOptions, language: string,
  sourceReferenceFilter?: (source: WikiSourceReference) => boolean,
): Promise<WikiSearchResult | null> {
  if (page.status === 'archived') return null
  const visible = revisions.filter(revision => matchesOptions(revision.source, options)
    && (!sourceReferenceFilter || sourceReferenceFilter(revision.source)))
  if (page.kind === 'source') {
    if (page.status !== 'ready' || page.sourceRefs.length !== 1) return null
    const reference = page.sourceRefs[0]
    const revision = visible.find(item => reference.stableId === item.source.stableId
      && reference.contentHash === item.source.contentHash && page.inputHash === item.inputHash)
    if (!revision) return null
    const source = wikiSourceWithEvidence(revision.source, revision.contributions)
    return { page: { ...page, sourceRefs: [source] }, content: page.body,
      sourceRefs: [source], score: 0 }
  }
  if (!page.topicKey) return null
  const contributions = visible.flatMap(revision => revision.contributions
    .filter(contribution => contribution.topicKey === page.topicKey)
    .map(contribution => ({ contribution, source: revision.source })))
  if (!contributions.length) return null
  const sourceRefs = [...new Map(contributions.map(item => [item.source.stableId, item.source])).values()]
    .map(source => wikiSourceWithEvidence(source, contributions.filter(item => item.source.stableId === source.stableId)
      .map(item => item.contribution)))
  const { buildWikiTopicInputHash } = await import('./compiler')
  const expected = buildWikiTopicInputHash(page.topicKey, revisions, page.generation ?? 0, language)
  const dependencies = revisions.filter(revision => revision.contributions.some(item => item.topicKey === page.topicKey))
  const allVisible = dependencies.length === sourceRefs.length && page.sourceRefs.length === dependencies.length
    && page.sourceRefs.every(source => sourceRefs.some(current =>
      current.stableId === source.stableId && current.contentHash === source.contentHash))
  const complete = page.status === 'ready' && page.inputHash === await expected && allVisible
  const referenceNumbers = new Map(sourceRefs.map((source, index) => [source.stableId, index + 1]))
  const body = complete ? page.body : contributions.map(({ contribution, source }) => [
    `### ${contribution.title}`, contribution.content,
    ...contribution.evidence.map(evidence => `> ${evidence.quote}`), `— ${source.title} [${referenceNumbers.get(source.stableId)}]`,
  ].join('\n\n')).join('\n\n')
  const title = complete ? page.title : contributions[0].contribution.title
  const orderedRefs = complete ? page.sourceRefs.flatMap(reference => {
    const current = sourceRefs.find(source => source.stableId === reference.stableId)
    return current ? [current] : []
  }) : sourceRefs
  return { page: { ...page, title, aliases: complete ? page.aliases : [],
    relatedPageIds: complete ? page.relatedPageIds : [], body, sourceRefs: orderedRefs }, content: body, sourceRefs: orderedRefs, score: 0 }
}

export async function listWikiPageViews(options: KnowledgeSearchOptions = {}): Promise<WikiSearchResult[]> {
  const isCurrent = captureWikiWorkspaceGuard()
  const { context, settings, revisions } = await currentRevisions()
  if (!settings.enabled || !revisions.length) return []
  const pages = await listWikiPages(context.id)
  const views: WikiSearchResult[] = []
  for (const page of pages) {
    const view = await pageView(page, revisions, options, settings.language)
    if (view) views.push(view)
  }
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  return views
}

let cachedSearchIndex: { contextId: string; signature: string; index: BM25Index } | null = null

export async function searchWiki(query: string, options: KnowledgeSearchOptions = {}): Promise<WikiSearchResult[]> {
  if (!query.trim()) return []
  const isCurrent = captureWikiWorkspaceGuard()
  const views = await listWikiPageViews(options)
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  if (!views.length) return []
  // Revalidate sources above on every query. Reuse only tokenization/scoring
  // data whose entire authorized view is unchanged, never freshness results.
  const documents = views.map(view => ({ id: view.page.id,
    content: [view.page.title, view.page.title, ...view.page.aliases, view.content].join('\n') }))
  const signature = wikiHash(JSON.stringify(documents))
  const contextId = views[0].page.contextId
  if (!cachedSearchIndex || cachedSearchIndex.contextId !== contextId || cachedSearchIndex.signature !== signature) {
    const index = new BM25Index()
    index.index(documents)
    cachedSearchIndex = { contextId, signature, index }
  }
  const index = cachedSearchIndex.index
  const byId = new Map(views.map(view => [view.page.id, view]))
  const limit = options.limit ?? 5
  const hits = index.search(query, limit)
  const scores = new Map(hits.map(hit => [hit.id, hit.score]))
  if (options.mode !== 'keyword') for (const hit of hits.slice(0, 3)) {
    for (const id of byId.get(hit.id)?.page.relatedPageIds ?? []) {
      if (byId.has(id)) scores.set(id, Math.max(scores.get(id) ?? 0, hit.score * 0.45))
    }
  }
  return [...scores.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit).flatMap(([id, score]) => {
    const view = byId.get(id)
    return view ? [{ ...view, score: score / (score + 2) }] : []
  })
}

export async function readWikiPage(
  pageId: string, options: KnowledgeSearchOptions = {},
  sourceReferenceFilter?: (source: WikiSourceReference) => boolean,
): Promise<WikiSearchResult | null> {
  const isCurrent = captureWikiWorkspaceGuard()
  const { settings, revisions, page } = await currentRevisions(pageId)
  if (!settings.enabled) return null
  const view = page ? await pageView(page, revisions, options, settings.language, sourceReferenceFilter) : null
  if (!isCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  return view
}
