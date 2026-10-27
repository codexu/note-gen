"use client"

import { createContext, useContext } from 'react'
import type { AgentArtifactPaths } from '@/lib/agent/artifacts'
import type { ChatResponseSource } from '@/lib/chat-ui/response-host'
import { EMPTY_ARTIFACT_LINKS } from '@/components/markdown/artifact-link'

export interface ChatResponseContextValue {
  artifacts: AgentArtifactPaths
  sources: ChatResponseSource[]
  workspaceFingerprint?: string
  isPreview?: boolean
}

export const ChatResponseContext = createContext<ChatResponseContextValue>({ artifacts: EMPTY_ARTIFACT_LINKS, sources: [] })
export const useChatResponseContext = () => useContext(ChatResponseContext)
