import type { AgentState, ToolCall } from './types'

export interface AgentStateAdapter {
  getState: () => AgentState
  reset: () => void
  setState: (state: Partial<AgentState>) => void
  upsertToolCall: (toolCall: ToolCall) => void
}
