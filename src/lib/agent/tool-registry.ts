import type OpenAI from 'openai'
import useArticleStore from '@/stores/article'
import { useMcpStore } from '@/stores/mcp'
import { callTool as callMcpTool } from '@/lib/mcp/tools'
import { normalizeMcpToolResult } from '@/lib/mcp/result-normalizer'
import { buildMcpAgentToolCatalog } from '@/lib/mcp/agent-tools'
import { mcpServerManager } from '@/lib/mcp/server-manager'
import { skillManager } from '@/lib/skills'
import {
  BUILTIN_SKILL_CREATOR,
  installSkillPackage,
  validateSkillPackage,
  type SkillPackageInput,
} from '@/lib/skills/creator'
import { useSkillsStore } from '@/stores/skills'
import {
  inspectRemoteSkill,
  installRemoteSkill,
  searchRemoteSkills,
} from '@/lib/skills/remote'
import { uninstallSkill } from '@/lib/skills/uninstall'
import {
  getEditorContentTool,
  getEditorSelectionTool,
  replaceEditorContentTool,
  insertAtCursorTool,
} from './tools/editor-tools'
import {
  listMarkdownFilesTool,
  readMarkdownFileTool,
  openMarkdownFileTool,
  createFileTool,
  updateMarkdownFileTool,
  deleteMarkdownFileTool,
  readMarkdownFilesBatchTool,
  listMarkdownFilesByDateTool,
  renameFileTool,
  moveFileTool,
  copyFileTool,
} from './tools/note-tools'
import { listFoldersTool, checkFolderExistsTool, createFolderTool, deleteFolderTool } from './tools/folder-tools'
import { listTagsTool, createTagTool, updateTagTool, deleteTagTool, searchTagsTool } from './tools/tag-tools'
import { readMarksTool, createMarkTool, updateMarkTool, deleteMarkTool } from './tools/mark-tools'
import { saveMemoryTool, listMemoriesTool, deleteMemoryTool, clearMemoriesTool } from './tools/memory-tools'
import { attachmentTools } from './tools/attachment-tools'
import { imageTools } from './tools/image-tools'
import { canvasTools } from './tools/canvas-tools'
import { webTools } from './tools/web-tools'
import { knowledgeTools } from './tools/knowledge-tools'
import {
  executeRegisteredSkillScript,
  executeSkillScriptTool,
  installSkillDependencies,
  installSkillPythonDependenciesTool,
} from './tools/system-tools'
import type {
  AgentChange,
  AgentTool,
  AgentToolExecutionContext,
  AgentToolResult,
  JsonSchema,
  Tool,
  ToolResult,
} from './types'
import type { EditorTransactionInput } from './editor-adapter'
import { buildEditorChange, prepareEditorLineTransaction } from './editor-adapter'
import {
  ensureSafeWorkspaceRelativePath,
  toWorkspaceRelativePath,
} from '@/lib/workspace'

const EMPTY_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {},
  required: [],
  additionalProperties: false,
}

function asObject(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {}
}

function resultFromLegacy(result: ToolResult): AgentToolResult {
  return {
    ok: result.success,
    message: result.message || result.error || (result.success ? '工具执行成功' : '工具执行失败'),
    data: result.data,
    error: result.error,
  }
}

async function normalizeAgentWorkspacePath(filePath: string): Promise<string> {
  return await ensureSafeWorkspaceRelativePath(
    await toWorkspaceRelativePath(filePath)
  )
}

function createChangeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : ''
}

const RESERVED_SKILL_RUNTIME_PATH = /(?:^|\/)skills\/[^/]+\/runtime(?:\/|$)/i

function getRequestedFilePath(input: Record<string, unknown>) {
  const filePath = asString(input.filePath)
  if (filePath) return normalizeFilePathForCompare(filePath)
  const fileName = asString(input.fileName)
  const folderPath = asString(input.folderPath)
  return normalizeFilePathForCompare(folderPath ? `${folderPath}/${fileName}` : fileName)
}

function rejectGeneratedSkillRuntimeFile(input: Record<string, unknown>): AgentToolResult | undefined {
  const filePath = getRequestedFilePath(input)
  if (!RESERVED_SKILL_RUNTIME_PATH.test(filePath)) return undefined

  return {
    ok: false,
    message: [
      `已阻止在笔记工作区创建或修改 Skill 运行时代码：${filePath}。`,
      '已安装的 Skill 资源是只读的；请使用 skill_read_resource 读取，并通过 skill_execute_script 执行已注册脚本。',
    ].join('\n'),
    error: 'RESERVED_SKILL_RUNTIME_PATH',
  }
}

function rejectGeneratedSkillRuntimeFolder(input: Record<string, unknown>): AgentToolResult | undefined {
  const folderPath = normalizeFilePathForCompare(asString(input.folderPath))
  if (!RESERVED_SKILL_RUNTIME_PATH.test(folderPath)) return undefined
  return {
    ok: false,
    message: `已阻止创建保留的 Skill 运行时目录：${folderPath}。Skill 资源只能通过 Skill 工具访问。`,
    error: 'RESERVED_SKILL_RUNTIME_PATH',
  }
}

function buildFileChange(config: {
  target: string
  before?: string
  after?: string
  summary: string
  reversible?: boolean
}): AgentChange {
  return {
    id: createChangeId(),
    type: 'file',
    target: config.target,
    before: config.before,
    after: config.after,
    reversible: config.reversible ?? true,
    summary: config.summary,
  }
}

function buildStructuralChange(config: {
  type: AgentChange['type']
  target: string
  summary: string
  reversible?: boolean
}): AgentChange {
  return {
    id: createChangeId(),
    type: config.type,
    target: config.target,
    reversible: config.reversible ?? true,
    summary: config.summary,
  }
}

async function readEditorMarkdown() {
  const result = await getEditorContentTool.execute({})
  if (!result.success || !result.data || typeof result.data !== 'object') {
    return undefined
  }

  const data = result.data as { markdown?: string }
  return typeof data.markdown === 'string' ? data.markdown : undefined
}

async function readEditorMarkdownAfterWrite(before: string | undefined) {
  let after = await readEditorMarkdown()

  for (let attempt = 0; attempt < 4 && before !== undefined && after === before; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)))
    after = await readEditorMarkdown()
  }

  return after
}

function normalizeFilePathForCompare(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function targetsActiveEditor(filePath: string) {
  const activeFilePath = useArticleStore.getState().activeFilePath
  return Boolean(
    filePath &&
    activeFilePath &&
    normalizeFilePathForCompare(filePath) === normalizeFilePathForCompare(activeFilePath)
  )
}

function legacyInputSchema(tool: Tool): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []

  for (const parameter of tool.parameters) {
    const schema: JsonSchema = {
      type: parameter.type === 'number' ? 'number' : parameter.type,
      description: parameter.description,
      default: parameter.default,
    }

    // JSON Schema requires `items` alongside `type: 'array'`. Legacy tool
    // descriptors carry no item type, so emit a permissive schema rather than a
    // bare `{ "type": "array" }`, which some providers reject outright.
    if (schema.type === 'array' && schema.items === undefined) {
      schema.items = {}
    }

    properties[parameter.name] = schema

    if (parameter.required) {
      required.push(parameter.name)
    }
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true,
  }
}

function adaptLegacyTool(config: {
  name: string
  title: string
  description?: string
  category: AgentTool['category']
  risk: AgentTool['risk']
  legacy: Tool
  inputSchema?: JsonSchema
  beforeExecute?: (input: Record<string, unknown>) => AgentToolResult | undefined
  execute?: (input: Record<string, unknown>, context: AgentToolExecutionContext) => Promise<AgentToolResult>
}): AgentTool {
  return {
    name: config.name,
    title: config.title,
    description: config.description || config.legacy.description,
    category: config.category,
    risk: config.risk,
    legacyName: config.legacy.name,
    inputSchema: config.inputSchema || legacyInputSchema(config.legacy),
    execute: async (input, context) => {
      const blocked = config.beforeExecute?.(input)
      if (blocked) {
        return blocked
      }

      if (config.execute) {
        return config.execute(input, context)
      }

      return resultFromLegacy(await config.legacy.execute(input as Record<string, any>))
    },
  }
}

export interface EditorApprovalPreview {
  previewParams: Record<string, unknown>
  originalContent: string
  modifiedContent: string
  filePath?: string
  from?: number
  to?: number
}

