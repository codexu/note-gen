import type { Chat } from '@/db/chats'
import type { AgentChange, ToolCall, ToolResult } from '@/lib/agent/types'

export interface ResultEvidence {
  changes: AgentChange[]
  toolCalls: ToolCall[]
  workspaceFingerprint?: string
}

export type ResultOperationStatus = 'success' | 'failed' | 'running' | 'pending' | 'unknown'
export type ResultNoteOperation = 'created' | 'updated' | 'deleted' | 'renamed' | 'moved' | 'copied' | 'changed'

const changeTypes = new Set(['editor', 'file', 'tag', 'mark', 'memory', 'chat', 'folder', 'canvas'])
const callStatuses = new Set(['pending', 'running', 'success', 'error'])
const presentationTools = new Set(['show_ui', 'show_result', 'render_response', 'ask_user_question'])
const businessWriteTools = new Set([
  'editor_insert_at_cursor', 'editor_replace_range', 'editor_replace_lines', 'editor_apply_transaction',
  'note_create_file', 'note_update_file', 'note_delete_file', 'note_rename_file', 'note_move_file', 'note_copy_file',
  'folder_create', 'folder_delete', 'tag_create', 'tag_update', 'tag_delete',
  'mark_create', 'mark_update', 'mark_delete', 'memory_create', 'memory_delete', 'memory_clear_all',
])
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const optionalString = (value: unknown) => typeof value === 'string' ? value : undefined

function readChanges(input: unknown): AgentChange[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((value: unknown): AgentChange[] => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id
      || !changeTypes.has(String(value.type)) || typeof value.target !== 'string' || !value.target) return []
    return [{
      id: value.id,
      type: value.type as AgentChange['type'],
      target: value.target,
      before: optionalString(value.before),
      after: optionalString(value.after),
      reversible: value.reversible === true,
      summary: optionalString(value.summary),
    }]
  })
}

function readToolCalls(input: unknown): ToolCall[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((value: unknown): ToolCall[] => {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id
      || typeof value.toolName !== 'string' || !callStatuses.has(String(value.status))) return []
    const rawResult = isRecord(value.result) ? value.result : undefined
    let result: ToolResult | undefined
    if (rawResult && (typeof rawResult.success === 'boolean' || typeof rawResult.ok === 'boolean')) {
      result = {
        success: typeof rawResult.success === 'boolean' ? rawResult.success : rawResult.ok === true,
        message: optionalString(rawResult.message),
        error: optionalString(rawResult.error),
        changes: readChanges(rawResult.changes),
      }
    }
    return [{
      id: value.id,
      toolName: value.toolName,
      params: isRecord(value.params) ? value.params : {},
      status: value.status as ToolCall['status'],
      timestamp: typeof value.timestamp === 'number' && Number.isFinite(value.timestamp) ? value.timestamp : 0,
      result,
    }]
  })
}

export function getChatResultEvidence(
  chat: Pick<Chat, 'agentHistory'>,
  live?: { changes?: AgentChange[]; toolCalls?: ToolCall[] },
): ResultEvidence {
  let history: Record<string, unknown> = {}
  if (chat.agentHistory) {
    try {
      const parsed: unknown = JSON.parse(chat.agentHistory)
      if (isRecord(parsed)) history = parsed
    } catch {
      // Ordinary chat messages and old histories may have no structured evidence.
    }
  }
  const toolCalls = new Map<string, ToolCall>()
  for (const call of [...readToolCalls(history.toolCalls), ...readToolCalls(live?.toolCalls)]) toolCalls.set(call.id, call)
  const changes = new Map<string, AgentChange>()
  for (const change of [
    ...readChanges(history.changes),
    ...readChanges(live?.changes),
    ...Array.from(toolCalls.values()).flatMap(call => call.result?.changes ?? []),
  ]) changes.set(change.id, change)
  const fingerprint = optionalString(history.workspaceFingerprint)
  return {
    changes: Array.from(changes.values()), toolCalls: Array.from(toolCalls.values()),
    workspaceFingerprint: fingerprint && /^[a-f0-9]{64}$/i.test(fingerprint) ? fingerprint.toLowerCase() : undefined,
  }
}

export function getResultOperationStatus(call: ToolCall): ResultOperationStatus {
  if (call.result?.success === false || call.status === 'error') return 'failed'
  if (call.result?.success === true || call.status === 'success') return 'success'
  if (call.status === 'running' || call.status === 'pending') return call.status
  return 'unknown'
}

export function getResultNoteOperation(change: AgentChange, evidence: ResultEvidence): ResultNoteOperation {
  const source = evidence.toolCalls.find(call => call.result?.changes?.some(item => item.id === change.id))
  const operations: Record<string, ResultNoteOperation> = {
    note_create_file: 'created', note_update_file: 'updated', note_delete_file: 'deleted',
    note_rename_file: 'renamed', note_move_file: 'moved', note_copy_file: 'copied',
  }
  if (source && Object.hasOwn(operations, source.toolName)) return operations[source.toolName]
  if (change.summary?.startsWith('删除文件 ')) return 'deleted'
  if (change.type === 'editor') return 'updated'
  if (change.after === undefined && change.before !== undefined) return 'deleted'
  if (change.before === undefined && change.after !== undefined) return 'created'
  return 'changed'
}

export function isFailedResultOperation(call: ToolCall): boolean {
  if (presentationTools.has(call.toolName) || getResultOperationStatus(call) !== 'failed') return false
  // These records describe requests stopped before execution, rather than failed outcomes.
  return !/^(?:BLOCKED_|USER_DENIED|USER_CANCELLED|CANCELLED_|INVALID_TOOL_|SKILL_NOT_LOADED|REPEATED_FAILED_MUTATION_BLOCKED|WORKSPACE_CHANGED|USER_STOPPED)|SUPERSEDED/.test(call.result?.error ?? '')
}

