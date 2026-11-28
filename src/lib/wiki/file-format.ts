import { createHash } from 'crypto'
import { z } from 'zod'
import { createRelativeMarkdownHref } from '@/lib/markdown-file-link'
import type {
  WikiContribution, WikiEvidence, WikiPage, WikiSharedSettings, WikiSourceReference, WikiSourceRevision,
} from '@/types/wiki'

export type WikiPageLinkTarget = Pick<WikiPage, 'id' | 'kind' | 'title' | 'sourceRefs' | 'filePath'>

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

// Older readers strictly validate the v2 envelope and preserve other YAML fields.
const sourceDateField = 'notegen-wiki-source-date:'
function envelopeSource(source: WikiSourceReference) {
  const portable = { ...source }
  delete portable.updatedAt
  return portable
}

function sourceDate(fields: string[], source: WikiSourceReference): number | undefined {
  const rows = fields.filter(line => line.startsWith(sourceDateField))
  if (rows.length !== 1) return undefined
  try {
    const value: unknown = JSON.parse(rows[0].slice(sourceDateField.length))
    if (Array.isArray(value) && value[0] === source.stableId && value[1] === source.contentHash
      && Number.isSafeInteger(value[2]) && value[2] > 0) return value[2]
  } catch { /* Invalid optional dates cannot qualify a source for a date range. */ }
  return undefined
}

function frontmatter(envelope: Envelope, body: string, source?: WikiSourceReference) {
  const origin = envelope.kind === 'page' ? envelope.page.id : 'index'
  const dateLine = source?.updatedAt ? `\n${sourceDateField} ${JSON.stringify([source.stableId, source.contentHash, source.updatedAt])}` : ''
  return `---\nnotegen-wiki-origin: ${JSON.stringify(origin)}\nnotegen-wiki-data: ${JSON.stringify(envelope)}${dateLine}\n---\n\n${normalizeBody(body)}\n`
}

function readEnvelope(text: string): { envelope: Envelope; body: string; sourceUpdatedAt?: number } | null {
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
    const revision = parsed.data.kind === 'page' ? parsed.data.revision : undefined
    return { envelope: parsed.data, body: normalizeBody(normalized.slice(match[0].length)),
      sourceUpdatedAt: revision ? sourceDate(fields, revision.source) : undefined }
  } catch { return null }
}

function marker(token: string, section: string, edge: 'start' | 'end') {
  return `<!-- notegen-wiki:${token}:${section}:${edge} -->`
}