export async function buildEditorApprovalPreview(
  toolName: string,
  input: Record<string, unknown>
): Promise<EditorApprovalPreview | undefined> {
  if (!['editor_apply_transaction', 'editor_replace_lines', 'editor_replace_range'].includes(toolName)) {
    return undefined
  }

  if (toolName === 'editor_replace_range') {
    const from = typeof input.from === 'number' ? Math.max(0, input.from) : undefined
    const to = typeof input.to === 'number' && from !== undefined
      ? Math.max(from, input.to)
      : undefined
    const replacement = typeof input.content === 'string' ? input.content : undefined
    if (from === undefined || to === undefined || replacement === undefined) {
      return undefined
    }

    const selectionResult = await getEditorSelectionTool.execute({})
    const selection = selectionResult.data && typeof selectionResult.data === 'object'
      ? selectionResult.data as { text?: unknown; from?: unknown; to?: unknown }
      : undefined
    const selectedText = selection?.from === from && selection?.to === to && typeof selection.text === 'string'
      ? selection.text
      : ''

    return {
      previewParams: input,
      originalContent: selectedText,
      modifiedContent: replacement,
      filePath: useArticleStore.getState().activeFilePath || (
        typeof input.filePath === 'string' ? input.filePath : undefined
      ),
      from,
      to,
    }
  }

  const stateResult = await getEditorContentTool.execute({})
  if (!stateResult.success || !stateResult.data || typeof stateResult.data !== 'object') {
    return undefined
  }

  const state = stateResult.data as { markdown?: unknown }
  if (typeof state.markdown !== 'string') {
    return undefined
  }

  const before = state.markdown
  let after = before

  if (toolName === 'editor_apply_transaction') {
    const transaction = input as unknown as EditorTransactionInput
    if (!Array.isArray(transaction.operations) || transaction.operations.length === 0) {
      return undefined
    }
    const prepared = prepareEditorLineTransaction(before, transaction.operations)
    if (!prepared.ok) {
      return undefined
    }
    after = prepared.markdown
  } else if (toolName === 'editor_replace_lines') {
    const startLine = typeof input.startLine === 'number' ? input.startLine : 1
    const endLine = typeof input.endLine === 'number' ? input.endLine : startLine
    const replacement = typeof input.replaceContent === 'string' ? input.replaceContent : ''
    const lines = before.split('\n')
    lines.splice(
      Math.max(0, startLine - 1),
      Math.max(0, endLine - startLine + 1),
      ...replacement.split('\n')
    )
    after = lines.join('\n')
  }

  if (after === before) {
    return undefined
  }

  return {
    previewParams: input,
    originalContent: before,
    modifiedContent: after,
    filePath: useArticleStore.getState().activeFilePath || (
      typeof input.filePath === 'string' ? input.filePath : undefined
    ),
  }
}

