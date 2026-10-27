import type { AgentTraceEvent } from '@/lib/agent/types'
import { parseChatUiRequest } from './catalog'
import type { ChatUiBlock } from './types'

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function requestSignature(input: unknown): string | undefined {
  try {
    return stableSerialize(parseChatUiRequest(input))
  } catch {
    return undefined
  }
}

/** Match current cards by their recorded IDs and older cards by validated request content. */
export function associateChatUiBlocks(
  events: AgentTraceEvent[],
  blocks: ChatUiBlock[],
): Map<string, ChatUiBlock[]> {
  const associations = new Map<string, ChatUiBlock[]>()
  const candidates = events.filter(event => event.toolName === 'show_ui'
    && (event.type === 'tool_call' || event.type === 'tool_result'))
  const matched = new Set<ChatUiBlock>()
  const usedEvents = new Set<string>()
  const sameRun = (event: AgentTraceEvent, block: ChatUiBlock) => event.runId === block.runId || event.runId === 'live'
  const associate = (event: AgentTraceEvent, block: ChatUiBlock) => {
    const attached = associations.get(event.id) ?? []
    attached.push(block)
    associations.set(event.id, attached)
    matched.add(block)
    usedEvents.add(event.id)
  }

  // Reserve exact matches first so legacy matching cannot consume a newer card's step.
  for (const block of blocks) {
    const traceMatch = block.traceEventId
      ? candidates.find(event => event.id === block.traceEventId && sameRun(event, block))
      : undefined
    const toolMatch = !traceMatch && block.toolCallId
      ? candidates.find(event => event.id === block.toolCallId && sameRun(event, block))
      : undefined
    const event = traceMatch ?? toolMatch
    if (event) associate(event, block)
  }

  const legacyCandidates = candidates.map(event => ({
    event,
    signature: requestSignature(event.input),
  }))
  const remaining = blocks.filter(block => !matched.has(block))
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const block of remaining) {
    const signature = requestSignature(block)
    if (!signature) continue
    let nearest: AgentTraceEvent | undefined
    for (const candidate of legacyCandidates) {
      const event = candidate.event
      if (usedEvents.has(event.id) || !sameRun(event, block)
        || (event.status === 'error' && block.status !== 'cancelled')
        || !Number.isFinite(event.timestamp) || event.timestamp > block.createdAt
        || candidate.signature !== signature) continue
      // Keep the original order for ties: consecutive display calls can share a millisecond.
      if (!nearest || event.timestamp > nearest.timestamp) nearest = event
    }
    if (nearest) associate(nearest, block)
  }

  for (const attached of associations.values()) attached.sort((left, right) => left.createdAt - right.createdAt)
  return associations
}
