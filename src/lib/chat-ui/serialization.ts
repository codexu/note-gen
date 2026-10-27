import { getChatUiFields, parseChatUiRequest, validateChatUiValues } from './catalog'
import type { Spec } from '@json-render/core'
import { getChatResponseText } from './response-catalog'
import type { ChatUiBlock } from './types'

export interface ChatResponseCompletion {
  runId: string
  toolCallId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Only a completed run's last final event can publish a structured response. */
export function getChatResponseCompletion(input: unknown): ChatResponseCompletion | undefined {
  let history: unknown = input
  if (typeof history === 'string') {
    try { history = JSON.parse(history) as unknown } catch { return undefined }
  }
  if (!isRecord(history) || history.status !== 'completed' || typeof history.runId !== 'string'
    || !history.runId || !Array.isArray(history.traceEvents)) return undefined
  const final = history.traceEvents.findLast((event: unknown) => isRecord(event) && event.type === 'final')
  if (!isRecord(final) || final.runId !== history.runId || final.status !== 'success'
    || !isRecord(final.output) || final.output.format !== 'json-render'
    || typeof final.output.toolCallId !== 'string' || !final.output.toolCallId) return undefined
  return { runId: history.runId, toolCallId: final.output.toolCallId }
}

export function parseChatUiBlocks(raw?: string | null): ChatUiBlock[] {
  if (!raw || raw.length > 1_000_000) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length > 20) return []
    return parsed.flatMap((item: unknown): ChatUiBlock[] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return []
      const block = item as Record<string, unknown>
      if (block.version !== 1 || typeof block.id !== 'string' || !block.id || typeof block.runId !== 'string' || !block.runId || typeof block.createdAt !== 'number' || !Number.isFinite(block.createdAt)) return []
      if (!['displayed', 'pending', 'submitted', 'cancelled'].includes(String(block.status))) return []
      try {
        const request = parseChatUiRequest(block)
        const state = validateChatUiValues(request.spec, block.state, false)
        const submitted = block.status === 'submitted' ? validateChatUiValues(request.spec, block.submittedValues) : undefined
        if (!state.success || (submitted && !submitted.success)) return []
        return [{
          ...request, version: 1, id: block.id, runId: block.runId,
          traceEventId: typeof block.traceEventId === 'string' && block.traceEventId ? block.traceEventId : undefined,
          toolCallId: typeof block.toolCallId === 'string' && block.toolCallId ? block.toolCallId : undefined,
          workspaceIdentity: typeof block.workspaceIdentity === 'string' ? block.workspaceIdentity : undefined,
          workspaceFingerprint: typeof block.workspaceFingerprint === 'string' && /^[a-f0-9]{64}$/.test(block.workspaceFingerprint) ? block.workspaceFingerprint : undefined,
          status: block.status as ChatUiBlock['status'], state: state.values,
          submittedValues: submitted?.values, createdAt: block.createdAt,
        }]
      } catch { return [] }
    })
  } catch { return [] }
}

function getDisplayedUiText(spec: Spec): string {
  const parts: string[] = []
  const visited = new Set<string>()
  const append = (value: unknown) => { if (typeof value === 'string' && value.trim()) parts.push(value) }
  const visit = (id: string) => {
    if (visited.has(id)) return
    visited.add(id)
    const element = spec.elements[id]
    if (!element) return
    if (element.type === 'Card') {
      append(element.props.title)
      append(element.props.description)
    } else if (['Text', 'Markdown', 'Heading'].includes(element.type)) {
      append(element.props.text)
    }
    for (const child of element.children ?? []) visit(child)
  }
  visit(spec.root)
  return parts.join('\n')
}

export function getChatUiHistoryText(
  raw?: string | null,
  existingContent?: string | null,
  completion?: ChatResponseCompletion,
): string {
  const blocks = parseChatUiBlocks(raw)
  const publishedResponse = completion ? blocks.findLast(block => block.placement === 'response'
    && block.status === 'displayed' && block.runId === completion.runId && block.toolCallId === completion.toolCallId) : undefined
  const entryCount = blocks.reduce((count, block) => count + getChatUiFields(block.spec).length
    + (block.status === 'displayed' ? 1 : 0), 0)
  const valueLimit = Math.max(32, Math.min(2_000, Math.floor(32_000 / Math.max(1, entryCount))))
  const excerpt = (value: string, limit = valueLimit) => value.length <= limit ? value
    : `${value.slice(0, Math.floor(limit / 2))} [truncated ${value.length - limit} chars] ${value.slice(-Math.ceil(limit / 2))}`
  const summaries = blocks.flatMap((block): string[] => {
    if (block.placement === 'response') {
      if (block !== publishedResponse) return []
      const projected = getChatResponseText(block.spec)
      if (!projected.trim() || projected.trim() === existingContent?.trim()) return []
      return [`[NoteGen published response]\n${excerpt(projected, 32_000)}`]
    }
    const fields = getChatUiFields(block.spec)
    const answers = block.status === 'submitted'
      ? fields.map(field => `${field.label} (${field.name}): ${excerpt(JSON.stringify(block.submittedValues?.[field.name] ?? ''))}`).join('\n')
      : ''
    const displayed = block.status === 'displayed'
      ? [
          excerpt(getDisplayedUiText(block.spec)),
          ...fields.map(field => `${field.name}: ${excerpt(JSON.stringify(block.state[field.name] ?? ''))}`),
        ].filter(Boolean).join('\n')
      : ''
    return [`[NoteGen UI: ${block.title}; status=${block.status}]${answers ? `\nUser-submitted values:\n${answers}` : ''}${displayed ? `\nDisplayed information:\n${displayed}` : ''}`]
  })
  return summaries.join('\n\n')
}

/** Local runtime identity is never an authority on another synced device. */
export function sanitizeChatUiBlocksForSync(raw?: string | null): string | undefined {
  if (!raw || raw.length > 1_000_000) return undefined
  try {
    const blocks: unknown = JSON.parse(raw)
    if (!Array.isArray(blocks) || blocks.length > 20) return undefined
    // Preserve unsupported versions for newer clients; only remove local execution identity.
    return JSON.stringify(blocks.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value
      const block = { ...value } as Record<string, unknown>
      delete block.workspaceIdentity
      return block
    }))
  } catch { return undefined }
}
