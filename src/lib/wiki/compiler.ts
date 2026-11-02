import { z } from 'zod'
import { BM25Index } from '@/lib/bm25'
import {
  commitWikiSourceRevision, findWikiRevision, getActiveWikiRevisions, getWikiMeta,
  getWikiPage, getWikiRevision, getWikiSegmentCache, getWikiSourceState, listWikiPages,
  recordWikiUsage, saveWikiSegmentCache, upsertWikiJob, upsertWikiPage,
} from '@/db/wiki'
import {
  WIKI_PIPELINE_VERSION, type WikiContext, type WikiContribution, type WikiPage,
  type WikiEvidence, type WikiSegmentCache, type WikiSettings, type WikiSourceReference, type WikiSourceRevision, type WikiSourceState,
  type WikiUsage,
} from '@/types/wiki'
import { getWikiContext } from './context'
import { getWikiSettings, isWikiSourceSelected } from './settings'
import { citeSingleWikiSource, wikiCitationIssues, wikiCitationReferences } from './citations'
import { compareWikiKeys, getWikiSourceDocument, isWikiSourceDocumentAllowed, normalizeWikiTopicName, wikiHash, wikiTopicKey, type WikiSourceDocument } from './sources'
import {
  createWikiAiSession, requestWikiJson, splitWikiText, throwIfWikiAborted, wikiInputBudget,
  WikiContextError, type WikiAiSession,
} from './ai'

export class WikiSourceChangedError extends Error {
  constructor() { super('WIKI_SOURCE_CHANGED'); this.name = 'WikiSourceChangedError' }
}

const evidenceSchema = z.object({ quote: z.string().trim().min(1).max(3000), nodeId: z.string().optional() })
const extractionSchema = z.object({
  summary: z.string().trim().min(1),
  topics: z.array(z.object({
    title: z.string().trim().min(1).max(160),
    topicKey: z.string().optional(),
    aliases: z.array(z.string().trim().min(1).max(160)).max(8),
    content: z.string().trim().min(1),
    evidence: z.array(evidenceSchema).min(1).max(12),
  })).max(3),
})

function emptyUsage(): WikiUsage { return { inputTokens: 0, outputTokens: 0, estimated: false } }

function addUsage(total: WikiUsage, usage: WikiUsage) {
  total.inputTokens += usage.inputTokens
  total.outputTokens += usage.outputTokens
  total.estimated ||= usage.estimated
}

function normalizeEvidence(text: string) { return text.normalize('NFKC').replace(/\s+/g, ' ').trim() }

function locateWikiEvidence(document: WikiSourceDocument, evidence: WikiEvidence[]): WikiEvidence[] {
  if (document.source.sourceType !== 'canvas') return evidence.map(item => ({ quote: item.quote }))
  const allowed = new Set(document.source.locator.nodeIds || [])
  const located = evidence.flatMap<WikiEvidence>(item => {
    const quote = normalizeEvidence(item.quote)
    const mentioned = [...item.quote.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1]).filter(id => allowed.has(id))
    const matches = (document.nodeTexts || []).filter(node => normalizeEvidence(node.text).includes(quote)).map(node => node.id)
    const inferred = [...new Set([...mentioned, ...matches])]
    const ids = inferred.length ? inferred : item.nodeId && allowed.has(item.nodeId) ? [item.nodeId] : []
    return ids.length ? ids.map(nodeId => ({ quote: item.quote, nodeId })) : [{ quote: item.quote }]
  })
  return located.filter((item, index, all) => all.findIndex(other => other.quote === item.quote && other.nodeId === item.nodeId) === index)
}

export function wikiSourceWithEvidence(source: WikiSourceReference, contributions: WikiContribution[]): WikiSourceReference {
  if (source.sourceType !== 'canvas') return source
  const valid = new Set(source.locator.nodeIds || [])
  const nodeIds = [...new Set(contributions.flatMap(item => item.evidence.flatMap(evidence => (
    evidence.nodeId && valid.has(evidence.nodeId) ? [evidence.nodeId] : []
  ))))].sort(compareWikiKeys)
  return { ...source, locator: { ...source.locator, nodeIds } }
}

