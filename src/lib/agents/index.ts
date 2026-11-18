import { getAgentSettings } from '@/db/agents'
import { agentTaskCenter, startAgentTaskCenter } from '@/lib/agent-tasks'
import type { AgentRunnerKind } from '@/lib/agent-tasks/types'
import { isUiV3 } from '@/lib/fork-ui'
import { createAgentRunner } from './runner'

/** Dispatch entry point for V3 callers, including job cards. */
export async function enqueueAgentTask(input: { agentId: string; prompt: string; title?: string; taskId?: string }) {
  if (!isUiV3()) throw new Error('AGENTS_UI_DISABLED')
  const agent = await getAgentSettings(input.agentId)
  if (!agent?.enabled) throw new Error('AGENT_DISABLED')
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('AGENT_PROMPT_REQUIRED')
  await startAgentTaskCenter()
  if (!isUiV3()) throw new Error('AGENTS_UI_DISABLED')
  const kind: AgentRunnerKind = `agent:${agent.id}`
  agentTaskCenter.registerRunner(kind, createAgentRunner(kind))
  return agentTaskCenter.enqueue({ kind, prompt, title: input.title, id: input.taskId })
}
