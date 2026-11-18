// almanac ALMNC-8：收下提案寫進既有位置（筆記新檔、今日日誌捕捉軌），可復原。
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()

vi.mock('@/lib/daily/note-io', () => ({
  noteExists: async (path: string) => files.has(path),
  readNote: async (path: string) => files.get(path) ?? null,
  writeNote: async (path: string, content: string) => { files.set(path, content) },
  revealInFileTree: async () => undefined,
}))

vi.mock('@/lib/daily/open-daily-note', () => ({
  ensureDailyNote: async (now: Date) => {
    const path = `20 Journal/21 Daily/${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.md`
    if (!files.has(path)) files.set(path, '# 今天\n\n## 捕捉軌\n\n- [ ] 既有任務\n')
    return { path }
  },
}))

const { acceptProposal, undoAccepted } = await import('./write')

const now = new Date(2026, 10, 18, 9, 30)
const base = { body: '', due: '', time: '', tags: [] as string[] }

describe('acceptProposal', () => {
  beforeEach(() => {
    files.clear()
  })

  it('writes a note as a new file in the inbox folder', async () => {
    const result = await acceptProposal({ ...base, id: 'n1', kind: 'note', title: '定價想法', body: '三種收費模式並列', tags: ['idea'] }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/2026-11-18 0930 定價想法.md')
    expect(files.get(result.path)).toBe('# 定價想法\n\n三種收費模式並列\n\n#idea\n')
    expect(result.record).toBeUndefined()
  })

  it('does not overwrite an existing note with the same name', async () => {
    files.set('10 Inbox/2026-11-18 0930 定價想法.md', '舊內容')
    const result = await acceptProposal({ ...base, id: 'n2', kind: 'note', title: '定價想法' }, { noteFolder: '10 Inbox', now })
    expect(result.path).toBe('10 Inbox/2026-11-18 0930 定價想法 2.md')
    expect(files.get('10 Inbox/2026-11-18 0930 定價想法.md')).toBe('舊內容')
  })

  it('adds tasks and events to the capture section of today and can undo them', async () => {
    const task = await acceptProposal({ ...base, id: 't1', kind: 'task', title: '回覆 Mia' }, { noteFolder: '10 Inbox', now })
    const event = await acceptProposal({ ...base, id: 'e1', kind: 'event', title: '寫提案', time: '14:00' }, { noteFolder: '10 Inbox', now })
    expect(task.path).toBe(event.path)
    const daily = files.get(task.path) ?? ''
    expect(daily).toContain('- [ ] 回覆 Mia 📅 2026-11-18')
    expect(daily).toContain('- [ ] 寫提案 📅 2026-11-18 ⏰ 14:00')
    expect(daily.indexOf('## 捕捉軌')).toBeLessThan(daily.indexOf('回覆 Mia'))
    expect(daily).toContain('- [ ] 既有任務')

    expect(await undoAccepted(event)).toBe(true)
    expect(files.get(task.path)).not.toContain('寫提案')
    expect(files.get(task.path)).toContain('回覆 Mia')
  })

})
