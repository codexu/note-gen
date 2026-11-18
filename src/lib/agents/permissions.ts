import type { AgentToolResult } from '@/lib/agent/types'
import { isAgentToolName, type AgentSettings } from './settings'

export interface AgentToolRefusal {
  agentId: string
  taskId: string
  toolName: string
  reason: 'disabled' | 'not_granted' | 'unavailable'
  createdAt: number
}

export async function authorizeAgentTool(
  toolName: string,
  offered: boolean,
  agent: AgentSettings | undefined,
  context: Pick<AgentToolRefusal, 'agentId' | 'taskId'>,
  record: (refusal: AgentToolRefusal) => Promise<void>,
): Promise<AgentToolResult | undefined> {
  let reason: AgentToolRefusal['reason']
  if (!agent?.enabled) reason = 'disabled'
  else if (!isAgentToolName(toolName) || !agent.allowedTools.includes(toolName)) reason = 'not_granted'
  else if (!offered) reason = 'unavailable'
  else return

  await record({ ...context, toolName: toolName.slice(0, 128), reason, createdAt: Date.now() })
  return { ok: false, error: 'AGENT_TOOL_REFUSED', message: `Tool call refused: ${reason}.` }
}
