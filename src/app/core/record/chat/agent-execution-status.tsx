import * as React from "react"
import useChatStore from "@/stores/chat"
import { AgentPlan } from "@/components/ui/agent-plan"

/**
 * Agent execution status component - displays real-time agent execution state
 * This component now uses the unified AgentPlan component for consistent styling
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
    <AgentPlan
      mode="live"
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
      loadedSkills={agentState.loadedSkills}
      selectedSkills={agentState.selectedSkills}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  )
}
