"use client"

import { useRef } from "react"
import { agentSessionManager } from "@/lib/agent/agent-session-manager"
import type { AgentSessionController } from "@/lib/agent/agent-session"
import useChatStore from "@/stores/chat"
import useTagStore from "@/stores/tag"
import type { AgentRequestSnapshot } from "./agent-session-context"

export function useChatAgentSession() {
  const currentConversationId = useChatStore(state => state.currentConversationId)
  const currentTagId = useTagStore(state => state.currentTagId)
  const sessionId = currentConversationId === null
    ? `draft:${currentTagId}`
    : `conversation:${currentConversationId}`
  const sessionRef = useRef<AgentSessionController<AgentRequestSnapshot> | null>(null)
  const sessionIdRef = useRef(sessionId)

  if (!sessionRef.current) {
    sessionRef.current = agentSessionManager.getOrCreate<AgentRequestSnapshot>(sessionId)
    sessionIdRef.current = sessionId
  } else if (sessionIdRef.current !== sessionId) {
    const promotingDraft = sessionIdRef.current.startsWith("draft:")
      && sessionId.startsWith("conversation:")
      && sessionRef.current.isStreaming

    if (!promotingDraft) {
      sessionRef.current = agentSessionManager.getOrCreate<AgentRequestSnapshot>(sessionId)
    }
    sessionIdRef.current = sessionId
  }

  const session = sessionRef.current
  if (!session) throw new Error("Agent session is unavailable.")

  return {
    session,
    sessionId: sessionIdRef.current,
  }
}
