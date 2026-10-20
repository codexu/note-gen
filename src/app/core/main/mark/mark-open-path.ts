import type { Mark } from '@/db/marks'

interface MarkOpenTargets {
  filePath: string | null
  folderPath: string | null
}

export interface MarkOpenAction {
  mode: 'open' | 'reveal'
  path: string | null
}

const HTTP_URL_PATTERN = /^https?:\/\//i
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-zA-Z]:[\\/]+/

function isHttpUrl(path: string): boolean {
  return HTTP_URL_PATTERN.test(path)
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function trimTrailingSlash(path: string): string {
  return normalizePath(path).replace(/\/+$/, '')
}

function joinPath(base: string, segment: string): string {
  const normalizedBase = trimTrailingSlash(base)
  const normalizedSegment = segment.replace(/^[/\\]+/, '')

  if (!normalizedSegment) {
    return normalizedBase
  }

  return `${normalizedBase}/${normalizedSegment}`
}

function dirname(path: string): string {
  const normalizedPath = normalizePath(path).replace(/\/+$/, '')
  const slashIndex = normalizedPath.lastIndexOf('/')

  if (slashIndex <= 0) {
    return slashIndex === 0 ? '/' : ''
  }

  return normalizedPath.slice(0, slashIndex)
}

function basename(path: string): string {
  const normalizedPath = normalizePath(path).replace(/\/+$/, '')
  const slashIndex = normalizedPath.lastIndexOf('/')

  return slashIndex === -1 ? normalizedPath : normalizedPath.slice(slashIndex + 1)
}

export function canOpenMarkSource(mark: Pick<Mark, 'type' | 'url'>): boolean {
  if (!mark.url) {
    return false
  }

  if (mark.type === 'image' || mark.type === 'scan' || mark.type === 'recording') {
    return !isHttpUrl(mark.url)
  }

  if (mark.type === 'file') {
    return !isHttpUrl(mark.url) && isAbsoluteFilePath(mark.url)
  }

  return false
}

export function getMarkOpenTargets(mark: Pick<Mark, 'type' | 'url'>, appDir: string): MarkOpenTargets {
  if (!canOpenMarkSource(mark)) {
    return {
      filePath: null,
      folderPath: null,
    }
  }

  if (mark.type === 'image' || mark.type === 'scan') {
    const folderName = mark.type === 'scan' ? 'screenshot' : 'image'
    const folderPath = joinPath(appDir, folderName)
    const fileName = basename(mark.url)

    return {
      folderPath,
      filePath: fileName ? joinPath(folderPath, fileName) : null,
    }
  }

  if (mark.type === 'recording') {
    if (isHttpUrl(mark.url)) {
      return {
        filePath: null,
        folderPath: null,
      }
    }

    const relativePath = mark.url.replace(/^[/\\]+/, '')
    const folderName = dirname(relativePath)

    return {
      filePath: joinPath(appDir, relativePath),
      folderPath: folderName ? joinPath(appDir, folderName) : trimTrailingSlash(appDir),
    }
  }

  if (mark.type === 'file') {
    const normalizedFilePath = normalizePath(mark.url)
    const folderPath = dirname(normalizedFilePath)

    return {
      filePath: normalizedFilePath,
      folderPath: folderPath || null,
    }
  }

  return {
    filePath: null,
    folderPath: null,
  }
}

export function getMarkOpenAction(
  mark: Pick<Mark, 'type' | 'url'>,
  appDir: string,
  target: 'folder' | 'file',
): MarkOpenAction | null {
  const { filePath, folderPath } = getMarkOpenTargets(mark, appDir)

  if (target === 'file') {
    return filePath ? { mode: 'open', path: filePath } : null
  }

  if (filePath) {
    return { mode: 'reveal', path: filePath }
  }

  return folderPath ? { mode: 'open', path: folderPath } : null
}
