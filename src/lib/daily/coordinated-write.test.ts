// almanac ALMNC-21：V3 寫日誌經編輯器協調，不會蓋掉開著的那篇裡未存的文字。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
const article = {
  activeFilePath: '',
  currentArticle: '',
  setCurrentArticle: vi.fn((content: string) => { article.currentArticle = content }),
}
const emitted: Array<[string, unknown]> = []
let queued = false

vi.mock('@/stores/article', () => ({ default: { getState: () => article } }))
vi.mock('@/lib/emitter', () => ({ default: { emit: (name: string, payload: unknown) => emitted.push([name, payload]) } }))
vi.mock('@/lib/daily/note-io', () => ({
  readNote: vi.fn(async (path: string) => files.get(path) ?? null),
  writeNote: vi.fn(async (path: string, content: string) => { files.set(path, content) }),
}))
vi.mock('@/lib/editor-deactivation', () => ({
  markEditorPathMutation: vi.fn(),
  getEditorPathMutationRevision: vi.fn(() => 0),
  prepareActiveEditorDeactivation: vi.fn(() => true),
  runEditorPathWriteTransaction: vi.fn(async (_path: string, tx: (ctx: { hasQueuedSave: () => boolean }) => Promise<boolean>) => tx({ hasQueuedSave: () => queued })),
}))

const { commitNoteWrites, NoteWriteConflict, revertNoteWrites } = await import('./coordinated-write')
const { insertLinesInSection } = await import('@/lib/today/today-model')

const DAILY = 'Journal/2026-11-19.md'
const SAVED = '# 今天\n\n## 捕捉軌\n\n- [ ] 既有任務\n'
const insert = (content: string) => insertLinesInSection(content, ['- [ ] 回覆 Mia'], '捕捉軌')

beforeEach(() => {
  files.clear()
  files.set(DAILY, SAVED)
  article.activeFilePath = ''
  article.currentArticle = ''
  emitted.length = 0
  queued = false
})

describe('commitNoteWrites', () => {
  it('writes directly when the note is not open and unchanged', async () => {
    const after = insert(SAVED)
    const result = await commitNoteWrites([{ path: DAILY, before: SAVED, after, rebase: insert }])
    expect(files.get(DAILY)).toBe(after)
    expect(result).toEqual([{ path: DAILY, before: SAVED, after }])
  })

  it('keeps unsaved editor text when the daily note is open, and tells the editor to reload', async () => {
    const unsaved = SAVED.replace('# 今天\n', '# 今天\n\n剛剛打的字還沒存\n')
    article.activeFilePath = DAILY
    article.currentArticle = unsaved
    const result = await commitNoteWrites([{ path: DAILY, before: SAVED, after: insert(SAVED), rebase: insert }])
    const written = files.get(DAILY)!
    expect(written).toContain('剛剛打的字還沒存')
    expect(written).toContain('- [ ] 回覆 Mia')
    expect(article.currentArticle).toBe(written)
    expect(emitted).toContainEqual(['external-content-update', written])
    expect(result[0]).toEqual({ path: DAILY, before: unsaved, after: written })
  })

  it('refuses without a rebase when the note changed since it was read, leaving the file untouched', async () => {
    files.set(DAILY, SAVED + '\n使用者後來加的\n')
    await expect(commitNoteWrites([{ path: DAILY, before: SAVED, after: insert(SAVED) }])).rejects.toBeInstanceOf(NoteWriteConflict)
    expect(files.get(DAILY)).toBe(SAVED + '\n使用者後來加的\n')
  })

  it('refuses when the editor has a queued save, rolling the file back', async () => {
    article.activeFilePath = DAILY
    article.currentArticle = SAVED
    queued = true
    await expect(commitNoteWrites([{ path: DAILY, before: SAVED, after: insert(SAVED), rebase: insert }])).rejects.toThrow()
    expect(files.get(DAILY)).toBe(SAVED)
  })

  it('undo only reverts when the file still holds what we wrote', async () => {
    const [write] = await commitNoteWrites([{ path: DAILY, before: SAVED, after: insert(SAVED), rebase: insert }])
    expect(await revertNoteWrites([write])).toBe(true)
    expect(files.get(DAILY)).toBe(SAVED)

    const [again] = await commitNoteWrites([{ path: DAILY, before: SAVED, after: insert(SAVED), rebase: insert }])
    files.set(DAILY, again.after + '\n之後又改了\n')
    expect(await revertNoteWrites([again])).toBe(false)
    expect(files.get(DAILY)).toBe(again.after + '\n之後又改了\n')
  })
})

describe('today actions through the coordinated write', () => {
  it('ticks a task while the note is open with unsaved text elsewhere', async () => {
    const { setTaskChecked } = await import('@/lib/today/today-actions')
    article.activeFilePath = DAILY
    article.currentArticle = SAVED + '\n未存的一段\n'
    const task = { path: DAILY, line: 4, raw: '- [ ] 既有任務', done: false } as never
    await setTaskChecked(task, true, new Date(2026, 10, 19))
    const written = files.get(DAILY)!
    expect(written).toMatch(/- \[x\] 既有任務/)
    expect(written).toContain('未存的一段')
  })

  it('fails and leaves the file alone when the task line was edited in the editor', async () => {
    const { setTaskChecked, StaleTaskError } = await import('@/lib/today/today-actions')
    article.activeFilePath = DAILY
    article.currentArticle = SAVED.replace('- [ ] 既有任務', '- [ ] 既有任務（改過）')
    const task = { path: DAILY, line: 4, raw: '- [ ] 既有任務', done: false } as never
    await expect(setTaskChecked(task, true, new Date(2026, 10, 19))).rejects.toBeInstanceOf(StaleTaskError)
    expect(files.get(DAILY)).toBe(SAVED)
  })
})
