import { createHash } from 'crypto'
import { z } from 'zod'
import { createRelativeMarkdownHref } from '@/lib/markdown-file-link'
import type {
  WikiContribution, WikiEvidence, WikiPage, WikiSharedSettings, WikiSourceRevision,
} from '@/types/wiki'

export type WikiMarkdownDocument = {
  kind: 'page'
  page: WikiPage
  revision?: WikiSourceRevision
  generatedBodyHash: string
  edited: boolean
} | {
  kind: 'index'
  settings: WikiSharedSettings
  generatedBodyHash: string
  edited: boolean
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex') }
function normalizeBody(value: string) { return value.replace(/\r\n?/g, '\n').trim() }
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const textSchema = z.string().min(1).max(4000).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
// Imported notes and records can have blank or multiline display labels.
// JSON escapes their line breaks; identifiers and paths still use stricter schemas.
const displayTextSchema = z.string().max(4000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
const pageIdSchema = z.string().regex(/^(?:source|topic):[a-f0-9]{64}$/)
const integerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

function safeRelativePath(value: string) {
  return value.length > 0 && value.length <= 4000
    && !/[\\\u0000-\u001f\u007f:]/.test(value) && !value.startsWith('/')
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

const pathSchema = z.string().refine(safeRelativePath)
const locatorSchema = z.strictObject({
  filePath: pathSchema.optional(),
  markId: integerSchema.optional(), tagId: integerSchema.optional(),
  tagIds: z.array(integerSchema).max(10000).optional(),
  canvasId: textSchema.optional(), nodeIds: z.array(textSchema).max(10000).optional(),
})
const sourceSchema = z.strictObject({
  sourceKey: textSchema, stableId: textSchema,
  sourceType: z.enum(['article', 'record', 'canvas']), title: displayTextSchema,
  contentHash: hashSchema, locator: locatorSchema,
  syncDomain: z.enum(['library', 'account-data']),
  remoteVersion: textSchema.optional(), tagKeys: z.array(textSchema).max(10000).optional(),
}).superRefine((source, ctx) => {
  const prefix = `${source.sourceType}:`
  if (!source.sourceKey.startsWith(prefix) || !source.stableId.startsWith(prefix)
    || source.sourceKey.length <= prefix.length || source.stableId.length <= prefix.length) {
    ctx.addIssue({ code: 'custom', message: 'Source IDs must match their source type.' })
  }
  if (source.sourceType === 'article' && (!safeRelativePath(source.sourceKey.slice(prefix.length))
    || !safeRelativePath(source.stableId.slice(prefix.length)))) {
    ctx.addIssue({ code: 'custom', message: 'Article references must stay inside the note workspace.' })
  }
})
const pageMetadataSchema = z.strictObject({
  id: pageIdSchema, kind: z.enum(['source', 'topic']), title: displayTextSchema,
  aliases: z.array(displayTextSchema).max(10000), sourceRefs: z.array(sourceSchema).max(10000),
  inputHash: hashSchema, outputHash: hashSchema, updatedAt: integerSchema,
  status: z.enum(['ready', 'stale', 'archived']), relatedPageIds: z.array(pageIdSchema).max(10000),
  topicKey: hashSchema.optional(), generation: integerSchema.optional(), filePath: pathSchema.optional(),
}).superRefine((page, ctx) => {
  if (!page.id.startsWith(`${page.kind}:`) || (page.topicKey && page.id !== `topic:${page.topicKey}`)) {
    ctx.addIssue({ code: 'custom', message: 'Page identity must match its kind and topic.' })
  }
})
const contributionMetadataSchema = z.strictObject({
  marker: hashSchema, topicKey: hashSchema, title: displayTextSchema, aliases: z.array(displayTextSchema).max(10000),
  // Supporting quote text lives in visible Markdown blockquotes, not JSON.
  evidence: z.array(z.strictObject({ nodeId: textSchema.optional() })).max(1000),
})
const revisionMetadataSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}:[a-f0-9]{64}$/),
  inputHash: hashSchema, outputHash: hashSchema, pipelineVersion: textSchema,
  generation: integerSchema, language: textSchema, source: sourceSchema,
  contributions: z.array(contributionMetadataSchema).max(1000),
  createdAt: integerSchema, modelId: textSchema,
  usage: z.strictObject({ inputTokens: integerSchema, outputTokens: integerSchema, estimated: z.boolean() }),
})
const clockSchema = z.record(textSchema, integerSchema)
const settingsSchema = z.strictObject({
  enabled: z.boolean(), started: z.boolean(), language: textSchema,
  languageClock: clockSchema, generation: integerSchema,
  scopes: z.array(z.strictObject({
    key: textSchema, kind: z.enum(['article-folder', 'article', 'record-tag', 'record', 'canvas', 'source-type']),
    id: z.string().max(4000).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
    label: displayTextSchema, enabled: z.boolean(), effect: z.enum(['include', 'exclude']).optional(), clock: clockSchema,
  }).superRefine((scope, ctx) => {
    if ((scope.kind === 'article' && !safeRelativePath(scope.id))
      || (scope.kind === 'article-folder' && scope.id !== '' && !safeRelativePath(scope.id))) {
      ctx.addIssue({ code: 'custom', message: 'Article scopes must stay inside the note workspace.' })
    }
    if (scope.kind === 'source-type' && !['article', 'record', 'canvas'].includes(scope.id)) {
      ctx.addIssue({ code: 'custom', message: 'Unknown source type scope.' })
    }
  })).max(10000),
})
const pageEnvelopeSchema = z.strictObject({
  schema: z.literal(2), kind: z.literal('page'), marker: hashSchema,
  page: pageMetadataSchema, revision: revisionMetadataSchema.optional(), generatedBodyHash: hashSchema,
}).superRefine((value, ctx) => {
  const revision = value.revision
  if (!revision) return
  if (value.page.kind !== 'source' || revision.inputHash !== value.page.inputHash
    || revision.id !== `${revision.inputHash}:${revision.outputHash}`
    || !value.page.sourceRefs.some(source => source.stableId === revision.source.stableId)) {
    ctx.addIssue({ code: 'custom', message: 'A source revision must belong to its source page.' })
  }
  const markers = revision.contributions.map(item => item.marker)
  if (new Set(markers).size !== markers.length) ctx.addIssue({ code: 'custom', message: 'Duplicate contribution markers.' })
})
const indexEnvelopeSchema = z.strictObject({
  schema: z.literal(2), kind: z.literal('index'), settings: settingsSchema, generatedBodyHash: hashSchema,
})
const envelopeSchema = z.union([pageEnvelopeSchema, indexEnvelopeSchema])
type PageEnvelope = z.infer<typeof pageEnvelopeSchema>
type Envelope = z.infer<typeof envelopeSchema>

