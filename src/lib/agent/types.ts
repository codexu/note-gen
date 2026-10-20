import type OpenAI from 'openai'
import type { AiConfig } from '@/app/core/setting/config'
import type { RuntimeChatAttachment } from '@/lib/chat-attachments'
import type { AgentImageAttachment } from '@/lib/chat-image-context'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export interface JsonSchema {
  $schema?: string
  $ref?: string
  $defs?: Record<string, JsonSchema>
  type?: string | string[]
  description?: string
  enum?: JsonPrimitive[]
  const?: JsonPrimitive
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  default?: JsonValue
  [key: string]: unknown
}

export interface AgentMcpToolMetadata {
  serverId: string
  serverName: string
  toolName: string
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
  trustToolAnnotations: boolean
  deferred?: boolean
}

export type AgentToolCategory =
  | 'editor'
  | 'note'
  | 'folder'
  | 'tag'
  | 'mark'
  | 'chat'
  | 'memory'
  | 'skill'
  | 'mcp'
  | 'system'
  | 'attachment'
  | 'image'
  | 'canvas'
  | 'web'

export type AgentToolRisk =
  | 'read'
  | 'editor-write'
  | 'file-create'
  | 'file-update'
  | 'memory-write'
  | 'delete'
  | 'script'
  | 'skill-install'
  | 'external'
  | 'medium'

export type AgentPermissionMode = 'read-only' | 'ask' | 'auto-edit'

export interface AgentContextSnapshot {
  activeChatId?: number
  activeFilePath?: string
  activeCanvasId?: string
  currentEditorState?: AgentEditorStateSnapshot
  userInput: string
  currentQuote?: AgentQuoteSnapshot
  availableSkills?: AgentSkillSummary[]
  selectedSkills?: string[]
  selectedMcpServerIds?: string[]
  attachments?: RuntimeChatAttachment[]
  imageAttachments?: AgentImageAttachment[]
}

export interface AgentEditorStateSnapshot {
  markdown: string
  wordCount: number
  charCount: number
  totalLines: number
  numberedLines: string
  version: number
  selection?: AgentEditorSelectionSnapshot
}

export interface AgentEditorSelectionSnapshot {
  text: string
  from: number
  to: number
  startLine: number
  endLine: number
}

export interface AgentQuoteSnapshot {
  fileName: string
  articlePath?: string
  startLine: number
  endLine: number
  from: number
  to: number
  fullContent?: string
  selectionToken?: string
}

export interface AgentSkillSummary {
  id: string
  name: string
  description?: string
  scope?: 'global' | 'project'
}

export interface AgentToolExecutionContext {
  requestUserQuestion?: (questions: AgentUserQuestion[], signal?: AbortSignal) => Promise<AgentUserAnswer[] | null>
  signal?: AbortSignal
  runId: string
  context: AgentContextSnapshot
}

export interface AgentChange {
  id: string
  type: 'editor' | 'file' | 'tag' | 'mark' | 'memory' | 'chat' | 'folder' | 'canvas'
  target: string
  before?: string
  after?: string
  reversible: boolean
  summary?: string
}

export interface AgentToolResult {
  ok: boolean
  message: string
  data?: unknown
  error?: string
  changes?: AgentChange[]
}

export interface AgentTool {
  name: string
  title: string
  description: string
  category: AgentToolCategory
  risk: AgentToolRisk
  inputSchema: JsonSchema
  execute: (
    input: Record<string, unknown>,
    context: AgentToolExecutionContext
  ) => Promise<AgentToolResult>
  legacyName?: string
  mcp?: AgentMcpToolMetadata
}

export type AgentRunStatus =
  | 'idle'
  | 'analyzing_images'
  | 'preparing_context'
  | 'thinking'
  | 'calling_tool'
  | 'waiting_approval'
  | 'waiting_answer'
  | 'applying_change'
  | 'recovering'
  | 'steering'
  | 'completed'
  | 'stopped'
  | 'failed'

export interface AgentTraceEvent {
  id: string
  runId: string
  type:
    | 'model_call'
    | 'model_response'
    | 'tool_call'
    | 'tool_result'
    | 'approval'
    | 'steering'
    | 'change'
    | 'error'
    | 'final'
  title: string
  status: 'pending' | 'running' | 'success' | 'error'
  timestamp: number
  duration?: number
  toolName?: string
  input?: Record<string, unknown>
  output?: unknown
  message?: string
  reasoning?: string
  isIntermediateResponse?: boolean
  streamedTokenCount?: number
  streamedCharacterCount?: number
}

export interface AgentApprovalRequest {
  id: string
  runId: string
  toolName: string
  title: string
  risk: AgentToolRisk
  params: Record<string, unknown>
  previewParams?: Record<string, unknown>
  originalContent?: string
  modifiedContent?: string
  filePath?: string
  from?: number
  to?: number
  canApproveForSession?: boolean
  sessionApprovalType?: 'runtime-script'
  sessionApprovalKey?: string
}

