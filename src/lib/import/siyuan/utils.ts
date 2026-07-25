import { exists, lstat, readTextFile } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const SIYUAN_ASSET_ROOTS = new Set(['assets', 'emojis', 'public'])
const MAX_FILENAME_CODE_POINTS = 120
const MAX_FILENAME_UTF8_BYTES = 255

export interface SiYuanAssetReference {
  sourcePath: string
  suffix: string
}

export function decodeBase64(value: string | undefined): string {
  if (!value) {
    return ''
  }

  try {
    return atob(value)
  } catch {
    return value
  }
}

function truncateFileNameComponent(value: string, maxUtf8Bytes = MAX_FILENAME_UTF8_BYTES): string {
  const codePoints = [...value]
  let result = ''

  for (const codePoint of codePoints) {
    if (result.length >= MAX_FILENAME_CODE_POINTS) {
      break
    }

    const next = `${result}${codePoint}`
    if (new TextEncoder().encode(next).length > maxUtf8Bytes) {
      break
    }
    result = next
  }

  return result.replace(/[. ]+$/, '')
}

function sanitizeFileNameCore(name: string, fallback: string): string {
  const sanitized = name
    .normalize('NFC')
    .trim()
    .replace(INVALID_FILENAME_CHARS, '_')
    .replace(/[. ]+$/, '')
  const candidate = sanitized || fallback.replace(INVALID_FILENAME_CHARS, '_').replace(/[. ]+$/, '')

  if (!candidate) {
    return 'untitled'
  }

  const normalized = WINDOWS_RESERVED_FILENAME.test(candidate) ? `_${candidate}` : candidate
  return normalized.startsWith('.') ? `_${normalized.slice(1)}` : normalized
}

export function sanitizeFileName(name: string, fallback: string): string {
  return truncateFileNameComponent(sanitizeFileNameCore(name, fallback)) || 'untitled'
}

function buildFileNameBase(name: string, fallback: string, reservedSuffixBytes: number): string {
  const maxBaseBytes = Math.max(1, MAX_FILENAME_UTF8_BYTES - reservedSuffixBytes)
  return truncateFileNameComponent(
    sanitizeFileNameCore(name, fallback),
    maxBaseBytes,
  ) || 'untitled'
}

export function isNotebookId(name: string): boolean {
  return /^\d{14}-[a-z0-9]{6,7}$/.test(name)
}

export async function hasSiYuanNotebookMarker(notebookDir: string): Promise<boolean> {
  const confPath = await join(notebookDir, '.siyuan', 'conf.json')
  if (!await exists(confPath)) {
    return false
  }

  const confInfo = await lstat(confPath)
  if (!confInfo.isFile || confInfo.isSymlink) {
    return false
  }

  try {
    const conf = JSON.parse(await readTextFile(confPath)) as { name?: unknown }
    return typeof conf.name === 'string' && conf.name.trim().length > 0
  } catch {
    return false
  }
}

export function isDocumentId(name: string): boolean {
  return /^\d{14}-[a-z0-9]{6,8}$/.test(name.replace(/\.sy$/, ''))
}

const SIYUAN_BLOCK_ID_PATTERN = /^\d{14}-[a-z0-9]{6,8}$/i

export function isSafeSiYuanBlockId(value: string | undefined): value is string {
  return typeof value === 'string' && SIYUAN_BLOCK_ID_PATTERN.test(value)
}

export function resolveSafeBlockAnchor(node: {
  ID?: string
  Properties?: { id?: string }
}): string | null {
  if (isSafeSiYuanBlockId(node.ID)) {
    return node.ID
  }
  if (isSafeSiYuanBlockId(node.Properties?.id)) {
    return node.Properties.id
  }
  return null
}

export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function escapeMarkdownTableCell(value: string): string {
  return escapeMarkdownText(value.replace(/\n/g, ' ')).trim()
}

const SIYUAN_INVISIBLE_CHAR_RE = /[\u200B-\u200D\uFEFF]/g