function frontmatter(envelope: Envelope, body: string) {
  const origin = envelope.kind === 'page' ? envelope.page.id : 'index'
  return `---\nnotegen-wiki-origin: ${JSON.stringify(origin)}\nnotegen-wiki-data: ${JSON.stringify(envelope)}\n---\n\n${normalizeBody(body)}\n`
}

function readEnvelope(text: string): { envelope: Envelope; body: string } | null {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized)
  if (!match) return null
  const fields = match[1].split('\n')
  const data = fields.filter(line => line.startsWith('notegen-wiki-data:'))
  const origin = fields.filter(line => line.startsWith('notegen-wiki-origin:'))
  if (data.length !== 1 || origin.length !== 1) return null
  try {
    const parsed = envelopeSchema.safeParse(JSON.parse(data[0].slice('notegen-wiki-data:'.length).trim()))
    if (!parsed.success) return null
    const expected = parsed.data.kind === 'page' ? parsed.data.page.id : 'index'
    if (JSON.parse(origin[0].slice('notegen-wiki-origin:'.length).trim()) !== expected) return null
    return { envelope: parsed.data, body: normalizeBody(normalized.slice(match[0].length)) }
  } catch { return null }
}

function marker(token: string, section: string, edge: 'start' | 'end') {
  return `<!-- notegen-wiki:${token}:${section}:${edge} -->`
}