async function executeEditorTransaction(input: Record<string, unknown>): Promise<AgentToolResult> {
  const transaction = input as unknown as EditorTransactionInput
  if (!Array.isArray(transaction.operations) || transaction.operations.length === 0) {
    return {
      ok: false,
      message: '缺少编辑操作。',
      error: 'operations must be a non-empty array',
    }
  }
  if (!targetsActiveEditor(transaction.filePath)) {
    return {
      ok: false,
      message: '活动编辑器已切换，未执行事务。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }

  const stateResult = await getEditorContentTool.execute({})
  if (!targetsActiveEditor(transaction.filePath)) {
    return {
      ok: false,
      message: '读取内容期间活动编辑器已切换，未执行事务。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }
  if (!stateResult.success || !stateResult.data || typeof stateResult.data !== 'object') {
    return resultFromLegacy(stateResult)
  }

  const state = stateResult.data as {
    markdown?: string
    totalLines?: number
    version?: number
  }
  const before = state.markdown || ''
  if (typeof transaction.version !== 'number') {
    return {
      ok: false,
      message: '缺少编辑器版本 version，请使用执行开始时提供的版本。',
      error: 'EDITOR_VERSION_REQUIRED',
    }
  }
  if (transaction.version !== state.version) {
    return {
      ok: false,
      message: `编辑器内容版本已变化：请求版本 ${transaction.version}，当前版本 ${state.version}。请重新读取编辑器状态后再修改。`,
      error: 'EDITOR_VERSION_MISMATCH',
      data: { expectedVersion: transaction.version, currentVersion: state.version },
    }
  }

  const prepared = prepareEditorLineTransaction(before, transaction.operations)
  if (!prepared.ok) {
    return {
      ok: false,
      message: prepared.error,
      error: 'INVALID_EDITOR_TRANSACTION',
    }
  }
  const after = prepared.markdown

  if (after === before) {
    return {
      ok: true,
      message: '编辑器内容无需修改。',
      data: { unchanged: true },
    }
  }

  const replaceResult = await replaceEditorContentTool.execute({
    filePath: transaction.filePath,
    startLine: 1,
    endLine: state.totalLines || before.split('\n').length,
    replaceContent: after,
    version: transaction.version,
  })

  const normalized = resultFromLegacy(replaceResult)
  if (!targetsActiveEditor(transaction.filePath)) {
    return {
      ok: false,
      message: '编辑期间活动编辑器已切换，无法安全验证事务结果。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }
  if (!normalized.ok) {
    return normalized
  }

  if (resultReportsNoChange(normalized)) {
    return normalized
  }

  return {
    ...normalized,
    changes: [
      buildEditorChange(transaction.filePath || useArticleStore.getState().activeFilePath || 'current editor', before, after),
    ],
  }
}

async function executeEditorLegacyWrite(input: Record<string, unknown>, legacy: Tool): Promise<AgentToolResult> {
  const requestedFilePath = asString(input.filePath)
  if (!requestedFilePath || !targetsActiveEditor(requestedFilePath)) {
    return {
      ok: false,
      message: '活动编辑器已切换，未执行写入。请重新读取当前编辑器状态后再试。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }

  const before = await readEditorMarkdown()
  if (!targetsActiveEditor(requestedFilePath)) {
    return {
      ok: false,
      message: '读取内容期间活动编辑器已切换，未执行写入。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }

  const legacyResult = await legacy.execute(input as Record<string, any>)
  const normalized = resultFromLegacy(legacyResult)

  if (!normalized.ok) {
    return normalized
  }

  if (!targetsActiveEditor(requestedFilePath)) {
    return {
      ok: false,
      message: '编辑期间活动编辑器已切换，无法安全验证结果。',
      error: 'EDITOR_TARGET_CHANGED',
    }
  }

  const after = await readEditorMarkdownAfterWrite(before)
  if (before === after && before !== undefined) {
    return {
      ...normalized,
      data: {
        ...(normalized.data && typeof normalized.data === 'object' ? normalized.data : {}),
        unchanged: true,
      },
      message: `${normalized.message}\n编辑器内容已是目标状态，无需重复修改。`,
    }
  }
  if (before === undefined || after === undefined) {
    return {
      ok: false,
      message: '编辑器操作已返回，但无法验证操作后的内容。为避免重复写入，已停止自动重试。',
      error: 'EDITOR_CHANGE_VERIFICATION_FAILED',
    }
  }

  return {
    ...normalized,
    changes: [
      buildEditorChange(requestedFilePath, before, after),
    ],
  }
}

async function readNoteContentForChange(filePath: string) {
  if (!filePath) {
    return undefined
  }

  const result = await readMarkdownFileTool.execute({ filePath })
  if (!result.success || !result.data || typeof result.data !== 'object') {
    return undefined
  }

  const data = result.data as { content?: string }
  return typeof data.content === 'string' ? data.content : undefined
}

async function executeReadFileFromEditor(input: Record<string, unknown>): Promise<AgentToolResult> {
  const requestedFilePath = asString(input.filePath)
  if (!requestedFilePath) {
    return {
      ok: false,
      message: 'filePath 必须是检索结果返回的非空工作区相对路径。',
      error: 'INVALID_NOTE_FILE_PATH',
    }
  }

  let filePath: string
  try {
    filePath = await normalizeAgentWorkspacePath(requestedFilePath)
  } catch (error) {
    return {
      ok: false,
      message: `无法读取该路径：${String(error)}`,
      error: 'INVALID_NOTE_FILE_PATH',
    }
  }
  const normalizedInput = { ...input, filePath }
  if (!targetsActiveEditor(filePath)) {
    return resultFromLegacy(await readMarkdownFileTool.execute(normalizedInput as Record<string, any>))
  }

  const editorResult = await getEditorContentTool.execute({})
  const normalized = resultFromLegacy(editorResult)
  if (!normalized.ok || !editorResult.data || typeof editorResult.data !== 'object') {
    return normalized
  }

  const editorState = editorResult.data as {
    markdown?: unknown
    version?: unknown
    totalLines?: unknown
    charCount?: unknown
  }
  if (typeof editorState.markdown !== 'string') {
    return {
      ok: false,
      message: '当前编辑器没有返回可读取的 Markdown 内容。',
      error: 'EDITOR_CONTENT_UNAVAILABLE',
    }
  }

  return {
    ok: true,
    message: `已从实时编辑器读取当前文件: ${filePath}`,
    data: {
      filePath,
      content: editorState.markdown,
      source: 'editor',
      version: editorState.version,
      totalLines: editorState.totalLines,
      charCount: editorState.charCount,
    },
  }
}

async function executeReadFilesBatch(input: Record<string, unknown>): Promise<AgentToolResult> {
  if (!Array.isArray(input.filePaths) || input.filePaths.length === 0) {
    return {
      ok: false,
      message: 'filePaths 必须包含至少一个由笔记检索返回的工作区相对路径。',
      error: 'EMPTY_NOTE_FILE_PATHS',
    }
  }

  const requestedPaths = input.filePaths.filter(
    (filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0
  )
  if (requestedPaths.length === 0) {
    return {
      ok: false,
      message: 'filePaths 中没有可读取的路径。不要调用空批量读取。',
      error: 'EMPTY_NOTE_FILE_PATHS',
    }
  }

  try {
    const normalizedPaths = Array.from(new Set(
      await Promise.all(requestedPaths.map(normalizeAgentWorkspacePath))
    ))
    return resultFromLegacy(await readMarkdownFilesBatchTool.execute({
      filePaths: normalizedPaths,
    }))
  } catch (error) {
    return {
      ok: false,
      message: `批量读取路径无效：${String(error)}`,
      error: 'INVALID_NOTE_FILE_PATHS',
    }
  }
}

function parseIsoCalendarDate(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return undefined
  }
  return timestamp
}

const dateDifferenceTool: AgentTool = {
  name: 'calculate_date_difference',
  title: '计算日期间隔',
  description: 'Calculate the exact calendar-day difference between two ISO dates. Always use this tool after retrieving dates when the answer asks how many days apart they are; do not estimate or count mentally.',
  category: 'system',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'Earlier or starting date in YYYY-MM-DD format.' },
      endDate: { type: 'string', description: 'Later or ending date in YYYY-MM-DD format.' },
    },
    required: ['startDate', 'endDate'],
    additionalProperties: false,
  },
  execute: async (input) => {
    const startDate = asString(input.startDate)
    const endDate = asString(input.endDate)
    const start = parseIsoCalendarDate(startDate)
    const end = parseIsoCalendarDate(endDate)
    if (start === undefined || end === undefined) {
      return {
        ok: false,
        message: '日期必须是真实有效的 YYYY-MM-DD 格式。',
        error: 'INVALID_ISO_DATE',
      }
    }
    const signedDays = Math.round((end - start) / 86_400_000)
    return {
      ok: true,
      message: `${startDate} 到 ${endDate} 相隔 ${Math.abs(signedDays)} 个自然日。`,
      data: {
        startDate,
        endDate,
        signedDays,
        absoluteDays: Math.abs(signedDays),
      },
    }
  },
}

function filePathFromCreateResult(input: Record<string, unknown>, result: AgentToolResult) {
  if (result.data && typeof result.data === 'object') {
    const data = result.data as { filePath?: unknown }
    if (typeof data.filePath === 'string') {
      return data.filePath
    }
  }

  const fileName = asString(input.fileName)
  const folderPath = asString(input.folderPath)
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

async function executeCreateFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await createFileTool.execute(input as Record<string, any>))

  if (!normalized.ok) {
    return normalized
  }

  if (resultReportsNoChange(normalized)) {
    return normalized
  }

  const target = filePathFromCreateResult(input, normalized)
  return {
    ...normalized,
    changes: [
      buildFileChange({
        target,
        after: asString(input.content),
        summary: `创建文件 ${target}`,
      }),
    ],
  }
}

async function executeUpdateFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const filePath = asString(input.filePath)
  if (targetsActiveEditor(filePath)) {
    const stateResult = await getEditorContentTool.execute({})
    if (!stateResult.success || !stateResult.data || typeof stateResult.data !== 'object') {
      return resultFromLegacy(stateResult)
    }

    const state = stateResult.data as {
      markdown?: unknown
      totalLines?: unknown
      version?: unknown
    }
    if (
      typeof state.markdown !== 'string' ||
      typeof state.totalLines !== 'number' ||
      typeof state.version !== 'number'
    ) {
      return {
        ok: false,
        message: '当前编辑器状态不完整，无法安全更新文件。',
        error: 'EDITOR_STATE_INCOMPLETE',
      }
    }

    const before = state.markdown
    const after = asString(input.content)
    if (before === after) {
      return {
        ok: true,
        message: `当前编辑器内容已是目标状态，无需重复更新: ${filePath}`,
        data: { filePath, source: 'editor', unchanged: true },
      }
    }

    const replaceResult = resultFromLegacy(await replaceEditorContentTool.execute({
      startLine: 1,
      endLine: state.totalLines,
      replaceContent: after,
      version: state.version,
    }))
    if (!replaceResult.ok) {
      return replaceResult
    }

    return {
      ...replaceResult,
      message: `已通过实时编辑器更新当前文件: ${filePath}`,
      data: {
        ...(replaceResult.data && typeof replaceResult.data === 'object' ? replaceResult.data : {}),
        filePath,
        source: 'editor',
      },
      changes: [
        buildEditorChange(filePath, before, after),
      ],
    }
  }

  const before = await readNoteContentForChange(filePath)
  const normalized = resultFromLegacy(await updateMarkdownFileTool.execute(input as Record<string, any>))

  if (!normalized.ok) {
    return normalized
  }

  if (resultReportsNoChange(normalized)) {
    return normalized
  }

  return {
    ...normalized,
    changes: [
      buildFileChange({
        target: filePath,
        before,
        after: asString(input.content),
        summary: `更新文件 ${filePath}`,
      }),
    ],
  }
}

async function executeDeleteFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const filePath = asString(input.filePath)
  const before = await readNoteContentForChange(filePath)
  const normalized = resultFromLegacy(await deleteMarkdownFileTool.execute(input as Record<string, any>))

  if (!normalized.ok) {
    return normalized
  }

  const alreadyAbsent = Boolean(
    normalized.data &&
    typeof normalized.data === 'object' &&
    'alreadyAbsent' in normalized.data &&
    normalized.data.alreadyAbsent === true
  )
  if (alreadyAbsent) {
    return normalized
  }

  return {
    ...normalized,
    changes: [
      buildFileChange({
        target: filePath,
        before,
        summary: `删除文件 ${filePath}`,
        reversible: Boolean(before),
      }),
    ],
  }
}

function resultDataPath(result: AgentToolResult, key: string) {
  if (!result.data || typeof result.data !== 'object') {
    return ''
  }

  const value = (result.data as Record<string, unknown>)[key]
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return ''
}

function resultReportsNoChange(result: AgentToolResult) {
  if (!result.data || typeof result.data !== 'object') {
    return false
  }

  const data = result.data as Record<string, unknown>
  return data.alreadyAbsent === true
    || data.alreadyExists === true
    || data.unchanged === true
    || data.alreadyRenamed === true
    || data.alreadyMoved === true
}

async function executeRenameFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await renameFileTool.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }

  const oldPath = resultDataPath(normalized, 'oldPath') || asString(input.filePath)
  const newPath = resultDataPath(normalized, 'newPath') || asString(input.newName)
  if (resultReportsNoChange(normalized)) {
    return normalized
  }
  return {
    ...normalized,
    changes: [
      buildFileChange({
        target: newPath,
        summary: `重命名文件 ${oldPath} -> ${newPath}`,
      }),
    ],
  }
}

async function executeMoveFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await moveFileTool.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }

  const oldPath = resultDataPath(normalized, 'oldPath') || asString(input.filePath)
  const newPath = resultDataPath(normalized, 'newPath') || asString(input.targetFolderPath)
  if (resultReportsNoChange(normalized)) {
    return normalized
  }
  return {
    ...normalized,
    changes: [
      buildFileChange({
        target: newPath,
        summary: `移动文件 ${oldPath} -> ${newPath}`,
      }),
    ],
  }
}

async function executeCopyFileWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const sourcePath = asString(input.filePath)
  const before = await readNoteContentForChange(sourcePath)
  const normalized = resultFromLegacy(await copyFileTool.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }

  const newPath = resultDataPath(normalized, 'newPath') || asString(input.newName) || sourcePath
  return {
    ...normalized,
    changes: [
      buildFileChange({
        target: newPath,
        after: before,
        summary: `复制文件 ${sourcePath} -> ${newPath}`,
      }),
    ],
  }
}

async function executeFolderCreateWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await createFolderTool.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }

  const target = resultDataPath(normalized, 'folderPath') || asString(input.folderPath)
  if (resultReportsNoChange(normalized)) {
    return normalized
  }
  return {
    ...normalized,
    changes: [
      buildStructuralChange({
        type: 'folder',
        target,
        summary: `创建文件夹 ${target}`,
      }),
    ],
  }
}

