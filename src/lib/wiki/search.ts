import { tokenizeLexicalText } from '@/lib/lexical-tokenizer'
import { getWikiSearchCatalog, wikiSearchText } from './search-catalog'
import { matchesKnowledgeSearchScope, type KnowledgeSearchOptions } from '@/lib/knowledge-search'
import type { WikiEvidenceRange, WikiPage, WikiSearchResult, WikiSourceReference, WikiSourceRevision } from '@/types/wiki'
import { assertWikiContextCurrent, captureWikiSelectionGuard, captureWikiWorkspaceGuard, getWikiContext } from './context'
import { getWikiSettings } from './settings'
import { getWikiSourcePolicy, resolveEligibleWikiRevision } from './sources'
import { wikiSourceWithEvidence } from './compiler'
import { refreshWikiFileCache } from './files'

function matchesOptions(source: WikiSourceReference, options: KnowledgeSearchOptions) {
  return matchesKnowledgeSearchScope({
    sourceKey: source.sourceKey, sourceType: source.sourceType,
    sourceId: source.sourceKey.slice(source.sourceKey.indexOf(':') + 1), title: source.title,
    contentHash: source.contentHash, updatedAt: source.updatedAt ?? 0, locator: source.locator, status: 'ready',
  }, options)
}

async function openWikiQuery(options: KnowledgeSearchOptions, sourceFilter?: (source: WikiSourceReference) => boolean) {
  const workspaceIsCurrent = captureWikiWorkspaceGuard()
  const context = await getWikiContext()
  const assertCurrent = async () => {
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
    await assertWikiContextCurrent(context.id)
    if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
  }
  await assertCurrent()
  if (!(await getWikiSettings(context.id)).enabled) return null
  await refreshWikiFileCache(context)
  const checkSelection = captureWikiSelectionGuard()
  const [policy, catalog] = await Promise.all([getWikiSourcePolicy(context.id), getWikiSearchCatalog(context.id)])
  const settings = policy.settings
  await assertCurrent()
  if (!settings.enabled) return null

  // One source can contribute to many candidate pages in the same request.
  const checked = new Map<string, WikiSourceRevision | null>()
  const views = new Map<string, WikiSearchResult | null>()
  async function view(id: string): Promise<WikiSearchResult | null> {
    const entry = catalog.pages.get(id)
    if (!entry) return null
    if (views.has(id)) return views.get(id) ?? null
    const valid: WikiSourceRevision[] = []
    for (const revision of entry.revisions) {
      if (!workspaceIsCurrent()) throw new Error('WIKI_CONTEXT_CHANGED')
      if (!checked.has(revision.id)) checked.set(revision.id, await resolveEligibleWikiRevision(revision, policy))
      const item = checked.get(revision.id)
      if (item) valid.push(item)
    }
    const result = await pageView(entry.page, valid, options, settings.language, sourceFilter)
    views.set(id, result)
    return result
  }
  return { catalog, view, assertCurrent: async () => { await assertCurrent(); checkSelection() } }
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
  const evidenceRanges: WikiEvidenceRange[] = []
  let body = complete ? page.body : ''
  if (!complete) for (const { contribution, source } of contributions) {
    const reference = referenceNumbers.get(source.stableId)!
    if (body) body += '\n\n'
    const start = body.length
    body += [`### ${contribution.title}`, contribution.content,
      ...contribution.evidence.map(evidence => `> ${evidence.quote}`), `— ${source.title} [${reference}]`].join('\n\n')
    evidenceRanges.push({ start, end: body.length, reference })
  }
  const title = complete ? page.title : contributions[0].contribution.title
  const orderedRefs = complete ? page.sourceRefs.flatMap(reference => {
    const current = sourceRefs.find(source => source.stableId === reference.stableId)
    return current ? [current] : []
  }) : sourceRefs
  return { page: { ...page, title, aliases: complete ? page.aliases : [],
    relatedPageIds: complete ? page.relatedPageIds : [], body, sourceRefs: orderedRefs }, content: body, sourceRefs: orderedRefs,
    evidenceRanges: complete ? undefined : evidenceRanges, score: 0 }
}

export async function listWikiPageViews(options: KnowledgeSearchOptions = {}): Promise<WikiSearchResult[]> {
  const request = await openWikiQuery(options)
  if (!request) return []
  const views: WikiSearchResult[] = []
  for (const id of request.catalog.pages.keys()) {
    const view = await request.view(id)
    if (view) views.push(view)
  }
  await request.assertCurrent()
  return views
}

export async function searchWiki(query: string, options: KnowledgeSearchOptions = {}): Promise<WikiSearchResult[]> {
  const terms = [...new Set(tokenizeLexicalText(query))]
  if (!terms.length) return []
  const request = await openWikiQuery(options)
  if (!request) return []
  const views = new Map<string, WikiSearchResult>()
  const matches: Array<{ id: string; score: number }> = []
  for (const [id, entry] of request.catalog.pages) {
    if (!terms.some(term => entry.terms.has(term))) continue
    const view = await request.view(id)
    if (!view) continue
    const score = request.catalog.index.scoreDocument(terms, id, wikiSearchText(view.page))
    if (score > 0) {
      views.set(id, view)
      matches.push({ id, score })
    }
  }
  const limit = options.limit ?? 5
  const hits = matches.sort((left, right) => right.score - left.score).slice(0, limit)
  const scores = new Map(hits.map(hit => [hit.id, hit.score]))
  if (options.mode !== 'keyword') for (const hit of hits.slice(0, 3)) {
    for (const id of views.get(hit.id)?.page.relatedPageIds ?? []) {
      const linked = await request.view(id)
      if (!linked) continue
      views.set(id, linked)
      scores.set(id, Math.max(scores.get(id) ?? 0, hit.score * 0.45))
    }
  }
  await request.assertCurrent()
  return [...scores.entries()].sort((left, right) => right[1] - left[1]).slice(0, limit).flatMap(([id, score]) => {
    const view = views.get(id)
    return view ? [{ ...view, score: score / (score + 2) }] : []
  })
}

export async function readWikiPage(
  pageId: string, options: KnowledgeSearchOptions = {},
  sourceReferenceFilter?: (source: WikiSourceReference) => boolean,
): Promise<WikiSearchResult | null> {
  const request = await openWikiQuery(options, sourceReferenceFilter)
  if (!request) return null
  const view = await request.view(pageId)
  await request.assertCurrent()
  return view
}
