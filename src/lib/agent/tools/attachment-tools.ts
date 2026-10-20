import { readDir } from '@tauri-apps/plugin-fs'
import {
  isReadableAttachmentName,
  resolveAttachmentChildPath,
} from '@/lib/chat-attachments'
import { parseLocalDocument } from '@/lib/document-parser'
import type { AgentTool } from '../types'

const MAX_BATCH_ATTACHMENT_CONTENT_CHARS = 8000

function getAttachment(id: unknown, context: Parameters<AgentTool['execute']>[1]) {
  if (typeof id !== 'string') return undefined
  return context.context.attachments?.find((attachment) => attachment.id === id)
}

export const listAttachmentsTool: AgentTool = {
  name: 'attachment_list',
  title: '列出附件目录',
  description: 'List the immediate children of a user-selected folder attachment. Paths are relative to the selected folder and symbolic links are not followed.',
  category: 'attachment',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID from the current attachment context.' },
      relativePath: { type: 'string', description: 'Optional subfolder path relative to the selected folder.' },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const attachment = getAttachment(input.attachmentId, context)
    if (!attachment) return { ok: false, message: '附件不存在或已不在本次运行授权范围内。', error: 'ATTACHMENT_NOT_AVAILABLE' }
    if (attachment.kind !== 'folder') return { ok: false, message: '该附件不是文件夹。', error: 'ATTACHMENT_NOT_FOLDER' }
    try {
      const relativePath = typeof input.relativePath === 'string' ? input.relativePath : ''
      const directoryPath = await resolveAttachmentChildPath(attachment, relativePath)
      const entries = (await readDir(directoryPath))
        .filter((entry) => !entry.name.startsWith('.'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory ? 'folder' : 'file',
          readable: entry.isDirectory || (!entry.isSymlink && isReadableAttachmentName(entry.name)),
          symlink: entry.isSymlink,
        }))
      return {
        ok: true,
        message: `已列出附件文件夹 ${attachment.name} 中的 ${entries.length} 项。`,
        data: { attachmentId: attachment.id, attachmentName: attachment.name, relativePath, entries },
      }
    } catch (error) {
      return { ok: false, message: `无法列出附件目录：${String(error)}`, error: 'ATTACHMENT_LIST_FAILED' }
    }
  },
}

export const readAttachmentTool: AgentTool = {
  name: 'attachment_read',
  title: '读取附件',
  description: 'Read user-selected text, code, Markdown, PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, or CSV attachments. For a folder summary, pass every relevant readable path together in relativePaths; use relativePath only when one file is sufficient. Use relative paths only.',
  category: 'attachment',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      attachmentId: { type: 'string', description: 'Attachment ID from the current attachment context.' },
      relativePath: { type: 'string', description: 'Required for folder attachments; omit for a selected file.' },
      relativePaths: {
        type: 'array',
        description: 'Up to 20 relevant readable paths inside one folder attachment. Prefer this for folder-wide summary or analysis.',
        items: { type: 'string' },
      },
      startLine: { type: 'number', description: 'Optional 1-based start line.' },
      endLine: { type: 'number', description: 'Optional inclusive end line.' },
    },
    required: ['attachmentId'],
    additionalProperties: false,
  },
  execute: async (input, context) => {
    const attachment = getAttachment(input.attachmentId, context)
    if (!attachment) return { ok: false, message: '附件不存在或已不在本次运行授权范围内。', error: 'ATTACHMENT_NOT_AVAILABLE' }
    const relativePath = typeof input.relativePath === 'string' ? input.relativePath : ''
    const relativePaths = Array.isArray(input.relativePaths)
      ? [...new Set(input.relativePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0))].slice(0, 20)
      : []
    const requestedPaths = attachment.kind === 'file'
      ? ['']
      : relativePaths.length > 0
        ? relativePaths
        : relativePath
          ? [relativePath]
          : []
    if (requestedPaths.length === 0) {
      return { ok: false, message: '读取文件夹附件时必须提供 relativePath 或 relativePaths。', error: 'ATTACHMENT_PATH_REQUIRED' }
    }

    const results: Array<{
      path: string
      ok: boolean
      startLine?: number
      endLine?: number
      totalLines?: number
      content?: string
      truncated?: boolean
      error?: string
    }> = []
    const perFileContentLimit = Math.max(
      500,
      Math.floor(MAX_BATCH_ATTACHMENT_CONTENT_CHARS / requestedPaths.length)
    )

    for (const path of requestedPaths) {
      const displayName = attachment.kind === 'file' ? attachment.name : path.split('/').pop() || path
      if (!isReadableAttachmentName(displayName)) {
        results.push({ path: path || attachment.name, ok: false, error: 'ATTACHMENT_UNSUPPORTED' })
        continue
      }

      try {
        const targetPath = await resolveAttachmentChildPath(attachment, path)
        const content = (await parseLocalDocument(targetPath, displayName)).markdown
        const lines = content.replace(/\r\n/g, '\n').split('\n')
        const startLine = Number.isInteger(input.startLine) ? Math.max(1, Number(input.startLine)) : 1
        const endLine = Number.isInteger(input.endLine)
          ? Math.min(lines.length, Math.max(startLine, Number(input.endLine)))
          : lines.length
        const selected = lines.slice(startLine - 1, endLine)
          .map((line, index) => `${startLine + index} | ${line}`)
          .join('\n')
        const truncated = requestedPaths.length > 1 && selected.length > perFileContentLimit
        results.push({
          path: path || attachment.name,
          ok: true,
          startLine,
          endLine,
          totalLines: lines.length,
          content: truncated ? `${selected.slice(0, perFileContentLimit)}\n…内容已截断，可按行继续读取。` : selected,
          truncated,
        })
      } catch (error) {
        results.push({ path: path || attachment.name, ok: false, error: String(error) })
      }
    }

    if (results.length === 1) {
      const [result] = results
      if (!result.ok) {
        return {
          ok: false,
          message: result.error === 'ATTACHMENT_UNSUPPORTED'
            ? `附件 ${result.path} 的格式暂不支持内容读取，只能使用已提供的元数据。`
            : `无法读取附件：${result.error}`,
          error: result.error || 'ATTACHMENT_READ_FAILED',
        }
      }
      return {
        ok: true,
        message: `已读取 ${result.path} 第 ${result.startLine}-${result.endLine} 行，共 ${result.totalLines} 行。`,
        data: { name: result.path, startLine: result.startLine, endLine: result.endLine, totalLines: result.totalLines, content: result.content },
      }
    }

    const readCount = results.filter((result) => result.ok).length
    const truncatedCount = results.filter((result) => result.truncated).length
    return {
      ok: readCount > 0,
      message: `已批量读取 ${readCount}/${results.length} 个附件文件${truncatedCount > 0 ? `，其中 ${truncatedCount} 个内容已截断` : ''}。`,
      data: { requestedCount: results.length, readCount, files: results },
      error: readCount > 0 ? undefined : 'ATTACHMENT_READ_FAILED',
    }
  },
}

export const attachmentTools = [listAttachmentsTool, readAttachmentTool]
