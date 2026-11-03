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
let persistTimer: ReturnType<typeof setTimeout> | undefined
let persistQueue: Promise<void> = Promise.resolve()

export function isAgentDebugEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  const setting = window.localStorage?.getItem('notegen.agent.debug')
  return setting === 'true' || (setting !== 'false' && process.env.NODE_ENV === 'development')
}

function scheduleDebugLogSave() {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window) || persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = undefined
    const entries = [...(window.__NOTEGEN_AGENT_DEBUG_LOGS__ || [])]
    persistQueue = persistQueue.then(async () => {
      const { Store } = await import('@tauri-apps/plugin-store')
      const store = await Store.load('agent_debug_logs.json', { autoSave: false })
      await store.set('entries', entries)
      await store.save()
    }).catch(error => console.warn('Failed to persist Agent debug logs:', error))
  }, 500)
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
    scheduleDebugLogSave()
  }
  return window.__NOTEGEN_AGENT_DEBUG_LOGS__
}

export function agentDebugLog(event: string, payload?: unknown) {
  if (!isAgentDebugEnabled()) {
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
  scheduleDebugLogSave()
}

// Ordinary log fields are capped at 1,200 characters. Split document context
// into smaller entries so the end of a note remains available for diagnosis.
export function agentDebugText(
  event: string,
  content: string,
  metadata: Record<string, unknown> = {}
) {
  if (!isAgentDebugEnabled()) return

  const chunkSize = 1000
  const maxChunks = 64
  const totalChunks = Math.ceil(content.length / chunkSize)
  const indexes = Array.from({ length: Math.min(totalChunks, maxChunks) }, (_, index) => (
    totalChunks > maxChunks && index >= maxChunks / 2
      ? totalChunks - maxChunks + index
      : index
  ))

  agentDebugLog(event, {
    ...metadata,
    charCount: content.length,
    totalChunks,
    loggedChunks: indexes.length,
    omittedChunks: totalChunks - indexes.length,
  })
  for (const index of indexes) {
    agentDebugLog(`${event}_chunk`, {
      ...metadata,
      chunkIndex: index,
      offset: index * chunkSize,
      content: content.slice(index * chunkSize, (index + 1) * chunkSize),
    })
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

if (isAgentDebugEnabled()) {
  agentDebugLog('debug_logging_ready', { localFile: 'agent_debug_logs.json' })
}
