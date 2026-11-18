import { describe, expect, it } from 'vitest'
import { buildPaletteSections, noteTitleParts, scorePaletteItem, type PaletteItem } from './palette-search'

const cmd = (id: string, title: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id, kind: 'command', title, ...extra })
const note = (path: string, mtime = 0, extra: Partial<PaletteItem> = {}): PaletteItem => ({ id: `note:${path}`, kind: 'note', title: noteTitleParts(path).title, subtitle: noteTitleParts(path).folder, mtime, ...extra })
const plugin = (id: string, title: string): PaletteItem => ({ id, kind: 'plugin', title, subtitle: 'My Plugin' })

describe('scorePaletteItem', () => {
  it('ranks exact > prefix > word start > substring > subsequence', () => {
    const q = 'plan'
    const scores = ['plan', 'plan today', 'my plan', 'airplane', 'p-l-a-n'].map(title => scorePaletteItem(cmd('x', title), q))
    expect(scores[0]).toBeGreaterThan(scores[1])
    expect(scores[1]).toBeGreaterThan(scores[2])
    expect(scores[2]).toBeGreaterThan(scores[3])
    expect(scores[3]).toBeGreaterThan(scores[4])
    expect(scores[4]).toBeGreaterThan(0)
  })

  it('requires every whitespace-separated token to match', () => {
    const item = note('專案/預算表.md')
    expect(scorePaletteItem(item, '預算 專案')).toBeGreaterThan(0)
    expect(scorePaletteItem(item, '預算 不存在')).toBe(0)
  })

  it('matches keywords and subtitle at lower weight than the title', () => {
    const viaTitle = scorePaletteItem(cmd('a', 'budget'), 'budget')
    const viaKeyword = scorePaletteItem(cmd('b', 'sheet', { keywords: ['budget'] }), 'budget')
    const viaSubtitle = scorePaletteItem(cmd('c', 'sheet', { subtitle: 'budget' }), 'budget')
    expect(viaTitle).toBeGreaterThan(viaKeyword)
    expect(viaKeyword).toBeGreaterThan(viaSubtitle)
    expect(viaSubtitle).toBeGreaterThan(0)
  })

  it('ignores case and full-width forms', () => {
    expect(scorePaletteItem(cmd('a', 'Open Settings'), 'ＯＰＥＮ')).toBeGreaterThan(0)
  })
})

describe('buildPaletteSections', () => {
  const items = [
    cmd('c1', '開啟設定'),
    cmd('c2', '新對話'),
    plugin('p1', '預算匯出'),
    note('專案/預算表.md', 100),
    note('日誌/2026-11-18.md', 300),
    note('專案/預算草稿.md', 200),
  ]

  it('shows commands, plugin commands and recent notes for an empty query', () => {
    const sections = buildPaletteSections(items, '  ')
    expect(sections.map(s => s.kind)).toEqual(['command', 'plugin', 'note'])
    expect(sections[2].items.map(i => i.title)).toEqual(['2026-11-18', '預算草稿', '預算表'])
  })

  it('merges notes and commands under one query, best section first', () => {
    const sections = buildPaletteSections(items, '預算')
    expect(sections.map(s => s.kind).sort()).toEqual(['note', 'plugin'])
    // 同樣是開頭相符，標題較短的筆記「預算表」分數稍高，所以筆記區塊排前面
    expect(sections[0].kind).toBe('note')
    const notes = sections.find(s => s.kind === 'note')!
    expect(notes.items.map(i => i.title)).toEqual(['預算表', '預算草稿'])
  })

  it('breaks note ties by newest first', () => {
    const tied = [note('a/same.md', 1), note('b/same.md', 9)]
    const [section] = buildPaletteSections(tied, 'same')
    expect(section.items.map(i => i.id)).toEqual(['note:b/same.md', 'note:a/same.md'])
  })

  it('caps each section and drops sections with no hit', () => {
    const many = Array.from({ length: 20 }, (_, i) => note(`n/${i}-memo.md`, i))
    const sections = buildPaletteSections([...many, cmd('c', '無關')], 'memo', { limits: { note: 3 } })
    expect(sections).toHaveLength(1)
    expect(sections[0].items).toHaveLength(3)
  })

  it('returns nothing when nothing matches', () => {
    expect(buildPaletteSections(items, 'zzzz-no-match')).toEqual([])
  })
})

describe('noteTitleParts', () => {
  it('splits folder and strips the extension', () => {
    expect(noteTitleParts('a/b/c.md')).toEqual({ title: 'c', folder: 'a/b' })
    expect(noteTitleParts('root.md')).toEqual({ title: 'root', folder: '' })
    expect(noteTitleParts('.hidden')).toEqual({ title: '.hidden', folder: '' })
  })
})
