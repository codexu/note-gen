import { agentDebugLog } from "@/lib/agent/debug-log"
import type { ConfirmationRecord } from "@/lib/agent/types"
import useChatStore from "@/stores/chat"
import useSettingStore from "@/stores/setting"

export type AgentApprovalScope = "once" | "conversation"

function getActionableConfirmation(expectedId?: string) {
  const latestState = useChatStore.getState()
  const pendingConfirmation = latestState.agentState.pendingConfirmation
  if (!pendingConfirmation || !latestState.agentState.isRunning) return
  if (expectedId !== undefined && pendingConfirmation.id !== expectedId) return
  if (pendingConfirmation.runId !== undefined && pendingConfirmation.runId !== latestState.agentState.runId) return
  const chatId = pendingConfirmation.chatId ?? latestState.agentState.activeChatId
  if (chatId === undefined || chatId !== latestState.agentState.activeChatId) return
  const owner = latestState.chats.find(chat => chat.id === chatId)
  if (!owner || (owner.conversationId ?? undefined) !== (latestState.currentConversationId ?? undefined)) return
  if (pendingConfirmation.id && pendingConfirmation.conversationId !== (latestState.currentConversationId ?? undefined)) return
  if (pendingConfirmation.workspacePath !== undefined && pendingConfirmation.workspacePath !== useSettingStore.getState().workspacePath) return
  return { latestState, pendingConfirmation }
}

export function confirmPendingAgentAction(scope: AgentApprovalScope = "once", expectedId?: string) {
  const actionable = getActionableConfirmation(expectedId)
  if (!actionable) return
  const { latestState, pendingConfirmation } = actionable

  const effectiveScope = scope === "conversation" && pendingConfirmation.canApproveForSession
    ? "conversation"
    : "once"
  const confirmationRecord: ConfirmationRecord = {
    id: pendingConfirmation.id,
    runId: pendingConfirmation.runId,
    chatId: pendingConfirmation.chatId,
    conversationId: pendingConfirmation.conversationId,
    traceEventId: pendingConfirmation.traceEventId,
    workspacePath: pendingConfirmation.workspacePath,
    toolName: pendingConfirmation.toolName,
    params: pendingConfirmation.params,
    status: "confirmed",
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

export function cancelPendingAgentAction(expectedId?: string) {
  const actionable = getActionableConfirmation(expectedId)
  if (!actionable) return
  const { latestState, pendingConfirmation } = actionable

  const confirmationRecord: ConfirmationRecord = {
    id: pendingConfirmation.id,
    runId: pendingConfirmation.runId,
    chatId: pendingConfirmation.chatId,
    conversationId: pendingConfirmation.conversationId,
    traceEventId: pendingConfirmation.traceEventId,
    workspacePath: pendingConfirmation.workspacePath,
    toolName: pendingConfirmation.toolName,
    params: pendingConfirmation.params,
    status: "cancelled",
    timestamp: Date.now(),
  }

  agentDebugLog("approval_user_cancelled", confirmationRecord)

  latestState.setAgentState({
    pendingConfirmation: undefined,
    confirmationHistory: [...latestState.agentState.confirmationHistory, confirmationRecord],
    isRunning: true,
  })
}