async function executeFolderDeleteWithChange(input: Record<string, unknown>): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await deleteFolderTool.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }

  if (resultReportsNoChange(normalized)) {
    return normalized
  }

  const target = asString(input.folderPath)
  return {
    ...normalized,
    changes: [
      buildStructuralChange({
        type: 'folder',
        target,
        summary: `删除文件夹 ${target}`,
        reversible: false,
      }),
    ],
  }
}

async function executeStructuralToolWithChange(
  input: Record<string, unknown>,
  legacy: Tool,
  type: AgentChange['type'],
  summary: (input: Record<string, unknown>, result: AgentToolResult) => string,
  target: (input: Record<string, unknown>, result: AgentToolResult) => string,
  reversible = true
): Promise<AgentToolResult> {
  const normalized = resultFromLegacy(await legacy.execute(input as Record<string, any>))
  if (!normalized.ok) {
    return normalized
  }


  if (resultReportsNoChange(normalized)) {
    return normalized
  }

  return {
    ...normalized,
    changes: [
      buildStructuralChange({
        type,
        target: target(input, normalized),
        summary: summary(input, normalized),
        reversible,
      }),
    ],
  }
}

const editorApplyTransactionTool: AgentTool = {
  name: 'editor_apply_transaction',
  title: '应用编辑器事务',
  description: 'Apply line insertion or multiple non-overlapping line edits to the current Markdown editor in one approval. Operations accept only replace_lines, insert_before_line, or insert_after_line. Every insertion operation must include an integer line; use insert_after_line with line=totalLines to append at the end. Never use replace_range inside operations. Use editor_replace_lines for one contiguous replacement and editor_replace_range only for an exact quoted selection.',
  category: 'editor',
  risk: 'editor-write',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Exact current editor file path.' },
      version: { type: 'number', description: 'Required editor version from the run-start snapshot or editor_get_state.' },
      operations: {
        type: 'array',
        description: 'One or more non-overlapping edits whose line numbers all refer to the original editor snapshot. Allowed operation types: replace_lines, insert_before_line, insert_after_line. Insertion operations require line; for end-of-document append use line=totalLines.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['replace_lines', 'insert_after_line', 'insert_before_line'],
            },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
            line: { type: 'number', description: 'Required integer for insert_before_line/insert_after_line. Use totalLines to append after the document end.' },
            content: { type: 'string' },
          },
          required: ['type', 'content'],
          additionalProperties: false,
        },
      },
    },
    required: ['filePath', 'version', 'operations'],
    additionalProperties: false,
  },
  execute: executeEditorTransaction,
}

function buildSkillListTool(): AgentTool {
  return {
    name: 'skill_list',
    title: '列出已安装 Skills',
    description: 'List every installed Skill, including disabled entries, with the exact skill_id and scope required by skill_uninstall. Call this before uninstalling when the target is unclear or the user asks to remove multiple or all Skills. Entries with removable=false must never be uninstalled.',
    category: 'skill',
    risk: 'read',
    inputSchema: EMPTY_SCHEMA,
    execute: async () => {
      await useSkillsStore.getState().initSkills()
      const installedSkills = skillManager.getAllInstalledSkills()
      const skills = [
        {
          skill_id: BUILTIN_SKILL_CREATOR.id,
          name: BUILTIN_SKILL_CREATOR.name,
          description: BUILTIN_SKILL_CREATOR.description,
          scope: 'built-in',
          enabled: true,
          builtIn: true,
          removable: false,
        },
        ...installedSkills
          .filter((skill) => skill.metadata.id !== BUILTIN_SKILL_CREATOR.id)
          .map((skill) => ({
            skill_id: skill.metadata.id,
            name: skill.metadata.name,
            description: skill.metadata.description,
            scope: skill.metadata.scope,
            enabled: skill.metadata.enabled !== false,
            builtIn: false,
            removable: true,
          })),
      ]
      return {
        ok: true,
        message: `Found ${installedSkills.length} installed Skill(s). Use each entry's exact skill_id and scope for skill_uninstall; do not infer IDs from names.`,
        data: skills,
      }
    },
  }
}

function buildSkillLoadTool(): AgentTool {
  return {
    name: 'skill_load',
    title: '加载 Skill',
    description: 'Load one installed Skill atomically. Returns its complete instructions, read-only resource index, and exact registered script IDs. Load a matching Skill once, then act using the returned resources; do not call skill_list or reload it.',
    category: 'skill',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Skill ID to load.' },
      },
      required: ['skill_id'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const skillId = asString(input.skill_id)
      if (skillId === BUILTIN_SKILL_CREATOR.id) {
        return {
          ok: true,
          message: `Loaded built-in Skill "${BUILTIN_SKILL_CREATOR.id}". Follow its workflow to validate and install the requested Skill package.`,
          data: {
            id: BUILTIN_SKILL_CREATOR.id,
            name: BUILTIN_SKILL_CREATOR.name,
            description: BUILTIN_SKILL_CREATOR.description,
            base_uri: `builtin-skill://${BUILTIN_SKILL_CREATOR.id}/`,
            instructions: BUILTIN_SKILL_CREATOR.instructions,
            resources: [],
            scripts: [],
            builtIn: true,
          },
        }
      }
      const skill = skillManager.getSkill(skillId)
      const fileInfo = skillManager.getSkillFileInfo(skillId)
      if (!skill || !fileInfo) {
        return {
          ok: false,
          message: `Skill not found: ${skillId}`,
          error: 'SKILL_NOT_FOUND',
        }
      }
      if (skill.metadata.enabled === false) {
        return {
          ok: false,
          message: `Skill is disabled: ${skillId}`,
          error: 'SKILL_DISABLED',
        }
      }

      const resources = [
        { path: 'SKILL.md', uri: `skill://${skillId}/SKILL.md`, type: 'instructions', readable: true, executable: false },
        ...skill.scripts.map(script => ({
          path: `scripts/${script.name}`,
          uri: `skill://${skillId}/scripts/${script.name}`,
          type: 'script',
          readable: true,
          executable: true,
        })),
        ...skill.references.map(reference => {
          const stored = reference.path.replace(/\\/g, '/')
          const directory = fileInfo.directory.replace(/\\/g, '/').replace(/\/+$/, '')
          const path = stored.startsWith(`${directory}/`)
            ? stored.slice(directory.length + 1)
            : stored
          return { path, uri: `skill://${skillId}/${path}`, type: 'reference', readable: true, executable: false }
        }),
        ...skill.assets.map(asset => {
          const stored = asset.path.replace(/\\/g, '/')
          const directory = fileInfo.directory.replace(/\\/g, '/').replace(/\/+$/, '')
          const path = stored.startsWith(`${directory}/`)
            ? stored.slice(directory.length + 1)
            : stored
          return { path, uri: `skill://${skillId}/${path}`, type: 'asset', readable: true, executable: false }
        }),
      ]

      return {
        ok: true,
        message: [
          `Loaded Skill "${skillId}" with complete instructions and ${skill.scripts.length} registered script(s).`,
          'The returned skill:// resources are installed and read-only. Never recreate or copy them into the note workspace.',
          skill.scripts.length > 0
            ? `Available script IDs: ${skill.scripts.map(script => script.name).join(', ')}`
            : 'This Skill has no registered scripts.',
          `For a user-visible output argument, always use a relative path beginning with article/outputs/${skillId}/. The runtime also redirects new recognized artifact files into that directory.`,
          `Registered scripts run with article/outputs/${skillId}/ as their working directory, so bare relative output names remain inside the user-visible output area.`,
          'Do not call skill_load or skill_list again for this Skill in the current task.',
        ].join('\n'),
        data: {
          id: skillId,
          name: skill.metadata.name,
          description: skill.metadata.description,
          base_uri: `skill://${skillId}/`,
          output_directory: `article/outputs/${skillId}/`,
          instructions: skill.instructions,
          resources,
          scripts: skill.scripts.map(script => ({
            id: script.name,
            type: script.type,
            description: script.description,
            sha256: script.sha256,
          })),
        },
      }
    },
  }
}

function skillPackageInput(input: Record<string, unknown>): SkillPackageInput {
  const files = Array.isArray(input.files)
    ? input.files.map((file) => {
        const value = asObject(file)
        return {
          path: asString(value.path),
          content: asString(value.content),
        }
      })
    : []
  return {
    name: asString(input.name),
    description: asString(input.description),
    instructions: asString(input.instructions),
    files,
    removeFiles: Array.isArray(input.removeFiles) ? input.removeFiles.map(String) : [],
    scope: input.scope === 'project' ? 'project' : 'global',
    replaceExisting: input.replaceExisting === true,
  }
}

