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
  return message.includes('远程文件不存在') || message.includes('远程路径指向的是目录')
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
