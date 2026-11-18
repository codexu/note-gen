import { parseDailyNotePath } from '@/lib/daily/format'
import { applyFrontmatterEdit } from '@/lib/markdown/frontmatter-edit'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { findUnlinkedMentions, linkMention } from '@/lib/markdown/unlinked-mentions'
import { noteKeyOf } from '@/lib/markdown/wikilink'
import { indexNote, type IndexedNote } from '@/lib/vault-index/index-note'
import { buildLinkLookup, resolveIndexedLinkWithLookup, resolveWikilinkTargetWithLookup } from '@/lib/vault-index/links'
import { mentionNamesFor } from '@/lib/vault-index/unlinked-mentions-scan'

export const HOUR = 60 * 60 * 1000
export const VAULT_LIMIT = 10_000
export const READ_LIMIT = 64
export const NOTE_BYTES_LIMIT = 64 * 1024
export const PROPOSAL_LIMIT = 5

export type OrganizeKind = 'merge' | 'tag' | 'link'
export interface NoteChange {
  path: string
  before: string
  after: string | null
}
export interface OrganizePlan {
  kind: OrganizeKind
  key: string
  path: string
  detail: string
  changes: NoteChange[]
  /** All notes relied on by this change, including ones we only read. */
  mtimes: Record<string, number>
}

export function mayRun(now: number, lastActivity: number, lastRun: number, fileCount: number): boolean {
  return fileCount > 0 && fileCount <= VAULT_LIMIT
    && now - lastActivity >= HOUR && now - lastRun >= HOUR && lastRun < lastActivity
}

export function safeNotePath(path: string): boolean {
  return /\.md$/i.test(path) && path.trim() === path && !/[:\\\u0000-\u001f]/.test(path)
    && path.split('/').every(part => part && !part.startsWith('.') && part.trim() === part)
}

export function eligible(note: Pick<IndexedNote, 'path' | 'mtime'>, now: number, dailyFolder: string, dailyPattern?: string): boolean {
  const folder = dailyFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase()
  // An empty daily folder can put journal entries in the vault root.
  const isDaily = folder ? note.path.toLowerCase().startsWith(folder + '/')
    : !note.path.includes('/') || parseDailyNotePath(note.path, '', dailyPattern) !== null
  return safeNotePath(note.path) && !isDaily && note.mtime > 0 && now - note.mtime >= HOUR
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function shingles(value: string): Set<string> {
  const chars = Array.from(normalize(value))
  if (chars.length < 3) return new Set(chars.length ? [chars.join('')] : [])
  return new Set(chars.slice(2).map((ch, i) => chars[i] + chars[i + 1] + ch))
}

function similarity(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const value of a) if (b.has(value)) shared++
  return shared / (a.size + b.size - shared || 1)
}

export function duplicateScore(aTitle: string, aBody: string, bTitle: string, bBody: string) {
  return {
    title: similarity(shingles(aTitle), shingles(bTitle)),
    body: similarity(shingles(aBody), shingles(bBody)),
  }
}

export function suggestTag(note: IndexedNote, peers: Iterable<IndexedNote>): string | undefined {
  const existing = new Set(note.tags.map(tag => tag.toLowerCase()))
  if (!existing.size) return
  const counts = new Map<string, { count: number, tag: string }>()
  let cohort = 0
  for (const peer of peers) {
    if (peer.path === note.path || peer.frontmatter?.type !== note.frontmatter?.type) continue
    const tags = new Map(peer.tags.map(tag => [tag.toLowerCase(), tag]))
    if (![...existing].every(tag => tags.has(tag))) continue
    cohort++
    for (const [key, tag] of tags) {
      if (existing.has(key)) continue
      counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1, tag })
    }
  }
  return [...counts.values()].filter(({ count }) => count >= 3 && count / cohort >= 0.75)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))[0]?.tag
}

export function nameOwners(notes: Map<string, IndexedNote>): Map<string, string | null> {
  const names = new Map<string, string | null>()
  for (const path of notes.keys()) {
    for (const raw of mentionNamesFor(path, notes)) {
      const name = raw.trim().toLowerCase()
      if (/[\r\n|\[\]<>]/.test(name) || /^\d+$/.test(name)
        || Array.from(name).length < (/[^\x00-\x7f]/.test(name) ? 3 : 4)) continue
      if (!names.has(name)) names.set(name, path)
      else if (names.get(name) !== path) names.set(name, null)
    }
  }
  return names
}