const SKILL_PACKAGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short verb-led kebab-case Skill name. Must match the installed directory.' },
    description: { type: 'string', description: 'Describe both what the Skill does and the user requests that should trigger it.' },
    instructions: { type: 'string', description: 'Complete concise SKILL.md body in imperative form. Do not include YAML frontmatter.' },
    files: {
      type: 'array',
      description: 'Optional text resources below scripts/, references/, assets/, or agents/. Do not include SKILL.md.',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    removeFiles: {
      type: 'array',
      description: 'Exact existing resource paths to delete during an explicit update. Omitted resources are preserved.',
      items: { type: 'string' },
    },
    scope: { type: 'string', enum: ['global', 'project'], description: 'Use project for workspace-specific Skills and global for reusable personal Skills.' },
    replaceExisting: { type: 'boolean', description: 'Set true only when the user explicitly asked to update an installed Skill with the same name.' },
  },
  required: ['name', 'description', 'instructions', 'scope'],
  additionalProperties: false,
}

function buildSkillValidatePackageTool(): AgentTool {
  return {
    name: 'skill_validate_package',
    title: '校验 Skill 包',
    description: 'Validate a complete proposed Skill package without changing files. Always call this before skill_install_package and fix every returned error.',
    category: 'skill',
    risk: 'read',
    inputSchema: SKILL_PACKAGE_SCHEMA,
    execute: async (input) => {
      try {
        const validation = await validateSkillPackage(skillPackageInput(input))
        return {
          ok: validation.valid,
          message: validation.valid
            ? `Skill package is valid (${validation.fileCount} files, ${validation.totalBytes} bytes).${validation.warnings.length ? ` Warnings: ${validation.warnings.join('; ')}` : ''}`
            : `Skill package validation failed: ${validation.errors.join('; ')}`,
          data: validation,
          error: validation.valid ? undefined : 'SKILL_PACKAGE_INVALID',
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'SKILL_PACKAGE_VALIDATION_FAILED',
        }
      }
    },
  }
}

function buildSkillInstallPackageTool(): AgentTool {
  return {
    name: 'skill_install_package',
    title: '安装 Skill 包',
    description: 'Atomically install a package that already passed skill_validate_package. This writes to NoteGen Skills, backs up an explicitly replaced version, reloads Skills, and requires write approval according to the current permission mode.',
    category: 'skill',
    risk: 'skill-install',
    inputSchema: SKILL_PACKAGE_SCHEMA,
    execute: async (input) => {
      try {
        const result = await installSkillPackage(skillPackageInput(input))
        await useSkillsStore.getState().refreshSkills()
        return {
          ok: true,
          message: `${result.replaced ? 'Updated' : 'Installed'} Skill "${result.name}" in ${result.scope} scope with ${result.fileCount} files${result.hasScripts ? ' and executable scripts' : ''}.`,
          data: result,
          changes: [buildStructuralChange({
            type: 'folder',
            target: `${result.scope}:skills/${result.name}`,
            summary: `${result.replaced ? '更新' : '安装'} Skill ${result.name}`,
          })],
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'SKILL_PACKAGE_INSTALL_FAILED',
        }
      }
    },
  }
}

function buildRemoteSkillSearchTool(): AgentTool {
  return {
    name: 'skill_search_remote',
    title: '搜索第三方 Skill',
    description: 'Search public GitHub repositories for Agent Skills whose SKILL.md name or description matches the user request. GitHub must be connected. Use this only when the user asks to find or install a third-party Skill and has not already provided a source URL.',
    category: 'skill',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Concise English search terms describing the desired capability.',
        },
        limit: {
          type: 'number',
          description: 'Maximum candidates to return, from 1 to 15.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: async (input) => {
      try {
        const results = await searchRemoteSkills(
          asString(input.query),
          typeof input.limit === 'number' ? input.limit : 8,
        )
        const usedCache = results.some(result => result.cached)
        return {
          ok: true,
          message: results.length > 0
            ? `Found ${results.length} remote Skills${usedCache ? ' from the local search cache because GitHub was unavailable' : ''}. Present the best matches and inspect the selected source before installation.`
            : 'No matching remote Skills were found. Refine the query or offer to create a new Skill.',
          data: results,
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'REMOTE_SKILL_SEARCH_FAILED',
        }
      }
    },
  }
}

function buildRemoteSkillInspectTool(): AgentTool {
  return {
    name: 'skill_inspect_source',
    title: '检查第三方 Skill',
    description: 'Download a GitHub, GitLab, Gitee, Codeberg/Gitea, or direct HTTPS ZIP source into an isolated cache, pin repository sources to a commit, validate the archive, and return an installation preview. Always call this before skill_install_source. The source may come from skill_search_remote or an explicit user-provided URL.',
    category: 'skill',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Exact sourceUrl returned by skill_search_remote, a supported repository Skill URL, owner/repository shorthand, or an explicit HTTPS ZIP URL from the user.',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      try {
        const preview = await inspectRemoteSkill(asString(input.source), context.signal)
        return {
          ok: true,
          message: `Inspected remote Skill "${preview.name}" from ${preview.provider} at revision ${preview.revision}. It contains ${preview.files.length} files${preview.hasScripts ? ' including executable scripts' : ' and no executable scripts'}${preview.warnings.length > 0 ? ` and ${preview.warnings.length} risk warning(s) that require user confirmation` : ''}. If the user asked to install it, call skill_install_source immediately with the exact preview fields so the app opens its confirmation panel. Never ask the user to type or reply with confirmation.`,
          data: preview,
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'REMOTE_SKILL_INSPECTION_FAILED',
        }
      }
    },
  }
}

function buildRemoteSkillInstallTool(): AgentTool {
  return {
    name: 'skill_install_source',
    title: '安装第三方 Skill',
    description: 'Open the app confirmation dialog, then install the exact immutable package represented by a recent skill_inspect_source preview. When the user has asked to install a Skill, call this tool immediately after inspection; never ask them to type or reply with confirmation. The runtime trusts only preview_id; the other fields exist solely to show the user what they are approving. This action always requires explicit approval in the dialog.',
    category: 'skill',
    risk: 'skill-install',
    inputSchema: {
      type: 'object',
      properties: {
        preview_id: {
          type: 'string',
          description: 'Opaque previewId returned by skill_inspect_source.',
        },
        scope: {
          type: 'string',
          enum: ['global', 'project'],
          description: 'Use global for personal reusable Skills and project for the current workspace.',
        },
        replaceExisting: {
          type: 'boolean',
          description: 'Set true only when the user explicitly asks to replace or update an existing Skill.',
        },
        name: {
          type: 'string',
          description: 'Display-only Skill name copied from the preview.',
        },
        source: {
          type: 'string',
          description: 'Display-only source URL copied from the preview.',
        },
        revision: {
          type: 'string',
          description: 'Display-only pinned revision copied from the preview.',
        },
        has_scripts: {
          type: 'boolean',
          description: 'Display-only script risk copied from the preview.',
        },
        skipped_symlinks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Display-only list of symbolic links that will be skipped, copied from skippedSymlinks in the preview.',
        },
        warnings: {
          type: 'array',
          description: 'Display-only risk warnings copied exactly from the preview.',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              actual: { type: 'number' },
              recommended: { type: 'number' },
              paths: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['code', 'actual', 'recommended', 'paths'],
            additionalProperties: false,
          },
        },
      },
      required: ['preview_id', 'scope', 'name', 'source', 'revision', 'has_scripts', 'skipped_symlinks', 'warnings'],
      additionalProperties: false,
    },
    execute: async (input) => {
      try {
        const result = await installRemoteSkill({
          previewId: asString(input.preview_id),
          scope: input.scope === 'project' ? 'project' : 'global',
          replaceExisting: input.replaceExisting === true,
        })
        await useSkillsStore.getState().refreshSkills()
        return {
          ok: true,
          message: `${result.replaced ? 'Updated' : 'Installed'} remote Skill "${result.name}" from ${result.provider} revision ${result.revision}${result.skippedSymlinks.length > 0 ? `. Skipped ${result.skippedSymlinks.length} symbolic link(s) for safety` : ''}${result.hasScripts ? '. Executable scripts still require separate approval' : ''}.`,
          data: result,
          changes: [buildStructuralChange({
            type: 'folder',
            target: `${result.scope}:skills/${result.name}`,
            summary: `${result.replaced ? '更新' : '安装'}第三方 Skill ${result.name}`,
          })],
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'REMOTE_SKILL_INSTALL_FAILED',
        }
      }
    },
  }
}

