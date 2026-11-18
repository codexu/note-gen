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
export const AGENT_SCHEMA_ROLLBACK = [
  "delete from agent_tasks where kind like 'agent:%'",
  'drop table if exists agent_tool_refusals',
  'drop table if exists agent_settings',
]
