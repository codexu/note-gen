import { exists, lstat, readDir, readTextFile } from '@tauri-apps/plugin-fs'

import { moveEntryToSystemTrash } from '@/app/core/main/file/system-trash'
import { getTags } from '@/db/tags'
import { recordMatchesTag } from '@/lib/record-tags'
import { delMark, getAllMarks, getMarkById, insertMark, restoreMark, updateMark, type Mark } from '@/db/marks'
import { getAllConversations, getConversation } from '@/db/conversations'
import { getChatsByConversation } from '@/db/chats'
import { deleteVectorDocumentsByFilename } from '@/db/vector'
import { createCanvasTab } from '@/app/core/main/canvas/canvas-tab'
import { prepareEditorLineTransaction } from '@/lib/agent/editor-adapter'
import { getToolByName } from '@/lib/agent/tools'
import { readCurrentEditorState } from '@/lib/agent/tools/editor-tools'
import { prepareActiveEditorPathMutationDurably } from '@/lib/editor-deactivation'
import { getAllMarkdownFiles } from '@/lib/files'
import { readKnowledgeSourcePage, searchKnowledge } from '@/lib/knowledge-search'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions, getWorkspacePath, isAbsoluteFsPath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useCanvasStore from '@/stores/canvas'
import useChatStore from '@/stores/chat'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import type { CanvasProjectType } from '@/types/canvas'
import { isKnowledgeSourceType, type KnowledgeSourceType } from '@/types/knowledge'

import type { LocalMcpToolResult } from './types'
import { beginLocalMcpWorkspaceWrite } from './workspace-guard'

type Input = Record<string, unknown>

interface NoteSnapshot {
  filePath: string
  content: string
  revision: string
  active: boolean
  totalLines: number
}

const writeQueues = new Map<string, Promise<void>>()

function textResult(message: string, data: Record<string, unknown> = {}): LocalMcpToolResult {
  return { content: [{ type: 'text', text: message }], structuredContent: data }
}

function errorResult(code: string, message: string, data?: unknown): LocalMcpToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { code, ...(data === undefined ? {} : { data }) },
    isError: true,
  }
}

function inputRecord(value: unknown): Input {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Input : {}
}

function requiredString(input: Input, key: string): string {
  const value = input[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`参数 ${key} 必须是非空字符串`)
  return value
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`参数 ${key} 必须是字符串`)
  return value
}

function requiredContent(input: Input): string {
  const value = input.content
  if (typeof value !== 'string') throw new Error('参数 content 必须是字符串')
  return value
}

function requiredInteger(input: Input, key: string): number {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new Error(`参数 ${key} 必须是正整数`)
  return value
}

async function workspaceKey(): Promise<string> {
  const workspace = await getWorkspacePath()
  return workspace.isCustom
    ? `custom:${workspace.path.replace(/\\/g, '/').replace(/\/+$/, '')}`
    : 'default:article'
}

async function assertWorkspaceUnchanged(expected: string): Promise<void> {
  if (await workspaceKey() !== expected) throw new Error('workspace_changed')
}

async function safeMarkdownPath(rawPath: string, allowMissingLeaf = false): Promise<string> {
  if (isAbsoluteFsPath(rawPath.trim())) throw new Error('不允许使用绝对路径')
  const normalized = await ensureSafeWorkspaceRelativePath(rawPath)
  if (!normalized.endsWith('.md')) throw new Error('只允许操作以 .md 结尾的 Markdown 文章')
  await assertNoSymlink(normalized, allowMissingLeaf)
  return normalized
}

