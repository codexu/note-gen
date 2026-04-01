function normalizeSegment(segment: string, preserveWhitespace = false) {
  return preserveWhitespace ? segment : segment.replace(/\s/g, '_')
}

function encodePath(path: string, preserveWhitespace = false) {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(normalizeSegment(segment, preserveWhitespace)))
    .join('/')
}

export function buildRepoContentPath({
  path,
  filename,
  preserveWhitespace = false,
}: {
  path?: string
  filename?: string
  preserveWhitespace?: boolean
}) {
  const normalizedPath = path?.replace(/^\/+|\/+$/g, '') || ''
  const normalizedFilename = filename ? normalizeSegment(filename, preserveWhitespace) : ''

  if (!normalizedPath) {
    return normalizedFilename ? encodePath(normalizedFilename, preserveWhitespace) : ''
  }

  if (!normalizedFilename) {
    return encodePath(normalizedPath, preserveWhitespace)
  }

  const segments = normalizedPath
    .split('/')
    .filter(Boolean)
    .map(segment => normalizeSegment(segment, preserveWhitespace))
  if (segments[segments.length - 1] !== normalizedFilename) {
    segments.push(normalizedFilename)
  }

  return segments.map(encodeURIComponent).join('/')
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

export function pickNestedFileEntry(entries: RemoteDirectoryEntry[], requestedPath: string) {
  const files = entries.filter(entry => entry.type === 'file' && typeof entry.path === 'string')
  if (files.length === 0) {
    return null
  }

  const expectedName = requestedPath.split('/').filter(Boolean).pop()?.replace(/\s/g, '_')
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

export function decodeBase64ToString(content: unknown) {
  if (typeof content !== 'string') {
    throw new Error('远程文件内容不是有效的 Base64 字符串')
  }

  const normalized = content.replace(/\s+/g, '')
  if (!normalized) {
    return ''
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    throw new Error('远程文件内容不是有效的 Base64 字符串')
  }

  return Buffer.from(normalized, 'base64').toString('utf-8')
}