function getQuestionAnswerHistory(chat: Pick<Chat, 'agentHistory'>): string[] {
  if (!chat.agentHistory) return []
  try {
    const history: unknown = JSON.parse(chat.agentHistory)
    if (!isRecord(history) || !Array.isArray(history.toolCalls)) return []
    return history.toolCalls.flatMap((value: unknown): string[] => {
      if (!isRecord(value) || value.toolName !== 'ask_user_question' || !isRecord(value.result)
        || value.result.success !== true || !isRecord(value.result.data) || !isRecord(value.params)) return []
      const answers: unknown = value.result.data.answers
      const questions: unknown = value.params.questions
      if (!Array.isArray(answers) || answers.length < 1 || answers.length > 4
        || !Array.isArray(questions) || questions.length !== answers.length) return []
      const lines: string[] = []
      for (const [index, answer] of answers.entries()) {
        const question: unknown = questions[index]
        if (!isRecord(answer) || !isRecord(question)
          || typeof answer.question !== 'string' || !answer.question.trim() || answer.question.length > 1_000
          || typeof question.question !== 'string' || question.question.trim() !== answer.question
          || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6
          || !Array.isArray(answer.selected) || answer.selected.length < 1 || answer.selected.length > 6
          || (question.multiSelect !== true && answer.selected.length !== 1)) return []
        const labels = question.options.flatMap((option: unknown): string[] => isRecord(option)
          && typeof option.label === 'string' && Boolean(option.label.trim()) && option.label.length <= 200
          ? [option.label.trim()] : [])
        if (labels.length !== question.options.length || new Set(labels).size !== labels.length
          || answer.selected.some((selected: unknown) => typeof selected !== 'string' || !labels.includes(selected))
          || new Set(answer.selected).size !== answer.selected.length) return []
        lines.push(`User answer: question=${JSON.stringify(answer.question)}; selected=${JSON.stringify(answer.selected)}`)
      }
      return lines
    })
  } catch {
    return []
  }
}

function getReferencedOperationIds(raw?: string): Set<string> {
  const references = new Set<string>()
  if (!raw || raw.length > 1_000_000) return references
  try {
    const blocks: unknown = JSON.parse(raw)
    if (!Array.isArray(blocks) || blocks.length > 20) return references
    for (const block of blocks) {
      if (!isRecord(block) || block.version !== 1 || block.placement !== 'result'
        || block.mode !== 'display' || block.status !== 'displayed' || !isRecord(block.spec)
        || !isRecord(block.spec.elements)) continue
      for (const element of Object.values(block.spec.elements)) {
        if (isRecord(element) && element.type === 'OperationResult' && isRecord(element.props)
          && typeof element.props.toolCallId === 'string' && element.props.toolCallId.length <= 200) {
          references.add(element.props.toolCallId)
        }
      }
    }
  } catch {
    // Unsupported UI data must not add any outcome claims to model history.
  }
  return references
}

function isReadOperation(call: ToolCall): boolean {
  const nestedName: unknown = call.params.toolName
  return [call.toolName, typeof nestedName === 'string' ? nestedName : '']
    .some(name => /(?:^|_)(?:get|read|list|search|check|inspect|preview|query)(?:_|$)/i.test(name))
}

/** Semantic evidence for the next turn; never include stored before/after document bodies. */
export function getChatResultHistoryText(chat: Pick<Chat, 'agentHistory' | 'uiBlocks'>): string {
  const evidence = getChatResultEvidence(chat)
  const lines = evidence.changes.filter(change => change.type === 'file' || change.type === 'editor')
    .map(change => `Change ${change.id}: ${getResultNoteOperation(change, evidence)}; target=${JSON.stringify(change.target)}`)
  const referencedOperations = getReferencedOperationIds(chat.uiBlocks)
  for (const call of evidence.toolCalls) {
    if (presentationTools.has(call.toolName) || getResultOperationStatus(call) !== 'success'
      || !(businessWriteTools.has(call.toolName) || (referencedOperations.has(call.id) && !isReadOperation(call)))) continue
    const message = call.result?.message ?? ''
    const excerpt = message.length > 500 ? `${message.slice(0, 250)} [truncated] ${message.slice(-250)}` : message
    lines.push(`Tool ${call.id}: ${call.toolName}; status=success${excerpt ? `; ${excerpt}` : ''}`)
  }
  for (const call of evidence.toolCalls.filter(isFailedResultOperation)) {
    const detail = [call.result?.error, call.result?.message].filter(Boolean).join(': ')
    const excerpt = detail.length > 500 ? `${detail.slice(0, 250)} [truncated] ${detail.slice(-250)}` : detail
    const targets = ['filePath', 'filePaths', 'folderPath', 'targetFolderPath', 'newPath']
      .flatMap(key => {
        const value: unknown = call.params[key]
        if (typeof value === 'string') return [`${key}=${JSON.stringify(value)}`]
        if (Array.isArray(value) && value.every(item => typeof item === 'string')) return [`${key}=${JSON.stringify(value)}`]
        return []
      })
    lines.push(`Tool ${call.id}: ${call.toolName}; status=failed${targets.length ? `; ${targets.join('; ')}` : ''}${excerpt ? `; ${excerpt}` : ''}`)
  }
  const answers = getQuestionAnswerHistory(chat)
  return [
    lines.length ? `[NoteGen recorded task results]\n${lines.join('\n')}` : '',
    answers.length ? `[NoteGen user answers]\n${answers.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}