export async function getWikiSourceGeneration(contextId: string, stableId: string, settings: WikiSettings) {
  const state = await getWikiSourceState(contextId, stableId)
  const revision = state?.revisionId ? await getWikiRevision(contextId, state.revisionId) : null
  return Math.max(settings.generation, revision?.generation ?? 0,
    await getWikiMeta<number>(contextId, `source-generation:${stableId}`) ?? 0)
}

export function buildWikiSourceInputHash(document: WikiSourceDocument, settings: WikiSettings, generation: number) {
  return wikiHash(JSON.stringify([WIKI_PIPELINE_VERSION, document.source.stableId,
    document.source.contentHash, generation, settings.language]))
}

export function buildWikiTopicInputHash(
  topicKey: string, revisions: WikiSourceRevision[], generation: number, language: string,
) {
  const dependencies = revisions.filter(revision => revision.contributions.some(item => item.topicKey === topicKey))
    .map(revision => [revision.source.stableId, revision.outputHash]).sort((left, right) => compareWikiKeys(left[0], right[0]))
  return wikiHash(JSON.stringify([WIKI_PIPELINE_VERSION, 'topic', topicKey, dependencies, generation, language]))
}

function sourcePage(revision: WikiSourceRevision): WikiPage {
  return {
    id: `source:${wikiHash(revision.source.stableId)}`,
    contextId: revision.contextId,
    kind: 'source',
    title: revision.source.title,
    aliases: [],
    body: revision.summary,
    sourceRefs: [wikiSourceWithEvidence(revision.source, revision.contributions)],
    inputHash: revision.inputHash,
    outputHash: revision.outputHash,
    generation: revision.generation,
    updatedAt: Date.now(),
    status: 'ready',
    relatedPageIds: revision.contributions.map(item => `topic:${item.topicKey}`),
  }
}

async function assertCurrentSource(document: WikiSourceDocument, context: WikiContext, signal?: AbortSignal) {
  throwIfWikiAborted(signal)
  if ((await getWikiContext()).id !== context.id) throw new WikiSourceChangedError()
  const settings = await getWikiSettings(context.id)
  if (!settings.enabled || !settings.started || !isWikiSourceSelected(document.source, settings)) throw new WikiSourceChangedError()
  const current = await getWikiSourceDocument(document.source.sourceKey)
  if (!current || current.source.contentHash !== document.source.contentHash || current.source.stableId !== document.source.stableId) {
    throw new WikiSourceChangedError()
  }
  if (!isWikiSourceSelected(current.source, settings) || !await isWikiSourceDocumentAllowed(current, context.id)) throw new WikiSourceChangedError()
}

function existingTopics(document: WikiSourceDocument, pages: WikiPage[]) {
  const available = pages.filter(page => page.kind === 'topic' && page.status !== 'archived'
    && page.sourceRefs.every(source => source.syncDomain === document.source.syncDomain))
  const byId = new Map(available.map(page => [page.id, page]))
  const index = new BM25Index()
  index.index(available.map(page => ({ id: page.id, content: [page.title, page.title, ...page.aliases].join('\n') })))
  return index.search(document.content, 5).flatMap(hit => {
    const page = byId.get(hit.id)
    return page ? [{ topicKey: page.id.replace(/^topic:/, ''), title: page.title, aliases: page.aliases }] : []
  })
}

