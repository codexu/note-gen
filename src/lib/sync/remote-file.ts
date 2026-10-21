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

export function formatSyncDataError(message: string, translate: (key: string, values: { path: string }) => string) {
  if (message.includes('SYNC_ONEDRIVE_UPLOAD_CONNECTION')) return translate('oneDriveUploadConnection', { path: '' })
  if (message.includes('SYNC_ONEDRIVE_UPLOAD_PENDING')) return translate('oneDriveUploadPending', { path: '' })
  if (message === 'SYNC_SWITCH_STALE') return translate('stale', { path: '' })
  if (message === 'SYNC_SWITCH_CONDITIONAL_UNSUPPORTED') return translate('conditionalUnsupported', { path: '' })
  if (message === 'SYNC_SWITCH_RECOVERY_CHANGED') return translate('recoveryChanged', { path: '' })
  const emptyUpload = /^SYNC_SWITCH_EMPTY_UPLOAD_UNSUPPORTED: ([^\n]+)$/.exec(message)
  if (emptyUpload) return translate('emptyUploadUnsupported', { path: emptyUpload[1] })
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
