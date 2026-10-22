import { redactSensitiveText } from '@/lib/diagnostics/runtime-log-buffer'
import { isSyncStaleError, readSyncStaleDetails, syncStaleError, type SyncStaleVersion } from './sync-stale-error'

function encodePath(path: string) {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

export function debugSyncPath(_scope: string, _payload: Record<string, unknown>) {
  void _scope
  void _payload
  // Sync diagnostics are intentionally quiet in normal builds.
}

export function debugSyncPerf(_scope: string, _payload: Record<string, unknown>) {
  void _scope
  void _payload
  // Sync diagnostics are intentionally quiet in normal builds.
}

export function buildRemoteLogicalPath(options: {
  path?: string
  filename?: string
  preserveWhitespace?: boolean
}) {
  const { path, filename } = options
  const normalizedPath = path?.replace(/^\/+|\/+$/g, '') || ''
  const normalizedFilename = filename || ''

  if (!normalizedPath) {
    return normalizedFilename
  }

  if (!normalizedFilename) {
    return normalizedPath
  }

  const segments = normalizedPath
    .split('/')
    .filter(Boolean)
  if (segments[segments.length - 1] !== normalizedFilename) {
    segments.push(normalizedFilename)
  }

  return segments.join('/')
}

export function buildRepoContentPath(options: {
  path?: string
  filename?: string
  preserveWhitespace?: boolean
}) {
  const logicalPath = buildRemoteLogicalPath(options)
  const encodedPath = encodePath(logicalPath)

  return encodedPath
}

export function buildRepoContentsEndpoint(path?: string) {
  if (!path) {
    return '/contents'
  }

  return `/contents/${path.replace(/^\/+/, '')}`
}

type RemoteDirectoryEntry = {
  type?: string
  name?: string
  path?: string
  sha?: string
}

function isFileEntry(entry: RemoteDirectoryEntry) {
  return entry.type === 'file' || entry.type === 'blob'
}

export function pickNestedFileEntry(entries: RemoteDirectoryEntry[], requestedPath: string) {
  const files = entries.filter(entry => isFileEntry(entry) && typeof entry.path === 'string')
  if (files.length === 0) {
    return null
  }

  const normalizedRequestedPath = requestedPath.replace(/^\/+|\/+$/g, '')
  const expectedName = normalizedRequestedPath.split('/').filter(Boolean).pop()
  const pathMatch = files.find(entry => entry.path === normalizedRequestedPath)
  if (pathMatch) {
    return pathMatch
  }

  if (expectedName) {
    const namedMatch = files.find(entry => entry.name === expectedName)
    if (namedMatch) {
      return namedMatch
    }
  }

  return files.length === 1 ? files[0] : null
}

export function getRemoteFileContent(file: unknown, path: string) {
  if (!file) {
    throw new Error(`远程文件不存在: ${path}`)
  }

  if (Array.isArray(file)) {
    throw new Error(`远程路径指向的是目录，不是文件: ${path}`)
  }

  const content = (file as { content?: unknown }).content
  if (typeof content !== 'string') {
    throw new Error(`远程文件内容格式无效: ${path}`)
  }

  return content
}

export function isMissingRemoteFileError(message: string) {
  return message.includes('远程文件不存在')
}

export function hasEmptyRemoteFileContent(file: unknown) {
  if (typeof file !== 'object' || file === null || Array.isArray(file)) {
    return false
  }

  const content = (file as { content?: unknown }).content
  return typeof content === 'string' && content.trim().length === 0
}

export function decodeBase64ToString(content: unknown) {
  return new TextDecoder().decode(decodeBase64ToBytes(content))
}

export function decodeBase64ToBytes(content: unknown): Uint8Array {
  if (typeof content !== 'string') {
    throw new Error('远程文件内容不是有效的 Base64 字符串')
  }

  const normalized = content.replace(/\s+/g, '')
  if (!normalized) {
    return new Uint8Array()
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error('远程文件内容不是有效的 Base64 字符串')
  }

  return new Uint8Array(Buffer.from(normalized, 'base64'))
}

export function encodeRemoteFileContent(content: string | Uint8Array): string {
  return typeof content === 'string'
    ? Buffer.from(content, 'utf-8').toString('base64')
    : Buffer.from(content).toString('base64')
}

// Missing files are represented by null by the transport. Present but empty or
// malformed snapshots must never become an authoritative empty collection.
export function syncDataError(kind: 'EMPTY_JSON' | 'INVALID_JSON' | 'INVALID_SCHEMA', path: string) {
  return new Error(`SYNC_DATA_${kind}: ${path}`)
}

export function parseSyncJson<T>(content: string, path: string, shape?: 'array' | 'object'): T {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!normalized.trim()) throw syncDataError('EMPTY_JSON', path)
  let parsed: unknown
  try { parsed = JSON.parse(normalized) }
  catch { throw syncDataError('INVALID_JSON', path) }
  if ((shape === 'array' && !Array.isArray(parsed))
    || (shape === 'object' && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)))) {
    throw syncDataError('INVALID_SCHEMA', path)
  }
  return parsed as T
}