function block(token: string, section: string, body: string) {
  return `${marker(token, section, 'start')}\n${body}\n${marker(token, section, 'end')}`
}

/** Exact whole-line matching avoids interpreting prose, HTML or code as metadata. */
function takeBlock(text: string, token: string, section: string): { body: string; rest: string } | null {
  const lines = text.split('\n')
  const start = marker(token, section, 'start')
  const end = marker(token, section, 'end')
  const starts = lines.flatMap((line, index) => line === start ? [index] : [])
  const ends = lines.flatMap((line, index) => line === end ? [index] : [])
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) return null
  return {
    body: normalizeBody(lines.slice(starts[0] + 1, ends[0]).join('\n')),
    rest: normalizeBody([...lines.slice(0, starts[0]), ...lines.slice(ends[0] + 1)].join('\n')),
  }
}

function plainHeading(value: string) { return value.replace(/[\r\n]+/g, ' ').replace(/([\\[\]*_`])/g, '\\$1') }
function readHeading(text: string, level: number) {
  const prefix = `${'#'.repeat(level)} `
  const first = text.split('\n', 1)[0]
  if (!first?.startsWith(prefix)) return { title: null, rest: text }
  return { title: first.slice(prefix.length).replace(/\\([\\[\]*_`])/g, '$1').trim(), rest: normalizeBody(text.slice(first.length)) }
}
function stripHeading(text: string, level: number) { return readHeading(text, level).rest }
function zhLanguage(language?: string) { return Boolean(language && /^(?:zh|简体中文|繁體中文)/i.test(language)) }
function restoreDisplayTitle(title: string | null, stored: string, fallback = '') {
  return title === (stored || fallback).replace(/[\r\n]+/g, ' ') ? stored : title || stored
}

function sourceLinks(page: WikiPage, filePath: string, allPages: WikiPage[], chinese: boolean) {
  const links = page.sourceRefs.map((source, index) => {
    const label = plainHeading(source.title || source.stableId)
    if (source.sourceType === 'article' && source.locator.filePath && safeRelativePath(source.locator.filePath)) {
      return `${index + 1}. [${label}](<${createRelativeMarkdownHref(filePath, source.locator.filePath)}>)`
    }
    const summary = allPages.find(candidate => candidate.kind === 'source' && candidate.id !== page.id
      && candidate.sourceRefs.some(ref => ref.stableId === source.stableId))
    if (summary?.filePath && safeRelativePath(summary.filePath)) {
      return `${index + 1}. [${label}](<${createRelativeMarkdownHref(filePath, summary.filePath)}>)`
    }
    return `${index + 1}. ${label} (${source.sourceType})`
  })
  const related = page.relatedPageIds.flatMap(id => {
    const other = allPages.find(candidate => candidate.id === id)
    return other?.filePath && safeRelativePath(other.filePath)
      ? [`- [${plainHeading(other.title || other.id)}](<${createRelativeMarkdownHref(filePath, other.filePath)}>)`] : []
  })
  return [
    ...(links.length ? [`## ${chinese ? '来源' : 'Sources'}`, '', ...links] : []),
    ...(related.length ? ['', `## ${chinese ? '相关页面' : 'Related pages'}`, '', ...related] : []),
  ].join('\n').trim()
}

function pageMetadata(page: WikiPage, filePath: string) {
  const { contextId: _contextId, body: _body, ...metadata } = page
  return pageMetadataSchema.parse({ ...metadata, filePath })
}

