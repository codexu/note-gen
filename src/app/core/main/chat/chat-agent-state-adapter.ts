import useChatStore from '@/stores/chat'
import type { AgentStateAdapter } from '@/lib/agent/agent-state-adapter'

export const chatAgentStateAdapter: AgentStateAdapter = {
  getState: () => useChatStore.getState().agentState,
  reset: () => useChatStore.getState().resetAgentState(),
  setState: state => useChatStore.getState().setAgentState(state),
  upsertToolCall: toolCall => {
    const store = useChatStore.getState()
    const exists = store.agentState.toolCalls.some(item => item.id === toolCall.id)
    if (exists) {
      store.updateAgentToolCall(toolCall.id, toolCall)
    } else {
      store.addAgentToolCall(toolCall)
    }
  },
}
