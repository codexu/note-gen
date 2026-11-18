// almanac ALMNC-17 PM 複審修正：歷史清除條件、整理前內容另存的檔名。
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/db', () => ({ getDb: async () => ({ execute: async () => ({}), select: async () => [] }) }))

describe('organize history prune', () => {
  it('drops reverted rows and applied rows past retention, never prepared ones', async () => {
    const { organizePruneSql, ORGANIZE_HISTORY_RETENTION_MS } = await import('./history')
    const now = 10 * ORGANIZE_HISTORY_RETENTION_MS
    const { sql, values } = organizePruneSql(now)
    expect(sql).toContain("status = 'reverted'")
    expect(sql).toContain("status = 'applied' and created_at < $1")
    expect(sql).not.toContain('prepared')
    expect(values).toEqual([now - ORGANIZE_HISTORY_RETENTION_MS])
  })
})

describe('snapshotCopyPath', () => {
  it('names the copy after the note and avoids existing files', async () => {
    const { snapshotCopyPath } = await import('./review')
    expect(snapshotCopyPath('Music/Copy.md', () => false)).toBe('Music/Copy (整理前).md')
    const taken = new Set(['Music/Copy (整理前).md', 'Music/Copy (整理前 2).md'])
    expect(snapshotCopyPath('Music/Copy.md', p => taken.has(p))).toBe('Music/Copy (整理前 3).md')
  })
})
