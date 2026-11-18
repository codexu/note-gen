import { describe, expect, it, vi } from 'vitest'
import { applyChanges, OrganizeConflict, undoChanges, type OrganizeIO, type OrganizeUndoRecord } from './transaction'

function setup() {
  const files = new Map([['keeper.md', 'keeper'], ['copy.md', 'copy']])
  let saved: OrganizeUndoRecord | undefined
  const io: OrganizeIO = {
    read: async path => files.get(path) ?? null,
    replace: vi.fn(async (path, expected, content) => {
      if ((files.get(path) ?? null) !== expected) throw new OrganizeConflict()
      if (content === null) files.delete(path)
      else files.set(path, content)
    }),
    save: vi.fn(async record => { saved = record }),
  }
  const record: OrganizeUndoRecord = {
    id: '1', workspace: '/vault', title: 'Merge', status: 'prepared',
    changes: [
      { path: 'keeper.md', before: 'keeper', after: 'keeper + copy' },
      { path: 'copy.md', before: 'copy', after: null },
    ],
  }
  return { io, files, record, saved: () => saved! }
}

describe('organize review transactions', () => {
  it('saves both snapshots before applying a merge and restores a deleted note in one undo', async () => {
    const { io, files, record, saved } = setup()
    await applyChanges(record, io)
    expect(vi.mocked(io.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(io.replace).mock.invocationCallOrder[0])
    expect(files.get('keeper.md')).toBe('keeper + copy')
    expect(files.has('copy.md')).toBe(false)
    expect(saved().status).toBe('applied')
    await undoChanges(saved(), io)
    expect([...files]).toEqual([['keeper.md', 'keeper'], ['copy.md', 'copy']])
    expect(saved().status).toBe('reverted')
  })

  it('uses the same snapshot for single-note tag and link changes', async () => {
    for (const after of ['---\ntags: [music]\n---\nkeeper', 'keeper [[Music]]']) {
      const { io, files, record, saved } = setup()
      record.changes = [{ path: 'keeper.md', before: 'keeper', after }]
      await applyChanges(record, io)
      expect(files.get('keeper.md')).toBe(after)
      await undoChanges(saved(), io)
      expect(files.get('keeper.md')).toBe('keeper')
    }
  })

  it('rejects stale proposals and later edits or recreations without touching any other path', async () => {
    const { files, io, record, saved } = setup()
    files.set('copy.md', 'edited')
    await expect(applyChanges(record, io)).rejects.toBeInstanceOf(OrganizeConflict)
    expect(io.save).not.toHaveBeenCalled()
    files.set('copy.md', 'copy')
    await applyChanges(record, io)
    files.set('copy.md', 'recreated')
    await expect(undoChanges(saved(), io)).rejects.toBeInstanceOf(OrganizeConflict)
    expect(files.get('keeper.md')).toBe('keeper + copy')
    files.delete('copy.md')
    files.set('keeper.md', 'edited after merge')
    await expect(undoChanges(saved(), io)).rejects.toBeInstanceOf(OrganizeConflict)
    expect(files.has('copy.md')).toBe(false)
  })

  it('does no writes if persisting the restoration record fails', async () => {
    const { io, record } = setup()
    vi.mocked(io.save).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(applyChanges(record, io)).rejects.toThrow('database unavailable')
    expect(io.replace).not.toHaveBeenCalled()
  })

  it('rolls back the first mutation if deleting the second note fails', async () => {
    const { io, files, record, saved } = setup()
    const replace = vi.mocked(io.replace).getMockImplementation()!
    vi.mocked(io.replace).mockImplementationOnce(replace).mockRejectedValueOnce(new Error('cannot delete'))
    await expect(applyChanges(record, io)).rejects.toThrow('cannot delete')
    expect([...files]).toEqual([['keeper.md', 'keeper'], ['copy.md', 'copy']])
    expect(saved().status).toBe('reverted')
  })

  it('recovers a prepared record after an interruption between file writes', async () => {
    const { io, files, record } = setup()
    files.set('keeper.md', 'keeper + copy')
    await undoChanges(record, io)
    expect([...files]).toEqual([['keeper.md', 'keeper'], ['copy.md', 'copy']])
  })

  it('rolls back a partial undo and keeps an interrupted record available', async () => {
    const { io, files, record, saved } = setup()
    await applyChanges(record, io)
    const replace = vi.mocked(io.replace).getMockImplementation()!
    vi.mocked(io.replace).mockImplementationOnce(replace).mockRejectedValueOnce(new Error('cannot restore keeper'))
    await expect(undoChanges(saved(), io)).rejects.toThrow('cannot restore keeper')
    expect(files.get('keeper.md')).toBe('keeper + copy')
    expect(files.has('copy.md')).toBe(false)
    expect(saved().status).toBe('prepared')
    await undoChanges(saved(), io)
    expect(files.get('copy.md')).toBe('copy')
  })
})
