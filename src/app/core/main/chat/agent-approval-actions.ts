import { agentDebugLog } from "@/lib/agent/debug-log"
import useChatStore from "@/stores/chat"

export type AgentApprovalScope = "once" | "conversation"

export function confirmPendingAgentAction(scope: AgentApprovalScope = "once") {
  const latestState = useChatStore.getState()
  const pendingConfirmation = latestState.agentState.pendingConfirmation
  if (!pendingConfirmation) return

  const effectiveScope = scope
  const confirmationRecord = {
    toolName: pendingConfirmation.toolName,
    params: pendingConfirmation.params,
    status: "confirmed" as const,
    timestamp: Date.now(),
    scope: effectiveScope,
    sessionApprovalType: pendingConfirmation.sessionApprovalType,
    sessionApprovalKey: pendingConfirmation.sessionApprovalKey,
  }

  if (effectiveScope === "conversation" && latestState.currentConversationId !== null) {
    latestState.setAgentAutoApproveConversationId(latestState.currentConversationId)
    latestState.setAgentAutoApproveRuntimeScriptKey(
      pendingConfirmation.sessionApprovalType === "runtime-script"
        ? pendingConfirmation.sessionApprovalKey || null
        : null
    )
  }

  agentDebugLog("approval_user_confirmed", confirmationRecord)

  latestState.setAgentState({
    pendingConfirmation: undefined,
    confirmationHistory: [...latestState.agentState.confirmationHistory, confirmationRecord],
    isRunning: true,
  })
}

export function cancelPendingAgentAction() {
  const latestState = useChatStore.getState()
  const pendingConfirmation = latestState.agentState.pendingConfirmation
  if (!pendingConfirmation) return

  const confirmationRecord = {
    toolName: pendingConfirmation.toolName,
    params: pendingConfirmation.params,
    status: "cancelled" as const,
    timestamp: Date.now(),
  }

  agentDebugLog("approval_user_cancelled", confirmationRecord)

  latestState.setAgentState({
    pendingConfirmation: undefined,
    confirmationHistory: [...latestState.agentState.confirmationHistory, confirmationRecord],
    isRunning: true,
  })
}