export function serializeWikiPageFile(
  page: WikiPage, revision: WikiSourceRevision | undefined, filePath: string,
  allPages: WikiPage[], generatedBodyHash?: string,
): string {
  const token = hash(`${page.id}:${page.outputHash}:markdown-2`)
  const chinese = zhLanguage(revision?.language)
  const revisionData = revision && page.kind === 'source' ? {
    id: revision.id, inputHash: revision.inputHash, outputHash: revision.outputHash,
    pipelineVersion: revision.pipelineVersion, generation: revision.generation, language: revision.language,
    source: revision.source, createdAt: revision.createdAt, modelId: revision.modelId, usage: revision.usage,
    contributions: revision.contributions.map((item, index) => ({
      marker: hash(`${token}:${index}:${item.topicKey}`), topicKey: item.topicKey,
      title: item.title, aliases: item.aliases, evidence: item.evidence.map(evidence => ({ nodeId: evidence.nodeId })),
    })),
  } : undefined
  const contributionBody = revisionData?.contributions.length && revision ? block(token, 'contributions', [
    `## ${chinese ? '主题贡献' : 'Topic contributions'}`, '',
    ...revision.contributions.map((item, index) => block(revisionData.contributions[index].marker, 'contribution', [
      `### ${plainHeading(item.title)}`, '', normalizeBody(item.content), '',
      ...(item.evidence.length ? [block(revisionData.contributions[index].marker, 'evidence', [
        `#### ${chinese ? '依据原文' : 'Supporting quotes'}`, '',
        ...item.evidence.map((evidence, quoteIndex) => block(revisionData.contributions[index].marker, `evidence-${quoteIndex}`,
          evidence.quote.split(/\r?\n/).map(line => `> ${line}`).join('\n'))),
      ].join('\n\n'))] : []),
    ].join('\n'))),
  ].join('\n\n')) : ''
  const body = normalizeBody([
    `# ${plainHeading(page.title || 'Wiki')}`, '', normalizeBody(page.body), '', contributionBody, '',
    block(token, 'links', sourceLinks(page, filePath, allPages, chinese)),
  ].join('\n'))
  const envelope = pageEnvelopeSchema.parse({
    schema: 2, kind: 'page', marker: token, page: pageMetadata(page, filePath), revision: revisionData,
    generatedBodyHash: generatedBodyHash ?? hash(body),
  })
  return frontmatter(envelope, body)
}

export function serializeWikiIndexFile(body: string, settings: WikiSharedSettings, generatedBodyHash?: string): string {
  return frontmatter(indexEnvelopeSchema.parse({
    schema: 2, kind: 'index', settings, generatedBodyHash: generatedBodyHash ?? hash(normalizeBody(body)),
  }), body)
}

function parseContribution(
  metadata: z.infer<typeof contributionMetadataSchema>, text: string,
): WikiContribution | null {
  let remaining = text
  const evidence: WikiEvidence[] = []
  let quoteSection = ''
  if (metadata.evidence.length) {
    const section = takeBlock(remaining, metadata.marker, 'evidence')
    if (!section) return null
    remaining = section.rest
    quoteSection = stripHeading(section.body, 4)
  }
  for (let index = 0; index < metadata.evidence.length; index++) {
    const quote = takeBlock(quoteSection, metadata.marker, `evidence-${index}`)
    if (!quote) return null
    quoteSection = quote.rest
    const quoteText = quote.body.split('\n').map(line => line.replace(/^> ?/, '')).join('\n').trim()
    if (!quoteText) continue
    evidence.push({ quote: quoteText, ...(metadata.evidence[index].nodeId ? { nodeId: metadata.evidence[index].nodeId } : {}) })
  }
  const heading = readHeading(remaining, 3)
  const content = normalizeBody([heading.rest, quoteSection].filter(Boolean).join('\n\n'))
  return { topicKey: metadata.topicKey, title: restoreDisplayTitle(heading.title, metadata.title),
    aliases: metadata.aliases, content, evidence }
}

