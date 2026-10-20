const DEFAULT_WRITING_SESSION_WINDOW_MS = 30 * 60 * 1000

export function shouldCreateWritingSession(
  previousTimestamp: number | undefined,
  nextTimestamp: number,
  sessionWindowMs = DEFAULT_WRITING_SESSION_WINDOW_MS
) {
  if (!previousTimestamp) {
    return true
  }

  return nextTimestamp - previousTimestamp > sessionWindowMs
}

export function truncateActivityText(value: string | undefined, maxLength = 120) {
  if (!value) return ''

  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}...`
}
