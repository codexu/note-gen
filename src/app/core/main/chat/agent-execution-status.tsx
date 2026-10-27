import useChatStore from "@/stores/chat"
import { AgentRunTimeline } from "./agent-run-timeline"
import type { Chat } from "@/db/chats"

/**
 * Agent execution status component - displays real-time agent execution state.
 */
export function AgentExecutionStatus({ chat }: { chat?: Chat }) {
  const { agentState } = useChatStore()

  return (
    <AgentRunTimeline
      chat={chat}
      modelName={agentState.activeModelName}
      status={agentState.status}
      ragSources={agentState.ragSources || []}
      ragSourceDetails={agentState.ragSourceDetails || []}
      isRunning={agentState.isRunning}
      toolCalls={agentState.toolCalls}
      traceEvents={agentState.traceEvents || []}
      loadedSkills={agentState.loadedSkills || []}
    />
  )
}