async function extractSegment(
  text: string, document: WikiSourceDocument, session: WikiAiSession, context: WikiContext,
  settings: WikiSettings, inputHash: string, pages: WikiPage[], signal: AbortSignal | undefined,
  totalUsage: WikiUsage,
): Promise<WikiSegmentCache[]> {
  const key = wikiHash(`${inputHash}:segment:${wikiHash(text)}`)
  const cached = await getWikiSegmentCache(context.id, key)
  if (cached) return [{ ...cached, contributions: cached.contributions.map(item => ({
    ...item, evidence: locateWikiEvidence(document, item.evidence),
  })) }]
  const catalog = existingTopics({ ...document, content: text }, pages)
  const schema = extractionSchema.superRefine((value, validation) => {
    const normalized = normalizeEvidence(text)
    value.topics.forEach((topic, topicIndex) => topic.evidence.forEach((evidence, evidenceIndex) => {
      if (!normalized.includes(normalizeEvidence(evidence.quote))) {
        validation.addIssue({ code: 'custom', path: ['topics', topicIndex, 'evidence', evidenceIndex, 'quote'],
          message: 'Evidence quote must be copied verbatim from this source segment.' })
      }
      if (evidence.nodeId && !document.source.locator.nodeIds?.includes(evidence.nodeId)) {
        validation.addIssue({ code: 'custom', path: ['topics', topicIndex, 'evidence', evidenceIndex, 'nodeId'],
          message: 'Use only canvas node IDs present in this source.' })
      }
    }))
  })
  const prompt = `Compile this source segment into a faithful summary and at most three main topic contributions.
Write summaries and topic names in language ${settings.language}. Preserve proper names, identifiers, dates, numbers and uncertainty.
Only describe facts supplied by this segment. Never incorporate facts from the existing-topic catalog.
Each contribution must have one or more short, verbatim supporting quotes copied from the segment.
For canvas evidence, include nodeId when a quote supports a particular node or its explicit connected edge. Use only actual IDs from the source's [node-id] node labels; omit nodeId for non-canvas sources or when uncertain.
Use an existing topicKey only when meaning and granularity match. Otherwise omit topicKey and propose a concise, specific topic title.
If names are ambiguous, qualify the title. Related topics are not necessarily the same topic.
Return JSON: {"summary":"markdown summary","topics":[{"title":"topic","topicKey":"optional existing key","aliases":[],"content":"source-specific markdown facts","evidence":[{"quote":"verbatim supporting text","nodeId":"optional actual canvas node ID"}]}]}
Existing topics: ${JSON.stringify(catalog)}
Source title: ${document.source.title}
<source-data>\n${text}\n</source-data>`
  const usage = emptyUsage()
  try {
    const extracted = await requestWikiJson(session, prompt, schema, {
      signal,
      onUsage: async value => { addUsage(totalUsage, value); addUsage(usage, value); await recordWikiUsage(context.id, value) },
    })
    const contributions: WikiContribution[] = extracted.topics.map(topic => {
      const exact = catalog.find(item => [item.title, ...item.aliases]
        .some(alias => normalizeWikiTopicName(alias) === normalizeWikiTopicName(topic.title)))
      const existing = catalog.find(item => item.topicKey === topic.topicKey) || exact
      return {
        topicKey: existing?.topicKey || wikiTopicKey(topic.title, document.source.syncDomain),
        title: existing?.title || topic.title,
        aliases: [...new Set([...topic.aliases, ...(existing?.aliases || [])])],
        content: topic.content,
        evidence: locateWikiEvidence(document, topic.evidence),
      }
    })
    const result = { summary: extracted.summary, contributions, usage }
    await saveWikiSegmentCache(context.id, key, result)
    return [result]
  } catch (error) {
    if (!(error instanceof WikiContextError) || text.length < 512) throw error
    const half = Math.floor(text.length / 2)
    return [
      ...await extractSegment(text.slice(0, half), document, session, context, settings, inputHash, pages, signal, totalUsage),
      ...await extractSegment(text.slice(half), document, session, context, settings, inputHash, pages, signal, totalUsage),
    ]
  }
}

