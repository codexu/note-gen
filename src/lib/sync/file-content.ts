import { isTextDocumentName } from '@/lib/document-parser'

const ADDITIONAL_TEXT_EXTENSIONS = new Set([
  'csv', 'svg', 'ipynb', 'cjs', 'cts', 'astro', 'xsd', 'xsl', 'xslt', 'rels',
  'tex', 'bib', 'rst', 'adoc', 'properties', 'lock', 'example', 'template',
  'editorconfig', 'gitattributes', 'gitmodules', 'npmrc', 'nvmrc',
])
const TEXT_FILENAMES = new Set(['readme', 'license', 'licence', 'makefile', 'dockerfile', 'procfile'])

/** Unknown formats stay on the byte path; a filename never authorizes lossy decoding. */
export function isSyncTextPath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').pop()?.toLowerCase() || ''
  const extension = name.split('.').pop() || ''
  return isTextDocumentName(name) || ADDITIONAL_TEXT_EXTENSIONS.has(extension) || TEXT_FILENAMES.has(name)
}

export function isBinaryFilePath(path: string): boolean {
  return !isSyncTextPath(path)
}

/** Text is an optional editor view of bytes, never the representation used to sync files. */
export function decodeSyncText(path: string, bytes: Uint8Array): string | undefined {
  if (!isSyncTextPath(path)) return undefined
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.includes('\0') ? undefined : text
  } catch {
    return undefined
  }
}

export function syncContentBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

export function sameFileBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}
