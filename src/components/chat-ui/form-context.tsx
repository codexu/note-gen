"use client"

import { createContext, useContext } from 'react'
import type { ChatUiValue, ChatUiValues } from '@/lib/chat-ui/types'
import type { loadChatUiDomainOptions } from '@/lib/chat-ui/domain'

export type ChatUiDomainOptions = Awaited<ReturnType<typeof loadChatUiDomainOptions>>

interface ChatUiFormContextValue {
  id: string
  values: ChatUiValues
  setValue: (name: string, value: ChatUiValue) => void
  readOnly: boolean
  errors: Record<string, string>
  domainOptions: ChatUiDomainOptions
  domainLoading: boolean
}

export const ChatUiFormContext = createContext<ChatUiFormContextValue | null>(null)

export function useChatUiForm() {
  const context = useContext(ChatUiFormContext)
  if (!context) throw new Error('Chat UI fields require a form context')
  return context
}
