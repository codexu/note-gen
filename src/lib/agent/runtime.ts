import type OpenAI from 'openai'
import { createAssistantToolCallMessage, createChatCompletionStreamWithToolChoiceFallback, createOpenAIClient, getAISettings, getChatTokenLimitParams, getSystemPromptContent, handleAIError, validateAIService, withFastAiRequestOptions } from '@/lib/ai/utils'
import { estimateTokens } from '@/lib/ai/token-counter'
import { AgentContextManager } from './context-manager'
import { agentEventBus } from './event-bus'
import { AgentPermissionEngine } from './permission-engine'
import { AgentPromptAssembler, hasInlineCurrentEditorSelection, hasInlineCurrentEditorState } from './prompt-assembler'
import { memoryContextService } from '@/lib/context/loader'
import { AgentRecoveryManager } from './recovery-manager'
import { PendingMessageQueue } from './pending-message-queue'
import { createAgentId, AgentTraceRecorder } from './trace-recorder'
import { agentToolRegistry, buildEditorApprovalPreview } from './tool-registry'
import { skillManager } from '@/lib/skills'
import { buildMcpAgentToolCatalog } from '@/lib/mcp/agent-tools'
import { agentDebugLog, previewText } from './debug-log'
import { getRagAgentPolicy } from '@/lib/rag-agent-policy'
import type {
  AgentChange,
  AgentContextSnapshot,
  AgentPermissionMode,
  AgentRuntimeCallbacks,
  AgentRuntimeInput,
  AgentRuntimeResult,
  AgentSteeringPayload,
  AgentStep,
  AgentTool,
  AgentToolResult,
  ToolCall,
  ToolResult,
} from './types'

const ABSOLUTE_MAX_MODEL_ROUNDS = 30
const MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS = 2
const MAX_IDENTICAL_READ_RESULT_REPEATS = 2
const MUTATING_TOOL_RISKS = new Set(['editor-write', 'file-create', 'file-update', 'delete', 'medium'])

export function isRequestAbortError(error: unknown) {
  if (typeof error === 'string') {
    return /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(error)
  }

  if (!error || typeof error !== 'object') {
    return false
  }

  const errorWithCode = error as { name?: string; code?: string; message?: string }
  return errorWithCode.name === 'AbortError'
    || errorWithCode.code === 'ABORT_ERR'
    || /(?:request (?:was )?aborted|operation (?:was )?aborted|aborterror)/i.test(errorWithCode.message || '')
}

async function executeAgentTool(
  tool: AgentTool,
  args: Record<string, unknown>,
  runId: string,
  signal: AbortSignal | undefined,
  context: AgentContextSnapshot
): Promise<AgentToolResult> {
  try {
    return await tool.execute(args, { runId, signal, context })
  } catch (error) {
    if (isRequestAbortError(error)) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      message: `${tool.title}执行时出现异常：${message}`,
      error: message,
    }
  }
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments || !rawArguments.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawArguments)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch (error) {
    throw new Error(`Invalid tool arguments JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function toolResultToLegacy(result: AgentToolResult): ToolResult {
  return {
    success: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
    changes: result.changes,
  }
}

function stringifyToolResult(result: AgentToolResult) {
  const payload = {
    ok: result.ok,
    message: result.message,
    data: result.data,
    error: result.error,
    changes: result.changes,
  }

  return JSON.stringify(payload)
}

function stringifyMessageContent(content: unknown) {
  if (typeof content === 'string') {
    return content
  }

  if (content === null || content === undefined) {
    return ''
  }

  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function normalizeBaseMessage(message: OpenAI.Chat.ChatCompletionMessageParam): OpenAI.Chat.ChatCompletionMessageParam {
  if (message.role !== 'system') {
    return message
  }

  return {
    role: 'user',
    content: `## App Context\n${stringifyMessageContent(message.content)}`,
  }
}

interface StreamingToolCallAccumulator {
  id?: string
  index: number
  type?: 'function'
  function: {
    name: string
    arguments: string
  }
}

