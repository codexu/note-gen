// Fork (ALMNC-12): device-local agent settings and permission audit.
import { getDb } from './index'
import { initAgentTaskDb } from './agent-tasks'
import { AGENT_SCHEMA } from '@/lib/agents/schema'
import { isAgentRole, isAgentToolName, type AgentSettings, type AgentSettingsInput } from '@/lib/agents/settings'
import type { AgentToolRefusal } from '@/lib/agents/permissions'

interface SettingsRow extends Omit<AgentSettings, 'allowedTools' | 'enabled'> {
  allowedTools: string
  enabled: number
}

const SELECT_SETTINGS = `select id, name, role, enabled, allowed_tools as allowedTools,
  created_at as createdAt, updated_at as updatedAt from agent_settings`

function fromRow(row: SettingsRow): AgentSettings {
  let tools: unknown
  try { tools = JSON.parse(row.allowedTools) } catch { /* Invalid lists grant no tools. */ }
  return {
    ...row,
    enabled: row.enabled === 1 && isAgentRole(row.role),
    allowedTools: Array.isArray(tools) ? tools.filter(isAgentToolName) : [],
  }
}

let initialization: Promise<void> | undefined

async function agentDb() {
  const db = await getDb()
  initialization ??= (async () => {
    await initAgentTaskDb()
    for (const sql of AGENT_SCHEMA) await db.execute(sql)
  })().catch(error => {
    initialization = undefined
    throw error
  })
  await initialization
  return db
}

function settingsValues(input: AgentSettingsInput) {
  const name = input.name.trim()
  if (!name || name.length > 80 || !isAgentRole(input.role) ||
      typeof input.enabled !== 'boolean' || !Array.isArray(input.allowedTools) ||
      !input.allowedTools.every(isAgentToolName)) {
    throw new Error('INVALID_AGENT_SETTINGS')
  }
  return [name, input.role, Number(input.enabled), JSON.stringify([...new Set(input.allowedTools)])]
}

export async function listAgentSettings(): Promise<AgentSettings[]> {
  const db = await agentDb()
  const rows = await db.select<SettingsRow[]>(`${SELECT_SETTINGS} order by created_at, id`)
  return rows.map(fromRow)
}

export async function getAgentSettings(id: string): Promise<AgentSettings | undefined> {
  const db = await agentDb()
  const [row] = await db.select<SettingsRow[]>(`${SELECT_SETTINGS} where id = $1`, [id])
  return row && fromRow(row)
}

export async function createAgentSettings(input: AgentSettingsInput): Promise<string> {
  const values = settingsValues(input)
  const db = await agentDb()
  const id = crypto.randomUUID()
  const now = Date.now()
  await db.execute(
    `insert into agent_settings (id, name, role, enabled, allowed_tools, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $6)`,
    [id, ...values, now],
  )
  return id
}

export async function updateAgentSettings(id: string, input: AgentSettingsInput): Promise<void> {
  const values = settingsValues(input)
  const db = await agentDb()
  const result = await db.execute(
    `update agent_settings set name = $2, role = $3, enabled = $4, allowed_tools = $5, updated_at = $6
     where id = $1`,
    [id, ...values, Date.now()],
  )
  if (result.rowsAffected !== 1) throw new Error('AGENT_NOT_FOUND')
}

export async function recordAgentToolRefusal(refusal: AgentToolRefusal): Promise<void> {
  const db = await agentDb()
  await db.execute(
    `insert into agent_tool_refusals (agent_id, task_id, tool_name, reason, created_at)
     values ($1, $2, $3, $4, $5)`,
    [refusal.agentId, refusal.taskId, refusal.toolName, refusal.reason, refusal.createdAt],
  )
}

export async function listAgentToolRefusals(taskId: string): Promise<AgentToolRefusal[]> {
  const db = await agentDb()
  return db.select<AgentToolRefusal[]>(
    `select agent_id as agentId, task_id as taskId, tool_name as toolName, reason, created_at as createdAt
     from agent_tool_refusals where task_id = $1 order by id`,
    [taskId],
  )
}
