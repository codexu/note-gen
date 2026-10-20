import type { MarkdownFile } from '@/lib/files'

export interface MarkdownLinkInputContext {
  linkText: string
  targetText: string
  targetFrom: number
  cursor: number
}

export interface MarkdownFileLinkSuggestion extends MarkdownFile {
  href: string
  score: number
}

export interface MarkdownFolderLinkSuggestion {
  kind: 'folder'
  name: string
  href: string
}

export type MarkdownPathSuggestion =
  | (MarkdownFileLinkSuggestion & { kind: 'file' })
  | MarkdownFolderLinkSuggestion

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/')
}

function pathSegments(path: string): string[] {
  return normalizePath(path).split('/').filter(Boolean)
}

function encodeMarkdownPath(path: string): string {
  return path
    .split('/')
    .map(segment => segment === '..' || segment === '.' ? segment : encodeURIComponent(segment))
    .join('/')
}

export function createRelativeMarkdownHref(currentFilePath: string, targetFilePath: string): string {
  const currentSegments = pathSegments(currentFilePath)
  const targetSegments = pathSegments(targetFilePath)
  const currentDirectory = currentSegments.slice(0, -1)
  let commonLength = 0

  while (
    commonLength < currentDirectory.length
    && commonLength < targetSegments.length
    && currentDirectory[commonLength] === targetSegments[commonLength]
  ) {
    commonLength++
  }

  const relativeSegments = [
    ...new Array(currentDirectory.length - commonLength).fill('..'),
    ...targetSegments.slice(commonLength),
  ]

  return encodeMarkdownPath(relativeSegments.join('/') || targetSegments.at(-1) || '')
}

export function isMarkdownPathInput(targetText: string): boolean {
  return targetText.startsWith('.') || targetText.includes('/') || targetText.includes('\\')
}

function normalizePathBrowserInput(targetText: string): string {
  const normalized = safeDecodeURIComponent(targetText).replace(/\\/g, '/')
  if (normalized === '.' || normalized === '/' || normalized === './') return './'
  if (normalized.startsWith('/')) return `.${normalized}`
  return normalized
}

export function listMarkdownPathSuggestions(options: {
  files: MarkdownFile[]
  currentFilePath: string
  targetText: string
}): MarkdownPathSuggestion[] {
  const { files, currentFilePath, targetText } = options
  const normalizedCurrentPath = normalizePath(currentFilePath)
  const browserInput = normalizePathBrowserInput(targetText)
  const lastSlashIndex = browserInput.lastIndexOf('/')
  const directoryPrefix = lastSlashIndex >= 0 ? browserInput.slice(0, lastSlashIndex + 1) : ''
  const query = (lastSlashIndex >= 0 ? browserInput.slice(lastSlashIndex + 1) : browserInput).toLocaleLowerCase()
  const useDotPrefix = browserInput.startsWith('./')
  const folders = new Map<string, MarkdownFolderLinkSuggestion>()
  const suggestions: Array<MarkdownFileLinkSuggestion & { kind: 'file' }> = []

  files.forEach(file => {
    if (normalizePath(file.relativePath) === normalizedCurrentPath) return

    const relativeHref = createRelativeMarkdownHref(currentFilePath, file.relativePath)
    const href = useDotPrefix && !relativeHref.startsWith('.')
      ? `./${relativeHref}`
      : relativeHref
    const decodedHref = safeDecodeURIComponent(href)
    if (!decodedHref.startsWith(directoryPrefix)) return

    const remainder = decodedHref.slice(directoryPrefix.length)
    if (!remainder) return

    const slashIndex = remainder.indexOf('/')
    const childName = slashIndex >= 0 ? remainder.slice(0, slashIndex) : remainder
    if (query && !childName.toLocaleLowerCase().includes(query)) return

    if (slashIndex >= 0) {
      const folderHref = encodeMarkdownPath(`${directoryPrefix}${childName}/`)
      if (!folders.has(folderHref)) {
        folders.set(folderHref, {
          kind: 'folder',
          name: childName,
          href: folderHref,
        })
      }
      return
    }

    suggestions.push({
      ...file,
      kind: 'file',
      href,
      score: childName.toLocaleLowerCase().startsWith(query) ? 100 : 40,
    })
  })

  return [
    ...Array.from(folders.values()).sort((left, right) => left.name.localeCompare(right.name)),
    ...suggestions.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name)),
  ]
}

function compactSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[\s_\-./\\]+/g, '')
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex++
    if (queryIndex === query.length) return true
  }
  return query.length === 0
}

function scoreFile(file: MarkdownFile, query: string, recentPaths: ReadonlySet<string>): number {
  const normalizedQuery = compactSearchText(query)
  const normalizedName = compactSearchText(file.name)
  const normalizedPath = compactSearchText(file.relativePath)
  let score = 0

  if (!normalizedQuery) score = 1
  else if (normalizedName === normalizedQuery) score = 100
  else if (normalizedName.startsWith(normalizedQuery)) score = 80
  else if (normalizedName.includes(normalizedQuery)) score = 60
  else if (normalizedPath.includes(normalizedQuery)) score = 35
  else if (isSubsequence(normalizedQuery, normalizedName)) score = 15

  if (recentPaths.has(normalizePath(file.relativePath))) score += 5
  return score
}

export function rankMarkdownFileSuggestions(options: {
  files: MarkdownFile[]
  currentFilePath: string
  linkText: string
  targetText: string
  recentPaths?: string[]
  limit?: number
}): MarkdownFileLinkSuggestion[] {
  const {
    files,
    currentFilePath,
    linkText,
    targetText,
    recentPaths = [],
    limit,
  } = options
  const normalizedCurrentPath = normalizePath(currentFilePath)
  const recentPathSet = new Set(recentPaths.map(normalizePath))
  const pathMode = isMarkdownPathInput(targetText)
  const rawNormalizedTarget = targetText.replace(/\\/g, '/').toLocaleLowerCase()
  const normalizedTarget = rawNormalizedTarget === '.' || rawNormalizedTarget === './' || rawNormalizedTarget === '/'
    ? ''
    : rawNormalizedTarget.startsWith('/')
      ? rawNormalizedTarget.slice(1)
      : rawNormalizedTarget
  const resultLimit = limit ?? (pathMode ? Number.POSITIVE_INFINITY : 6)

  return files
    .filter(file => normalizePath(file.relativePath) !== normalizedCurrentPath)
    .map(file => {
      const relativeHref = createRelativeMarkdownHref(currentFilePath, file.relativePath)
      const href = pathMode && targetText.startsWith('./') && !relativeHref.startsWith('.')
        ? `./${relativeHref}`
        : relativeHref
      const decodedHref = safeDecodeURIComponent(href).toLocaleLowerCase()
      const score = pathMode
        ? !normalizedTarget || decodedHref.startsWith(normalizedTarget) ? 100 : decodedHref.includes(normalizedTarget) ? 40 : 0
        : scoreFile(file, targetText.trim() || linkText, recentPathSet)
      return { ...file, href, score }
    })
    .filter(file => file.score > 0)
    .sort((left, right) => right.score - left.score || left.relativePath.localeCompare(right.relativePath))
    .slice(0, resultLimit)
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
