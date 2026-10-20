import { invoke } from '@tauri-apps/api/core'
import { readTextFile } from '@tauri-apps/plugin-fs'

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'mts', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte',
  'py', 'java', 'kt', 'kts', 'swift', 'c', 'h', 'cpp', 'cc', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'lua',
  'scala', 'dart', 'r', 'sql', 'graphql', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'asm', 'pl', 'clj', 'ex',
  'elm', 'f90', 'hs', 'jl', 'dockerfile', 'gitignore', 'env', 'log',
])

const ANYDOC_EXTENSIONS = new Set([
  'doc', 'docx', 'docm',
  'ppt', 'pps', 'pot', 'pptx', 'pptm', 'ppsx', 'ppsm',
  'xls', 'xlsx', 'xlsm', 'xlsb',
  'odt', 'ods', 'odp',
  'rtf', 'epub', 'csv', 'pdf',
])

export interface ParsedLocalDocument {
  markdown: string
  format: string
  characterCount: number
}

export type DocumentParseErrorCode =
  | 'UNSUPPORTED'
  | 'SCANNED_PDF'
  | 'ENCRYPTED'
  | 'MALFORMED'
  | 'RESOURCE_LIMIT'
  | 'MISSING_PART'
  | 'READ_FAILED'
  | 'FILE_TOO_LARGE'
  | 'PARSE_FAILED'

export class DocumentParseError extends Error {
  code: DocumentParseErrorCode

  constructor(code: DocumentParseErrorCode, message: string) {
    super(message)
    this.name = 'DocumentParseError'
    this.code = code
  }
}

export function getDocumentExtension(name: string) {
  const normalizedName = name.split(/[?#]/, 1)[0]
  let decodedName = normalizedName
  try {
    decodedName = decodeURIComponent(normalizedName)
  } catch {
    // Keep the original value when a local path contains a literal `%`.
  }
  const lowerName = decodedName.toLowerCase()
  if (!lowerName.includes('.')) return lowerName
  return lowerName.split('.').pop() || ''
}

export function getDocumentFileName(path: string) {
  const normalizedPath = path.split(/[?#]/, 1)[0]
  let decodedPath = normalizedPath
  try {
    decodedPath = decodeURIComponent(normalizedPath)
  } catch {
    // Keep the original value when a local path contains a literal `%`.
  }
  return decodedPath.split(/[\\/]/).pop() || decodedPath
}

export function isTextDocumentName(name: string) {
  return TEXT_EXTENSIONS.has(getDocumentExtension(name))
}

export function isAnydocDocumentName(name: string) {
  return ANYDOC_EXTENSIONS.has(getDocumentExtension(name))
}

export function isReadableDocumentName(name: string) {
  return isTextDocumentName(name) || isAnydocDocumentName(name)
}

export function getDocumentParseMessageKey(code: DocumentParseErrorCode) {
  switch (code) {
  case 'SCANNED_PDF': return 'documentParseError.scannedPdf' as const
  case 'ENCRYPTED': return 'documentParseError.encrypted' as const
  case 'MALFORMED':
  case 'MISSING_PART': return 'documentParseError.malformed' as const
  case 'RESOURCE_LIMIT': return 'documentParseError.resourceLimit' as const
  case 'FILE_TOO_LARGE': return 'documentParseError.fileTooLarge' as const
  case 'READ_FAILED': return 'documentParseError.readFailed' as const
  case 'UNSUPPORTED': return 'fileUnsupportedDescription' as const
  default: return 'documentParseError.parseFailed' as const
  }
}

function isDocumentParseErrorCode(value: unknown): value is DocumentParseErrorCode {
  return typeof value === 'string' && [
    'UNSUPPORTED',
    'SCANNED_PDF',
    'ENCRYPTED',
    'MALFORMED',
    'RESOURCE_LIMIT',
    'MISSING_PART',
    'READ_FAILED',
    'FILE_TOO_LARGE',
    'PARSE_FAILED',
  ].includes(value)
}

export function normalizeDocumentParseError(error: unknown): DocumentParseError {
  if (error instanceof DocumentParseError) return error
  if (error && typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown }
    if (isDocumentParseErrorCode(value.code)) {
      return new DocumentParseError(
        value.code,
        typeof value.message === 'string' ? value.message : value.code
      )
    }
  }
  return new DocumentParseError(
    'PARSE_FAILED',
    error instanceof Error ? error.message : String(error)
  )
}

export async function parseLocalDocument(path: string, name = path): Promise<ParsedLocalDocument> {
  const documentName = isReadableDocumentName(path) ? path : name
  const isMobileDocumentUri = path.startsWith('content://') || path.startsWith('file://')

  if (isTextDocumentName(documentName)) {
    try {
      const markdown = await readTextFile(path)
      return {
        markdown,
        format: getDocumentExtension(documentName),
        characterCount: Array.from(markdown).length,
      }
    } catch (error) {
      throw new DocumentParseError(
        'READ_FAILED',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  if (!isAnydocDocumentName(documentName) && !isMobileDocumentUri) {
    throw new DocumentParseError('UNSUPPORTED', 'Unsupported document format')
  }

  try {
    return await invoke<ParsedLocalDocument>('parse_document', {
      path,
      extension: getDocumentExtension(documentName),
    })
  } catch (error) {
    throw normalizeDocumentParseError(error)
  }
}