function buildSkillUninstallTool(): AgentTool {
  return {
    name: 'skill_uninstall',
    title: '移除 Skill',
    description: 'Remove one exact installed Skill after the app shows its inline confirmation panel. Use only when the user explicitly asks to remove or uninstall a Skill. Pass the exact skill_id and scope from the prompt catalog or skill_list; do not infer IDs from display names. Never ask the user to provide an ID or type a confirmation. Entries with removable=false cannot be removed.',
    category: 'skill',
    risk: 'delete',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: {
          type: 'string',
          description: 'Exact installed Skill ID.',
        },
        scope: {
          type: 'string',
          enum: ['global', 'project'],
          description: 'Exact installed Skill scope.',
        },
      },
      required: ['skill_id', 'scope'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const skillId = asString(input.skill_id)
      const scope = input.scope === 'project' ? 'project' : 'global'
      if (skillId === BUILTIN_SKILL_CREATOR.id) {
        return {
          ok: false,
          message: 'The built-in Skill creator cannot be removed.',
          error: 'BUILTIN_SKILL_CANNOT_BE_REMOVED',
        }
      }

      await useSkillsStore.getState().initSkills()
      const skill = skillManager
        .getSkillsByScope(scope)
        .find(candidate => candidate.metadata.id === skillId)
      if (!skill) {
        return {
          ok: false,
          message: `Installed Skill not found in ${scope} scope: ${skillId}`,
          error: 'SKILL_NOT_FOUND',
        }
      }
      try {
        const result = await uninstallSkill(skillId, scope)
        await useSkillsStore.getState().refreshSkills()
        return {
          ok: true,
          message: `Removed Skill "${skill.metadata.name}" from ${scope} scope.${result.warnings.length > 0 ? ` Cleanup warning(s): ${result.warnings.join('; ')}` : ''}`,
          data: result,
          changes: [buildStructuralChange({
            type: 'folder',
            target: `${scope}:skills/${skillId}`,
            summary: `移除 Skill ${skill.metadata.name}`,
            reversible: false,
          })],
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'SKILL_UNINSTALL_FAILED',
        }
      }
    },
  }
}

function buildSkillReadResourceTool(): AgentTool {
  return {
    name: 'skill_read_resource',
    title: '读取 Skill 资源',
    description: 'Read one exact installed Skill resource listed by skill_load. Use this only when the complete instructions say a particular reference or script source is needed. Resources are read-only and must not be copied into the note workspace.',
    category: 'skill',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        skill_id: { type: 'string', description: 'Loaded Skill ID.' },
        path: { type: 'string', description: 'Exact relative resource path returned by skill_load, such as scripts/new_notebook.py.' },
      },
      required: ['skill_id', 'path'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const skillId = asString(input.skill_id)
      const path = asString(input.path)
      try {
        const content = await skillManager.readSkillResource(skillId, path)
        return {
          ok: true,
          message: `Read read-only Skill resource skill://${skillId}/${path}. Do not recreate this file in the note workspace.`,
          data: { skill_id: skillId, path, uri: `skill://${skillId}/${path}`, content },
        }
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          error: 'SKILL_RESOURCE_READ_FAILED',
        }
      }
    },
  }
}

function buildMcpCallTool(): AgentTool {
  return {
    name: 'mcp_call_tool',
    title: '调用 MCP 工具',
    description: 'Call a selected MCP server tool. Use serverId and toolName exactly as shown in the MCP catalog.',
    category: 'mcp',
    risk: 'external',
    inputSchema: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'Selected MCP server ID.' },
        toolName: { type: 'string', description: 'MCP tool name.' },
        args: {
          type: 'object',
          description: 'Arguments passed to the MCP tool.',
          additionalProperties: true,
        },
      },
      required: ['serverId', 'toolName'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const serverId = typeof input.serverId === 'string' ? input.serverId : ''
      const toolName = typeof input.toolName === 'string' ? input.toolName : ''
      const args = asObject(input.args)

      if (!serverId || !toolName) {
        return {
          ok: false,
          message: '缺少 MCP serverId 或 toolName。',
          error: 'serverId and toolName are required',
        }
      }

      const catalog = buildMcpAgentToolCatalog(context.context.selectedMcpServerIds)
      const deferred = catalog.deferredEntries.some(entry => entry.server.id === serverId && entry.tool.name === toolName)
      if (!deferred) {
        return {
          ok: false,
          message: 'This MCP tool is not deferred or its server is not selected. Call its registered tool directly.',
          error: 'MCP_TOOL_NOT_DEFERRED',
        }
      }

      const result = await callMcpTool(serverId, toolName, args)
      return normalizeMcpToolResult(result)
    },
  }
}

function buildMcpListResourcesTool(): AgentTool {
  return {
    name: 'mcp_list_resources',
    title: '列出 MCP 资源',
    description: 'List resources exposed by selected and connected MCP servers. This reads resource metadata only.',
    category: 'mcp',
    risk: 'read',
    inputSchema: EMPTY_SCHEMA,
    execute: async (_input, context) => {
      const store = useMcpStore.getState()
      const selected = new Set(context.context.selectedMcpServerIds || [])
      const resources = store.servers
        .filter(server => selected.has(server.id))
        .flatMap(server => mcpServerManager.getServerResources(server.id).map(resource => ({
          server: server.name,
          ...resource,
        })))
      return {
        ok: true,
        message: resources.length ? JSON.stringify(resources, null, 2) : 'Selected MCP servers expose no resources.',
        data: { resources },
      }
    },
  }
}

function resolveSelectedMcpServer(
  context: AgentToolExecutionContext,
  reference: string,
  uri?: string
): { serverId: string; serverName: string } | { error: string } {
  const store = useMcpStore.getState()
  const selectedIds = context.context.selectedMcpServerIds || []
  const selectedServers = selectedIds
    .map(id => store.servers.find(server => server.id === id))
    .filter((server): server is NonNullable<typeof server> => Boolean(server))

  if (selectedServers.length === 0) {
    return { error: 'No MCP server is selected. Select a server in the chat toolbar first.' }
  }

  if (selectedServers.length === 1) {
    return { serverId: selectedServers[0].id, serverName: selectedServers[0].name }
  }

  const normalizedReference = reference.trim().toLocaleLowerCase()
  if (normalizedReference) {
    const exactMatches = selectedServers.filter(server =>
      server.id === reference || server.name.toLocaleLowerCase() === normalizedReference
    )
    if (exactMatches.length === 1) {
      return { serverId: exactMatches[0].id, serverName: exactMatches[0].name }
    }

    const partialMatches = selectedServers.filter(server =>
      server.name.toLocaleLowerCase().includes(normalizedReference)
    )
    if (partialMatches.length === 1) {
      return { serverId: partialMatches[0].id, serverName: partialMatches[0].name }
    }
  }

  if (uri) {
    const uriMatches = selectedServers.filter(server =>
      mcpServerManager.getServerResources(server.id).some(resource => resource.uri === uri)
    )
    if (uriMatches.length === 1) {
      return { serverId: uriMatches[0].id, serverName: uriMatches[0].name }
    }
  }

  return {
    error: `Multiple MCP servers are selected. Specify one by its display name: ${selectedServers.map(server => server.name).join(', ')}.`,
  }
}

function buildMcpListResourceTemplatesTool(): AgentTool {
  return {
    name: 'mcp_list_resource_templates',
    title: '列出 MCP 资源模板',
    description: 'List parameterized resource templates from a selected MCP server. Omit server when only one server is selected.',
    category: 'mcp',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional selected MCP server display name. Omit when only one server is selected.' },
      },
      required: [],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const resolved = resolveSelectedMcpServer(context, asString(input.server))
      if ('error' in resolved) {
        return { ok: false, message: resolved.error, error: 'MCP_SERVER_AMBIGUOUS' }
      }
      try {
        const resourceTemplates = await mcpServerManager.listResourceTemplates(resolved.serverId)
        return {
          ok: true,
          message: JSON.stringify(resourceTemplates, null, 2),
          data: { server: resolved.serverName, resourceTemplates },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message, error: 'MCP_RESOURCE_TEMPLATES_FAILED' }
      }
    },
  }
}

function buildMcpReadResourceTool(): AgentTool {
  return {
    name: 'mcp_read_resource',
    title: '读取 MCP 资源',
    description: 'Read one MCP resource by URI. Omit server when one selected server exposes the resource.',
    category: 'mcp',
    risk: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Optional selected MCP server display name. Omit when one selected server exposes the URI.' },
        uri: { type: 'string', description: 'Exact resource URI returned by mcp_list_resources.' },
      },
      required: ['uri'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const uri = asString(input.uri)
      const resolved = resolveSelectedMcpServer(context, asString(input.server), uri)
      if ('error' in resolved) {
        return { ok: false, message: resolved.error, error: 'MCP_SERVER_AMBIGUOUS' }
      }
      try {
        const result = await mcpServerManager.readResource(resolved.serverId, uri)
        const content = result.contents.map(item => item.text || `[Binary resource omitted: ${item.uri} (${item.mimeType || 'application/octet-stream'})]`).join('\n\n')
        const safeContents = result.contents.map(item => item.blob ? { uri: item.uri, mimeType: item.mimeType, blobOmitted: true } : item)
        return {
          ok: true,
          message: content || 'MCP resource returned no content.',
          data: { server: resolved.serverName, ...result, contents: safeContents },
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message, error: 'MCP_RESOURCE_READ_FAILED' }
      }
    },
  }
}