async function summarizeSegments(
  summaries: string[], session: WikiAiSession, context: WikiContext, signal: AbortSignal | undefined, usage: WikiUsage,
): Promise<string> {
  if (summaries.length === 1) return summaries[0]
  const instruction = `Merge these source summaries into one coherent Markdown summary in language ${session.language}.
Use only the supplied summaries. Preserve key facts, uncertainty and disagreements. Return {"summary":"markdown"}.`
  let current = summaries
  for (let depth = 0; depth < 10; depth++) {
    const groups = splitWikiText(current.join('\n\n'), Math.min(6000, wikiInputBudget(session, instruction)))
    const next: string[] = []
    for (const group of groups) {
      const cacheKey = wikiHash(`summary:${WIKI_PIPELINE_VERSION}:${session.language}:${group}`)
      const cached = await getWikiSegmentCache(context.id, cacheKey)
      if (cached) { next.push(cached.summary); continue }
      const result = await requestWikiJson(session, `${instruction}\n<summaries>\n${group}\n</summaries>`,
        z.object({ summary: z.string().trim().min(1) }), {
          signal,
          onUsage: async value => { addUsage(usage, value); await recordWikiUsage(context.id, value) },
        })
      await saveWikiSegmentCache(context.id, cacheKey, { summary: result.summary, contributions: [], usage: emptyUsage() })
      next.push(result.summary)
    }
    if (next.length === 1) return next[0]
    current = next
  }
  throw new Error('WIKI_SUMMARY_TOO_LARGE')
}

function combineContributions(segments: WikiSegmentCache[]): WikiContribution[] {
  const grouped = new Map<string, { item: WikiContribution; occurrences: number }>()
  for (const segment of segments) for (const contribution of segment.contributions) {
    const previous = grouped.get(contribution.topicKey)
    if (!previous) grouped.set(contribution.topicKey, { item: { ...contribution }, occurrences: 1 })
    else {
      previous.occurrences++
      previous.item = {
        ...previous.item,
        content: `${previous.item.content}\n\n${contribution.content}`,
        aliases: [...new Set([...previous.item.aliases, ...contribution.aliases])],
        evidence: [...previous.item.evidence, ...contribution.evidence]
          .filter((evidence, index, all) => all.findIndex(item => item.quote === evidence.quote && item.nodeId === evidence.nodeId) === index),
      }
    }
  }
  return [...grouped.values()].sort((left, right) => right.occurrences - left.occurrences
    || compareWikiKeys(left.item.topicKey, right.item.topicKey)).slice(0, 3).map(item => item.item)
}

export async function scheduleWikiTopics(contextId: string, keys: string[]) {
  for (const key of new Set(keys)) {
    const page = await getWikiPage(contextId, `topic:${key}`)
    if (page && page.status !== 'archived') await upsertWikiPage({ ...page, status: 'stale' })
    await upsertWikiJob({
      id: `topic:${key}`, contextId, sourceKey: key, kind: 'topic', inputHash: '', status: 'pending',
      stage: 'topic', attempts: 0, readyAt: Date.now() + 1000, updatedAt: Date.now(), error: null,
    })
  }
}

export async function compileWikiSource(
  document: WikiSourceDocument, context: WikiContext, settings: WikiSettings,
  state: WikiSourceState, signal?: AbortSignal,
): Promise<void> {
  const generation = await getWikiSourceGeneration(context.id, document.source.stableId, settings)
  const inputHash = buildWikiSourceInputHash(document, settings, generation)
  const previous = state.revisionId ? await getWikiRevision(context.id, state.revisionId) : null
  let revision = await findWikiRevision(context.id, inputHash)
  if (!revision) {
    const session = await createWikiAiSession(settings.modelId, settings.language)
    const pages = await listWikiPages(context.id)
    const usage = emptyUsage()
    const segments: WikiSegmentCache[] = []
    const budget = Math.min(6000, wikiInputBudget(session, 'source-grounded summary, topics and verbatim supporting quotes'.repeat(10)))
    const chunks = splitWikiText(document.content, budget)
    if (!chunks.length) throw new Error('WIKI_EMPTY_SOURCE')
    for (const chunk of chunks) {
      await assertCurrentSource(document, context, signal)
      segments.push(...await extractSegment(chunk, document, session, context, settings, inputHash, pages, signal, usage))
    }
    const summary = await summarizeSegments(segments.map(segment => segment.summary), session, context, signal, usage)
    const contributions = combineContributions(segments)
    const outputHash = wikiHash(JSON.stringify({ summary, contributions }))
    revision = {
      id: `${inputHash}:${outputHash}`, contextId: context.id, inputHash, outputHash,
      pipelineVersion: WIKI_PIPELINE_VERSION, generation, language: settings.language,
      source: document.source, summary, contributions, createdAt: Date.now(), modelId: session.modelId, usage,
    }
  } else {
    const contributions = revision.contributions.map(item => ({ ...item, evidence: locateWikiEvidence(document, item.evidence) }))
    const outputHash = wikiHash(JSON.stringify({ summary: revision.summary, contributions }))
    revision = { ...revision, id: `${inputHash}:${outputHash}`, outputHash, contributions, source: document.source }
  }
  await assertCurrentSource(document, context, signal)
  if (!await commitWikiSourceRevision(revision, [sourcePage(revision)], state.version)) throw new WikiSourceChangedError()
  await scheduleWikiTopics(context.id, [
    ...(previous?.contributions.map(item => item.topicKey) || []), ...revision.contributions.map(item => item.topicKey),
  ])
  const { notifyWikiChanged } = await import('./sync')
  notifyWikiChanged()
}