async function assertNoSymlink(normalized: string, allowMissingLeaf = false): Promise<void> {
  const segments = normalized.split('/').filter(Boolean)
  const stop = allowMissingLeaf ? segments.length - 1 : segments.length
  for (let index = 1; index <= stop; index += 1) {
    const candidate = segments.slice(0, index).join('/')
    const options = await getFilePathOptions(candidate)
    const candidateExists = options.baseDir
      ? await exists(options.path, { baseDir: options.baseDir })
      : await exists(options.path)
    if (!candidateExists) continue
    const info = options.baseDir
      ? await lstat(options.path, { baseDir: options.baseDir })
      : await lstat(options.path)
    if (info.isSymlink) throw new Error('路径包含符号链接，已拒绝访问')
  }
}

async function safeFolderPath(rawPath: string): Promise<string> {
  if (isAbsoluteFsPath(rawPath.trim())) throw new Error('不允许使用绝对路径')
  const normalized = await ensureSafeWorkspaceRelativePath(rawPath)
  await assertNoSymlink(normalized)
  return normalized
}

async function listWorkspaceFolders(folderPath: string, recursive: boolean): Promise<string[]> {
  const folders: string[] = []
  const visit = async (relativePath: string): Promise<void> => {
    const options = await getFilePathOptions(relativePath)
    const entries = options.baseDir
      ? await readDir(options.path, { baseDir: options.baseDir })
      : await readDir(options.path)
    for (const entry of entries) {
      if (!entry.isDirectory || entry.isSymlink || entry.name.startsWith('.')) continue
      const childPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      folders.push(childPath)
      if (recursive) await visit(childPath)
    }
  }
  await visit(folderPath)
  return folders.sort()
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function buildRevision(workspace: string, filePath: string, content: string): Promise<string> {
  return `sha256:${await digest(`${workspace}\u0000${filePath}\u0000${content}`)}`
}

async function readNote(filePath: string, workspace: string): Promise<NoteSnapshot> {
  const normalized = await safeMarkdownPath(filePath)
  const article = useArticleStore.getState()
  const active = article.activeFilePath === normalized
  let content: string
  if (active) {
    content = (await readCurrentEditorState()).markdown
  } else {
    const options = await getFilePathOptions(normalized)
    content = options.baseDir
      ? await readTextFile(options.path, { baseDir: options.baseDir })
      : await readTextFile(options.path)
  }
  await assertWorkspaceUnchanged(workspace)
  return {
    filePath: normalized,
    content,
    revision: await buildRevision(workspace, normalized, content),
    active,
    totalLines: content.split('\n').length,
  }
}

async function runAgentTool(name: string, input: Input, contextOverrides: { activeCanvasId?: string } = {}) {
  const tool = getToolByName(name)
  if (!tool) throw new Error(`NoteGen 内部工具不可用: ${name}`)
  const article = useArticleStore.getState()
  const currentEditorState = article.activeFilePath ? await readCurrentEditorState() : undefined
  const result = await tool.execute(input, {
    runId: `local-mcp:${crypto.randomUUID()}`,
    context: {
      userInput: 'Local MCP authorized tool call',
      activeFilePath: article.activeFilePath || undefined,
      currentEditorState,
      ...contextOverrides,
    },
  })
  if (!result.ok) throw new Error(result.error || result.message)
  return result
}

async function refreshRecordState(): Promise<void> {
  await Promise.all([
    useMarkStore.getState().fetchMarks(),
    useMarkStore.getState().fetchAllMarks(),
    useTagStore.getState().fetchTags(),
  ])
}

async function withFileWrite<T>(_filePath: string, operation: () => Promise<T>): Promise<T> {
  const releaseWorkspace = beginLocalMcpWorkspaceWrite()
  const queueKey = 'workspace'
  const previous = writeQueues.get(queueKey) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>(resolve => { release = resolve })
  const queued = previous.then(() => current)
  writeQueues.set(queueKey, queued)
  await previous
  try {
    return await operation()
  } finally {
    release?.()
    releaseWorkspace()
    if (writeQueues.get(queueKey) === queued) writeQueues.delete(queueKey)
  }
}

function serializeNote(snapshot: NoteSnapshot): Record<string, unknown> {
  return { ...snapshot }
}

async function updateWithRevision(input: Input, contentBuilder: (current: string) => string) {
  const workspace = await workspaceKey()
  const filePath = await safeMarkdownPath(requiredString(input, 'filePath'))
  const expectedRevision = requiredString(input, 'expectedRevision')
  return withFileWrite(filePath, async () => {
    const before = await readNote(filePath, workspace)
    if (before.revision !== expectedRevision) {
      return errorResult('revision_conflict', '文章内容已发生变化，请重新读取后再修改', {
        filePath,
        expectedRevision,
        currentRevision: before.revision,
      })
    }
    const nextContent = contentBuilder(before.content)
    await assertWorkspaceUnchanged(workspace)
    await runAgentTool('note_update_file', { filePath, content: nextContent })
    await assertWorkspaceUnchanged(workspace)
    const after = await readNote(filePath, workspace)
    return textResult(`已更新 ${filePath}`, serializeNote(after))
  })
}

function buildDocumentMap(content: string) {
  const lines = content.split('\n')
  const frontmatter: Array<{ key: string; line: number }> = []
  if (lines[0]?.trim() === '---') {
    const end = lines.slice(1).findIndex(line => line.trim() === '---')
    if (end >= 0) {
      lines.slice(1, end + 1).forEach((line, index) => {
        const match = line.match(/^([A-Za-z0-9_.-]+)\s*:/)
        if (match) frontmatter.push({ key: match[1], line: index + 2 })
      })
    }
  }
  const headings = lines.flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    return match ? [{ title: match[2], level: match[1].length, startLine: index + 1, endLine: lines.length }] : []
  })
  headings.forEach((heading, index) => {
    const next = headings.slice(index + 1).find(item => item.level <= heading.level)
    heading.endLine = next ? next.startLine - 1 : lines.length
  })
  return { frontmatter, headings, totalLines: lines.length }
}

