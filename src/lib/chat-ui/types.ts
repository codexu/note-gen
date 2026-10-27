import type { Spec } from '@json-render/core'

export type ChatUiValue = string | string[]
export type ChatUiValues = Record<string, ChatUiValue>

export interface ChatUiRequest {
  placement?: 'step' | 'response' | 'result'
  mode: 'display' | 'collect'
  title: string
  spec: Spec
}

export interface ChatUiResponse {
  status: 'displayed' | 'submitted' | 'cancelled'
  values?: ChatUiValues
}

/** Ephemeral, read-only model output. Never written to uiBlocks or conversation history. */
export interface ChatResponsePreview {
  runId: string
  toolCallId: string
  workspaceIdentity: string
  title: string
  spec: Spec
}

export interface ChatUiBlock extends ChatUiRequest {
  version: 1
  id: string
  runId: string
  traceEventId?: string
  toolCallId?: string
  workspaceIdentity?: string
  workspaceFingerprint?: string
  status: 'displayed' | 'pending' | 'submitted' | 'cancelled'
  state: ChatUiValues
  submittedValues?: ChatUiValues
  createdAt: number
}

export interface PendingChatUi {
  id: string
  chatId: number
  conversationId?: number
  runId: string
  workspaceIdentity?: string
  response?: ChatUiResponse
}

export type RequestChatUi = (
  request: ChatUiRequest,
  context: { runId: string; workspaceIdentity?: string; signal?: AbortSignal }
) => Promise<ChatUiResponse>

export interface ChatUiField {
  name: string
  label: string
  type: 'Input' | 'Textarea' | 'Select' | 'CheckboxGroup' | 'NotePicker' | 'FolderPicker' | 'TagPicker'
  required: boolean
  multiple: boolean
  options?: Array<{ label: string; value: string }>
  defaultValue?: ChatUiValue
}