export function stripSiYuanInvisibleChars(value: string): string {
  return value.replace(SIYUAN_INVISIBLE_CHAR_RE, '')
}

export function escapeMarkdownText(value: string): string {
  return stripSiYuanInvisibleChars(value).replace(/([\\`*_[\]{}<>#>+\-|])/g, '\\$1')
}

export function escapeMarkdownLinkText(value: string): string {
  return escapeMarkdownText(value)
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xDC00 || next > 0xDFFF) {
        return false
      }
      index += 1
      continue
    }
    if (code >= 0xDC00 && code <= 0xDFFF) {
      return false
    }
  }
  return true
}

export function encodeMarkdownLinkDestination(value: string): string | null {
  if (!isWellFormedUnicode(value)) {
    return null
  }

  try {
    return encodeURI(value)
      .replace(/\(/g, '%28')
      .replace(/\)/g, '%29')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E')
  } catch {
    return null
  }
}

export function encodeMarkdownPath(value: string): string | null {
  if (!isWellFormedUnicode(value)) {
    return null
  }

  try {
    return value
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => {
        if (segment === '.' || segment === '..' || segment === '') {
          return segment
        }
        return encodeURIComponent(segment)
          .replace(/\(/g, '%28')
          .replace(/\)/g, '%29')
      })
      .join('/')
  } catch {
    return null
  }
}

export function toRelativeWorkspacePath(fromFilePath: string, toPath: string): string {
  const fromSegments = fromFilePath.replace(/\\/g, '/').split('/')
  fromSegments.pop()
  const toSegments = toPath.replace(/\\/g, '/').split('/')

  let commonPrefixLength = 0
  while (
    commonPrefixLength < fromSegments.length
    && commonPrefixLength < toSegments.length
    && fromSegments[commonPrefixLength] === toSegments[commonPrefixLength]
  ) {
    commonPrefixLength += 1
  }

  const upwardSegments = new Array(fromSegments.length - commonPrefixLength).fill('..')
  const downwardSegments = toSegments.slice(commonPrefixLength)
  return [...upwardSegments, ...downwardSegments].join('/') || '.'
}

function decodePathComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function getSiYuanAssetRootFromPath(pathPart: string): string | null {
  const normalized = pathPart.replace(/\\/g, '/').replace(/^\.\//, '')
  const firstSegment = normalized.split('/')[0]
  if (!firstSegment) {
    return null
  }

  const decodedRoot = decodePathComponent(firstSegment) ?? firstSegment
  const root = decodedRoot.toLowerCase()
  return SIYUAN_ASSET_ROOTS.has(root) ? root : null
}

export function isSiYuanAssetReferenceCandidate(value: string): boolean {
  const pathPart = value.trim().split(/[?#]/, 1)[0]
  return getSiYuanAssetRootFromPath(pathPart) !== null
}

export function parseSiYuanAssetReference(value: string): SiYuanAssetReference | null {
  const trimmed = value.trim()
  const suffixIndex = trimmed.search(/[?#]/)
  const encodedPathPart = suffixIndex >= 0 ? trimmed.slice(0, suffixIndex) : trimmed
  const decodedPathPart = decodePathComponent(encodedPathPart)
  if (decodedPathPart === null) {
    return null
  }

  const pathPart = decodedPathPart.replace(/\\/g, '/').replace(/^\.\//, '')
  const suffix = suffixIndex >= 0 ? trimmed.slice(suffixIndex) : ''

  if (!pathPart || pathPart.startsWith('/') || /^[a-z]:/i.test(pathPart) || pathPart.includes('\0')) {
    return null
  }

  const segments = pathPart.split('/')
  if (
    segments.length < 2
    || !SIYUAN_ASSET_ROOTS.has(segments[0])
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    return null
  }

  return {
    sourcePath: segments.join('/'),
    suffix,
  }
}

export function isSafeRelativeLinkReference(value: string): boolean {
  const trimmed = value.trim()
  const pathPart = trimmed.split(/[?#]/, 1)[0]
  if (!pathPart) {
    return true
  }

  const decodedPath = decodePathComponent(pathPart)
  if (decodedPath === null) {
    return false
  }

  const normalized = decodedPath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
    return false
  }

  return normalized.split('/').every(segment => segment !== '..')
}

export function getNoteGenAssetOutputDir(
  mdRelativePath: string,
  assetsDirName = 'assets',
): string {
  const normalized = mdRelativePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  segments.pop()
  const markdownDir = segments.join('/')
  const dirName = assetsDirName.trim() || 'assets'
  return markdownDir ? `${markdownDir}/${dirName}` : dirName
}

export function getImportedAssetRelativePath(sourcePath: string, assetOutputDir: string): string {
  const normalizedSource = sourcePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const base = assetOutputDir.replace(/\\/g, '/').replace(/\/$/, '')
  const assetReference = parseSiYuanAssetReference(normalizedSource)
  const resolvedSource = assetReference?.sourcePath ?? normalizedSource

  if (resolvedSource.startsWith('assets/')) {
    return `${base}/${resolvedSource.slice('assets/'.length)}`
  }
  if (resolvedSource.startsWith('emojis/')) {
    return `${base}/${resolvedSource}`
  }
  if (resolvedSource.startsWith('public/')) {
    return `${base}/${resolvedSource.slice('public/'.length)}`
  }

  return `${base}/${resolvedSource}`
}

export const SIYUAN_DATA_SUBDIRS = new Set([
  'assets',
  'storage',
  'templates',
  'widgets',
  'plugins',
  'emojis',
  'snippets',
  'public',
])

export class ImportPathAllocator {
  private readonly usedRelativePaths = new Set<string>()
  private readonly targetDir: string

  constructor(targetDir: string) {
    this.targetDir = targetDir
  }

  private pathKey(relativePath: string): string {
    return relativePath
      .replace(/\\/g, '/')
      .replace(/^\/|\/$/g, '')
      .normalize('NFC')
      .toLocaleLowerCase('en-US')
  }

  reserveRelativePath(relativePath: string): void {
    const normalized = this.pathKey(relativePath)
    if (normalized) {
      this.usedRelativePaths.add(normalized)
    }
  }

  allocateRelativeDir(parentRelativePath: string, desiredName: string): string {
    const parent = parentRelativePath.replace(/\\/g, '/').replace(/\/$/, '')
    let suffix = 0

    while (true) {
      const suffixPart = suffix === 0 ? '' : `-${suffix}`
      const candidate = `${buildFileNameBase(
        desiredName,
        desiredName,
        new TextEncoder().encode(suffixPart).length,
      )}${suffixPart}`
      const relativePath = parent ? `${parent}/${candidate}` : candidate
      if (!this.usedRelativePaths.has(this.pathKey(relativePath))) {
        this.usedRelativePaths.add(this.pathKey(relativePath))
        return relativePath
      }
      suffix += 1
    }
  }

  allocateRelativeFile(parentRelativePath: string, desiredName: string): string {
    const parent = parentRelativePath.replace(/\\/g, '/').replace(/\/$/, '')
    const cleanedName = desiredName.replace(/\.md$/i, '')
    let suffix = 0

    while (true) {
      const suffixPart = suffix === 0 ? '.md' : `-${suffix}.md`
      const candidate = `${buildFileNameBase(
        cleanedName,
        desiredName,
        new TextEncoder().encode(suffixPart).length,
      )}${suffixPart}`
      const relativePath = parent ? `${parent}/${candidate}` : candidate
      if (!this.usedRelativePaths.has(this.pathKey(relativePath))) {
        this.usedRelativePaths.add(this.pathKey(relativePath))
        return relativePath
      }
      suffix += 1
    }
  }

  toAbsolutePath(relativePath: string): string {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\//, '')
    return `${this.targetDir.replace(/\\/g, '/').replace(/\/$/, '')}/${normalized}`
  }

  getTargetDir(): string {
    return this.targetDir
  }
}