export async function executeLocalMcpTool(toolName: string, rawArguments: unknown): Promise<LocalMcpToolResult> {
  const input = inputRecord(rawArguments)
  try {
    const workspace = await workspaceKey()
    switch (toolName) {
      case 'notegen_get_context': {
        const article = useArticleStore.getState()
        const editor = article.activeFilePath ? await readCurrentEditorState() : undefined
        await assertWorkspaceUnchanged(workspace)
        return textResult('已读取 NoteGen 当前上下文', {
          workspace,
          currentFile: article.activeFilePath || null,
          editor: editor ? {
            revision: await buildRevision(workspace, article.activeFilePath || '', editor.markdown),
            wordCount: editor.wordCount,
            charCount: editor.charCount,
            totalLines: editor.totalLines,
            selection: editor.selection,
          } : null,
          contentTypes: ['article', 'record', 'conversation', 'canvas'],
          writableContentTypes: ['article', 'record', 'conversation', 'canvas'],
        })
      }
      case 'notegen_search': {
        const sourceTypes = Array.isArray(input.sourceTypes)
          ? input.sourceTypes.filter(isKnowledgeSourceType) as KnowledgeSourceType[]
          : undefined
        const sourceMode = input.sourceMode === 'only' ? 'only' : input.sourceMode === 'prefer' ? 'prefer' : undefined
        const results = await searchKnowledge(requiredString(input, 'query'), {
          mode: input.mode === 'keyword' ? 'keyword' : 'rag',
          sourceTypes,
          sourceMode,
          folderPath: optionalString(input, 'folderPath'),
          tagId: typeof input.tagId === 'number' ? input.tagId : undefined,
          limit: typeof input.limit === 'number' ? Math.min(50, Math.max(1, input.limit)) : undefined,
        })
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${results.length} 个知识来源`, { results })
      }
      case 'notegen_read_sources': {
        if (!Array.isArray(input.requests) || input.requests.length === 0) throw new Error('requests 必须是非空数组')
        const pages = await Promise.all(input.requests.map(async request => {
          const item = inputRecord(request)
          return readKnowledgeSourcePage(requiredString(item, 'sourceKey'), optionalString(item, 'cursor'))
        }))
        await assertWorkspaceUnchanged(workspace)
        return textResult(`已读取 ${pages.filter(Boolean).length} 个知识来源`, { pages })
      }
      case 'note_list': {
        const rawFolder = optionalString(input, 'folderPath')?.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
        const folderPath = rawFolder ? await safeFolderPath(rawFolder) : ''
        const recursive = input.recursive !== false
        const files = (await getAllMarkdownFiles(true)).filter(file => {
          const path = file.relativePath.replace(/\\/g, '/')
          if (!folderPath) return recursive || !path.includes('/')
          if (!path.startsWith(`${folderPath}/`)) return false
          return recursive || !path.slice(folderPath.length + 1).includes('/')
        }).map(file => ({
          filePath: file.relativePath.replace(/\\/g, '/'),
          name: file.name,
          size: file.metadata?.size,
          createdAt: file.metadata?.createdAt?.toISOString(),
          modifiedAt: file.metadata?.modifiedAt?.toISOString(),
          readOnly: file.metadata?.isReadOnly,
        }))
        const folders = await listWorkspaceFolders(folderPath, recursive)
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${files.length} 个 Markdown 文件`, { files, folders })
      }
      case 'note_read': {
        const note = await readNote(requiredString(input, 'filePath'), workspace)
        return textResult(`已读取 ${note.filePath}`, serializeNote(note))
      }
      case 'note_get_document_map': {
        const note = await readNote(requiredString(input, 'filePath'), workspace)
        return textResult(`已生成 ${note.filePath} 的文档地图`, {
          filePath: note.filePath,
          revision: note.revision,
          ...buildDocumentMap(note.content),
        })
      }
      case 'note_create': {
        const filePath = await safeMarkdownPath(requiredString(input, 'filePath'), true)
        const content = requiredContent(input)
        return withFileWrite(filePath, async () => {
          await assertWorkspaceUnchanged(workspace)
          const parts = filePath.split('/')
          const fileName = parts.pop() || filePath
          await runAgentTool('note_create_file', { fileName, folderPath: parts.join('/') || undefined, content })
          await assertWorkspaceUnchanged(workspace)
          const note = await readNote(filePath, workspace)
          return textResult(`已创建 ${filePath}`, serializeNote(note))
        })
      }
      case 'note_update':
        return updateWithRevision(input, () => requiredContent(input))
      case 'note_append':
        return updateWithRevision(input, current => current + requiredContent(input))
      case 'note_patch':
        return updateWithRevision(input, current => {
          if (!Array.isArray(input.operations)) throw new Error('operations 必须是数组')
          const prepared = prepareEditorLineTransaction(current, input.operations)
          if (!prepared.ok) throw new Error(prepared.error)
          return prepared.markdown
        })
      case 'note_copy':
      case 'note_move':
      case 'note_rename': {
        const filePath = await safeMarkdownPath(requiredString(input, 'filePath'))
        const mapping = { note_copy: 'note_copy_file', note_move: 'note_move_file', note_rename: 'note_rename_file' } as const
        const operationInput: Input = { ...input, filePath }
        if (toolName === 'note_rename') {
          const requestedName = requiredString(input, 'newName')
          if (requestedName.includes('/') || requestedName.includes('\\')) throw new Error('newName 只能是文件名，不能包含路径')
          const newName = requestedName.endsWith('.md') ? requestedName : `${requestedName}.md`
          const folder = filePath.split('/').slice(0, -1).join('/')
          await safeMarkdownPath(folder ? `${folder}/${newName}` : newName, true)
          operationInput.newName = newName
        } else {
          const targetFolderPath = optionalString(input, 'targetFolderPath')?.trim() || ''
          const normalizedFolder = targetFolderPath ? await safeFolderPath(targetFolderPath) : ''
          const requestedName = toolName === 'note_copy' ? optionalString(input, 'newName') : undefined
          if (requestedName?.includes('/') || requestedName?.includes('\\')) throw new Error('newName 只能是文件名，不能包含路径')
          const targetName = requestedName
            ? (requestedName.endsWith('.md') ? requestedName : `${requestedName}.md`)
            : filePath.split('/').pop() || filePath
          await safeMarkdownPath(normalizedFolder ? `${normalizedFolder}/${targetName}` : targetName, true)
          operationInput.targetFolderPath = normalizedFolder
          if (requestedName) operationInput.newName = targetName
        }
        return withFileWrite(filePath, async () => {
          await assertWorkspaceUnchanged(workspace)
          if (toolName === 'note_copy' && !await prepareActiveEditorPathMutationDurably(
            useArticleStore.getState().activeFilePath,
            [filePath],
          )) {
            return errorResult('editor_busy', '当前编辑器正在处理异步内容，复制已取消')
          }
          const result = await runAgentTool(mapping[toolName], operationInput)
          await assertWorkspaceUnchanged(workspace)
          return textResult(result.message, { result: result.data ?? null })
        })
      }
      case 'note_delete': {
        const filePath = await safeMarkdownPath(requiredString(input, 'filePath'))
        return withFileWrite(filePath, async () => {
          await assertWorkspaceUnchanged(workspace)
          const article = useArticleStore.getState()
          if (!await prepareActiveEditorPathMutationDurably(article.activeFilePath, [filePath])) {
            return errorResult('editor_busy', '当前编辑器正在处理异步内容，删除已取消')
          }
          const moved = await moveEntryToSystemTrash(filePath)
          if (!moved) return errorResult('not_found', `文件不存在: ${filePath}`)
          await article.cleanTabsByDeletedFile(filePath)
          if (!article.removeLocalEntry(filePath)) await article.loadFileTree()
          await deleteVectorDocumentsByFilename(filePath)
          const legacyName = filePath.split('/').pop() || filePath
          if (legacyName !== filePath) await deleteVectorDocumentsByFilename(legacyName)
          await assertWorkspaceUnchanged(workspace)
          return textResult(`已将 ${filePath} 移入系统回收站`, { filePath, trashed: true })
        })
      }
      case 'note_open': {
        const filePath = await safeMarkdownPath(requiredString(input, 'filePath'))
        await assertWorkspaceUnchanged(workspace)
        const result = await runAgentTool('note_open_file', { filePath })
        await assertWorkspaceUnchanged(workspace)
        return textResult(result.message, { filePath })
      }
      case 'record_list': {
        const tagId = typeof input.tagId === 'number' ? requiredInteger(input, 'tagId') : undefined
        const includeDeleted = input.includeDeleted === true
        const tags = await getTags()
        const records = (await getAllMarks()).filter(record =>
          (tagId === undefined || recordMatchesTag(record, tagId, tags)) && (includeDeleted || record.deleted === 0)
        )
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${records.length} 条记录`, { records })
      }
      case 'record_create': {
        const tagId = requiredInteger(input, 'tagId')
        const type = optionalString(input, 'type') || 'text'
        const allowedTypes: Mark['type'][] = ['scan', 'text', 'image', 'link', 'file', 'recording', 'todo']
        if (!allowedTypes.includes(type as Mark['type'])) throw new Error('参数 type 不是支持的记录类型')
        const result = await insertMark({
          tagId,
          type: type as Mark['type'],
          content: optionalString(input, 'content') || '',
          desc: optionalString(input, 'description'),
          url: optionalString(input, 'url') || '',
        })
        const id = result.lastInsertId
        if (!id) throw new Error('记录创建失败')
        await refreshRecordState()
        await assertWorkspaceUnchanged(workspace)
        return textResult('已创建记录', { record: await getMarkById(id) })
      }
      case 'record_update': {
        const id = requiredInteger(input, 'id')
        const current = await getMarkById(id)
        if (!current || current.deleted) throw new Error(`记录不存在: ${id}`)
        await updateMark({
          ...current,
          tagId: typeof input.tagId === 'number' ? requiredInteger(input, 'tagId') : current.tagId,
          content: optionalString(input, 'content') ?? current.content,
          desc: optionalString(input, 'description') ?? current.desc,
          url: optionalString(input, 'url') ?? current.url,
        })
        await refreshRecordState()
        await assertWorkspaceUnchanged(workspace)
        return textResult('已更新记录', { record: await getMarkById(id) })
      }
      case 'record_delete':
      case 'record_restore': {
        const id = requiredInteger(input, 'id')
        const current = await getMarkById(id)
        if (!current) throw new Error(`记录不存在: ${id}`)
        if (toolName === 'record_delete') await delMark(id)
        else await restoreMark(id)
        await refreshRecordState()
        await assertWorkspaceUnchanged(workspace)
        return textResult(toolName === 'record_delete' ? '已将记录移入回收站' : '已恢复记录', {
          record: await getMarkById(id),
        })
      }
      case 'conversation_list': {
        const conversations = await getAllConversations()
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${conversations.length} 个对话`, { conversations })
      }
      case 'conversation_read': {
        const id = requiredInteger(input, 'id')
        const conversation = await getConversation(id)
        if (!conversation) throw new Error(`对话不存在: ${id}`)
        const limit = typeof input.limit === 'number' ? Math.min(200, Math.max(1, Math.trunc(input.limit))) : 100
        const offset = typeof input.offset === 'number' ? Math.max(0, Math.trunc(input.offset)) : 0
        const allMessages = await getChatsByConversation(id)
        const messages = allMessages.slice(offset, offset + limit)
        await assertWorkspaceUnchanged(workspace)
        return textResult(`已读取对话“${conversation.title}”`, {
          conversation,
          messages,
          offset,
          nextOffset: offset + messages.length < allMessages.length ? offset + messages.length : null,
        })
      }
      case 'conversation_create': {
        const id = await useChatStore.getState().createConversation(requiredString(input, 'title'))
        await assertWorkspaceUnchanged(workspace)
        return textResult('已创建对话', { conversation: await getConversation(id) })
      }
      case 'conversation_append': {
        const id = requiredInteger(input, 'id')
        if (!await getConversation(id)) throw new Error(`对话不存在: ${id}`)
        const role = input.role === 'assistant' || input.role === 'system'
          ? 'system'
          : input.role === 'user' ? 'user' : null
        if (!role) throw new Error('参数 role 必须是 user、assistant 或 system')
        const store = useChatStore.getState()
        if (store.currentConversationId !== id) await store.switchConversation(id)
        const message = await useChatStore.getState().insert({
          conversationId: id,
          tagId: useTagStore.getState().currentTagId || 1,
          role,
          type: 'chat',
          content: requiredContent(input),
          inserted: false,
        })
        if (!message) throw new Error('消息写入失败')
        await assertWorkspaceUnchanged(workspace)
        return textResult('已追加对话消息', { message })
      }
      case 'conversation_rename': {
        const id = requiredInteger(input, 'id')
        await useChatStore.getState().updateConversationTitle(id, requiredString(input, 'title'))
        await assertWorkspaceUnchanged(workspace)
        return textResult('已重命名对话', { conversation: await getConversation(id) })
      }
      case 'conversation_open': {
        const id = requiredInteger(input, 'id')
        await useChatStore.getState().switchConversation(id)
        await assertWorkspaceUnchanged(workspace)
        return textResult('已在 NoteGen 中打开对话', { id })
      }
      case 'conversation_delete': {
        const id = requiredInteger(input, 'id')
        await useChatStore.getState().deleteConversation(id)
        await assertWorkspaceUnchanged(workspace)
        return textResult('已删除对话', { id, deleted: true })
      }
      case 'canvas_list': {
        await useCanvasStore.getState().loadProjects()
        const includeDeleted = input.includeDeleted === true
        const state = useCanvasStore.getState()
        const projects = includeDeleted ? [...state.projects, ...state.deletedProjects] : state.projects
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${projects.length} 个画布`, { projects })
      }
      case 'canvas_create': {
        const requestedType = optionalString(input, 'canvasType') || 'blank'
        const allowedTypes: CanvasProjectType[] = ['blank', 'flowchart', 'mindmap', 'timeline', 'quadrant', 'kanban', 'swot']
        if (!allowedTypes.includes(requestedType as CanvasProjectType)) throw new Error('参数 canvasType 不是支持的画布类型')
        const project = await useCanvasStore.getState().createProject(requestedType as CanvasProjectType, requiredString(input, 'title'))
        if (!project) throw new Error('画布创建失败')
        await assertWorkspaceUnchanged(workspace)
        return textResult('已创建画布', { project })
      }
      case 'canvas_read': {
        const canvasId = requiredString(input, 'canvasId')
        const project = await useCanvasStore.getState().openProject(canvasId)
        if (!project) throw new Error(`画布不存在: ${canvasId}`)
        const result = await runAgentTool('canvas_get_state', {}, { activeCanvasId: canvasId })
        await assertWorkspaceUnchanged(workspace)
        return textResult(result.message, { canvas: result.data ?? null })
      }
      case 'canvas_open': {
        const canvasId = requiredString(input, 'canvasId')
        const project = await useCanvasStore.getState().openProject(canvasId)
        if (!project) throw new Error(`画布不存在: ${canvasId}`)
        await useArticleStore.getState().addTab(createCanvasTab(project))
        await assertWorkspaceUnchanged(workspace)
        return textResult('已在 NoteGen 中打开画布', { canvasId })
      }
      case 'canvas_create_diagram':
      case 'canvas_apply_operations': {
        const canvasId = requiredString(input, 'canvasId')
        if (!await useCanvasStore.getState().openProject(canvasId)) throw new Error(`画布不存在: ${canvasId}`)
        const internalName = toolName === 'canvas_create_diagram' ? 'canvas_create_diagram' : 'canvas_apply_operations'
        const result = await runAgentTool(internalName, input, { activeCanvasId: canvasId })
        await useCanvasStore.getState().saveProject(canvasId)
        await assertWorkspaceUnchanged(workspace)
        return textResult(result.message, { canvas: result.data ?? null })
      }
      case 'canvas_rename': {
        const canvasId = requiredString(input, 'canvasId')
        await useCanvasStore.getState().renameProject(canvasId, requiredString(input, 'title'))
        await assertWorkspaceUnchanged(workspace)
        return textResult('已重命名画布', { canvasId, title: input.title })
      }
      case 'canvas_delete':
      case 'canvas_restore': {
        const canvasId = requiredString(input, 'canvasId')
        if (toolName === 'canvas_delete') await useCanvasStore.getState().deleteProject(canvasId)
        else if (!await useCanvasStore.getState().restoreProject(canvasId)) throw new Error(`画布不存在: ${canvasId}`)
        await assertWorkspaceUnchanged(workspace)
        return textResult(toolName === 'canvas_delete' ? '已将画布移入回收站' : '已恢复画布', { canvasId })
      }
      case 'tag_list': {
        const tags = await getTags()
        await assertWorkspaceUnchanged(workspace)
        return textResult(`找到 ${tags.length} 个标签`, { tags })
      }
      default:
        return errorResult('unknown_tool', `未知的 NoteGen 工具: ${toolName}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return message === 'workspace_changed'
      ? errorResult('workspace_changed', '执行期间工作区已切换，操作已取消')
      : errorResult('tool_error', message)
  }
}