function toToolCallList(
  toolCalls: Map<number, StreamingToolCallAccumulator>
): OpenAI.Chat.ChatCompletionMessageToolCall[] {
  return [...toolCalls.values()]
    .sort((a, b) => a.index - b.index)
    .filter((toolCall) => toolCall.function.name)
    .map((toolCall) => ({
      id: toolCall.id || createAgentId('tool-call'),
      type: 'function' as const,
      function: {
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
    }))
}

function resolveStreamingToolCallIndex(
  toolCalls: Map<number, StreamingToolCallAccumulator>,
  toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall
) {
  if (Number.isInteger(toolCall.index)) {
    return toolCall.index
  }

  if (toolCall.id) {
    const existing = [...toolCalls.entries()].find(([, current]) => current.id === toolCall.id)
    if (existing) {
      return existing[0]
    }
    const indexes = [...toolCalls.keys()]
    return indexes.length > 0 ? Math.max(...indexes) + 1 : 0
  }

  const indexes = [...toolCalls.keys()]
  return indexes.length > 0 ? Math.max(...indexes) : 0
}

function summarizeMessage(message: OpenAI.Chat.ChatCompletionMessageParam, index: number) {
  const content = 'content' in message ? message.content : undefined
  const text = stringifyMessageContent(content)

  return {
    index,
    role: message.role,
    contentLength: text.length,
    preview: previewText(text),
  }
}

function estimateMessageTextTokens(message: OpenAI.Chat.ChatCompletionMessageParam) {
  if (!('content' in message)) {
    return 0
  }

  if (typeof message.content === 'string') {
    return estimateTokens(message.content)
  }

  if (!Array.isArray(message.content)) {
    return 0
  }

  return message.content.reduce((sum, item) => {
    if (
      typeof item === 'object'
      && item !== null
      && 'type' in item
      && item.type === 'text'
      && 'text' in item
      && typeof item.text === 'string'
    ) {
      return sum + estimateTokens(item.text)
    }
    return sum
  }, 0)
}

function normalizeFilePathForCompare(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function rewriteWorkspaceReadAsAttachmentRead(
  toolCall: OpenAI.Chat.ChatCompletionMessageToolCall,
  context: AgentContextSnapshot
) {
  const folderAttachments = (context.attachments || []).filter((attachment) => attachment.kind === 'folder')
  if (toolCall.function.name === 'note_list_files' && folderAttachments.length === 1) {
    return {
      ...toolCall,
      function: {
        name: 'attachment_list',
        arguments: JSON.stringify({ attachmentId: folderAttachments[0].id }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  if (toolCall.function.name !== 'note_open_file' && toolCall.function.name !== 'note_read_file') {
    return toolCall
  }

  let args: Record<string, unknown>
  try {
    args = parseToolArguments(toolCall.function.arguments)
  } catch {
    return toolCall
  }

  const requestedPath = typeof args.filePath === 'string'
    ? normalizeFilePathForCompare(args.filePath)
    : ''
  const requestedName = requestedPath.split('/').pop()?.toLocaleLowerCase() || ''
  if (!requestedName) return toolCall

  const matches = (context.attachments || []).filter((attachment) =>
    attachment.kind === 'file'
    && attachment.name.toLocaleLowerCase() === requestedName
  )
  if (matches.length === 1) {
    return {
      ...toolCall,
      function: {
        name: 'attachment_read',
        arguments: JSON.stringify({ attachmentId: matches[0].id }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  if (folderAttachments.length === 1) {
    const folder = folderAttachments[0]
    const folderPrefix = `${folder.name.toLocaleLowerCase()}/`
    const relativePath = requestedPath.toLocaleLowerCase().startsWith(folderPrefix)
      ? requestedPath.slice(folder.name.length + 1)
      : requestedPath
    return {
      ...toolCall,
      function: {
        name: 'attachment_read',
        arguments: JSON.stringify({ attachmentId: folder.id, relativePath }),
      },
    } satisfies OpenAI.Chat.ChatCompletionMessageToolCall
  }

  return toolCall
}

function repairAttachmentToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContextSnapshot
) {
  if (toolName !== 'attachment_list' && toolName !== 'attachment_read') {
    return args
  }

  const attachments = context.attachments || []
  const requestedAttachmentId = typeof args.attachmentId === 'string' ? args.attachmentId : ''
  if (attachments.some((attachment) => attachment.id === requestedAttachmentId)) {
    return args
  }

  const relativePath = typeof args.relativePath === 'string' ? args.relativePath : ''
  const hasRelativePaths = Array.isArray(args.relativePaths) && args.relativePaths.length > 0
  const candidates = toolName === 'attachment_list' || relativePath || hasRelativePaths
    ? attachments.filter((attachment) => attachment.kind === 'folder')
    : attachments.filter((attachment) => attachment.kind === 'file')

  if (candidates.length !== 1) {
    return args
  }

  return {
    ...args,
    attachmentId: candidates[0].id,
  }
}

function getNumberArg(args: Record<string, unknown>, key: string) {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function claimsUserNoteEvidence(content: string) {
  const positiveAttribution = /根据(?:您|你).{0,12}(?:知识库|笔记|记录|文章|画布)|(?:according to|based on).{0,24}(?:your|the user's).{0,16}(?:knowledge base|notes?|records?|articles?|canvases?)|(?:あなた|ユーザー).{0,16}(?:ナレッジベース|ノート|記録)|segundo.{0,24}(?:suas?|os seus).{0,16}(?:notas?|registros?)/i
  const unsupportedAbsence = /(?:(?:知识库|笔记|记录|文章|画布|记忆|当前对话|上下文).{0,24}(?:没有|未找到|找不到|不存在|无法确认|不能确认)|(?:没有|未找到|找不到|无法).{0,24}(?:知识库|笔记|记录|文章|画布|记忆|当前对话|上下文))|(?:(?:could not|couldn't|did not|didn't|no).{0,24}(?:find|confirm|evidence).{0,24}(?:knowledge base|notes?|records?|articles?|canvases?|memory|conversation|context))|(?:(?:ナレッジベース|ノート|記録|メモリ|会話|コンテキスト).{0,24}(?:見つかりません|確認できません))|(?:(?:não|nenhum).{0,24}(?:encontrei|confirmar).{0,24}(?:notas?|registros?|memória|conversa|contexto))/i
  return positiveAttribution.test(content) || unsupportedAbsence.test(content)
}

function explicitlyRequestsKnowledgeLookup(content: string) {
  return /(?:(?:只|仅|只从|仅从|不要查(?:其他|其它|别的)).{0,12}(?:知识库|笔记|记录|文章|画布)|(?:知识库|笔记|记录|文章|画布).{0,12}(?:里|中|内).{0,8}(?:找|查|搜索|检索))|(?:(?:only|exclusively).{0,16}(?:knowledge base|notes?|records?|articles?|canvases?))/i.test(content)
}

function requestsSavedPersonalFact(content: string) {
  return /(?:我的|我(?:之前|上次|曾经|过去)).{1,24}(?:是(?:什么|多少|哪|谁)?|叫什么|多少|何时|什么时候|哪天|在哪里|地址|号码|编号|计划|决定|偏好|习惯)(?:[？?]|$)/i.test(content)
    || /(?:what|which|when|where|who).{0,16}(?:is|was|are|were).{0,12}my\b/i.test(content)
}

function validateQuotedEditorWrite(
  context: AgentContextSnapshot,
  toolName: string,
  args: Record<string, unknown>
): AgentToolResult | null {
  const quote = context.currentQuote
  if (!quote) {
    return null
  }

  const hasExactRange = quote.from >= 0 && quote.to >= quote.from
  const hasExactLines = quote.startLine >= 1 && quote.endLine >= quote.startLine
  const editorWriteTools = new Set([
    'editor_insert_at_cursor',
    'editor_replace_range',
    'editor_replace_lines',
    'editor_apply_transaction',
  ])

  if (editorWriteTools.has(toolName)) {
    const quotePath = quote.articlePath
    const activeFilePath = context.activeFilePath
    if (
      !quotePath
      || !activeFilePath
      || normalizeFilePathForCompare(quotePath) !== normalizeFilePathForCompare(activeFilePath)
    ) {
      return {
        ok: false,
        message: '引用内容不属于当前活动编辑器。请重新打开并引用目标文件后再修改。',
        error: 'QUOTED_EDITOR_TARGET_CHANGED',
      }
    }
  }

  if (!hasExactRange && !hasExactLines && editorWriteTools.has(toolName)) {
    if (
      toolName === 'editor_insert_at_cursor'
      && args.replaceSelection === true
      && typeof quote.fullContent === 'string'
      && typeof quote.selectionToken === 'string'
    ) {
      return null
    }
    return {
      ok: false,
      message: '当前可读取选中文本，但无法安全映射到 Markdown 源码位置。只能使用 editor_insert_at_cursor，并设置 replaceSelection=true；若选区已变化，该操作会自动失败。',
      error: 'SELECTION_TARGET_UNAVAILABLE',
    }
  }

  if (toolName === 'editor_replace_range' && hasExactRange) {
    const from = getNumberArg(args, 'from')
    const to = getNumberArg(args, 'to')
    if (from !== quote.from || to !== quote.to) {
      return {
        ok: false,
        message: `工具参数越界：当前请求只能替换用户选区 from=${quote.from}, to=${quote.to}，请用这个精确范围重试。`,
        error: 'INVALID_QUOTED_RANGE',
      }
    }
  }

  return null
}

function validateEditorTargetFile(
  context: AgentContextSnapshot,
  tool: AgentTool,
  args: Record<string, unknown>
): AgentToolResult | null {
  if (tool.category !== 'editor' || tool.risk === 'read') {
    return null
  }

  const activeFilePath = context.activeFilePath
  const targetFilePath = typeof args.filePath === 'string' ? args.filePath : ''

  if (!activeFilePath) {
    return {
      ok: false,
      message: '当前没有打开的编辑器文件，不能执行 editor_* 写入工具。请改用带明确 filePath 的 note_* 工具。',
      error: 'EDITOR_TOOL_WITHOUT_ACTIVE_FILE',
    }
  }

  if (!targetFilePath) {
    return {
      ok: false,
      message: `editor_* 写入工具必须在结构化参数 filePath 中声明目标文件。当前编辑器文件是 ${activeFilePath}，请使用这个完整路径重试。`,
      error: 'EDITOR_TOOL_MISSING_TARGET_FILE',
    }
  }

  if (normalizeFilePathForCompare(targetFilePath) === normalizeFilePathForCompare(activeFilePath)) {
    return null
  }

  return {
    ok: false,
    message: `工具参数中的目标文件是 ${targetFilePath}，但当前编辑器文件是 ${activeFilePath}。请不要使用 editor_* 工具，改用 note_read_file 和 note_update_file 针对目标文件操作。`,
    error: 'EDITOR_TOOL_WRONG_TARGET_FILE',
  }
}

function validateToolInputShape(tool: AgentTool, args: Record<string, unknown>): AgentToolResult | null {
  const properties = tool.inputSchema.properties || {}
  const allowedKeys = new Set(Object.keys(properties))
  const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key))
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      message: `工具参数包含未声明字段：${unknownKeys.join(', ')}。请只使用结构化工具定义中的参数。`,
      error: 'UNKNOWN_TOOL_ARGUMENTS',
    }
  }

  const missingKeys = (tool.inputSchema.required || []).filter((key) =>
    args[key] === undefined || args[key] === null
  )
  if (missingKeys.length > 0) {
    return {
      ok: false,
      message: `工具缺少必填参数：${missingKeys.join(', ')}。`,
      error: 'MISSING_TOOL_ARGUMENTS',
    }
  }

  return null
}

function preserveOriginalMarkdownPrefix(
  context: AgentContextSnapshot,
  lineNumber: number,
  content: string
) {
  if (content.includes('\n')) {
    return content
  }

  const numberedLine = context.currentEditorState?.numberedLines
    .split('\n')
    .find((line) => new RegExp(`^\\s*${lineNumber}\\s*\\|`).test(line))
  const originalLine = numberedLine?.replace(/^\s*\d+\s*\|\s?/, '') || ''
  const originalPrefix = originalLine.match(/^(\s*#{1,6}\s+)/)?.[1]
  const replacementHasPrefix = /^\s*#{1,6}\s+/.test(content)
  const requestsPlainText = /(?:改为|改成|转换为|变成).*(?:正文|普通文本|段落|plain\s+text|paragraph)/i
    .test(context.userInput)

  return originalPrefix && !replacementHasPrefix && !requestsPlainText
    ? `${originalPrefix}${content}`
    : content
}

function repairEditorWriteArgs(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContextSnapshot
): Record<string, unknown> {
  const editorToolsWithTarget = new Set([
    'editor_insert_at_cursor',
    'editor_replace_range',
    'editor_replace_lines',
    'editor_apply_transaction',
  ])
  const editorToolsWithVersion = new Set([
    'editor_replace_range',
    'editor_replace_lines',
    'editor_apply_transaction',
  ])
  let repairedArgs = args

  if (
    editorToolsWithTarget.has(toolName) &&
    (typeof repairedArgs.filePath !== 'string' || !repairedArgs.filePath.trim()) &&
    context.activeFilePath
  ) {
    repairedArgs = {
      ...repairedArgs,
      filePath: context.activeFilePath,
    }
  }

  if (
    editorToolsWithVersion.has(toolName) &&
    typeof repairedArgs.version !== 'number' &&
    typeof context.currentEditorState?.version === 'number'
  ) {
    repairedArgs = {
      ...repairedArgs,
      version: context.currentEditorState.version,
    }
  }

  if (
    toolName === 'editor_replace_lines' &&
    Number.isInteger(repairedArgs.startLine) &&
    repairedArgs.startLine === repairedArgs.endLine &&
    typeof repairedArgs.replaceContent === 'string'
  ) {
    const replaceContent = preserveOriginalMarkdownPrefix(
      context,
      repairedArgs.startLine as number,
      repairedArgs.replaceContent
    )
    if (replaceContent !== repairedArgs.replaceContent) {
      repairedArgs = { ...repairedArgs, replaceContent }
    }
  }

  if (toolName !== 'editor_apply_transaction' || !Array.isArray(repairedArgs.operations)) {
    return repairedArgs
  }

  let repaired = false
  const operations = repairedArgs.operations.map((rawOperation) => {
    if (!rawOperation || typeof rawOperation !== 'object' || Array.isArray(rawOperation)) {
      return rawOperation
    }

    const operation = rawOperation as Record<string, unknown>
    if (
      operation.type === 'insert_after_line' &&
      !Number.isInteger(operation.line) &&
      Number.isInteger(context.currentEditorState?.totalLines)
    ) {
      repaired = true
      return {
        ...operation,
        line: context.currentEditorState?.totalLines,
      }
    }

    if (
      operation.type === 'insert_before_line' &&
      !Number.isInteger(operation.line)
    ) {
      repaired = true
      return {
        ...operation,
        line: 1,
      }
    }

    if (
      operation.type === 'replace_lines' &&
      Number.isInteger(operation.startLine) &&
      operation.startLine === operation.endLine &&
      typeof operation.content === 'string'
    ) {
      const content = preserveOriginalMarkdownPrefix(
        context,
        operation.startLine as number,
        operation.content
      )
      if (content !== operation.content) {
        repaired = true
        return { ...operation, content }
      }
      return rawOperation
    }

    if (operation.type !== 'replace_range') {
      return rawOperation
    }

    const startLine = Number.isInteger(operation.startLine)
      ? operation.startLine
      : operation.from
    const endLine = Number.isInteger(operation.endLine)
      ? operation.endLine
      : operation.to
    let content = typeof operation.content === 'string'
      ? operation.content
      : operation.replaceContent

    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || typeof content !== 'string') {
      return rawOperation
    }

    if (startLine === endLine) {
      content = preserveOriginalMarkdownPrefix(context, startLine as number, content)
    }

    repaired = true
    return {
      type: 'replace_lines',
      startLine,
      endLine,
      content,
    }
  })

  return repaired ? { ...repairedArgs, operations } : repairedArgs
}

function selectToolsForContext(
  context: AgentContextSnapshot,
  tools: AgentTool[],
  permissionMode: AgentPermissionMode = 'ask'
) {
  let selectedTools = tools

  if (permissionMode === 'read-only') {
    selectedTools = selectedTools.filter((tool) =>
      tool.risk === 'read' || tool.risk === 'external'
    )
  }

  if (!context.activeFilePath) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'editor')
  }

  if (!context.activeCanvasId) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'canvas')
  }

  if (!context.attachments?.length) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'attachment')
  }

  if (!context.imageAttachments?.length) {
    selectedTools = selectedTools.filter((tool) => tool.category !== 'image')
  }

  return selectedTools
}

function buildStep(tool: AgentTool, input: Record<string, unknown>, result: AgentToolResult, duration: number): AgentStep {
  return {
    thought: `${tool.title}`,
    action: {
      tool: tool.name,
      params: input,
    },
    observation: result.message,
    duration,
  }
}

function isMutatingTool(tool: AgentTool) {
  return MUTATING_TOOL_RISKS.has(tool.risk)
}

function getReadToolCallSignature(tool: AgentTool, args: Record<string, unknown>) {
  if (tool.risk !== 'read') {
    return undefined
  }

  return `${tool.name}:${JSON.stringify(args)}`
}

function isEditorStateStaleResult(tool: AgentTool, result: AgentToolResult) {
  if (result.ok || !isMutatingTool(tool)) {
    return false
  }

  return /content has changed|editor content.*changed|内容已变化|版本.*(?:变化|不匹配)/i.test(
    `${result.error || ''}\n${result.message || ''}`
  )
}

export class AgentRuntime {
  private readonly contextManager = new AgentContextManager()
  private readonly promptAssembler = new AgentPromptAssembler()
  private readonly permissionEngine = new AgentPermissionEngine()
  private readonly recoveryManager = new AgentRecoveryManager()
  private abortController: AbortController | null = null
  private stopped = false
  private steeringRequested = false
  private readonly steeringQueue = new PendingMessageQueue<AgentSteeringPayload>(
    'one-at-a-time',
    (left, right) => left.sequence - right.sequence
  )

  stop() {
    this.stopped = true
    this.steeringQueue.clear()
    this.steeringRequested = false
    this.abortController?.abort()
  }

  steer(payload: AgentSteeringPayload) {
    if (this.stopped) return
    this.steeringRequested = true
    this.steeringQueue.enqueue(payload)
  }

  clearSteeringQueue() {
    this.steeringQueue.clear()
    this.steeringRequested = false
  }

  removeSteering(sequence: number) {
    this.steeringQueue.remove(payload => payload.sequence === sequence)
    this.steeringRequested = this.steeringQueue.hasItems()
  }

  async run(input: AgentRuntimeInput, callbacks: AgentRuntimeCallbacks = {}): Promise<AgentRuntimeResult> {
    this.stopped = false
    this.abortController = new AbortController()

    const recorder = new AgentTraceRecorder()
    const runId = recorder.getRunId()
    const steps: AgentStep[] = []
    const toolCalls: ToolCall[] = []
    const changes: AgentChange[] = []

    const context: AgentContextSnapshot = {
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath,
      activeCanvasId: input.activeCanvasId,
      currentEditorState: input.currentEditorState,
      userInput: input.userInput,
      currentQuote: input.currentQuote,
      availableSkills: input.availableSkills,
      selectedSkills: input.selectedSkills,
      selectedMcpServerIds: input.selectedMcpServerIds,
      attachments: input.attachments,
      imageAttachments: input.imageAttachments,
    }

    // A supplied turn snapshot must outlive changes to the global model picker.
    const aiConfig = input.aiConfig ?? await getAISettings()
    const validatedBaseURL = await validateAIService(aiConfig?.baseURL)
    if (!aiConfig || validatedBaseURL === null) {
      agentDebugLog('ai_service_invalid', { runId })
      return {
        runId,
        content: '',
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    }

    const mcpToolCatalog = buildMcpAgentToolCatalog(input.selectedMcpServerIds)

    agentDebugLog('run_start', {
      runId,
      activeChatId: input.activeChatId,
      activeFilePath: input.activeFilePath || null,
      activeCanvasId: input.activeCanvasId || null,
      userInput: input.userInput,
      imageCount: input.imageUrls?.length || 0,
      hasQuote: Boolean(input.currentQuote),
      hasEditorState: Boolean(input.currentEditorState),
      availableSkillCount: input.availableSkills?.length || 0,
      selectedSkills: input.selectedSkills || [],
      directMcpToolCount: mcpToolCatalog.directTools.length,
      deferredMcpToolCount: mcpToolCatalog.deferredEntries.length,
      mcpSchemaTokens: mcpToolCatalog.schemaTokens,
    })

    const ragAgentPolicy = await getRagAgentPolicy()
    const allTools = [...agentToolRegistry.listTools(), ...mcpToolCatalog.directTools]
      .filter(tool =>
        (ragAgentPolicy.automaticSearchEnabled || tool.name !== 'knowledge_search')
        && (aiConfig.enableWebSearch === true || tool.category !== 'web')
      )
    const toolMap = new Map(allTools.map((tool) => [tool.name, tool]))
    let tools = selectToolsForContext(context, allTools, input.permissionMode)
    const customSystemPrompt = await getSystemPromptContent()
    let memoryContext = input.useMemories === false
      ? {
          memories: [],
          usedTokens: 0,
          policyEnabled: false,
          workspaceId: input.workspaceId || 'default',
        }
      : await memoryContextService.getMemoryContext({
          query: input.userInput,
          conversationId: input.conversationId,
          workspaceId: input.workspaceId,
        })
    let systemPrompt = this.promptAssembler.assemble(
      context,
      tools,
      customSystemPrompt,
      memoryContextService.formatMemoryContext(memoryContext)
    )
    const baseMessages = this.contextManager.prepareMessages(input.messages || [])
      .map(normalizeBaseMessage)

    const currentUserMessage = await this.contextManager.buildCurrentUserMessage(
      input.userInput,
      input.imageUrls
    )

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...baseMessages,
      currentUserMessage,
    ]

    agentDebugLog('context_prepared', {
      runId,
      systemPromptLength: systemPrompt.length,
      systemPromptTokens: estimateTokens(systemPrompt),
      toolCount: tools.length,
      rawMessageCount: input.messages?.length || 0,
      preparedMessageCount: messages.length,
      preparedMessageTextTokens: messages.reduce(
        (sum, message) => sum + estimateMessageTextTokens(message),
        0
      ),
      currentImageCount: input.imageUrls?.length || 0,
      appContextMessageCount: baseMessages.filter((message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('## App Context')
      ).length,
      messages: messages.map(summarizeMessage),
    })
    callbacks.onStatus?.('preparing_context')

    const client = await createOpenAIClient(aiConfig)
    let editorStateReadLocked = hasInlineCurrentEditorState(context)
    let editorSelectionReadLocked = hasInlineCurrentEditorSelection(context)
    let finalContent = ''
    let writeActionCompleted = false
    const readToolResultHistory = new Map<string, {
      result: string
      repeatCount: number
    }>()
    const failedToolResultHistory = new Map<string, {
      result: string
      repeatCount: number
    }>()
    const successfulMutationCalls = new Set<string>()
    const toolResultEvidence = new Set<string>()
    let knowledgeSearchCount = 0
    const readKnowledgeSourceKeys = new Set<string>()
    const knowledgeReadLimit = ragAgentPolicy.strategy === 'fast'
      ? 1
      : ragAgentPolicy.strategy === 'deep' ? 5 : 3
    let directAnswerEvidenceChecked = false
    let knowledgeCitationChecked = false
    const executeToolWithBudget = async (
      tool: AgentTool,
      args: Record<string, unknown>
    ): Promise<AgentToolResult> => {
      if (tool.name === 'knowledge_search') {
        if (knowledgeSearchCount >= ragAgentPolicy.maxSearchRounds) {
          return {
            ok: false,
            message: `本次任务已达到“${ragAgentPolicy.strategy}”策略允许的 ${ragAgentPolicy.maxSearchRounds} 轮知识搜索上限。请基于已有证据完成回答。`,
            error: 'KNOWLEDGE_SEARCH_BUDGET_EXHAUSTED',
          }
        }
        knowledgeSearchCount += 1
      }
      if (tool.name === 'knowledge_read_sources') {
        const requests = Array.isArray(args.requests) ? args.requests : []
        const requestedKeys = requests.flatMap(request => {
          if (!request || typeof request !== 'object') return []
          const sourceKey = (request as { sourceKey?: unknown }).sourceKey
          return typeof sourceKey === 'string' ? [sourceKey] : []
        })
        const nextKeys = requestedKeys.filter(sourceKey => !readKnowledgeSourceKeys.has(sourceKey))
        if (readKnowledgeSourceKeys.size + new Set(nextKeys).size > knowledgeReadLimit) {
          return {
            ok: false,
            message: `“${ragAgentPolicy.strategy}”策略最多定向读取 ${knowledgeReadLimit} 个知识来源。请只读取最相关的候选。`,
            error: 'KNOWLEDGE_READ_BUDGET_EXHAUSTED',
          }
        }
        requestedKeys.forEach(sourceKey => readKnowledgeSourceKeys.add(sourceKey))
      }

      return executeAgentTool(
        tool,
        args,
        runId,
        this.abortController?.signal,
        context
      )
    }
    const appendToolResult = (
      toolCallId: string,
      toolName: string,
      args: Record<string, unknown>,
      result: AgentToolResult
    ) => {
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: stringifyToolResult(result),
      })
      toolResultEvidence.add([
        toolName,
        JSON.stringify(args),
        stringifyToolResult(result),
      ].join(':'))
    }
    const loadedSkillIds = new Set<string>()
    let consecutiveNoProgressRounds = 0
    let forceFinalResponseReason: string | undefined
    let latestEditorStateResult: AgentToolResult | undefined
    let activeModelTraceId: string | undefined
    let activeModelStartedAt = 0
    let activeModelReasoning = ''
    let activeModelContent = ''
    let activeModelStreamedTokenCount = 0
    const discoveredFolderFiles = new Map<string, Set<string>>()
    const readFolderFiles = new Map<string, Set<string>>()

    const getFolderAttachmentProgress = (
      toolName: string,
      args: Record<string, unknown>,
      result: AgentToolResult
    ) => {
      if (!result.ok || (toolName !== 'attachment_list' && toolName !== 'attachment_read')) {
        return undefined
      }

      const attachmentId = typeof args.attachmentId === 'string' ? args.attachmentId : ''
      const attachment = context.attachments?.find((item) => item.id === attachmentId)
      if (!attachment || attachment.kind !== 'folder') {
        return undefined
      }

      if (toolName === 'attachment_list') {
        const data = result.data && typeof result.data === 'object'
          ? result.data as { relativePath?: unknown; entries?: unknown }
          : undefined
        const relativePath = typeof data?.relativePath === 'string' ? data.relativePath : ''
        const entries = Array.isArray(data?.entries) ? data.entries : []
        const discovered = discoveredFolderFiles.get(attachmentId) || new Set<string>()

        for (const value of entries) {
          if (!value || typeof value !== 'object') continue
          const entry = value as { name?: unknown; kind?: unknown; readable?: unknown }
          if (entry.kind !== 'file' || entry.readable !== true || typeof entry.name !== 'string') continue
          discovered.add(relativePath ? `${relativePath}/${entry.name}` : entry.name)
        }

        discoveredFolderFiles.set(attachmentId, discovered)
        return `本次列出了 ${entries.length} 项，其中当前累计发现 ${discovered.size} 个可读取文件。`
      }

      const relativePath = typeof args.relativePath === 'string' ? args.relativePath : ''
      const relativePaths = Array.isArray(args.relativePaths)
        ? args.relativePaths.filter((path): path is string => typeof path === 'string')
        : []
      const resultData = result.data && typeof result.data === 'object'
        ? result.data as { files?: unknown }
        : undefined
      const successfulBatchPaths = Array.isArray(resultData?.files)
        ? resultData.files.flatMap((value) => {
            if (!value || typeof value !== 'object') return []
            const file = value as { path?: unknown; ok?: unknown }
            return file.ok === true && typeof file.path === 'string' ? [file.path] : []
          })
        : []
      const readPaths = successfulBatchPaths.length > 0
        ? successfulBatchPaths
        : relativePaths.length === 0 && relativePath
          ? [relativePath]
          : []
      if (readPaths.length === 0) return undefined
      const read = readFolderFiles.get(attachmentId) || new Set<string>()
      for (const path of readPaths) {
        read.add(path)
      }
      readFolderFiles.set(attachmentId, read)

      const discovered = discoveredFolderFiles.get(attachmentId)
      if (!discovered || discovered.size === 0) {
        return undefined
      }

      const readCount = [...discovered].filter((path) => read.has(path)).length
      const unread = [...discovered].filter((path) => !read.has(path))
      const unreadPreview = unread.slice(0, 20).join('、')
      const omittedCount = Math.max(0, unread.length - 20)
      return [
        `当前已读取 ${readCount}/${discovered.size} 个已发现的可读文件。`,
        unread.length > 0
          ? `尚未读取：${unreadPreview}${omittedCount > 0 ? `，另有 ${omittedCount} 个` : ''}。请结合用户请求判断是否需要继续读取。`
          : '当前已发现的可读文件均已读取。',
      ].join('\n')
    }

    const getSafeStoppedContent = () => {
      if (toolCalls.length > 0 && !finalContent) {
        return [
          '已停止生成最终说明；已成功执行的操作请以工具结果和改动记录为准。',
          changes.length > 0 ? `本轮已记录 ${changes.length} 项成功改动。` : '',
        ].filter(Boolean).join('\n')
      }

      return activeModelContent || finalContent
    }

    const prepareFinalResponse = (reason: string) => {
      callbacks.onCandidateAnswerClear?.()
      forceFinalResponseReason = reason
      consecutiveNoProgressRounds = 0
      messages.push({
        role: 'user',
        content: [
          '## App Context',
          `工具执行阶段已停止：${reason}`,
          '请基于用户原始请求和已有工具结果，直接生成自然、完整的最终答复。说明已经完成的内容、未完成的内容及原因；不要再调用任何工具。',
        ].join('\n'),
      })
    }

    const drainSteering = async () => {
      if (!this.steeringRequested) return false
      if (this.stopped) return false

      const payloads = this.steeringQueue.drain()
      if (payloads.length === 0) return false
      this.steeringRequested = this.steeringQueue.hasItems()
      callbacks.onSteeringDelivered?.(payloads)
      callbacks.onStatus?.('steering')

      for (const payload of payloads) {
        const text = payload.additionalContext
          ? `## App Context\n${payload.additionalContext}\n\n## User steering message\n${payload.text}`
          : payload.text
        messages.push(await this.contextManager.buildCurrentUserMessage(text, payload.imageUrls))
      }

      const latest = payloads[payloads.length - 1]
      context.userInput = latest.text
      context.currentQuote = latest.currentQuote
      context.attachments = latest.attachments ?? context.attachments
      const steeredSkillIds = payloads.flatMap(payload => payload.selectedSkills || [])
      if (steeredSkillIds.length > 0) {
        context.selectedSkills = [
          ...new Set([...(context.selectedSkills || []), ...steeredSkillIds]),
        ]
        const availableSkillIds = new Set(
          (context.availableSkills || []).map(skill => skill.id)
        )
        for (const skillId of steeredSkillIds) {
          if (availableSkillIds.has(skillId)) continue
          const skill = skillManager.getSkill(skillId)
          if (!skill || skill.metadata.enabled === false) continue
          context.availableSkills = [
            ...(context.availableSkills || []),
            {
              id: skill.metadata.id,
              name: skill.metadata.name,
              description: skill.metadata.description,
              scope: skill.metadata.scope,
            },
          ]
          availableSkillIds.add(skillId)
        }
      }
      if (latest.imageAttachments?.length) {
        context.imageAttachments = [
          ...(context.imageAttachments ?? []),
          ...latest.imageAttachments,
        ].slice(-6)
      }
      context.currentEditorState = undefined
      tools = selectToolsForContext(context, allTools, input.permissionMode)
      editorStateReadLocked = false
      editorSelectionReadLocked = hasInlineCurrentEditorSelection(context)
      consecutiveNoProgressRounds = 0
      forceFinalResponseReason = undefined
      successfulMutationCalls.clear()
      directAnswerEvidenceChecked = false
      memoryContext = input.useMemories === false
        ? {
            memories: [],
            usedTokens: 0,
            policyEnabled: false,
            workspaceId: input.workspaceId || 'default',
          }
        : await memoryContextService.getMemoryContext({
            query: latest.text,
            conversationId: input.conversationId,
            workspaceId: input.workspaceId,
          })
      systemPrompt = this.promptAssembler.assemble(
        context,
        tools,
        customSystemPrompt,
        memoryContextService.formatMemoryContext(memoryContext)
      )
      messages[0] = { role: 'system', content: systemPrompt }

      const steeringTrace = recorder.add({
        type: 'steering',
        title: '已应用追加信息',
        status: 'success',
        message: payloads.map((payload) => payload.text).join('\n'),
      })
      callbacks.onTrace?.(steeringTrace)
      return true
    }

    const finalizeInterruptedModelTrace = (
      status: 'success' | 'error',
      title: string,
      isIntermediateResponse = false
    ) => {
      if (!activeModelTraceId) {
        return
      }

      const interruptedTrace = recorder.update(activeModelTraceId, {
        type: 'model_response',
        title,
        status,
        duration: Date.now() - activeModelStartedAt,
        output: activeModelContent || undefined,
        reasoning: activeModelReasoning || undefined,
        isIntermediateResponse: isIntermediateResponse && Boolean(activeModelContent),
        streamedTokenCount: activeModelStreamedTokenCount,
      })
      if (interruptedTrace) callbacks.onTrace?.(interruptedTrace)

      activeModelTraceId = undefined
      activeModelStartedAt = 0
      activeModelReasoning = ''
      activeModelContent = ''
      activeModelStreamedTokenCount = 0
    }

    try {
      agentLoop: for (let iteration = 1; iteration <= ABSOLUTE_MAX_MODEL_ROUNDS + 1; iteration += 1) {
        if (iteration > ABSOLUTE_MAX_MODEL_ROUNDS && !forceFinalResponseReason) {
          break
        }
        if (this.stopped) {
          callbacks.onStatus?.('stopped')
          const stoppedContent = getSafeStoppedContent()
          if (stoppedContent) {
            callbacks.onFinalAnswerRender?.(stoppedContent)
          }
          return {
            runId,
            content: stoppedContent,
            stopped: true,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        await drainSteering()
        const evidenceCountAtRoundStart = toolResultEvidence.size

        callbacks.onStatus?.('thinking')
        await agentEventBus.emit('before-model-call', { runId })
        agentDebugLog('model_call_start', {
          runId,
          iteration,
          model: aiConfig?.model || '',
          messageCount: messages.length,
          toolCount: tools.length,
        })
        const modelTrace = recorder.add({
          type: 'model_call',
          title: '模型思考',
          status: 'running',
          message: `第 ${iteration} 轮`,
          streamedTokenCount: 0,
        })
        activeModelTraceId = modelTrace.id
        activeModelStartedAt = modelTrace.timestamp
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        callbacks.onTrace?.(modelTrace)

        const offeredTools = forceFinalResponseReason ? [] : tools.filter((tool) => {
          if (editorStateReadLocked && tool.name === 'editor_get_state') {
            return false
          }
          if (editorSelectionReadLocked && tool.name === 'editor_get_selection') {
            return false
          }
          return true
        })
        const offeredToolNames = new Set(offeredTools.map((tool) => tool.name))
        const openAITools = agentToolRegistry.toOpenAITools(offeredTools, loadedSkillIds)
        const requestMessages = this.contextManager.prepareMessages(messages)
        const messageTextTokens = requestMessages.reduce(
          (sum, message) => sum + estimateMessageTextTokens(message),
          0
        )
        const toolSchemaTokens = estimateTokens(JSON.stringify(openAITools))
        agentDebugLog('model_request_budget', {
          runId,
          iteration,
          messageCount: requestMessages.length,
          messageTextTokens,
          offeredToolCount: offeredTools.length,
          toolSchemaTokens,
          estimatedTextAndToolTokens: messageTextTokens + toolSchemaTokens,
          imageCount: input.imageUrls?.length || 0,
        })
        const toolParams = openAITools.length > 0
          ? {
              tools: openAITools,
              tool_choice: 'auto' as const,
            }
          : {}
        const stream = await this.recoveryManager.withRetry(() =>
          createChatCompletionStreamWithToolChoiceFallback(client, withFastAiRequestOptions({
            model: aiConfig?.model || '',
            messages: requestMessages,
            temperature: aiConfig?.temperature,
            top_p: aiConfig?.topP,
            stream: true,
            ...toolParams,
            ...getChatTokenLimitParams(aiConfig),
          }, aiConfig), {
            signal: this.abortController?.signal,
          })
        )
        let assistantContent = ''
        let finishReason: string | null | undefined
        let toolCallsStarted = false
        let candidateAnswerRendered = false
        let assistantReasoning = ''
        const assistantReasoningDetails: unknown[] = []
        let streamedText = ''
        let streamedTokenCount = 0
        let lastModelProgressTraceAt = 0
        const streamedToolCalls = new Map<number, StreamingToolCallAccumulator>()

        for await (const chunk of stream) {
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          const choice = chunk.choices?.[0]
          if (!choice) {
            continue
          }

          finishReason = choice.finish_reason ?? finishReason
          const delta = choice.delta
          if (!delta) {
            continue
          }
          const extendedDelta = delta as typeof delta & {
            reasoning?: string
            reasoning_content?: string
            reasoning_details?: unknown[]
          }
          const reasoningDelta = extendedDelta.reasoning_content || extendedDelta.reasoning
          if (typeof reasoningDelta === 'string') {
            assistantReasoning += reasoningDelta
            streamedText += reasoningDelta
            activeModelReasoning = assistantReasoning
          }
          if (Array.isArray(extendedDelta.reasoning_details)) {
            assistantReasoningDetails.push(...extendedDelta.reasoning_details)
          }
          if (typeof delta.content === 'string' && delta.content) {
            assistantContent += delta.content
            streamedText += delta.content
            activeModelContent = assistantContent
            if (
              !toolCallsStarted &&
              assistantContent.trim()
            ) {
              candidateAnswerRendered = true
              callbacks.onCandidateAnswerRender?.(assistantContent)
            }
          }

          for (const toolCallDelta of delta.tool_calls || []) {
            if (!toolCallsStarted) {
              toolCallsStarted = true
            }

            const index = resolveStreamingToolCallIndex(streamedToolCalls, toolCallDelta)
            const current = streamedToolCalls.get(index) || {
              index,
              id: toolCallDelta.id,
              type: 'function' as const,
              function: {
                name: '',
                arguments: '',
              },
            }

            if (toolCallDelta.id) {
              current.id = toolCallDelta.id
            }
            if (toolCallDelta.type === 'function') {
              current.type = toolCallDelta.type
            }
            if (toolCallDelta.function?.name) {
              current.function.name += toolCallDelta.function.name
              streamedText += toolCallDelta.function.name
            }
            if (toolCallDelta.function?.arguments) {
              current.function.arguments += toolCallDelta.function.arguments
              streamedText += toolCallDelta.function.arguments
            }

            streamedToolCalls.set(index, current)
          }

          const now = Date.now()
          if (streamedText && now - lastModelProgressTraceAt >= 100) {
            streamedTokenCount = estimateTokens(streamedText)
            activeModelStreamedTokenCount = streamedTokenCount
            lastModelProgressTraceAt = now
            const progressTrace = recorder.update(modelTrace.id, {
              output: assistantContent || undefined,
              reasoning: assistantReasoning || undefined,
              streamedTokenCount,
            })
            if (progressTrace) callbacks.onTrace?.(progressTrace)
          }
        }
        streamedTokenCount = estimateTokens(streamedText)
        activeModelStreamedTokenCount = streamedTokenCount
        assistantContent = assistantContent.trim() ? assistantContent : ''
        const rawToolUses = toToolCallList(streamedToolCalls)
        const toolUses = rawToolUses.map((toolCall) => {
          const rewritten = rewriteWorkspaceReadAsAttachmentRead(toolCall, context)
          if (rewritten.function.name !== toolCall.function.name) {
            agentDebugLog('tool_call_auto_routed_to_attachment', {
              runId,
              toolCallId: toolCall.id,
              originalToolName: toolCall.function.name,
              originalArguments: toolCall.function.arguments,
              rewrittenToolName: rewritten.function.name,
              rewrittenArguments: rewritten.function.arguments,
            })
          }
          return rewritten
        })
        agentDebugLog('model_call_end', {
          runId,
          iteration,
          finishReason,
          assistantContentLength: assistantContent.length,
          assistantPreview: previewText(assistantContent),
          toolCalls: toolUses.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            argumentsPreview: previewText(toolCall.function.arguments || ''),
          })),
        })
        const modelTraceOutput = assistantContent || (
          toolUses.length > 0
            ? {
              finishReason,
              toolCalls: toolUses.map((toolCall) => ({
                id: toolCall.id,
                name: toolCall.function.name,
                argumentsPreview: previewText(toolCall.function.arguments || '', 500),
              })),
            }
            : undefined
        )
        const responseTrace = recorder.update(modelTrace.id, {
          type: 'model_response',
          title: assistantContent ? '模型响应' : toolUses.length > 0 ? '模型选择工具' : '模型思考',
          status: 'success',
          duration: Date.now() - modelTrace.timestamp,
          output: modelTraceOutput,
          reasoning: assistantReasoning || undefined,
          isIntermediateResponse: (toolUses.length > 0 || this.steeringRequested) && Boolean(assistantContent),
          streamedTokenCount,
        })
        if (responseTrace) callbacks.onTrace?.(responseTrace)
        activeModelTraceId = undefined
        activeModelStartedAt = 0
        activeModelReasoning = ''
        activeModelContent = ''
        activeModelStreamedTokenCount = 0
        if (toolCallsStarted && candidateAnswerRendered) {
          callbacks.onCandidateAnswerClear?.()
        }
        await agentEventBus.emit('after-model-call', { runId, content: assistantContent })

        if (toolUses.length === 0) {
          const resolvedContent = assistantContent || finalContent
          if (this.steeringRequested) {
            callbacks.onCandidateAnswerClear?.()
            if (resolvedContent) {
              messages.push({ role: 'assistant', content: resolvedContent })
            }
            await drainSteering()
            continue
          }
          if (!resolvedContent) {
            throw new Error('AI response did not include a message')
          }
          if (
            knowledgeSearchCount > 0
            && !knowledgeCitationChecked
            && !toolCalls.some(call => call.toolName === 'knowledge_cite_sources' && call.status === 'success')
          ) {
            knowledgeCitationChecked = true
            callbacks.onCandidateAnswerClear?.()
            messages.push(
              { role: 'assistant', content: resolvedContent },
              {
                role: 'user',
                content: [
                  '## App Context',
                  'A knowledge search occurred, but the draft did not identify which retrieved sources were actually used.',
                  'If the draft relies on any retrieved source, call knowledge_cite_sources with only those source keys, then return the final answer.',
                  'Do not cite sources that were merely retrieved, rejected, or left unread. If no retrieved source supports the draft, return the answer without claiming support from the knowledge base.',
                  'Do not mention this internal citation check.',
                ].join('\n'),
              }
            )
            continue
          }
          if (
            !forceFinalResponseReason
            && !directAnswerEvidenceChecked
            && knowledgeSearchCount === 0
            && offeredToolNames.has('knowledge_search')
            && (
              claimsUserNoteEvidence(resolvedContent)
              || explicitlyRequestsKnowledgeLookup(context.userInput)
              || requestsSavedPersonalFact(context.userInput)
            )
          ) {
            directAnswerEvidenceChecked = true
            callbacks.onCandidateAnswerClear?.()
            messages.push(
              { role: 'assistant', content: resolvedContent },
              {
                role: 'user',
                content: [
                  '## App Context',
                  'The draft above answers a request that may depend on the user\'s saved knowledge, but no unified knowledge search occurred in this run. Calls to memory_list, tag_list, mark_list, or other tools do not replace knowledge_search.',
                  'Verify that attribution semantically, without relying on required keywords or fixed business fields. Do not treat the draft itself as evidence.',
                  'If the claimed fact is not already supported by the conversation, current editor context, current canvas, or saved memory context, call knowledge_search now. If the existing context really supports it, return the final answer directly.',
                  'Do not mention this internal evidence-attribution check.',
                ].join('\n'),
              }
            )
            continue
          }
          agentDebugLog('final_answer', {
            runId,
            contentLength: resolvedContent.length,
            preview: previewText(resolvedContent),
          })
          callbacks.onStatus?.('completed')
          callbacks.onFinalAnswerRender?.(resolvedContent)
          const finalTrace = recorder.add({
            type: 'final',
            title: '完成',
            status: 'success',
            message: resolvedContent,
          })
          callbacks.onTrace?.(finalTrace)

          return {
            runId,
            content: resolvedContent,
            stopped: false,
            steps,
            toolCalls,
            changes,
            trace: recorder.all(),
          }
        }

        messages.push(createAssistantToolCallMessage(
          assistantContent,
          toolUses,
          assistantReasoning,
          assistantReasoningDetails
        ))

        const cancelRemainingToolCalls = (afterIndex: number, reason: string) => {
          for (const pendingToolUse of toolUses.slice(afterIndex + 1)) {
            appendToolResult(pendingToolUse.id, pendingToolUse.function.name, {}, {
              ok: false,
              message: `运行保护已停止后续工具调用：${reason}`,
              error: 'CANCELLED_BY_RUNTIME_GUARD',
            })
          }
        }

        for (let toolIndex = 0; toolIndex < toolUses.length; toolIndex += 1) {
          const toolUse = toolUses[toolIndex]
          if (this.stopped) {
            throw new Error('USER_STOPPED')
          }
          const toolName = toolUse.function.name
          const tool = toolMap.get(toolName)
          let args: Record<string, unknown>
          try {
            args = parseToolArguments(toolUse.function.arguments)
          } catch (error) {
            const parseErrorResult: AgentToolResult = {
              ok: false,
              message: `工具参数 JSON 无效：${error instanceof Error ? error.message : String(error)}。请重新发起同一个工具调用，并返回合法 JSON 参数。`,
              error: 'INVALID_TOOL_ARGUMENTS_JSON',
            }
            const toolCall: ToolCall = {
              id: toolUse.id || createAgentId('tool-call'),
              toolName,
              params: {},
              status: 'error',
              result: toolResultToLegacy(parseErrorResult),
              timestamp: Date.now(),
            }
            toolCalls.push(toolCall)
            callbacks.onToolCall?.(toolCall)
            agentDebugLog('tool_args_parse_error', {
              runId,
              toolCallId: toolUse.id,
              toolName,
              rawArguments: toolUse.function.arguments || '',
              error: parseErrorResult.message,
            })
            appendToolResult(toolUse.id, toolName, {}, parseErrorResult)
            continue
          }

          const repairedEditorArgs = repairEditorWriteArgs(toolName, args, context)
          if (repairedEditorArgs !== args) {
            agentDebugLog('tool_args_auto_repaired', {
              runId,
              toolName,
              originalArgs: args,
              repairedArgs: repairedEditorArgs,
              reason: 'Normalized editor line replacement arguments and preserved Markdown structure.',
            })
            args = repairedEditorArgs
          }

          const repairedAttachmentArgs = repairAttachmentToolArgs(toolName, args, context)
          if (repairedAttachmentArgs !== args) {
            agentDebugLog('attachment_args_auto_repaired', {
              runId,
              toolCallId: toolUse.id,
              toolName,
              originalArgs: args,
              repairedArgs: repairedAttachmentArgs,
            })
            args = repairedAttachmentArgs
          }

          agentDebugLog('tool_call_received', {
            runId,
            toolCallId: toolUse.id,
            toolName,
            args,
          })

          if (!tool) {
            const missingResult: AgentToolResult = {
              ok: false,
              message: `工具不存在：${toolName}`,
              error: `Unknown tool ${toolName}`,
            }
            agentDebugLog('tool_missing', {
              runId,
              toolName,
            })
            appendToolResult(toolUse.id, toolName, args, missingResult)
            continue
          }

          callbacks.onStatus?.('calling_tool')
          const toolCall: ToolCall = {
            id: toolUse.id || createAgentId('tool-call'),
            toolName,
            params: args,
            status: 'pending',
            timestamp: Date.now(),
          }
          toolCalls.push(toolCall)
          callbacks.onToolCall?.(toolCall)

          if (!offeredToolNames.has(toolName)) {
            const blockedResult: AgentToolResult = {
              ok: false,
              message: `已阻止当前上下文或权限模式未提供的工具调用：${toolName}。`,
              error: 'BLOCKED_UNAVAILABLE_TOOL',
            }
            agentDebugLog('tool_blocked_as_unavailable', {
              runId,
              toolName,
              args,
              offeredToolNames: [...offeredToolNames],
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(blockedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, blockedResult)
            continue
          }

          const invalidToolInput = validateToolInputShape(tool, args)
          if (invalidToolInput) {
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidToolInput)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidToolInput)
            continue
          }

          if (
            (toolName === 'skill_execute_script' || toolName === 'skill_read_resource')
            && (
              typeof args.skill_id !== 'string'
              || !loadedSkillIds.has(args.skill_id)
            )
          ) {
            const notLoadedResult: AgentToolResult = {
              ok: false,
              message: `Skill "${String(args.skill_id || '')}" is not loaded in this task. Call skill_load once before using its resources or scripts.`,
              error: 'SKILL_NOT_LOADED',
            }
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(notLoadedResult)
            callbacks.onToolCall?.(toolCall)
            messages.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: stringifyToolResult(notLoadedResult),
            })
            continue
          }

          if (toolName === 'skill_execute_script' && typeof args.skill_id === 'string') {
            const availableScripts = skillManager.getSkill(args.skill_id)?.scripts.map(script => script.name) || []
            if (
              typeof args.script_id !== 'string'
              || !availableScripts.includes(args.script_id)
            ) {
              const invalidScriptResult: AgentToolResult = {
                ok: false,
                message: [
                  `Invalid script_id for loaded Skill "${args.skill_id}": ${String(args.script_id || '')}.`,
                  `Choose one exact registered ID: ${availableScripts.join(', ') || '(none)'}.`,
                  'Do not invent, abbreviate, or recreate a script.',
                ].join('\n'),
                error: 'INVALID_REGISTERED_SCRIPT_ID',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(invalidScriptResult)
              callbacks.onToolCall?.(toolCall)
              messages.push({
                role: 'tool',
                tool_call_id: toolUse.id,
                content: stringifyToolResult(invalidScriptResult),
              })
              continue
            }
          }

          const invalidEditorTarget = validateEditorTargetFile(context, tool, args)
          if (invalidEditorTarget) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidEditorTarget.message,
              error: invalidEditorTarget.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidEditorTarget)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidEditorTarget)
            continue
          }

          const invalidQuotedWrite = validateQuotedEditorWrite(context, toolName, args)
          if (invalidQuotedWrite) {
            agentDebugLog('tool_args_rejected', {
              runId,
              toolName,
              args,
              reason: invalidQuotedWrite.message,
              error: invalidQuotedWrite.error,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(invalidQuotedWrite)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, invalidQuotedWrite)
            continue
          }

          const blockedByHook = await agentEventBus.emit('pre-tool-use', {
            runId,
            tool,
            input: args,
          })

          if (blockedByHook) {
            const blockedResult: AgentToolResult = {
              ok: false,
              message: blockedByHook,
              error: 'BLOCKED_BY_HOOK',
            }
            agentDebugLog('tool_blocked_by_hook', {
              runId,
              toolName,
              reason: blockedByHook,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(blockedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, blockedResult)
            continue
          }

          const permission = this.permissionEngine.evaluate(tool, args, input.permissionMode)
          agentDebugLog('permission_decision', {
            runId,
            toolName,
            risk: tool.risk,
            allowed: permission.allowed,
            requiresApproval: permission.requiresApproval,
            reason: permission.reason,
            canApproveForSession: permission.canApproveForSession,
            sessionApprovalType: permission.sessionApprovalType,
            sessionApprovalKey: permission.sessionApprovalKey,
          })
          if (!permission.allowed) {
            const deniedResult: AgentToolResult = {
              ok: false,
              message: permission.reason || '工具调用被权限策略阻止。',
              error: 'BLOCKED_BY_PERMISSION',
            }
            agentDebugLog('tool_blocked_by_permission', {
              runId,
              toolName,
              reason: deniedResult.message,
            })
            toolCall.status = 'error'
            toolCall.result = toolResultToLegacy(deniedResult)
            callbacks.onToolCall?.(toolCall)
            appendToolResult(toolUse.id, toolName, args, deniedResult)
            continue
          }

          if (permission.requiresApproval) {
            callbacks.onStatus?.('waiting_approval')
            agentDebugLog('approval_request', {
              runId,
              toolName,
              args,
            })
            const approvalTrace = recorder.add({
              type: 'approval',
              title: '等待用户确认',
              status: 'running',
              toolName,
              input: args,
            })
            callbacks.onTrace?.(approvalTrace)

            const approvalPreview = await buildEditorApprovalPreview(tool.name, args)
            if (this.stopped) {
              throw new Error('USER_STOPPED')
            }
            let approvalDecision = this.steeringRequested
              ? 'steered'
              : await callbacks.requestConfirmation?.(
                  tool.name,
                  args,
                  approvalPreview ?? { previewParams: args }
                )

            agentDebugLog('approval_result', {
              runId,
              toolName,
              approved: approvalDecision === 'approved',
              decision: approvalDecision,
            })

            if (this.stopped) {
              throw new Error('USER_STOPPED')
            }
            if (this.steeringRequested) {
              approvalDecision = 'steered'
            }

            if (approvalDecision === 'steered') {
              const supersededResult: AgentToolResult = {
                ok: false,
                message: '用户追加了新的引导信息，本次待确认操作已取消。',
                error: 'SUPERSEDED_BY_STEERING',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(supersededResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: supersededResult.message,
                output: supersededResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              appendToolResult(toolUse.id, toolName, args, supersededResult)
              continue
            }

            if (approvalDecision !== 'approved') {
              const deniedResult: AgentToolResult = {
                ok: false,
                message: '用户拒绝了这个操作。请不要重复调用同一高风险工具，改用只读回答或询问用户新的处理方式。',
                error: 'USER_DENIED_TOOL',
              }
              toolCall.status = 'error'
              toolCall.result = toolResultToLegacy(deniedResult)
              callbacks.onToolCall?.(toolCall)
              const updatedApprovalTrace = recorder.update(approvalTrace.id, {
                status: 'error',
                message: deniedResult.message,
                output: deniedResult,
              })
              if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
              appendToolResult(toolUse.id, toolName, args, deniedResult)
              finalContent = changes.length > 0
                ? `已取消当前待确认操作；此前已有 ${changes.length} 项改动成功执行，请以改动记录为准。`
                : '已取消当前待确认操作，未执行该项改动。'
              agentDebugLog('approval_denied_final', {
                runId,
                toolName,
                content: finalContent,
              })
              callbacks.onStatus?.('completed')
              callbacks.onFinalAnswerRender?.(finalContent)
              const finalTrace = recorder.add({
                type: 'final',
                title: '已取消',
                status: 'success',
                message: finalContent,
              })
              callbacks.onTrace?.(finalTrace)

              return {
                runId,
                content: finalContent,
                stopped: false,
                steps,
                toolCalls,
                changes,
                trace: recorder.all(),
              }
            }

            const updatedApprovalTrace = recorder.update(approvalTrace.id, {
              status: 'success',
              message: '用户已确认操作。',
            })
            if (updatedApprovalTrace) callbacks.onTrace?.(updatedApprovalTrace)
          }

          callbacks.onStatus?.(
            ['editor-write', 'file-create', 'file-update', 'delete', 'medium'].includes(tool.risk)
              ? 'applying_change'
              : 'calling_tool'
          )

          const trace = recorder.add({
            type: 'tool_call',
            title: tool.title,
            status: 'running',
            toolName,
            input: args,
          })
          callbacks.onTrace?.(trace)
          toolCall.status = 'running'
          callbacks.onToolCall?.(toolCall)

          const startedAt = Date.now()
          const reusableEditorStateResult = toolName === 'editor_get_state' && editorStateReadLocked
            ? latestEditorStateResult
            : undefined
          const reusedLockedEditorState = reusableEditorStateResult !== undefined
          const mutationCallSignature = isMutatingTool(tool)
            ? `${tool.name}:${JSON.stringify(args)}`
            : undefined
          const repeatedFailedMutation = Boolean(
            mutationCallSignature && failedToolResultHistory.has(mutationCallSignature)
          )
          const repeatedSuccessfulMutation = Boolean(
            mutationCallSignature && successfulMutationCalls.has(mutationCallSignature)
          )
          agentDebugLog('tool_execute_start', {
            runId,
            iteration,
            toolName,
            args,
            reusedLockedEditorState,
            repeatedFailedMutation,
            repeatedSuccessfulMutation,
          })
          const result: AgentToolResult = repeatedSuccessfulMutation
            ? {
                ok: true,
                message: '相同的写入操作已在本次任务中成功执行，本次重复调用已忽略。请直接完成回答。',
                data: { deduplicated: true },
              }
            : repeatedFailedMutation
            ? {
                ok: false,
                message: '相同的写入操作此前已经失败，本次重复执行已被阻止。请调整参数、改用其他工具，或向用户说明失败原因。',
                error: 'REPEATED_FAILED_MUTATION_BLOCKED',
              }
            : reusableEditorStateResult
            ? {
                ...reusableEditorStateResult,
                message: [
                  reusableEditorStateResult.message,
                  '本轮已经读取过相同的编辑器状态，请直接使用此前返回的内容，不要再次读取。',
                ].join('\n\n'),
              }
            : await executeToolWithBudget(tool, args)
          const folderAttachmentProgress = getFolderAttachmentProgress(tool.name, args, result)
          const duration = Date.now() - startedAt
          agentDebugLog('tool_execute_end', {
            runId,
            iteration,
            toolName,
            ok: result.ok,
            duration,
            message: result.message,
            error: result.error,
            changeCount: result.changes?.length || 0,
          })

          if (result.changes) {
            for (const change of result.changes) {
              changes.push(change)
              callbacks.onChange?.(change)
              const changeTrace = recorder.add({
                type: 'change',
                title: change.summary || '记录改动',
                status: 'success',
                toolName,
                output: change,
                message: change.target,
              })
              callbacks.onTrace?.(changeTrace)
            }
          }

          toolCall.status = result.ok ? 'success' : 'error'
          toolCall.result = toolResultToLegacy(result)
          callbacks.onToolCall?.(toolCall)

          const step = buildStep(tool, args, result, duration)
          steps.push(step)
          callbacks.onStep?.(step)

          const updatedTrace = recorder.update(trace.id, {
            status: result.ok ? 'success' : 'error',
            duration,
            output: result,
            message: [result.message, folderAttachmentProgress].filter(Boolean).join('\n\n'),
          })
          if (updatedTrace) callbacks.onTrace?.(updatedTrace)

          await agentEventBus.emit('post-tool-use', {
            runId,
            tool,
            input: args,
            result,
          })

          let modelFacingResult = result
          let identicalReadResultRepeatCount = 0
          const readToolCallSignature = reusedLockedEditorState
            ? undefined
            : getReadToolCallSignature(tool, args)
          if (result.ok && readToolCallSignature) {
            const serializedResult = stringifyToolResult(result)
            const previousRead = readToolResultHistory.get(readToolCallSignature)

            if (previousRead?.result === serializedResult) {
              identicalReadResultRepeatCount = previousRead.repeatCount + 1
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: identicalReadResultRepeatCount,
              })
              modelFacingResult = {
                ...result,
                message: [
                  result.message,
                  '这次读取与上次完全相同，上次结果仍在上下文中。不要再次读取；请使用已有结果执行下一步写入，或直接完成回答。',
                ].join('\n\n'),
              }
            } else {
              readToolResultHistory.set(readToolCallSignature, {
                result: serializedResult,
                repeatCount: 0,
              })
            }
          }

          if (result.ok && isMutatingTool(tool) && !repeatedSuccessfulMutation) {
            modelFacingResult = {
              ...result,
              message: [
                result.message || '操作已成功完成。',
                '该操作已经成功，不要再次使用相同参数调用同一工具。如果用户请求已经完成，请直接给出最终答复。',
              ].join('\n\n'),
            }
          } else if (!result.ok) {
            modelFacingResult = {
              ...result,
              message: [
                result.message || result.error || '工具未返回可确认的成功结果。',
                isMutatingTool(tool)
                  ? '该操作未确认成功。不要用相同参数重复执行；请调整方案、改用其他工具，或向用户说明情况。'
                  : '请根据该结果调整参数、改用其他工具，或直接向用户说明情况；不要无视错误结束对话。',
              ].join('\n\n'),
            }
          }

          if (folderAttachmentProgress) {
            modelFacingResult = {
              ...modelFacingResult,
              message: [modelFacingResult.message, folderAttachmentProgress].filter(Boolean).join('\n\n'),
            }
          }

          appendToolResult(toolUse.id, tool.name, args, modelFacingResult)

          if (repeatedSuccessfulMutation || repeatedFailedMutation) {
            const reason = repeatedSuccessfulMutation
              ? `相同的 ${tool.title} 操作此前已经成功，本次重复调用未再次执行。`
              : `相同的 ${tool.title} 操作此前已经失败，本次重复调用已被阻止。`
            cancelRemainingToolCalls(toolIndex, reason)
            prepareFinalResponse(reason)
            continue agentLoop
          }

          if (result.ok && tool.name === 'skill_load' && typeof args.skill_id === 'string') {
            loadedSkillIds.add(args.skill_id)
          }

          if (result.ok && mutationCallSignature && !repeatedSuccessfulMutation) {
            successfulMutationCalls.add(mutationCallSignature)
          }

          if (!result.ok) {
            const failedCallSignature = `${tool.name}:${JSON.stringify(args)}`
            const serializedResult = stringifyToolResult(result)
            const previousFailure = failedToolResultHistory.get(failedCallSignature)
            const repeatCount = previousFailure?.result === serializedResult
              ? previousFailure.repeatCount + 1
              : 0
            failedToolResultHistory.set(failedCallSignature, {
              result: serializedResult,
              repeatCount,
            })
          } else {
            failedToolResultHistory.delete(`${tool.name}:${JSON.stringify(args)}`)
          }

          if (identicalReadResultRepeatCount >= MAX_IDENTICAL_READ_RESULT_REPEATS) {
            const reason = [
              `模型连续重复调用 ${toolName}，且读取结果始终未变，已停止执行以避免循环。`,
              writeActionCompleted ? '已保留此前完成的修改。' : '本次修改尚未完成。',
            ].join('\n')
            cancelRemainingToolCalls(toolIndex, reason)
            prepareFinalResponse(reason)
            continue agentLoop
          }

          if (result.ok && isMutatingTool(tool)) {
            writeActionCompleted = true
            readToolResultHistory.clear()
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            editorSelectionReadLocked = false
          } else if (isEditorStateStaleResult(tool, result)) {
            latestEditorStateResult = undefined
            editorStateReadLocked = false
            editorSelectionReadLocked = false
          }

          if (result.ok && tool.name === 'editor_get_state') {
            if (!reusedLockedEditorState) {
              latestEditorStateResult = result
            }
            editorStateReadLocked = true
            const editorStateData = result.data && typeof result.data === 'object'
              ? result.data as { selection?: unknown }
              : undefined
            if (editorStateData?.selection) {
              editorSelectionReadLocked = true
            }
          }

          if (result.ok && tool.name === 'editor_get_selection') {
            editorSelectionReadLocked = true
          }

        }

        const madeProgress = toolResultEvidence.size > evidenceCountAtRoundStart
        consecutiveNoProgressRounds = madeProgress
          ? 0
          : consecutiveNoProgressRounds + 1
        agentDebugLog('agent_round_progress', {
          runId,
          iteration,
          madeProgress,
          newEvidenceCount: toolResultEvidence.size - evidenceCountAtRoundStart,
          consecutiveNoProgressRounds,
        })

        if (consecutiveNoProgressRounds >= MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS) {
          const completedWrite = writeActionCompleted || changes.length > 0
          const reason = completedWrite
            ? [
                '修改已成功执行；模型后续没有产生新的工具结果，已停止重复调用。',
                changes.length > 0 ? `本轮共记录 ${changes.length} 项成功改动。` : '重复写入已被忽略。',
              ].join('\n')
            : [
                `连续 ${MAX_CONSECUTIVE_NO_PROGRESS_ROUNDS} 轮没有获得新的工具结果，已停止执行以避免无效循环。`,
                '本次任务尚未确认完成。',
              ].join('\n')
          prepareFinalResponse(reason)
          continue
        }

        if (iteration >= ABSOLUTE_MAX_MODEL_ROUNDS && !forceFinalResponseReason) {
          prepareFinalResponse(`已达到 ${ABSOLUTE_MAX_MODEL_ROUNDS} 轮工具执行安全上限。`)
        }

      }

      finalContent = finalContent || `已达到 ${ABSOLUTE_MAX_MODEL_ROUNDS} 轮绝对安全上限，任务可能未完全完成。`
      callbacks.onFinalAnswerRender?.(finalContent)
      return {
        runId,
        content: finalContent,
        stopped: false,
        steps,
        toolCalls,
        changes,
        trace: recorder.all(),
      }
    } catch (error) {
      if (
        this.stopped
        || (error instanceof Error && error.message === 'USER_STOPPED')
        || isRequestAbortError(error)
      ) {
        // AbortController may surface an AbortError before the stream loop can throw
        // USER_STOPPED. Treat both paths as a normal stop and preserve what the
        // current model has already streamed to the user.
        finalContent = getSafeStoppedContent()
        finalizeInterruptedModelTrace('success', '模型响应已停止')
        callbacks.onStatus?.('stopped')
        if (finalContent) {
          callbacks.onFinalAnswerRender?.(finalContent)
        }
        return {
          runId,
          content: finalContent,
          stopped: true,
          steps,
          toolCalls,
          changes,
          trace: recorder.all(),
        }
      }

      callbacks.onStatus?.('failed')
      finalizeInterruptedModelTrace('error', '模型响应失败')
      const message = handleAIError(error, false) || (error instanceof Error ? error.message : String(error))
      const errorTrace = recorder.add({
        type: 'error',
        title: '执行失败',
        status: 'error',
        message,
      })
      callbacks.onTrace?.(errorTrace)
      throw new Error(message)
    }
  }
}
