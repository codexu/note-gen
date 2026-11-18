import { describe, expect, it } from 'vitest'
import { projectDecisions } from '@/lib/decide/project'
import { indexNote } from '@/lib/vault-index/index-note'
import { buildOrganizeDraft } from './drafts'
import { detectProposals, duplicateScore, HOUR, mayRun, PROPOSAL_LIMIT, VAULT_LIMIT } from './detect'

const NOW = 5 * HOUR
const OLD = NOW - HOUR
const BODY = 'A long note about acoustic instruments with enough detail for comparison. '
  + 'The strings and the instrument body shape the tone and tuning.'

function fixture(entries: Array<[string, string, number?]>) {
  const contents = new Map(entries.map(([path, content]) => [path, content]))
  const notes = new Map(entries.map(([path, content, mtime = OLD]) => [path, indexNote(path, content, mtime)]))
  return { contents, notes, dailyFolder: 'Journal/Daily', now: NOW }
}

describe('organize detection', () => {
  it('scores by normalized trigrams, including unsegmented Chinese text', () => {
    expect(duplicateScore('量子筆記', '理論與觀測的關係', '量子筆記', '理論與觀測的關係')).toEqual({ title: 1, body: 1 })
    expect(duplicateScore('Apollo', 'notes on Moon landings', 'Garden', 'tropical plant care').title).toBe(0)
  })

  it('merges exact copies and preserves distinct Markdown in a very similar pair', () => {
    const exact = detectProposals(fixture([['Music/Cello.md', BODY], ['Music/Copy.md', BODY]]))
    expect(exact).toMatchObject([{ kind: 'merge', changes: [{ path: 'Music/Copy.md', before: BODY, after: null }] }])
    const near = detectProposals(fixture([['Music/Cello acoustics.md', BODY, OLD - 1], ['Music/Cello acoustics Copy.md', BODY + '!']]))
    expect(near[0]?.changes).toEqual([
      { path: 'Music/Cello acoustics.md', before: BODY, after: BODY + '\n\n---\n\n' + BODY + '!' },
      { path: 'Music/Cello acoustics Copy.md', before: BODY + '!', after: null },
    ])
  })

  it('skips recent, unstatable, daily and differently typed merge candidates', () => {
    const check = (entries: Array<[string, string, number?]>) => expect(detectProposals(fixture(entries))).toEqual([])
    check([['a.md', BODY], ['b.md', BODY, OLD + 1]])
    check([['a.md', BODY], ['b.md', BODY, 0]])
    check([['journal/daily/a.md', BODY], ['Journal/Daily/b.md', BODY]])
    check([['a.md', '---\ntype: project\n---\n' + BODY], ['b.md', '---\ntype: book\n---\n' + BODY]])
  })

  it('keeps a linked copy and skips merges if both have links pointing to them', () => {
    const data = fixture([['Music/Cello.md', BODY], ['Music/Copy.md', BODY], ['Other.md', '[[Music/Copy]]']])
    expect(detectProposals(data)).toMatchObject([{ kind: 'merge', path: 'Music/Copy.md', detail: 'Music/Cello.md' }])
    data.notes.set('Other.md', indexNote('Other.md', '[cello](Music/Cello.md) [[Music/Copy]]', OLD))
    expect(detectProposals(data).some(p => p.kind === 'merge')).toBe(false)
  })

  it('adds a missing tag when three of four matching peers share it, preserving other YAML', () => {
    const target = '---\ntype: study # keep\ntags: [music]\n---\nAn introduction.'
    const peers = [0, 1, 2, 3].map((i): [string, string] => [
      `Peer ${i}.md`, `---\ntype: study\ntags: [music${i < 3 ? ', cello' : ''}]\n---\nPeer ${i}.`,
    ])
    const data = fixture([['Subject.md', target], ...peers])
    data.contents = new Map([['Subject.md', target]])
    expect(detectProposals(data)).toMatchObject([{ kind: 'tag', detail: 'cello',
      changes: [{ after: target.replace('[music]', '[music, cello]') }] }])
    data.notes.set('Peer 4.md', indexNote('Peer 4.md', target, OLD))
    expect(detectProposals(data)).toEqual([])
  })

  it('links a unique free-text alias without rewriting comments, code or existing links', () => {
    const source = '<!--\nExplorer Program\n-->\n`Explorer Program`\nI read about Explorer Program.'
    const data = fixture([['Source.md', source], ['Space/Program.md', '---\naliases: [Explorer Program]\n---\nA note.']])
    expect(detectProposals(data)).toMatchObject([{ kind: 'link', detail: 'Space/Program.md',
      changes: [{ after: source.replace('about Explorer Program', 'about [[Space/Program|Explorer Program]]') }] }])
    const linked = source + '\n[existing](Space/Program.md)'
    expect(detectProposals({ ...data, contents: new Map([['Source.md', linked]]) })).toEqual([])
    data.notes.set('Duplicate.md', indexNote('Duplicate.md', '---\naliases: [Explorer Program]\n---\nA note.', OLD))
    expect(detectProposals(data)).toEqual([])
  })

  it('caps proposals, skips pending paths and suppresses seen snapshots', () => {
    const data = fixture(Array.from({ length: 14 }, (_, i) => [
      `Subject ${i}.md`, i === 13 ? 'A note.' : 'I read about Heliophysics.',
    ]))
    // One note per proposal is consumed as a dependency, so use distinct link targets.
    for (let i = 0; i < 8; i++) {
      const path = `Subject ${i}.md`
      const target = `Field-${i}X.md`
      const text = `I read about Field-${i}X.`
      data.contents.set(path, text)
      data.notes.set(path, indexNote(path, text, OLD))
      data.notes.set(target, indexNote(target, 'A field of study.', OLD))
    }
    const first = detectProposals(data)
    expect(first).toHaveLength(PROPOSAL_LIMIT)
    const second = detectProposals({ ...data, limit: 1, seen: new Set(first.map(p => p.key)),
      blocked: new Set(['Subject 5.md']) })
    expect(second).toMatchObject([{ path: 'Subject 6.md' }])
  })

  it('projects a merge as one decision in its own workspace', () => {
    const [plan] = detectProposals(fixture([['Music/Cello.md', BODY], ['Music/Copy.md', BODY]]))
    const draft = buildOrganizeDraft(plan, '/vault', 'custom:/vault', 'Merge copies')
    const input = { items: [], journal: null,
      tasks: [{ id: 'task', status: 'awaiting_review', updatedAt: NOW, title: 'Organize', drafts: [draft] }] }
    expect(projectDecisions({ ...input, workspace: '/another' })).toEqual([])
    expect(projectDecisions({ ...input, workspace: '/vault' })).toMatchObject([
      { source: 'draft', summary: 'Merge copies', organizeMerge: { keeper: 'Music/Cello.md', removed: 'Music/Copy.md' } },
    ])
  })

  it('waits one hour, runs once per idle period, and respects the vault budget', () => {
    expect(mayRun(NOW, NOW - HOUR + 1, -Infinity, 2)).toBe(false)
    expect(mayRun(NOW, OLD, -Infinity, VAULT_LIMIT)).toBe(true)
    expect(mayRun(NOW, OLD, -Infinity, VAULT_LIMIT + 1)).toBe(false)
    expect(mayRun(NOW + HOUR, OLD, NOW, 2)).toBe(false)
    expect(mayRun(NOW + HOUR + 1, NOW + 1, NOW, 2)).toBe(true)
    const notes = new Map(Array.from({ length: VAULT_LIMIT + 1 }, (_, i) => [`${i}.md`, indexNote(`${i}.md`, '', OLD)]))
    expect(detectProposals({ ...fixture([['a.md', BODY], ['b.md', BODY]]), notes })).toEqual([])
  })
})