export function sanitizeSyncErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message
      : String(error)
  const details = readSyncStaleDetails(message)
  if (details) return syncStaleError(details).message
  if (message.includes('\n')) return message.split('\n').map(line => sanitizeSyncErrorMessage(line)).join('\n')
  return redactSensitiveText(message)
}

export function formatSyncDataError(message: string, translate: (key: string, values: { path: string }) => string): string {
  message = sanitizeSyncErrorMessage(message)
  if (message.includes('\n')) return message.split('\n').map(line => formatSyncDataError(line, translate)).join('\n')
  const giteeRequest = /^SYNC_GITEE_(CONNECTION|REQUEST)_FAILED: ([^\n]+)$/.exec(message)
  if (giteeRequest) return translate(giteeRequest[1] === 'CONNECTION' ? 'giteeConnectionFailed' : 'giteeRequestFailed', { path: giteeRequest[2] })
  // Old recovery records may contain native errors with credentials in URLs.
  if (/error sending request for url/i.test(message)) {
    const giteeUrl = /https:\/\/gitee\.com\/[^\s)]*/i.exec(message)
    if (giteeUrl) {
      try {
        const url = new URL(giteeUrl[0])
        return translate('giteeConnectionFailed', { path: `${url.origin}${url.pathname}` })
      } catch { /* Keep the sanitized original error if the URL is malformed. */ }
    }
  }
  if (message.includes('SYNC_ONEDRIVE_UPLOAD_CONNECTION')) return translate('oneDriveUploadConnection', { path: '' })
  if (message.includes('SYNC_ONEDRIVE_UPLOAD_PENDING')) return translate('oneDriveUploadPending', { path: '' })
  if (isSyncStaleError(message)) {
    const details = readSyncStaleDetails(message)
    const summary = details?.check === 'unindexed'
      ? translate('unindexedItemConflict', { path: details.path || '' })
      : translate('stale', { path: '' })
    if (!details) return summary
    const label = (key: string, path = '') => translate(`staleDetails.${key}`, { path })
    const unknown = label('unknown')
    const version = (value: SyncStaleVersion | undefined) => [
      ...(typeof value?.exists === 'boolean' ? [label(value.exists ? 'present' : 'absent')] : []),
      // Non-Git providers may use opaque ETags instead of object hashes.
      label(value?.sha && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.sha) ? 'version' : 'sha', value?.sha ?? unknown),
      label('size', value?.size != null ? `${value.size} B` : unknown),
    ].join(' · ')
    return [
      summary,
      label('stage', [label(`stages.${details.stage}`), ...(details.source ? [label(`source.${details.source}`)] : [])].join(' / ')),
      label('file', details.path || label('unspecifiedPath')),
      ...(details.check ? [label('check', label(`checks.${details.check === 'unindexed' ? 'content' : details.check}`))] : []),
      label('expected', version(details.expected)),
      label('actual', version(details.actual)),
    ].join('\n')
  }
  if (message === 'SYNC_SWITCH_CONDITIONAL_UNSUPPORTED') return translate('conditionalUnsupported', { path: '' })
  if (message === 'SYNC_SWITCH_RECOVERY_CHANGED') return translate('recoveryChanged', { path: '' })
  // This guard only exists in older bundles and saved recovery markers. Keep
  // the error visible, with instructions that can reach the Git upload path.
  const legacyEmptyUpload = /^SYNC_SWITCH_EMPTY_UPLOAD_UNSUPPORTED: ([^\n]+)$/.exec(message)
  if (legacyEmptyUpload) return translate('emptyUploadUnsupported', { path: legacyEmptyUpload[1] })
  const localModule = /^SYNC_SWITCH_LOCAL_VERIFY: (records|tags|canvases|conversations|settings|memories)(?: \/ ([^\n]+))?$/.exec(message)
  if (localModule) {
    const moduleLabel = translate(`modules.${localModule[1]}`, { path: '' })
    return translate('localVerificationFailed', { path: localModule[2] ? `${moduleLabel} / ${localModule[2]}` : moduleLabel })
  }
  const match = message.match(/SYNC_(?:DATA|SWITCH)_(EMPTY_JSON|INVALID_JSON|INVALID_SCHEMA): ([^\n]+)/)
  if (!match) return message
  const key = match[1] === 'EMPTY_JSON' ? 'emptyJsonFile' : match[1] === 'INVALID_JSON' ? 'invalidJsonFile' : 'invalidSchemaFile'
  return translate(key, { path: match[2] })
}

// Keep the native Response.json contract for existing provider result types,
// while reporting malformed API bodies through the shared error vocabulary.
export async function readSyncResponseJson(response: Response, path: string): ReturnType<Response['json']> {
  const value = parseSyncJson<unknown>(await response.text(), path)
  if (value === null || typeof value !== 'object') throw syncDataError('INVALID_SCHEMA', path)
  return value
}
