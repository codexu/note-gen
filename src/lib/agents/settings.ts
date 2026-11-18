export const AGENT_TOOL_NAMES = [
  'note_list_files',
  'note_read_file',
  'calendar_read_day',
  'note_create_file',
  'note_update_file',
] as const

export type AgentToolName = typeof AGENT_TOOL_NAMES[number]

export const AGENT_ROLES = ['organizer', 'scheduler', 'researcher', 'reviewer', 'custom'] as const
export type AgentRole = typeof AGENT_ROLES[number]

export interface AgentSettingsInput {
  name: string
  role: AgentRole
  enabled: boolean
  allowedTools: AgentToolName[]
}

export interface AgentSettings extends AgentSettingsInput {
  id: string
  createdAt: number
  updatedAt: number
}

export const ROLE_TOOLS: Record<AgentRole, readonly AgentToolName[]> = {
  organizer: ['note_list_files', 'note_read_file', 'note_create_file'],
  scheduler: ['note_list_files', 'note_read_file', 'calendar_read_day', 'note_update_file'],
  researcher: ['note_list_files', 'note_read_file', 'note_create_file', 'note_update_file'],
  reviewer: ['note_list_files', 'note_read_file', 'note_create_file'],
  custom: [],
}

export function isAgentToolName(value: unknown): value is AgentToolName {
  return AGENT_TOOL_NAMES.some(name => name === value)
}

export function isAgentRole(value: unknown): value is AgentRole {
  return AGENT_ROLES.some(role => role === value)
}