export async function invalidateWikiSourcePages(contextId: string, state: WikiSourceState) {
  const revision = state.revisionId ? await getWikiRevision(contextId, state.revisionId) : null
  const page = await getWikiPage(contextId, `source:${wikiHash(state.stableId)}`)
  if (page) await upsertWikiPage({ ...page, status: ['deleted', 'excluded'].includes(state.status) ? 'archived' : 'stale' })
  await scheduleWikiTopics(contextId, revision?.contributions.map(item => item.topicKey) || [])
  const { notifyWikiChanged } = await import('./sync')
  notifyWikiChanged()
}

export async function compileWikiTopic(
  topicKey: string, context: WikiContext, settings: WikiSettings, signal?: AbortSignal,
  onSources?: (sources: readonly WikiSourceReference[]) => void,
  beforeCommit?: () => Promise<void>,
) {
  const revisions = (await getActiveWikiRevisions(context.id))
    .filter(revision => isWikiSourceSelected(revision.source, settings))
    .filter(revision => revision.contributions.some(item => item.topicKey === topicKey))
    .sort((left, right) => compareWikiKeys(left.source.stableId, right.source.stableId))
  onSources?.(revisions.map(revision => revision.source))
  const existing = await getWikiPage(context.id, `topic:${topicKey}`)
  if (!revisions.length) {
    if (existing) {
      await beforeCommit?.()
      await upsertWikiPage({ ...existing, status: 'archived', sourceRefs: [], body: '', updatedAt: Date.now() })
      const { notifyWikiChanged } = await import('./sync')
      notifyWikiChanged()
    }
    return
  }
  const generation = Math.max(settings.generation, existing?.generation ?? 0,
    await getWikiMeta<number>(context.id, `topic-generation:${topicKey}`) ?? 0)
  const inputHash = buildWikiTopicInputHash(topicKey, revisions, generation, settings.language)
  const deletedPages = await getWikiMeta<Record<string, string>>(context.id, 'markdown-deleted') ?? {}
  if (deletedPages[`topic:${topicKey}`] === inputHash) return
  if (existing?.inputHash === inputHash && existing.status !== 'archived') {
    if (existing.status !== 'ready') {
      await beforeCommit?.()
      await upsertWikiPage({ ...existing, sourceRefs: revisions.map(revision => wikiSourceWithEvidence(revision.source,
        revision.contributions.filter(item => item.topicKey === topicKey))), status: 'ready' })
      const { notifyWikiChanged } = await import('./sync')
      notifyWikiChanged()
    }
    return
  }
  const contributions = revisions.map((revision, index) => ({
    reference: index + 1,
    title: revision.source.title,
    contributions: revision.contributions.filter(item => item.topicKey === topicKey),
  }))
  const topic = contributions[0].contributions[0]
  const allowed = new Set(contributions.map(item => item.reference))
  const singleSourceBody = revisions.length === 1
    ? contributions[0].contributions.map(item => item.content).join('\n\n') : ''
  let body = singleSourceBody && !wikiCitationReferences(singleSourceBody).length
    ? citeSingleWikiSource(singleSourceBody) : ''
  // Normal single-source pages need no merge request. Ambiguous source-local
  // footnotes or malformed Markdown go through the same validated formatter.
  if (body && wikiCitationIssues(body, allowed).length) body = ''
  if (!body) {
    const session = await createWikiAiSession(settings.modelId, settings.language)
    const instructions = `Write a coherent wiki topic page in language ${settings.language} for "${topic.title}".
Use only supplied contributions. Distinguish disagreements; do not silently choose one version.
Every factual paragraph must cite its supporting source reference numbers as [1], [2], etc.
Every list item and table data row must also carry a supporting citation. Code and formula blocks need a cited caption immediately before or after them. Use plain [n] references outside inline code, not Markdown links.
Preserve literal bracketed data and array indexes inside inline code; do not confuse original source footnotes with these Wiki source reference numbers.
Do not add a source list or invent references. Return {"body":"Markdown with citations"}.`
    const schema = z.object({ body: z.string().trim().min(1) }).superRefine((value, validation) => {
      for (const message of wikiCitationIssues(value.body, allowed)) {
        validation.addIssue({ code: 'custom', path: ['body'], message })
      }
    })
    let sections = contributions.flatMap(item => item.contributions.map(contribution => (
      `Source [${item.reference}] ${item.title}:\n${contribution.content}\nEvidence:\n${contribution.evidence.map(evidence => evidence.quote).join('\n')}`
    )))
    body = ''
    for (let depth = 0; depth < 10; depth++) {
      const groups = splitWikiText(sections.join('\n\n'), Math.min(6000, wikiInputBudget(session, instructions)))
      const next: string[] = []
      for (const group of groups) {
        throwIfWikiAborted(signal)
        const cacheKey = wikiHash(`topic-section:citations-2:${inputHash}:${group}`)
        const cached = await getWikiSegmentCache(context.id, cacheKey)
        if (cached && !wikiCitationIssues(cached.summary, allowed).length) { next.push(cached.summary); continue }
        const result = await requestWikiJson(session, `${instructions}\n<contributions>\n${group}\n</contributions>`, schema, {
          signal, onUsage: value => recordWikiUsage(context.id, value),
        })
        await saveWikiSegmentCache(context.id, cacheKey, { summary: result.body, contributions: [], usage: emptyUsage() })
        next.push(result.body)
      }
      if (next.length === 1) { body = next[0]; break }
      sections = next
    }
    if (!body) throw new Error('WIKI_TOPIC_TOO_LARGE')
  }
  throwIfWikiAborted(signal)
  if ((await getWikiContext()).id !== context.id) throw new WikiSourceChangedError()
  const latestSettings = await getWikiSettings(context.id)
  const latest = (await getActiveWikiRevisions(context.id)).filter(revision => isWikiSourceSelected(revision.source, latestSettings))
  if (buildWikiTopicInputHash(topicKey, latest, generation, latestSettings.language) !== inputHash) throw new WikiSourceChangedError()
  const citationIssues = wikiCitationIssues(body, allowed)
  if (citationIssues.length) throw new Error(`WIKI_INVALID_RESPONSE: ${citationIssues.join(' ')}`)
  await beforeCommit?.()
  await upsertWikiPage({
    id: `topic:${topicKey}`, topicKey, contextId: context.id, kind: 'topic', title: topic.title,
    aliases: [...new Set(contributions.flatMap(item => item.contributions.flatMap(contribution => contribution.aliases)))],
    body, sourceRefs: revisions.map(revision => wikiSourceWithEvidence(revision.source,
      revision.contributions.filter(item => item.topicKey === topicKey))), inputHash, outputHash: wikiHash(body), generation,
    updatedAt: Date.now(), status: 'ready', relatedPageIds: revisions.map(revision => `source:${wikiHash(revision.source.stableId)}`),
  })
  const { notifyWikiChanged } = await import('./sync')
  notifyWikiChanged()
}