function buildMcpListToolsTool(): AgentTool {
  return {
    name: 'mcp_list_tools',
    title: '列出 MCP 工具',
    description: 'List configured MCP servers, selected servers, connection state, tools, and resources. This is read-only.',
    category: 'mcp',
    risk: 'read',
    inputSchema: EMPTY_SCHEMA,
    execute: async (_input, context) => {
      const store = useMcpStore.getState()
      await store.initMcpData()
      const latestStore = useMcpStore.getState()
      const selectedServerIds = context.context.selectedMcpServerIds || []
      const selectedServerIdSet = new Set(selectedServerIds)
      const catalog = buildMcpAgentToolCatalog(selectedServerIds)
      const servers = latestStore.servers.map((server) => {
        const state = latestStore.serverStates.get(server.id)
        const tools = mcpServerManager.getServerTools(server.id)
        const resources = mcpServerManager.getServerResources(server.id)

        return {
          id: server.id,
          name: server.name,
          type: server.type,
          enabled: server.enabled,
          selected: selectedServerIdSet.has(server.id),
          status: state?.status || 'disconnected',
          error: state?.error,
          toolCount: tools.length,
          tools: tools.map((tool) => ({
            name: tool.name,
            agentToolName: catalog.directEntries.find(entry => entry.server.id === server.id && entry.tool.name === tool.name)?.agentToolName,
            mode: catalog.deferredEntries.some(entry => entry.server.id === server.id && entry.tool.name === tool.name) ? 'deferred' : 'direct',
            deferredReason: catalog.deferredEntries.find(entry => entry.server.id === server.id && entry.tool.name === tool.name)?.deferredReason,
            description: tool.description || '',
            required: tool.inputSchema?.required || [],
            annotations: tool.annotations,
          })),
          resourceCount: resources.length,
          resources: resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: resource.description || '',
            mimeType: resource.mimeType || '',
          })),
        }
      })

      return {
        ok: true,
        message: servers.length
          ? `找到 ${servers.length} 个 MCP 服务，其中 ${servers.filter((server) => server.selected).length} 个已选中。`
          : '当前没有配置 MCP 服务。',
        data: {
          servers,
          selectedServerIds,
        },
      }
    },
  }
}

