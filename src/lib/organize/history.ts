import { create } from 'zustand'
import { getDb } from '@/db'
import type { OrganizeUndoRecord } from './transaction'

type HistoryRow = Omit<OrganizeUndoRecord, 'changes'>
type StoredRow = HistoryRow & { changes: string }

let initialized: ReturnType<typeof getDb> | undefined
async function database() {
  initialized ??= getDb().then(async db => {
    await db.execute(`create table if not exists organize_undo (
      id text primary key, workspace text not null, title text not null, changes text not null,
      status text not null, created_at integer not null
    )`)
    return db
  }).catch(error => {
    initialized = undefined
    throw error
  })
  return initialized
}

export const useOrganizeHistory = create<{ rows: HistoryRow[]; workspace: string | null }>(() => ({ rows: [], workspace: null }))

export async function loadOrganizeHistory(workspace: string): Promise<void> {
  useOrganizeHistory.setState({ workspace, rows: [] })
  await refresh(workspace)
}

let refreshVersion = 0

async function refresh(workspace: string) {
  if (useOrganizeHistory.getState().workspace !== workspace) return
  const version = ++refreshVersion
  const db = await database()
  const rows = await db.select<HistoryRow[]>(
    "select id, workspace, title, status from organize_undo where workspace = $1 and status <> 'reverted' order by created_at desc",
    [workspace],
  )
  if (refreshVersion === version && useOrganizeHistory.getState().workspace === workspace) useOrganizeHistory.setState({ rows })
}

export async function readOrganizeRecord(id: string): Promise<OrganizeUndoRecord | undefined> {
  const db = await database()
  const [row] = await db.select<StoredRow[]>('select id, workspace, title, changes, status from organize_undo where id = $1', [id])
  return row && { ...row, changes: JSON.parse(row.changes) }
}

export async function saveOrganizeRecord(record: OrganizeUndoRecord): Promise<void> {
  const db = await database()
  await db.execute(`insert into organize_undo (id, workspace, title, changes, status, created_at)
    values ($1, $2, $3, $4, $5, $6) on conflict(id) do update set status = excluded.status`,
  [record.id, record.workspace, record.title, JSON.stringify(record.changes), record.status, Date.now()])
  // A failed history refresh must not roll back a successfully journaled write.
  void refresh(record.workspace).catch(error => console.debug('[organize] history refresh failed', error))
}
