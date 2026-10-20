export interface AgentDebugEntry {
  timestamp: string
  event: string
  payload?: unknown
}

declare global {
  interface Window {
    __NOTEGEN_AGENT_DEBUG_LOGS__?: AgentDebugEntry[]
    __NOTEGEN_AGENT_DEBUG_DUMP__?: () => string
    __NOTEGEN_AGENT_DEBUG_CLEAR__?: () => void
  }
}

const MAX_LOGS = 300
const MAX_STRING_LENGTH = 1200
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 30

function isDebugEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage?.getItem('notegen.agent.debug') === 'true'
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[MaxDepth]'
  }

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}... [truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`)
    }
    return items
  }

  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)
  const sanitized: Record<string, unknown> = {}

  for (const [key, entryValue] of entries) {
    sanitized[key] = sanitizeValue(entryValue, depth + 1)
  }

  const totalKeys = Object.keys(value as Record<string, unknown>).length
  if (totalKeys > MAX_OBJECT_KEYS) {
    sanitized.__truncatedKeys = totalKeys - MAX_OBJECT_KEYS
  }

  return sanitized
}

function ensureDebugBuffer() {
  window.__NOTEGEN_AGENT_DEBUG_LOGS__ ||= []
  window.__NOTEGEN_AGENT_DEBUG_DUMP__ = () =>
    JSON.stringify(window.__NOTEGEN_AGENT_DEBUG_LOGS__ || [], null, 2)
  window.__NOTEGEN_AGENT_DEBUG_CLEAR__ = () => {
    window.__NOTEGEN_AGENT_DEBUG_LOGS__ = []
  }
  return window.__NOTEGEN_AGENT_DEBUG_LOGS__
}

export function agentDebugLog(event: string, payload?: unknown) {
  if (!isDebugEnabled()) {
    return
  }

  const entry: AgentDebugEntry = {
    timestamp: new Date().toISOString(),
    event,
    payload: sanitizeValue(payload),
  }

  const logs = ensureDebugBuffer()
  logs.push(entry)
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS)
  }
}

export function previewText(value: unknown, maxLength = 240) {
  if (typeof value !== 'string') {
    return ''
  }

  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized
}
