// Additive, idempotent schema for note.db, following the existing agent_tasks bootstrap.
export const AGENT_SCHEMA = [
  `create table if not exists agent_settings (
    id text primary key not null,
    name text not null check (length(trim(name)) between 1 and 80),
    role text not null check (role in ('organizer', 'scheduler', 'researcher', 'reviewer', 'custom')),
    enabled integer not null check (enabled in (0, 1)),
    allowed_tools text not null,
    created_at integer not null,
    updated_at integer not null
  )`,
  `create table if not exists agent_tool_refusals (
    id integer primary key,
    agent_id text not null,
    task_id text not null,
    tool_name text not null,
    reason text not null check (reason in ('disabled', 'not_granted', 'unavailable')),
    created_at integer not null
  )`,
  'create index if not exists idx_agent_tool_refusals_task on agent_tool_refusals(task_id, id)',
]

// Run offline after a backup, immediately before downgrading to a build without P5.
// substr() instead of LIKE: LIKE is case-insensitive in SQLite and would also match e.g. 'AGENT:legacy'.
export const AGENT_SCHEMA_ROLLBACK = [
  "delete from agent_tasks where substr(kind, 1, 6) = 'agent:'",
  'drop table if exists agent_tool_refusals',
  'drop table if exists agent_settings',
]

export const AGENT_PENDING_REVIEW_SQL =
  "select count(*) as count from agent_tasks where substr(kind, 1, 6) = 'agent:' and status = 'awaiting_review'"

export interface RollbackDb {
  select: <T>(sql: string) => Promise<T>
  execute: (sql: string) => Promise<unknown>
}

/**
 * Removes P5 data in one transaction (review finding: the rollback used to exist only as SQL in the README).
 * Refuses while agent drafts still wait for review, unless `discardPendingReview` is set, because deleting
 * them is irreversible. Back up note.db before calling this.
 */
export async function rollbackAgentSchema(db: RollbackDb, options: { discardPendingReview?: boolean } = {}): Promise<void> {
  const rows = await db.select<Array<{ count: number }>>(AGENT_PENDING_REVIEW_SQL)
  const pending = Number(rows[0]?.count ?? 0)
  if (pending > 0 && !options.discardPendingReview) {
    throw new Error(`AGENT_ROLLBACK_PENDING_REVIEW: ${pending} agent draft task(s) still await review`)
  }
  await db.execute('begin')
  try {
    for (const statement of AGENT_SCHEMA_ROLLBACK) await db.execute(statement)
    await db.execute('commit')
  } catch (error) {
    await db.execute('rollback')
    throw error
  }
}