export interface AgentRuntimeInput {
  userInput: string
  aiConfig?: AiConfig
  messages?: OpenAI.Chat.ChatCompletionMessageParam[]
  imageUrls?: string[]
  activeChatId?: number
  activeFilePath?: string
  activeCanvasId?: string
  currentEditorState?: AgentEditorStateSnapshot
  currentQuote?: AgentQuoteSnapshot
  availableSkills?: AgentSkillSummary[]
  selectedSkills?: string[]
  selectedMcpServerIds?: string[]
  attachments?: RuntimeChatAttachment[]
  imageAttachments?: AgentImageAttachment[]
  permissionMode?: AgentPermissionMode
  conversationId?: number
  workspaceId?: string
  useMemories?: boolean
}

export interface AgentSteeringPayload {
  sequence: number
  text: string
  selectedSkills?: string[]
  imageUrls?: string[]
  additionalContext?: string
  currentQuote?: AgentQuoteSnapshot
  attachments?: RuntimeChatAttachment[]
  imageAttachments?: AgentImageAttachment[]
}

export type AgentApprovalDecision = 'approved' | 'denied' | 'steered'

export interface AgentUserQuestion {
  question: string
  options: Array<{ label: string; description?: string }>
  multiSelect: boolean
}

export interface AgentUserAnswer {
  question: string
  selected: string[]
}

export interface AgentRuntimeCallbacks {
  requestUserQuestion?: AgentToolExecutionContext['requestUserQuestion']
  onStatus?: (status: AgentRunStatus) => void
  onSteeringDelivered?: (payloads: AgentSteeringPayload[]) => void
  onTrace?: (event: AgentTraceEvent) => void
  onToolCall?: (toolCall: ToolCall) => void
  onChange?: (change: AgentChange) => void
  onStep?: (step: AgentStep) => void
  onCandidateAnswerRender?: (markdownContent: string) => void
  onCandidateAnswerClear?: () => void
  onFinalAnswerRender?: (markdownContent: string) => void
  requestConfirmation?: (
    toolName: string,
    params: Record<string, unknown>,
    context?: {
      previewParams?: Record<string, unknown>
      originalContent?: string
      modifiedContent?: string
      filePath?: string
      from?: number
      to?: number
    }
  ) => Promise<AgentApprovalDecision>
}

export interface AgentRuntimeResult {
  runId: string
  content: string
  stopped: boolean
  steps: AgentStep[]
  toolCalls: ToolCall[]
  changes: AgentChange[]
  trace: AgentTraceEvent[]
}

// Compatibility types kept for existing store/UI while the runtime is rewritten.
export type ToolParameterType = 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface ToolParameter {
  name: string
  type: ToolParameterType
  description: string
  required: boolean
  default?: any
}

export interface Tool {
  name: string
  description: string
  parameters: ToolParameter[]
  requiresConfirmation: boolean
  category: 'note' | 'chat' | 'tag' | 'mark' | 'search' | 'mcp' | 'system' | 'editor'
  execute: (params: Record<string, any>) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
  message?: string
  changes?: AgentChange[]
}

export interface ToolCall {
  id: string
  toolName: string
  params: Record<string, any>
  result?: ToolResult
  status: 'pending' | 'running' | 'success' | 'error'
  timestamp: number
}

export interface ConfirmationRecord {
  toolName: string
  params: Record<string, any>
  status: 'pending' | 'confirmed' | 'cancelled' | 'superseded'
  timestamp: number
  scope?: 'once' | 'conversation'
  sessionApprovalType?: 'runtime-script'
  sessionApprovalKey?: string
}

export interface AgentState {
  pendingQuestion?: {
    id: string
    conversationId?: number
    questions: AgentUserQuestion[]
    response?: AgentUserAnswer[] | null
  }
  activeChatId?: number
  activeModelId?: string
  activeModelName?: string
  runId?: string
  status?: AgentRunStatus
  isRunning: boolean
  isThinking: boolean
  currentThought: string
  thoughtHistory: string[]
  completedSteps: AgentStep[]
  currentAction?: string
  currentObservation?: string
  toolCalls: ToolCall[]
  traceEvents?: AgentTraceEvent[]
  changes?: AgentChange[]
  maxIterations: number
  currentIteration: number
  pendingConfirmation?: {
    toolName: string
    params: Record<string, any>
    previewParams?: Record<string, any>
    originalContent?: string
    modifiedContent?: string
    filePath?: string
    from?: number
    to?: number
    canApproveForSession?: boolean
    sessionApprovalType?: 'runtime-script'
    sessionApprovalKey?: string
  }
  confirmationHistory: ConfirmationRecord[]
  loadedSkills?: AgentSkillSummary[]
  selectedSkills?: string[]
  currentStepStartTime?: number
  ragSources?: string[]
  ragSourceDetails?: Array<{
    filepath: string
    filename: string
    content: string
    sourceKey?: string
    sourceType?: 'article' | 'record' | 'canvas'
    sourceId?: string
    locator?: {
      filePath?: string
      markId?: number
      tagId?: number
      canvasId?: string
      nodeIds?: string[]
    }
    updatedAt?: number
  }>
  isFinalAnswerMode?: boolean
  finalAnswerContent?: string
}

export interface AgentStep {
  thought: string
  action?: {
    tool: string
    params: Record<string, any>
  }
  observation?: string
  duration?: number
}

export type ReActStep = AgentStep