function buildTools(): AgentTool[] {
  return [
    adaptLegacyTool({
      name: 'editor_get_state',
      title: '读取编辑器状态',
      description: 'Read the current Markdown editor content including unsaved changes, numberedLines, totalLines, and version. Use editor_replace_range, editor_replace_lines, or editor_apply_transaction for edits.',
      category: 'editor',
      risk: 'read',
      legacy: getEditorContentTool,
      inputSchema: EMPTY_SCHEMA,
    }),
    adaptLegacyTool({
      name: 'editor_get_selection',
      title: '读取编辑器选区',
      description: 'Refresh the current editor selection with text, from/to offsets, and line numbers. The run-start selection is already provided in context when available; call this only after it becomes stale or is missing.',
      category: 'editor',
      risk: 'read',
      legacy: getEditorSelectionTool,
      inputSchema: EMPTY_SCHEMA,
    }),
    adaptLegacyTool({
      name: 'editor_insert_at_cursor',
      title: '在光标处插入',
      description: 'Insert Markdown at the current editor cursor. When a quoted selection has no canonical source offsets, set replaceSelection=true; the editor verifies that the live selection still matches the run-start selection.',
      category: 'editor',
      risk: 'editor-write',
      legacy: insertAtCursorTool,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Exact current editor file path.' },
          content: { type: 'string', description: 'Markdown content to insert.' },
          replaceSelection: { type: 'boolean', description: 'Replace the current selection when true.' },
        },
        required: ['filePath', 'content'],
        additionalProperties: false,
      },
      execute: (input, executionContext) => executeEditorLegacyWrite({
        ...input,
        expectedSelection: executionContext.context.currentQuote?.fullContent,
        expectedSelectionToken: executionContext.context.currentQuote?.selectionToken,
      }, insertAtCursorTool),
    }),
    adaptLegacyTool({
      name: 'editor_replace_range',
      title: '替换编辑器选区',
      description: 'Replace an exact editor character range using from/to offsets and content. Prefer this for explicit quoted selections.',
      category: 'editor',
      risk: 'editor-write',
      legacy: replaceEditorContentTool,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Exact current editor file path.' },
          from: { type: 'number' },
          to: { type: 'number' },
          content: { type: 'string' },
          version: { type: 'number' },
        },
        required: ['filePath', 'from', 'to', 'content'],
        additionalProperties: false,
      },
      execute: (input) => executeEditorLegacyWrite(input, replaceEditorContentTool),
    }),
    adaptLegacyTool({
      name: 'editor_replace_lines',
      title: '替换编辑器行',
      description: 'Replace one contiguous range of exact 1-based editor lines with complete Markdown in replaceContent. Preserve structural markers such as "# ", "- ", and "> ". Prefer this for a single current-document line, section, or block edit.',
      category: 'editor',
      risk: 'editor-write',
      legacy: replaceEditorContentTool,
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Exact current editor file path.' },
          startLine: { type: 'number' },
          endLine: { type: 'number' },
          replaceContent: { type: 'string' },
          version: { type: 'number' },
        },
        required: ['filePath', 'startLine', 'endLine', 'replaceContent'],
        additionalProperties: false,
      },
      execute: (input) => executeEditorLegacyWrite(input, replaceEditorContentTool),
    }),
    editorApplyTransactionTool,
    adaptLegacyTool({
      name: 'note_list_files',
      title: '列出笔记文件',
      description: 'List Markdown files in the NoteGen workspace. Never use this tool to inspect a user-selected folder attachment; use attachment_list for attachments.',
      category: 'note',
      risk: 'read',
      legacy: listMarkdownFilesTool,
      inputSchema: EMPTY_SCHEMA,
    }),
    adaptLegacyTool({
      name: 'note_list_files_by_date',
      title: '按时间列出笔记文件',
      category: 'note',
      risk: 'read',
      legacy: listMarkdownFilesByDateTool,
    }),
    adaptLegacyTool({
      name: 'note_read_file',
      title: '读取笔记文件',
      description: 'Read a text-based NoteGen workspace file only when its canonical workspace-relative path is already known. For knowledge discovery and evidence reading, use knowledge_search and knowledge_read_sources. Never use this tool for a user-selected attachment; use attachment_read with its attachment ID.',
      category: 'note',
      risk: 'read',
      legacy: readMarkdownFileTool,
      execute: executeReadFileFromEditor,
    }),
    adaptLegacyTool({
      name: 'note_open_file',
      title: '打开笔记文件',
      description: 'Open an existing NoteGen workspace note in the editor only when the user explicitly asks to open or switch to that note. Never use this tool to inspect, read, summarize, or analyze a user-selected attachment; use attachment_read for attachments.',
      category: 'note',
      risk: 'read',
      legacy: openMarkdownFileTool,
    }),
    adaptLegacyTool({
      name: 'note_read_files_batch',
      title: '批量读取笔记文件',
      description: 'Read one or more notes only when their canonical workspace-relative paths are already known. For knowledge discovery, use knowledge_search. Never call this tool with an empty array.',
      category: 'note',
      risk: 'read',
      legacy: readMarkdownFilesBatchTool,
      inputSchema: {
        type: 'object',
        properties: {
          filePaths: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'One or more known canonical workspace-relative paths.',
          },
        },
        required: ['filePaths'],
        additionalProperties: false,
      },
      execute: executeReadFilesBatch,
    }),
    ...knowledgeTools,
    dateDifferenceTool,
    adaptLegacyTool({
      name: 'note_create_file',
      title: '创建文件',
      category: 'note',
      risk: 'file-create',
      legacy: createFileTool,
      beforeExecute: rejectGeneratedSkillRuntimeFile,
      execute: executeCreateFileWithChange,
    }),
    adaptLegacyTool({
      name: 'note_update_file',
      title: '更新笔记文件',
      category: 'note',
      risk: 'file-update',
      legacy: updateMarkdownFileTool,
      beforeExecute: rejectGeneratedSkillRuntimeFile,
      execute: executeUpdateFileWithChange,
    }),
    adaptLegacyTool({
      name: 'note_delete_file',
      title: '删除笔记文件',
      category: 'note',
      risk: 'delete',
      legacy: deleteMarkdownFileTool,
      execute: executeDeleteFileWithChange,
    }),
    adaptLegacyTool({
      name: 'note_rename_file',
      title: '重命名笔记文件',
      category: 'note',
      risk: 'file-update',
      legacy: renameFileTool,
      execute: executeRenameFileWithChange,
    }),
    adaptLegacyTool({
      name: 'note_move_file',
      title: '移动笔记文件',
      category: 'note',
      risk: 'file-update',
      legacy: moveFileTool,
      execute: executeMoveFileWithChange,
    }),
    adaptLegacyTool({
      name: 'note_copy_file',
      title: '复制笔记文件',
      category: 'note',
      risk: 'file-create',
      legacy: copyFileTool,
      execute: executeCopyFileWithChange,
    }),
    adaptLegacyTool({ name: 'folder_list', title: '列出文件夹', category: 'folder', risk: 'read', legacy: listFoldersTool }),
    adaptLegacyTool({ name: 'folder_check_exists', title: '检查文件夹', category: 'folder', risk: 'read', legacy: checkFolderExistsTool }),
    adaptLegacyTool({ name: 'folder_create', title: '创建文件夹', category: 'folder', risk: 'file-create', legacy: createFolderTool, beforeExecute: rejectGeneratedSkillRuntimeFolder, execute: executeFolderCreateWithChange }),
    adaptLegacyTool({ name: 'folder_delete', title: '删除文件夹', category: 'folder', risk: 'delete', legacy: deleteFolderTool, execute: executeFolderDeleteWithChange }),
    adaptLegacyTool({ name: 'tag_list', title: '列出标签', category: 'tag', risk: 'read', legacy: listTagsTool }),
    adaptLegacyTool({ name: 'tag_search', title: '搜索标签', category: 'tag', risk: 'read', legacy: searchTagsTool }),
    adaptLegacyTool({
      name: 'tag_create',
      title: '创建标签',
      category: 'tag',
      risk: 'medium',
      legacy: createTagTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        createTagTool,
        'tag',
        (params) => `创建标签 ${asString(params.name)}`,
        (params, result) => resultDataPath(result, 'id') || asString(params.name)
      ),
    }),
    adaptLegacyTool({
      name: 'tag_update',
      title: '更新标签',
      category: 'tag',
      risk: 'medium',
      legacy: updateTagTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        updateTagTool,
        'tag',
        (params) => `更新标签 ${String(params.id ?? '')}`,
        (params) => String(params.id ?? '')
      ),
    }),
    adaptLegacyTool({
      name: 'tag_delete',
      title: '删除标签',
      category: 'tag',
      risk: 'delete',
      legacy: deleteTagTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        deleteTagTool,
        'tag',
        (params) => `删除标签 ${String(params.id ?? '')}`,
        (params) => String(params.id ?? ''),
        false
      ),
    }),
    adaptLegacyTool({ name: 'mark_list', title: '读取记录', category: 'mark', risk: 'read', legacy: readMarksTool }),
    adaptLegacyTool({
      name: 'mark_create',
      title: '创建记录',
      category: 'mark',
      risk: 'medium',
      legacy: createMarkTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        createMarkTool,
        'mark',
        (params) => `创建记录 ${asString(params.desc) || asString(params.content).slice(0, 24)}`,
        (params, result) => resultDataPath(result, 'id') || asString(params.desc) || asString(params.content).slice(0, 24)
      ),
    }),
    adaptLegacyTool({
      name: 'mark_update',
      title: '更新记录',
      category: 'mark',
      risk: 'medium',
      legacy: updateMarkTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        updateMarkTool,
        'mark',
        (params) => `更新记录 ${String(params.id ?? '')}`,
        (params) => String(params.id ?? '')
      ),
    }),
    adaptLegacyTool({
      name: 'mark_delete',
      title: '删除记录',
      category: 'mark',
      risk: 'delete',
      legacy: deleteMarkTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        deleteMarkTool,
        'mark',
        (params) => `删除记录 ${String(params.id ?? '')}`,
        (params) => String(params.id ?? ''),
        false
      ),
    }),
    adaptLegacyTool({ name: 'memory_list', title: '列出记忆', category: 'memory', risk: 'read', legacy: listMemoriesTool }),
    adaptLegacyTool({
      name: 'memory_create',
      title: '创建记忆',
      category: 'memory',
      risk: 'memory-write',
      legacy: saveMemoryTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        saveMemoryTool,
        'memory',
        (params) => `创建记忆 ${asString(params.content).slice(0, 24)}`,
        (params) => asString(params.content).slice(0, 48)
      ),
    }),
    adaptLegacyTool({
      name: 'memory_delete',
      title: '删除记忆',
      category: 'memory',
      risk: 'delete',
      legacy: deleteMemoryTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        deleteMemoryTool,
        'memory',
        (params) => `删除记忆 ${String(params.id ?? '')}`,
        (params) => String(params.id ?? ''),
        false
      ),
    }),
    adaptLegacyTool({
      name: 'memory_clear_all',
      title: '清空全部记忆',
      category: 'memory',
      risk: 'delete',
      legacy: clearMemoriesTool,
      execute: (input) => executeStructuralToolWithChange(
        input,
        clearMemoriesTool,
        'memory',
        () => '清空全部记忆',
        () => 'all',
        false
      ),
    }),
    buildSkillListTool(),
    buildSkillLoadTool(),
    buildSkillReadResourceTool(),
    buildSkillValidatePackageTool(),
    buildSkillInstallPackageTool(),
    buildRemoteSkillSearchTool(),
    buildRemoteSkillInspectTool(),
    buildRemoteSkillInstallTool(),
    buildSkillUninstallTool(),
    adaptLegacyTool({
      name: 'skill_execute_script',
      title: '执行 Skill 脚本',
      description: 'Execute one registered, integrity-checked script from a loaded Skill. Arbitrary commands and generated runtime scripts are not supported.',
      category: 'skill',
      risk: 'script',
      legacy: executeSkillScriptTool,
      execute: async (input, context) => resultFromLegacy(
        await executeRegisteredSkillScript(input, context.signal)
      ),
    }),
    adaptLegacyTool({
      name: 'skill_install_python_dependencies',
      title: '安装 Skill Python 依赖',
      description: 'After explicit user approval, install exact PyPI wheel packages into this Skill\'s isolated Python environment. URLs, paths, flags, and automatic installation are not supported.',
      category: 'skill',
      risk: 'script',
      legacy: installSkillPythonDependenciesTool,
      execute: async (input, context) => resultFromLegacy(
        await installSkillDependencies(input, context.signal)
      ),
    }),
    buildMcpListToolsTool(),
    buildMcpListResourcesTool(),
    buildMcpListResourceTemplatesTool(),
    buildMcpReadResourceTool(),
    buildMcpCallTool(),
    ...canvasTools,
    ...attachmentTools,
    ...imageTools,
    ...webTools,
  ]
}

export class AgentToolRegistry {
  private tools = buildTools()
  private toolMap = new Map(this.tools.map((tool) => [tool.name, tool]))

  listTools() {
    return [...this.tools]
  }

  getTool(name: string) {
    return this.toolMap.get(name)
  }

  toOpenAITools(
    tools: AgentTool[] = this.tools,
    loadedSkillIds: ReadonlySet<string> = new Set()
  ): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: `${tool.title}. ${
          tool.name === 'skill_execute_script' && loadedSkillIds.size > 0
            ? `${tool.description} Loaded script mapping: ${[...loadedSkillIds]
                .map(skillId => `${skillId}=[${(skillManager.getSkill(skillId)?.scripts || []).map(script => script.name).join(', ')}]`)
                .join('; ')}.`
            : tool.description
        }`,
        parameters: (
          tool.name === 'skill_execute_script' && loadedSkillIds.size > 0
            ? {
                ...tool.inputSchema,
                properties: {
                  ...tool.inputSchema.properties,
                  skill_id: {
                    ...tool.inputSchema.properties?.skill_id,
                    type: 'string',
                    enum: [...loadedSkillIds],
                    description: 'Exact loaded Skill ID.',
                  },
                  script_id: {
                    ...tool.inputSchema.properties?.script_id,
                    type: 'string',
                    enum: [...new Set([...loadedSkillIds].flatMap(skillId =>
                      (skillManager.getSkill(skillId)?.scripts || []).map(script => script.name)
                    ))],
                    description: 'Exact registered script ID returned by skill_load. Never invent or abbreviate it.',
                  },
                },
              }
            : tool.inputSchema
        ) as Record<string, unknown>,
      },
    }))
  }
}

export const agentToolRegistry = new AgentToolRegistry()