/** The visual reader uses the same validated, ordered references as the file itself. */
export function readWikiTopicCitationHeader(raw: string) {
  if (!/^notegen-wiki-origin:\s*"topic:/m.test(raw)) return null
  const envelope = readEnvelope(raw)?.envelope
  if (envelope?.kind !== 'page' || envelope.page.kind !== 'topic' || !envelope.page.sourceRefs.length) return null
  return {
    pageId: envelope.page.id, sourceRefs: envelope.page.sourceRefs,
    linksStart: marker(envelope.marker, 'links', 'start'), linksEnd: marker(envelope.marker, 'links', 'end'),
  }
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

function sourceLinks(page: WikiPage, filePath: string, allPages: WikiPageLinkTarget[], chinese: boolean) {
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
  return pageMetadataSchema.parse({
    id: page.id, kind: page.kind, title: page.title, aliases: page.aliases,
    sourceRefs: page.sourceRefs.map(envelopeSource), inputHash: page.inputHash, outputHash: page.outputHash,
    updatedAt: page.updatedAt, status: page.status, relatedPageIds: page.relatedPageIds,
    topicKey: page.topicKey, generation: page.generation, filePath,
  })
}

export function serializeWikiPageFile(
  page: WikiPage, revision: WikiSourceRevision | undefined, filePath: string,
  allPages: WikiPageLinkTarget[], generatedBodyHash?: string,
): string {
  const token = hash(`${page.id}:${page.outputHash}:markdown-2`)
  const chinese = zhLanguage(revision?.language)
  const revisionData = revision && page.kind === 'source' ? {
    id: revision.id, inputHash: revision.inputHash, outputHash: revision.outputHash,
    pipelineVersion: revision.pipelineVersion, generation: revision.generation, language: revision.language,
    source: envelopeSource(revision.source), createdAt: revision.createdAt, modelId: revision.modelId, usage: revision.usage,
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
  return frontmatter(envelope, body, revision?.source)
}

type IndexKind = 'topic' | 'source'
const indexKinds: IndexKind[] = ['topic', 'source']
const indexDescription = (zh: boolean) => zh
  ? '这些 Markdown 文件由 AI 根据选定资料整理，可在文件树中直接阅读和编辑。'
  : 'These Markdown notes are organized from your selected sources. Read and edit them in the file tree.'

function indexHeading(kind: IndexKind, zh: boolean) {
  if (kind === 'topic') return zh ? '## 主题' : '## Topics'
  return zh ? '## 来源摘要' : '## Source summaries'
}

const indexLinkLine = /^- \[(?:\\.|[^\]\\\r\n])*\]\(.+\)$/

/** Recover only lines proven by the checksum. All other lines belong to the reader. */
function recoverIndexSection(lines: string[], heading: string, expectedHash: string): string[] | null {
  const generated = lines.filter(line => line === heading || indexLinkLine.test(line))
  if (generated[0] !== heading) return null
  const canonical = normalizeBody([heading, '', ...generated.slice(1)].join('\n'))
  return hash(canonical) === expectedHash
    ? lines.filter(line => line !== heading && !indexLinkLine.test(line)) : null
}

function migrateEditedIndex(body: string, previousLanguage: string, previousHash: string,
  blocks: Record<IndexKind, string>, newline: string): string {
  const zh = zhLanguage(previousLanguage)
  const lines = body.split(newline)
  const topics = lines.indexOf(indexHeading('topic', zh))
  const sources = lines.indexOf(indexHeading('source', zh))
  if (topics >= 0 && sources > topics) {
    const sections = [lines.slice(topics + 1, sources), lines.slice(sources + 1)]
    for (const contiguous of [true, false]) {
      const indexes = sections.map(section => {
        const result = new Set<number>()
        for (const [index, line] of section.entries()) {
          if (indexLinkLine.test(line)) result.add(index)
          else if (contiguous && (line.trim() || result.size)) break
        }
        return result
      })
      const old = indexKinds.map((kind, index) => [indexHeading(kind, zh), '',
        ...sections[index].filter((_, row) => indexes[index].has(row))].join('\n'))
      const canonical = ['# Wiki', '', indexDescription(zh), '', old[0], '', old[1]].join('\n')
      if (hash(normalizeBody(canonical)) === previousHash) {
        return [...lines.slice(0, topics), blocks.topic, ...sections[0].filter((_, row) => !indexes[0].has(row)),
          blocks.source, ...sections[1].filter((_, row) => !indexes[1].has(row))].join(newline)
      }
    }
  }
  // Ambiguous old links may be handwritten. Keep them and add a maintained directory once.
  return body + newline + newline + blocks.topic + newline + newline + blocks.source + newline
}

function updateIndexSection(body: string, kind: IndexKind, next: string, newline: string): string {
  const lines = body.split(newline)
  const startPattern = new RegExp('^<!-- notegen-wiki:([a-f0-9]{64}):index-' + kind + ':start -->$')
  // The last complete pair can still be maintained when an older marker was damaged.
  for (let start = lines.length - 1; start >= 0; start--) {
    const token = startPattern.exec(lines[start])?.[1]
    if (!token) continue
    const end = lines.indexOf(marker(token, 'index-' + kind, 'end'), start + 1)
    if (end < 0) continue
    const inside = lines.slice(start + 1, end)
    if (inside.some(line => /^<!-- notegen-wiki:[a-f0-9]{64}:index-/.test(line))) continue
    const current = normalizeBody(inside.join('\n'))
    let authored: string[] = []
    if (hash(current) !== token) {
      const heading = inside.find(line => line === indexHeading(kind, true) || line === indexHeading(kind, false))
      authored = (heading && recoverIndexSection(inside, heading, token)) || inside
    }
    return [...lines.slice(0, start), next, ...authored, ...lines.slice(end + 1)].join(newline)
  }
  return body + newline + newline + next + newline
}

/** Edit marked directory sections without reserializing user prose or frontmatter. */
export function serializeWikiIndexFile(settings: WikiSharedSettings, lists: Record<IndexKind, string[]>, previous: string | null): string {
  const zh = zhLanguage(settings.language)
  const old = previous ? readEnvelope(previous)?.envelope : null
  const header = previous && rawFrontmatterPattern.exec(previous)?.[0]
  const newline = previous?.includes('\r\n') ? '\r\n' : '\n'
  const section = (kind: IndexKind) => {
    const content = normalizeBody([indexHeading(kind, zh), '', ...lists[kind]].join('\n'))
    return block(hash(content), 'index-' + kind, content).replaceAll('\n', newline)
  }
  const blocks = { topic: section('topic'), source: section('source') }
  const generated = ['# Wiki', '', indexDescription(zh), '', blocks.topic, '', blocks.source].join(newline)
  const original = previous && header ? previous.slice(header.length) : ''
  let body = newline + generated + newline
  if (old?.kind === 'index' && hash(normalizeBody(original)) !== old.generatedBodyHash) {
    body = /<!-- notegen-wiki:[a-f0-9]{64}:index-(?:topic|source):/.test(original)
      ? indexKinds.reduce((text, kind) => updateIndexSection(text, kind, blocks[kind], newline), original)
      : migrateEditedIndex(original, old.settings.language, old.generatedBodyHash, blocks, newline)
  }
  const envelope = indexEnvelopeSchema.parse({
    schema: 2, kind: 'index', settings, generatedBodyHash: hash(normalizeBody(generated)),
  })
  return header ? header.replace(/^notegen-wiki-data:[^\r\n]*/m, () => 'notegen-wiki-data: ' + JSON.stringify(envelope)) + body
    : frontmatter(envelope, body)
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
    const metadata = envelope.revision
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
  const document = parsePage(envelope, body, contextId)
  if (document.kind === 'page' && document.revision && parsed.sourceUpdatedAt) {
    const source = document.revision.source
    source.updatedAt = parsed.sourceUpdatedAt
    for (const ref of document.page.sourceRefs) {
      if (ref.stableId === source.stableId && ref.contentHash === source.contentHash) ref.updatedAt = source.updatedAt
    }
  }
  return document
}

/** Relocate managed navigation without regenerating or normalizing authored prose. */
export function refreshWikiNavigation(text: string, filePath: string, allPages: WikiPageLinkTarget[]): string {
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
  const fields = match[1].split(/\r?\n/).filter(line => !line.startsWith(sourceDateField)).map(line => {
    if (line.startsWith('notegen-wiki-data:')) return `notegen-wiki-data: ${JSON.stringify(envelope)}`
    if (line.startsWith('notegen-wiki-origin:')) return `notegen-wiki-origin: ${JSON.stringify(origin)}`
    return line
  })
  const dateLine = bodyMatch[1].split(/\r?\n/).find(line => line.startsWith(sourceDateField))
  if (dateLine) fields.push(dateLine)
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