export function suggestLink(content: string, from: IndexedNote, names: Map<string, string | null>,
  lookup: ReturnType<typeof buildLinkLookup>, allowed: (path: string) => boolean) {
  const connected = new Set(from.links.map(link => resolveIndexedLinkWithLookup(link, lookup, from.path)))
  // Match each source once, using the same parser and rewriter as Unlinked Mentions.
  // Exclude markup whose meaning may change when an inline link is inserted.
  const lines = content.split('\n')
  const visible = content.replace(/<!--[\s\S]*?(?:-->|$)/g, comment => comment.replace(/[^\r\n]/g, ' '))
  const sample = visible.slice(0, 16 * 1024).toLowerCase()
  const relevant: string[] = []
  for (const name of names.keys()) {
    if (sample.includes(name)) relevant.push(name)
  }
  // Longer ambiguous names must still mask shorter names inside the same mention.
  relevant.sort((a, b) => b.length - a.length)

  for (const hit of findUnlinkedMentions(visible, relevant.slice(0, 128))) {
    const path = names.get(hit.text.toLowerCase())
    if (!path || path === from.path || connected.has(path) || !allowed(path) || /[#|\[\]<>\\\r\n]/.test(path) || /^\s*(?:#{1,6}\s|\[|<|<!--)/.test(lines[hit.line])
      || /[\[\]<>\\]/.test(lines[hit.line])) continue
    const stem = path.replace(/\.md$/i, '')
    const target = resolveWikilinkTargetWithLookup(stem, lookup, from.path) === path ? stem : path
    if (resolveWikilinkTargetWithLookup(target, lookup, from.path) !== path) continue
    return { path, content: linkMention(content, hit, target) }
  }
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

/** Be conservative about removing a path even when a link resolves ambiguously. */
export function referencedPaths(notes: Map<string, IndexedNote>, lookup = buildLinkLookup(notes.keys())) {
  const paths = new Set<string>()
  const wikiNames = new Set<string>()
  for (const note of notes.values()) {
    for (const link of note.links) {
      const resolved = resolveIndexedLinkWithLookup(link, lookup, note.path)
      if (resolved) paths.add(resolved.toLowerCase())
      if (link.kind === 'wikilink') wikiNames.add(noteKeyOf(link.target).toLowerCase())
    }
  }
  return (path: string) => paths.has(path.toLowerCase()) || wikiNames.has(noteKeyOf(path).toLowerCase())
}

interface Candidate {
  note: IndexedNote
  content: string
  block: string
  body: string
  titleTokens: Set<string>
  bodyTokens: Set<string>
}

function mergeContent(keeper: Candidate, source: Candidate): string | undefined {
  if (keeper.note.frontmatter?.type !== source.note.frontmatter?.type || keeper.block !== source.block
    || source.note.aliases.length || folderOf(keeper.note.path) !== folderOf(source.note.path)
    || keeper.body.trim().length < 40 || source.body.trim().length < 40) return
  // Keep Markdown byte-for-byte in the surviving note when the bodies match.
  if (keeper.body === source.body) return keeper.content
  if (keeper.note.tasks.length || source.note.tasks.length || keeper.note.links.length || source.note.links.length
    || keeper.note.blockIds.length || source.note.blockIds.length) return
  if (similarity(keeper.titleTokens, source.titleTokens) < 0.6
    || similarity(keeper.bodyTokens, source.bodyTokens) < 0.9) return
  // Retain both versions in full when similarity is high but their text differs.
  return keeper.content + '\n\n---\n\n' + source.body
}

export function detectProposals(input: {
  notes: Map<string, IndexedNote>
  contents: Map<string, string>
  dailyFolder: string
  dailyPattern?: string
  now: number
  seen?: Set<string>
  blocked?: Set<string>
  limit?: number
  /** PM review M2：工作區接了同步時不提合併（本機刪除不會傳到遠端）。預設 true。 */
  allowMerge?: boolean
}): OrganizePlan[] {
  const { notes, contents, now, dailyFolder, dailyPattern } = input
  if (notes.size > VAULT_LIMIT) return []
  const limit = Math.max(0, Math.min(input.limit ?? PROPOSAL_LIMIT, PROPOSAL_LIMIT))
  const lookup = buildLinkLookup(notes.keys())
  const referenced = referencedPaths(notes, lookup)
  const names = nameOwners(notes)
  // PM review M1：上游刪除工具以檔名（不含資料夾）清向量索引，同檔名的其他筆記會一起被清；
  // 來源檔名在 vault 裡不唯一時不提合併。
  const basenameCount = new Map<string, number>()
  for (const notePath of notes.keys()) {
    const base = (notePath.split('/').pop() ?? notePath).toLowerCase()
    basenameCount.set(base, (basenameCount.get(base) ?? 0) + 1)
  }
  const uniqueName = (notePath: string) => basenameCount.get((notePath.split('/').pop() ?? notePath).toLowerCase()) === 1
  const used = new Set(input.blocked)
  const candidates: Candidate[] = []
  for (const [path, content] of contents) {
    const indexed = notes.get(path)
    if (!indexed || !eligible(indexed, now, dailyFolder, dailyPattern) || content.length > NOTE_BYTES_LIMIT || used.has(path)) continue
    const { block, body } = splitFrontmatter(content)
    const note = indexNote(path, content, indexed.mtime)
    if (block && !note.frontmatter) continue
    candidates.push({ note, content, block, body, titleTokens: shingles(noteKeyOf(path)), bodyTokens: shingles(body) })
  }
  const plans: OrganizePlan[] = []
  function add(kind: OrganizeKind, path: string, detail: string, changes: NoteChange[], mtimes: Record<string, number>) {
    const key = JSON.stringify([kind, path, detail, mtimes])
    if (plans.length >= limit || input.seen?.has(key)) return false
    plans.push({ kind, key, path, detail, changes, mtimes })
    for (const affected of Object.keys(mtimes)) used.add(affected)
    return true
  }
  // Scan in three passes so a tagged or linkable duplicate still gets a merge proposal.
  const ordered = [...candidates].sort((a, b) => Number(referenced(b.note.path)) - Number(referenced(a.note.path))
    || a.note.mtime - b.note.mtime || a.note.path.localeCompare(b.note.path))
  for (const [i, keeper] of ordered.entries()) {
    if (plans.length >= limit) return plans
    const path = keeper.note.path
    if (used.has(path)) continue
    for (const source of ordered.slice(i + 1)) {
      const other = source.note.path
      if (input.allowMerge === false || !uniqueName(other)) continue
      if (used.has(other) || referenced(other) || path.toLowerCase() === other.toLowerCase()) continue
      const after = mergeContent(keeper, source)
      if (after === undefined) continue
      const changes = after === keeper.content ? [] : [{ path, before: keeper.content, after }]
      if (add('merge', path, other, [...changes, { path: other, before: source.content, after: null }],
        { [path]: keeper.note.mtime, [other]: source.note.mtime })) break
    }
  }
  for (const { note, content } of candidates) {
    if (plans.length >= limit) break
    const path = note.path
    if (used.has(path)) continue
    const link = suggestLink(content, note, names, lookup, target => {
      const other = notes.get(target)
      return !!other && !used.has(target) && eligible(other, now, dailyFolder, dailyPattern)
    })
    if (link && add('link', path, link.path, [{ path, before: content, after: link.content }],
      { [path]: note.mtime, [link.path]: notes.get(link.path)!.mtime })) continue
    const tag = suggestTag(note, notes.values())
    if (!tag) continue
    const tags = note.frontmatter?.tags
    if (tags !== undefined && (!Array.isArray(tags) || tags.some(value => typeof value !== 'string'))) continue
    try {
      const after = applyFrontmatterEdit(content, { kind: 'set', key: 'tags', value: [...(tags ?? []), tag], type: 'tags' })
      if (after !== content) add('tag', path, tag, [{ path, before: content, after }], { [path]: note.mtime })
    } catch {
      // Unsupported YAML structures are left for manual editing.
    }
  }
  return plans
}
