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

/** PM review M3：已還原的紀錄與超過保留期的已套用紀錄要清掉，快照不無限成長。prepared（未完成）永遠保留。 */
export const ORGANIZE_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export function organizePruneSql(now: number): { sql: string, values: Array<string | number> } {
  return {
    sql: "delete from organize_undo where status = 'reverted' or (status = 'applied' and created_at < $1)",
    values: [now - ORGANIZE_HISTORY_RETENTION_MS],
  }
}

export async function pruneOrganizeHistory(now = Date.now()): Promise<void> {
  const db = await database()
  const { sql, values } = organizePruneSql(now)
  await db.execute(sql, values)
}

export async function loadOrganizeHistory(workspace: string): Promise<void> {
  useOrganizeHistory.setState({ workspace, rows: [] })
  await pruneOrganizeHistory().catch(error => console.debug('[organize] history prune failed', error))
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
