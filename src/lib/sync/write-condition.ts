/** null means create-only; a version means replace/delete exactly that version. */
export interface RemoteWriteCondition { version: string | null }

export function conditionalHeaders(condition?: RemoteWriteCondition): Record<string, string> {
  if (!condition) return {}
  if (condition.version === null) return { 'If-None-Match': '*' }
  const version = condition.version.trim()
  if (!version || /^W\//i.test(version) || version.startsWith('uploaded:') || /[\r\n]/.test(version)) {
    throw new Error('SYNC_SWITCH_CONDITIONAL_UNSUPPORTED')
  }
  return { 'If-Match': version.startsWith('"') ? version : `"${version}"` }
}

export function assertConditionalResponse(response: Response, condition?: RemoteWriteCondition) {
  if (!condition || response.ok) return
  if ([404, 409, 412, 422].includes(response.status)) throw new Error('SYNC_SWITCH_STALE')
  // Never retry a rejected conditional mutation without its condition.
  throw new Error(`Conditional remote write failed: HTTP ${response.status}`)
}
