// Fork（#30）：Agent 任務表。模式比照 memory_jobs；草稿以 JSON 存在同一列。
import { getDb } from './index'
import { JOB_TASK_PREFIX } from '@/lib/jobs/task-id'
import type { AgentTask, AgentTaskKind, AgentTaskStatus, DraftChange } from '@/lib/agent-tasks/types'

interface AgentTaskRow {
  id: string
  kind: AgentTaskKind
  title: string
  prompt: string
  status: AgentTaskStatus
  drafts: string
  result: string | null
  error: string | null
  tokens: number
  createdAt: number
  updatedAt: number
  finishedAt: number | null
}

let initialized: Promise<void> | null = null

export function initAgentTaskDb(): Promise<void> {
  if (!initialized) {
    initialized = (async () => {
      const db = await getDb()
      await db.execute(`
        create table if not exists agent_tasks (
          id text primary key,
          kind text not null,
          title text not null,
          prompt text not null,
          status text not null,
          drafts text not null default '[]',
          result text,
          error text,
          tokens integer not null default 0,
          created_at integer not null,
          updated_at integer not null,
          finished_at integer
        )
      `)
      await db.execute('create index if not exists idx_agent_tasks_status on agent_tasks(status, created_at)')
    })().catch(error => {
      initialized = null
      throw error
    })
  }
  return initialized
}

function parseDrafts(raw: string): DraftChange[] {
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function fromRow(row: AgentTaskRow): AgentTask {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    prompt: row.prompt,
    status: row.status,
    drafts: parseDrafts(row.drafts),
    result: row.result ?? undefined,
    error: row.error ?? undefined,
    tokens: row.tokens,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt ?? undefined,
  }
}

export async function listAgentTasks(limit = 100): Promise<AgentTask[]> {
  await initAgentTaskDb()
  const db = await getDb()
  const rows = await db.select<AgentTaskRow[]>(
    `with recent as (
       select id from agent_tasks where id not glob $1 order by created_at desc limit $2
     )
     select id, kind, title, prompt, status, drafts, result, error, tokens,
            created_at as createdAt, updated_at as updatedAt, finished_at as finishedAt
     from agent_tasks
     where id glob $1 or (kind = 'organize' and status = 'awaiting_review') or id in (select id from recent)
     order by created_at desc`,
    [`${JOB_TASK_PREFIX}*`, limit]
  )
  return rows.map(fromRow)
}

export async function saveAgentTask(task: AgentTask): Promise<void> {
  await initAgentTaskDb()
  const db = await getDb()
  await db.execute(
    `insert into agent_tasks
       (id, kind, title, prompt, status, drafts, result, error, tokens, created_at, updated_at, finished_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict(id) do update set
       title = excluded.title,
       status = excluded.status,
       drafts = excluded.drafts,
       result = excluded.result,
       error = excluded.error,
       tokens = excluded.tokens,
       updated_at = excluded.updated_at,
       finished_at = excluded.finished_at`,
    [
      task.id,
      task.kind,
      task.title,
      task.prompt,
      task.status,
      JSON.stringify(task.drafts),
      task.result ?? null,
      task.error?.slice(0, 1000) ?? null,
      task.tokens,
      task.createdAt,
      task.updatedAt,
      task.finishedAt ?? null,
    ]
  )
}

export async function deleteAgentTask(id: string): Promise<void> {
  await initAgentTaskDb()
  const db = await getDb()
  await db.execute('delete from agent_tasks where id = $1', [id])
  // Fork（almanac ALMNC-12）：刪任務時一併清掉代理人的拒絕紀錄；P5 表不存在（舊庫或已回退）時略過。
  try {
    await db.execute('delete from agent_tool_refusals where task_id = $1', [id])
  } catch {
    // agent_tool_refusals 只在 P5 之後存在
  }
}