function pageFromProse(
  envelope: PageEnvelope, prose: string, contributions: WikiContribution[], contextId: string, edited: boolean,
): WikiMarkdownDocument {
  const heading = readHeading(prose, 1)
  const summary = normalizeBody(heading.rest)
  let revision: WikiSourceRevision | undefined
  if (envelope.revision) {
    const { contributions: _contributionMetadata, ...metadata } = envelope.revision
    const outputHash = edited ? hash(JSON.stringify({ summary, contributions })) : metadata.outputHash
    revision = { ...metadata, contextId, summary, contributions, outputHash,
      id: edited ? `${metadata.inputHash}:${outputHash}` : metadata.id }
  }
  const page: WikiPage = {
    ...envelope.page, contextId, title: restoreDisplayTitle(heading.title, envelope.page.title, 'Wiki'), body: summary,
    outputHash: edited ? revision?.outputHash ?? hash(summary) : envelope.page.outputHash,
  }
  return { kind: 'page', page, revision, generatedBodyHash: envelope.generatedBodyHash, edited }
}

function parsePage(envelope: PageEnvelope, body: string, contextId: string): WikiMarkdownDocument {
  const links = takeBlock(body, envelope.marker, 'links')
  const fallback = () => pageFromProse(envelope, links?.rest ?? body, [], contextId, true)
  if (!links) return fallback()
  let prose = links.rest
  const contributions: WikiContribution[] = []
  const revisionMetadata = envelope.revision
  if (revisionMetadata?.contributions.length) {
    const section = takeBlock(prose, envelope.marker, 'contributions')
    if (!section) return fallback()
    prose = section.rest
    let remaining = stripHeading(section.body, 2)
    for (const metadata of revisionMetadata.contributions) {
      const item = takeBlock(remaining, metadata.marker, 'contribution')
      if (!item) return fallback()
      const contribution = parseContribution(metadata, item.body)
      if (!contribution) return fallback()
      contributions.push(contribution)
      remaining = item.rest
    }
    // Handwritten prose between generated sections remains searchable as summary text.
    if (remaining) prose = `${prose}\n\n${remaining}`
  }
  const edited = hash(body) !== envelope.generatedBodyHash
  return pageFromProse(envelope, prose, contributions, contextId, edited)
}

/** Returns null for unrecognized or unsafe metadata; callers must keep the original file. */
export function parseWikiMarkdown(text: string, contextId: string): WikiMarkdownDocument | null {
  const parsed = readEnvelope(text)
  if (!parsed) return null
  const { envelope, body } = parsed
  if (envelope.kind === 'index') return {
    kind: 'index', settings: envelope.settings,
    generatedBodyHash: envelope.generatedBodyHash, edited: hash(body) !== envelope.generatedBodyHash,
  }
  return parsePage(envelope, body, contextId)
}

