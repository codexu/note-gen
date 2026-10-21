import { redactSensitiveText } from '@/lib/diagnostics/runtime-log-buffer'

export interface SyncStaleVersion {
  sha?: string | null
  size?: number | null
  exists?: boolean
}

export interface SyncStaleDetails {
  stage: 'scan' | 'validate' | 'backup' | 'apply' | 'verify' | 'restore'
  path?: string
  source?: 'local' | 'remote'
  check?: 'content' | 'version' | 'size' | 'inventory' | 'configuration' | 'gitTree' | 'gitCommit' | 'gitRef' | 'fileType' | 'unindexed'
  expected?: SyncStaleVersion
  actual?: SyncStaleVersion
}

const code = 'SYNC_SWITCH_STALE'
const stages = new Set(['scan', 'validate', 'backup', 'apply', 'verify', 'restore'])
const checks = new Set(['content', 'version', 'size', 'inventory', 'configuration', 'gitTree', 'gitCommit', 'gitRef', 'fileType', 'unindexed'])

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message
    : typeof error === 'string' ? error
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : ''
}

export function isSyncStaleError(error: unknown) {
  const message = errorMessage(error)
  return message === code || message.startsWith(`${code}: `)
}

function versionDetails(value: unknown): SyncStaleVersion | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const item = value as Record<string, unknown>
  return {
    ...(typeof item.sha === 'string' ? { sha: redactSensitiveText(item.sha) } : item.sha === null ? { sha: null } : {}),
    ...(typeof item.size === 'number' && Number.isSafeInteger(item.size) && item.size >= 0 ? { size: item.size } : item.size === null ? { size: null } : {}),
    ...(typeof item.exists === 'boolean' ? { exists: item.exists } : {}),
  }
}

/** A single-line payload survives recovery persistence and sync error aggregation. */
export function readSyncStaleDetails(error: unknown): SyncStaleDetails | null {
  const message = errorMessage(error)
  if (!message.startsWith(`${code}: `)) return null
  try {
    const value: unknown = JSON.parse(message.slice(code.length + 2))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (typeof item.stage !== 'string' || !stages.has(item.stage)) return null
    return {
      stage: item.stage as SyncStaleDetails['stage'],
      ...(typeof item.path === 'string' ? { path: redactSensitiveText(item.path) } : {}),
      ...(item.source === 'local' || item.source === 'remote' ? { source: item.source } : {}),
      ...(typeof item.check === 'string' && checks.has(item.check) ? { check: item.check as SyncStaleDetails['check'] } : {}),
      expected: versionDetails(item.expected), actual: versionDetails(item.actual),
    }
  } catch { return null }
}

export function syncStaleError(details: SyncStaleDetails): Error {
  // Keep only diagnostic fields, never arbitrary response bodies/configuration.
  const safe = readSyncStaleDetails(`${code}: ${JSON.stringify(details)}`)
  return new Error(safe ? `${code}: ${JSON.stringify(safe)}` : code)
}

/** Add caller context without replacing more specific transport observations. */
export function withSyncStaleContext(error: unknown, context: SyncStaleDetails, useContextStage = false): unknown {
  if (!isSyncStaleError(error)) return error
  const details = readSyncStaleDetails(error)
  if (!details) return syncStaleError(context)
  return syncStaleError({
    ...context, ...details,
    ...(useContextStage ? { stage: context.stage } : {}),
    // A lower layer may describe a tree/ref rather than the caller's file.
    // Keep each observation together instead of mixing sizes and object IDs.
    expected: details.expected,
    actual: details.actual,
  })
}
