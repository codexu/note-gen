import type { NoteChange } from './detect'

export interface OrganizeUndoRecord {
  id: string
  workspace: string
  title: string
  changes: NoteChange[]
  status: 'prepared' | 'applied' | 'reverted'
}

export interface OrganizeIO {
  read: (path: string) => Promise<string | null>
  replace: (path: string, expected: string | null, content: string | null) => Promise<void>
  save: (record: OrganizeUndoRecord) => Promise<void>
}

export class OrganizeConflict extends Error {
  constructor() { super('ORGANIZE_CONFLICT') }
}

async function requireSnapshot(changes: NoteChange[], io: OrganizeIO, direction: 'apply' | 'undo' | 'recover') {
  for (const { path, before, after } of changes) {
    const current = await io.read(path)
    if (direction === 'apply' && current === before) continue
    if (direction === 'undo' && current === after) continue
    if (direction === 'recover' && (current === before || current === after)) continue
    throw new OrganizeConflict()
  }
}

async function rollback(written: NoteChange[], io: OrganizeIO) {
  let restored = true
  for (const change of [...written].reverse()) {
    try {
      await io.replace(change.path, change.after, change.before)
    } catch {
      restored = false
    }
  }
  return restored
}

export async function applyChanges(record: OrganizeUndoRecord, io: OrganizeIO): Promise<void> {
  await requireSnapshot(record.changes, io, 'apply')
  // Write-ahead snapshots survive interruption between individual file writes.
  await io.save({ ...record, status: 'prepared' })
  const written: NoteChange[] = []
  try {
    for (const change of record.changes) {
      await io.replace(change.path, change.before, change.after)
      written.push(change)
    }
    await io.save({ ...record, status: 'applied' })
  } catch (error) {
    if (await rollback(written, io)) {
      // If a write failed after mutating the disk, leave the journal recoverable.
      try {
        await requireSnapshot(record.changes, io, 'apply')
        await io.save({ ...record, status: 'reverted' })
      } catch { /* Preserve the prepared record. */ }
    }
    throw error
  }
}

export async function undoChanges(record: OrganizeUndoRecord, io: OrganizeIO): Promise<void> {
  if (record.status === 'reverted') return
  await requireSnapshot(record.changes, io, record.status === 'prepared' ? 'recover' : 'undo')
  if (record.status === 'applied') await io.save({ ...record, status: 'prepared' })
  const written: NoteChange[] = []
  try {
    for (const change of [...record.changes].reverse()) {
      if (await io.read(change.path) === change.before) continue
      await io.replace(change.path, change.after, change.before)
      written.push(change)
    }
    await io.save({ ...record, status: 'reverted' })
  } catch (error) {
    // Preserve null (absence) when rolling back the recreation of a deleted file.
    for (const change of written.reverse()) {
      try { await io.replace(change.path, change.before, change.after) } catch { /* Recover from the journal. */ }
    }
    throw error
  }
}