/** Relocate managed navigation without regenerating or normalizing authored prose. */
export function refreshWikiNavigation(text: string, filePath: string, allPages: WikiPage[]): string {
  const parsed = readEnvelope(text)
  if (!parsed || parsed.envelope.kind !== 'page' || !safeRelativePath(filePath)) return text
  const { envelope } = parsed
  const header = rawFrontmatterPattern.exec(text)
  if (!header) return text
  const rawBody = text.slice(header[0].length)
  const lines = rawBody.split(/(?<=\n)/)
  const starts: number[] = []
  const ends: number[] = []
  let offset = 0
  for (const line of lines) {
    const value = line.replace(/\r?\n$/, '')
    if (value === marker(envelope.marker, 'links', 'start')) starts.push(offset + line.length)
    if (value === marker(envelope.marker, 'links', 'end')) ends.push(offset)
    offset += line.length
  }
  if (starts.length !== 1 || ends.length !== 1 || starts[0] > ends[0]) return text
  const chinese = zhLanguage(envelope.revision?.language)
    || /^## (?:来源|相关页面)\r?$/m.test(rawBody.slice(starts[0], ends[0]))
  const page = { ...envelope.page, contextId: '', body: '', filePath }
  const newline = rawBody.includes('\r\n') ? '\r\n' : '\n'
  const navigation = sourceLinks(page, filePath, allPages, chinese).replace(/\n/g, newline)
  const nextBody = rawBody.slice(0, starts[0]) + navigation + newline + rawBody.slice(ends[0])
  const nextEnvelope = { ...envelope, page: { ...envelope.page, filePath } }
  if (hash(normalizeBody(rawBody)) === envelope.generatedBodyHash) nextEnvelope.generatedBodyHash = hash(normalizeBody(nextBody))
  if (nextBody === rawBody && envelope.page.filePath === filePath) return text
  // Preserve custom YAML and its formatting byte-for-byte. Only the managed
  // envelope line and the marked navigation block belong to this operation.
  const nextHeader = text.slice(0, header[0].length).replace(/^notegen-wiki-data:[^\r\n]*/m,
    `notegen-wiki-data: ${JSON.stringify(nextEnvelope)}`)
  return nextHeader + nextBody
}

const rawFrontmatterPattern = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/

function assertSameDocument(next: Envelope, previous: Envelope) {
  if (next.kind !== previous.kind || (next.kind === 'page' && previous.kind === 'page'
    && next.page.id !== previous.page.id)) throw new Error('WIKI_INVALID_MARKDOWN_METADATA')
}

function mergeUserFrontmatter(envelope: Envelope, previous: string, bodySource: string) {
  const match = rawFrontmatterPattern.exec(previous)
  const bodyMatch = rawFrontmatterPattern.exec(bodySource)
  if (!match || !bodyMatch) throw new Error('WIKI_INVALID_MARKDOWN_METADATA')
  // Other user frontmatter fields (tags, aliases, etc.) belong to the note as well.
  const origin = envelope.kind === 'page' ? envelope.page.id : 'index'
  const fields = match[1].split(/\r?\n/).map(line => {
    if (line.startsWith('notegen-wiki-data:')) return `notegen-wiki-data: ${JSON.stringify(envelope)}`
    if (line.startsWith('notegen-wiki-origin:')) return `notegen-wiki-origin: ${JSON.stringify(origin)}`
    return line
  })
  const header = `${previous.startsWith('\uFEFF') ? '\uFEFF' : ''}---\n${fields.join('\n')}\n---\n`
  return `${header}${bodySource.slice(bodyMatch[0].length)}`
}

/** Keep user YAML fields while writing a newly generated Wiki body and metadata. */
export function preserveWikiFrontmatter(serialized: string, previous: string): string {
  const next = readEnvelope(serialized)
  const old = readEnvelope(previous)
  if (!next || !old) throw new Error('WIKI_INVALID_MARKDOWN_METADATA')
  assertSameDocument(next.envelope, old.envelope)
  return mergeUserFrontmatter(next.envelope, previous, serialized)
}

/** Update only metadata while retaining every character of edited Markdown and its edit guard. */
export function preserveWikiMarkdownBody(serialized: string, previous: string): string {
  const next = readEnvelope(serialized)
  const old = readEnvelope(previous)
  if (!next || !old) throw new Error('WIKI_INVALID_MARKDOWN_METADATA')
  assertSameDocument(next.envelope, old.envelope)
  if (next.envelope.kind === 'page' && old.envelope.kind === 'page') {
    // Section tokens and quote indices belong to the preserved body, too.
    next.envelope.marker = old.envelope.marker
    next.envelope.revision = old.envelope.revision
  }
  next.envelope.generatedBodyHash = old.envelope.generatedBodyHash
  return mergeUserFrontmatter(next.envelope, previous, previous)
}
