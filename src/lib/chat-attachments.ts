import { readDir, stat } from '@tauri-apps/plugin-fs'
import { basename, join, normalize } from '@tauri-apps/api/path'
import { getDocumentExtension, isReadableDocumentName } from '@/lib/document-parser'

export type ChatAttachmentKind = 'file' | 'folder'

export interface PersistedChatAttachment {
  id: string
  kind: ChatAttachmentKind
  name: string
  size?: number
  extension?: string
  readable: boolean
  entryCount?: number
  previewTruncated?: boolean
}

export interface RuntimeChatAttachment extends PersistedChatAttachment {
  path: string
  preview?: string
}

export const FOLDER_PREVIEW_MAX_ENTRIES = 100
export const FOLDER_PREVIEW_MAX_DEPTH = 2

export function getAttachmentExtension(name: string) {
  return getDocumentExtension(name)
}

export function isReadableAttachmentName(name: string) {
  return isReadableDocumentName(name)
}

export function toPersistedChatAttachment(
  attachment: RuntimeChatAttachment
): PersistedChatAttachment {
  return {
    id: attachment.id,
    kind: attachment.kind,
    name: attachment.name,
    size: attachment.size,
    extension: attachment.extension,
    readable: attachment.readable,
    entryCount: attachment.entryCount,
    previewTruncated: attachment.previewTruncated,
  }
}

export function serializeChatAttachments(attachments: RuntimeChatAttachment[]) {
  return JSON.stringify(attachments.map(toPersistedChatAttachment))
}

export function parsePersistedChatAttachments(value?: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PersistedChatAttachment => {
      if (!item || typeof item !== 'object') return false
      const attachment = item as Partial<PersistedChatAttachment>
      return (
        typeof attachment.id === 'string'
        && (attachment.kind === 'file' || attachment.kind === 'folder')
        && typeof attachment.name === 'string'
        && typeof attachment.readable === 'boolean'
        && !('path' in attachment)
      )
    })
  } catch {
    return []
  }
}

export async function createFileAttachment(path: string): Promise<RuntimeChatAttachment> {
  const fileStat = await stat(path)
  const name = await basename(path)
  return {
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: 'file',
    name,
    path,
    size: fileStat.size,
    extension: getAttachmentExtension(name),
    readable: isReadableAttachmentName(name),
  }
}

export async function createFolderAttachment(path: string): Promise<RuntimeChatAttachment> {
  const name = await basename(path)
  const preview = await buildFolderPreview(path)
  return {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: 'folder',
    name,
    path,
    readable: true,
    entryCount: preview.entryCount,
    previewTruncated: preview.truncated,
    preview: preview.text,
  }
}

export async function buildFolderPreview(rootPath: string) {
  const lines: string[] = []
  let entryCount = 0
  let truncated = false

  const visit = async (directoryPath: string, prefix: string, depth: number) => {
    if (depth > FOLDER_PREVIEW_MAX_DEPTH || truncated) return
    const entries = (await readDir(directoryPath))
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1
        return left.name.localeCompare(right.name)
      })

    for (const entry of entries) {
      if (entryCount >= FOLDER_PREVIEW_MAX_ENTRIES) {
        truncated = true
        return
      }
      entryCount += 1
      const suffix = entry.isDirectory ? '/' : entry.isSymlink ? ' (symlink)' : ''
      lines.push(`${prefix}${entry.name}${suffix}`)
      if (entry.isDirectory && !entry.isSymlink && depth < FOLDER_PREVIEW_MAX_DEPTH) {
        await visit(await join(directoryPath, entry.name), `${prefix}  `, depth + 1)
      }
    }
  }

  await visit(rootPath, '', 1)
  return {
    text: lines.join('\n'),
    entryCount,
    truncated,
  }
}

function normalizeForCompare(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows')
    ? normalized.toLowerCase()
    : normalized
}

async function ensureNoSymlinkTraversal(rootPath: string, relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  let currentPath = rootPath
  for (const segment of segments) {
    const entries = await readDir(currentPath)
    const entry = entries.find((candidate) => candidate.name === segment)
    if (!entry) throw new Error('ATTACHMENT_PATH_NOT_FOUND')
    if (entry.isSymlink) throw new Error('ATTACHMENT_SYMLINK_BLOCKED')
    currentPath = await join(currentPath, segment)
  }
}

export async function resolveAttachmentChildPath(
  attachment: RuntimeChatAttachment,
  relativePath = ''
) {
  const cleanRelativePath = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (
    cleanRelativePath.split('/').some((segment) => segment === '..' || segment === '.')
    || /^[a-zA-Z]:/.test(cleanRelativePath)
  ) {
    throw new Error('ATTACHMENT_PATH_OUTSIDE_ROOT')
  }

  if (attachment.kind === 'file') {
    if (cleanRelativePath) throw new Error('ATTACHMENT_FILE_HAS_NO_CHILD')
    return attachment.path
  }

  if (cleanRelativePath) await ensureNoSymlinkTraversal(attachment.path, cleanRelativePath)
  const normalizedRoot = await normalize(attachment.path)
  const normalizedTarget = await normalize(
    cleanRelativePath ? await join(attachment.path, cleanRelativePath) : attachment.path
  )
  const resolvedRoot = normalizeForCompare(normalizedRoot)
  const resolvedTarget = normalizeForCompare(normalizedTarget)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}/`)) {
    throw new Error('ATTACHMENT_PATH_OUTSIDE_ROOT')
  }
  return normalizedTarget
}
