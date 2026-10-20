export type RuntimeLogLevel = 'info' | 'warn' | 'error'

export interface RuntimeLogEntry {
  timestamp: string
  level: RuntimeLogLevel
  message: string
}

const MAX_RUNTIME_LOG_ENTRIES = 300
const MAX_LOG_MESSAGE_LENGTH = 2_000
const MAX_UNSTRUCTURED_TEXT_LENGTH = 800
const MAX_VALUE_DEPTH = 4
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 30
const runtimeLogs: RuntimeLogEntry[] = []
const runtimeLogListeners = new Set<(count: number) => void>()

const SENSITIVE_KEY_PATTERN = /authorization|cookie|token|password|passphrase|secret|api.?key|recovery.?key|private.?key|totp|credential/i
const IDENTIFIER_KEY_PATTERN = /account.?id|device.?id|workspace.?id|object.?id|profile.?id|local.?identity|logical.?key|file.?name|(?:^|_)path$/i
const CONTENT_KEY_PATTERN = /^(?:content|body|markdown|prompt|messages|note|document|selectedText)$/i

export function redactDiagnosticText(value: string): string {
  const redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/((?:access|refresh|api|auth)[_-]?token|password|passphrase|secret|cookie|authorization|(?:private|recovery)[_-]?key|credential|totp)(["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi, '$1$2<redacted>')
    .replace(/([?&](?:token|api[_-]?key|key|secret|password|code|authorization)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/[A-Z]:\\(?:[^\\\s]+\\)+[^\s"']*/gi, '<path>')
    .replace(/\/(?:Users|home|var|private|tmp)\/[^\s"']+(?:\/[^\s"']*)?/g, '<path>')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
  if (redacted.length > MAX_UNSTRUCTURED_TEXT_LENGTH) {
    return `${redacted.slice(0, MAX_UNSTRUCTURED_TEXT_LENGTH)}… [truncated ${redacted.length - MAX_UNSTRUCTURED_TEXT_LENGTH} chars]`
  }
  return redacted.slice(0, MAX_LOG_MESSAGE_LENGTH)
}

export function sanitizeDiagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_VALUE_DEPTH) return '[MaxDepth]'

  if (typeof value === 'string') return redactDiagnosticText(value)
  if (typeof value === 'bigint') return value.toString()
  if (typeof value !== 'object' || value === null) return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactDiagnosticText(value.message),
    }
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map(item => sanitizeDiagnosticValue(item, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[truncated ${value.length - MAX_ARRAY_ITEMS} items]`)
    return items
  }

  const source = value as Record<string, unknown>
  const entries = Object.entries(source).slice(0, MAX_OBJECT_KEYS)
  const sanitized: Record<string, unknown> = {}

  for (const [key, entryValue] of entries) {
    if (SENSITIVE_KEY_PATTERN.test(key) || IDENTIFIER_KEY_PATTERN.test(key) || CONTENT_KEY_PATTERN.test(key)) {
      sanitized[key] = entryValue == null ? entryValue : '<redacted>'
    } else {
      sanitized[key] = sanitizeDiagnosticValue(entryValue, depth + 1)
    }
  }

  const remainingKeys = Object.keys(source).length - entries.length
  if (remainingKeys > 0) sanitized.__truncatedKeys = remainingKeys
  return sanitized
}

function formatLogArgument(argument: unknown): string {
  if (typeof argument === 'string') return redactDiagnosticText(argument)
  try {
    return JSON.stringify(sanitizeDiagnosticValue(argument))
  } catch {
    return redactDiagnosticText(String(argument))
  }
}

export function recordRuntimeLog(level: RuntimeLogLevel, args: unknown[]): void {
  const message = redactDiagnosticText(args.map(formatLogArgument).join(' '))
  runtimeLogs.push({ timestamp: new Date().toISOString(), level, message })
  if (runtimeLogs.length > MAX_RUNTIME_LOG_ENTRIES) {
    runtimeLogs.splice(0, runtimeLogs.length - MAX_RUNTIME_LOG_ENTRIES)
  }
  runtimeLogListeners.forEach(listener => listener(runtimeLogs.length))
}

export function getRuntimeLogs(): RuntimeLogEntry[] {
  return runtimeLogs.map(entry => ({ ...entry }))
}

export function clearRuntimeLogs(): void {
  runtimeLogs.length = 0
  runtimeLogListeners.forEach(listener => listener(0))
}

export function subscribeRuntimeLogs(listener: (count: number) => void): () => void {
  runtimeLogListeners.add(listener)
  listener(runtimeLogs.length)
  return () => {
    runtimeLogListeners.delete(listener)
  }
}
