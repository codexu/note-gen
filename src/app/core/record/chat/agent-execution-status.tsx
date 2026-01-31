import * as React from "react"
import useChatStore from "@/stores/chat"
import { AgentPanelWithRag } from "./agent-panel-with-rag"

/**
 * Agent execution status component - displays real-time agent execution state
 * This component uses AgentPanelWithRag to show both RAG sources and Agent steps together
 */
export function AgentExecutionStatus() {
  const { agentState, setAgentState } = useChatStore()

  // Handle confirmation
  const handleConfirm = () => {
    if (!agentState.pendingConfirmation) return

    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'confirmed' as const,
      timestamp: Date.now()
    }

    // Confirm while keeping isRunning: true, only clear pendingConfirmation
    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: true  // Explicitly keep running state
    })
  }

  const handleCancel = () => {
    if (!agentState.pendingConfirmation) return

    const confirmationRecord = {
      toolName: agentState.pendingConfirmation.toolName,
      params: agentState.pendingConfirmation.params,
      status: 'cancelled' as const,
      timestamp: Date.now()
    }

    // Cancel and stop agent execution
    setAgentState({
      pendingConfirmation: undefined,
      confirmationHistory: [...agentState.confirmationHistory, confirmationRecord],
      isRunning: false
    })
  }

  return (
    <AgentPanelWithRag
      ragSources={agentState.ragSources || []}
      ragSourceDetails={agentState.ragSourceDetails || []}
      isRunning={agentState.isRunning}
      isThinking={agentState.isThinking}
      currentThought={agentState.currentThought}
      thoughtHistory={agentState.thoughtHistory}
      completedSteps={agentState.completedSteps}
      currentAction={agentState.currentAction}
      currentObservation={agentState.currentObservation}
      toolCalls={agentState.toolCalls}
      pendingConfirmation={agentState.pendingConfirmation}
      confirmationHistory={agentState.confirmationHistory}
      currentStepStartTime={agentState.currentStepStartTime}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
