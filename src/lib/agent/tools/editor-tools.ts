import { Tool, ToolResult } from '../types'
import emitter from '@/lib/emitter'
import useArticleStore from '@/stores/article'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import type { AgentEditorStateSnapshot } from '../types'
import { agentDebugLog, agentDebugText } from '../debug-log'

const EDITOR_TOOL_RESPONSE_TIMEOUT_MS = 200
const storeBackedContentVersion = 0
let editorSnapshotReadSequence = 0

function normalizeEditorFilePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/').trim()
}

function isCurrentEditorTarget(filePath: unknown): filePath is string {
  const activeFilePath = useArticleStore.getState().activeFilePath
  return typeof filePath === 'string'
    && filePath.length > 0
    && Boolean(activeFilePath)
    && normalizeEditorFilePath(filePath) === normalizeEditorFilePath(activeFilePath || '')
}

function buildEditorContentPayload(markdown: string, version: number): AgentEditorStateSnapshot & { text: string } {
  const normalizedMarkdown = markdown
  const text = normalizedMarkdown
  const markdownLines = normalizedMarkdown.split('\n')
  const totalLines = markdownLines.length
  const lineNumberWidth = String(totalLines).length
  const numberedLines = markdownLines
    .map((line, index) => `${String(index + 1).padStart(lineNumberWidth)} | ${line}`)
    .join('\n')

  return {
    markdown: normalizedMarkdown,
    text,
    wordCount: text.split(/\s+/).filter(w => w).length,
    charCount: text.length,
    totalLines,
    numberedLines,
    version,
  }
}

export async function readCurrentEditorState(): Promise<AgentEditorStateSnapshot> {
  const readId = ++editorSnapshotReadSequence
  const startedAt = Date.now()
  const requestedFilePath = useArticleStore.getState().activeFilePath
  return new Promise((resolve) => {
    let settled = false

    const finalize = (data: AgentEditorStateSnapshot, source: 'editor-event' | 'store-or-disk-fallback') => {
      if (settled) {
        return
      }
      settled = true
      const articleState = useArticleStore.getState()
      agentDebugLog('editor_snapshot_read', {
        readId,
        source,
        requestedFilePath,
        activeFilePath: articleState.activeFilePath,
        targetChanged: requestedFilePath !== articleState.activeFilePath,
        durationMs: Date.now() - startedAt,
        version: data.version,
        charCount: data.markdown.length,
        totalLines: data.totalLines,
        storeCharCount: articleState.currentArticle?.length || 0,
        matchesStore: data.markdown === (articleState.currentArticle || ''),
        markdownHead: data.markdown.slice(0, 500),
        markdownTail: data.markdown.slice(-1000),
        selection: data.selection ? {
          from: data.selection.from,
          to: data.selection.to,
          charCount: data.selection.text.length,
        } : undefined,
      })
      agentDebugText('editor_snapshot_content', data.markdown, { readId, source, requestedFilePath })
      resolve(data)
    }

    const timeoutId = setTimeout(() => {
      agentDebugLog('editor_snapshot_timeout', { readId, requestedFilePath, timeoutMs: EDITOR_TOOL_RESPONSE_TIMEOUT_MS })
      void hydrateStoreBackedEditorContent().then(data => finalize(data ?? getStoreBackedEditorContent(), 'store-or-disk-fallback'))
    }, EDITOR_TOOL_RESPONSE_TIMEOUT_MS)

    emitter.emit('editor-get-content', {
      resolve: (data) => {
        clearTimeout(timeoutId)
        finalize({
          markdown: data.markdown,
          wordCount: data.wordCount,
          charCount: data.charCount,
          totalLines: data.totalLines ?? data.markdown.split('\n').length,
          numberedLines: data.numberedLines ?? buildEditorContentPayload(data.markdown, data.version).numberedLines,
          version: data.version,
          selection: data.selection,
        }, 'editor-event')
      },
    })
  })
}

function getStoreBackedEditorContent() {
  const { currentArticle } = useArticleStore.getState()
  return buildEditorContentPayload(currentArticle || '', storeBackedContentVersion)
}

async function hydrateStoreBackedEditorContent(expectedFilePath?: string) {
  const articleStore = useArticleStore.getState()

  if (expectedFilePath && !isCurrentEditorTarget(expectedFilePath)) {
    return null
  }

  if (articleStore.currentArticle || !articleStore.activeFilePath) {
    return getStoreBackedEditorContent()
  }

  try {
    const targetFilePath = expectedFilePath || articleStore.activeFilePath
    if (!targetFilePath) return getStoreBackedEditorContent()
    const pathOptions = await getFilePathOptions(targetFilePath)
    const fileExists = pathOptions.baseDir
      ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await exists(pathOptions.path)

    if (!fileExists) {
      return getStoreBackedEditorContent()
    }

    const content = pathOptions.baseDir
      ? await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      : await readTextFile(pathOptions.path)

    if (expectedFilePath && !isCurrentEditorTarget(expectedFilePath)) {
      return null
    }
    articleStore.setCurrentArticle(content)
    return buildEditorContentPayload(content, storeBackedContentVersion)
  } catch {
    return getStoreBackedEditorContent()
  }
}

function getEditorSelectionFallbackResult(): ToolResult {
  return {
    success: false,
    data: { text: '', from: 0, to: 0, startLine: 1, endLine: 1 },
    message: '当前没有活跃编辑器，无法获取选中内容',
  }
}

// 1. 获取当前选中内容
export const getEditorSelectionTool: Tool = {
  name: 'get_editor_selection',
  description: `📝 **Editor Operation**: Get the currently selected text in the editor, including position information.

**Use Cases:**
- Get selected text for AI processing (translate, polish, etc.)
- Know selection range for precise replacement
- Get line numbers for line-based editing

**Returns:**
- \`text\`: Selected text content
- \`from\`: Start position (0-indexed)
- \`to\`: End position (0-indexed)
- \`startLine\`: Start line number (1-indexed)
- \`endLine\`: End line number (1-indexed)`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return new Promise((resolve) => {
      let settled = false

      const finalize = (result: ToolResult) => {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      const timeoutId = setTimeout(() => {
        finalize(getEditorSelectionFallbackResult())
      }, EDITOR_TOOL_RESPONSE_TIMEOUT_MS)

      emitter.emit('editor-get-selection', {
        resolve: (data) => {
          clearTimeout(timeoutId)
          finalize({
            success: true,
            data,
            message: data.text
              ? `选中内容：${data.text.slice(0, 50)}${data.text.length > 50 ? '...' : ''} (行 ${data.startLine}-${data.endLine})`
              : `当前没有选中文本，光标位于第 ${data.startLine || 1} 行，位置 ${data.from}。`,
          })
        },
      })
    })
  },
}

// 2. 获取当前编辑器内容
export const getEditorContentTool: Tool = {
  name: 'get_editor_content',
  description: `📝 **Editor Operation**: Get the current complete content of the editor (unsaved changes included).

**Use Cases:**
- Get current editor state for AI analysis
- Read unsaved changes that haven't been saved to file
- Get total line count for line-based editing

**Returns:**
- \`markdown\`: Full markdown content
- \`wordCount\`: Number of words
- \`charCount\`: Number of characters
- \`totalLines\`: Total number of lines
- \`numberedLines\`: The current content rendered line by line with 1-based line numbers
- \`version\`: Version number for content verification (use this when calling replace_editor_content)

**Recommended workflow for document-wide edits:** Read \`numberedLines\`, then call \`replace_editor_content\` with \`startLine: 1\`, \`endLine: totalLines\`, and \`version\`.

**Note:** Prefer this tool for the currently open file. Use read_markdown_file only when you specifically need the saved on-disk content of another file.`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    const data = await readCurrentEditorState()
    return {
      success: true,
      data,
      message: `编辑器内容：${data.markdown.slice(0, 50)}${data.markdown.length > 50 ? '...' : ''} (${data.wordCount} 字，${data.totalLines} 行, v${data.version})`,
    }
  },
}

// 3. 在光标位置插入内容
export const insertAtCursorTool: Tool = {
  name: 'insert_at_cursor',
  description: `📝 **Editor Operation**: Insert content at the current cursor position or replace selected text.

**Use Cases:**
- AI generates content and wants to insert at cursor
- Insert AI response after user's selected text

**Parameters:**
- \`content\`: Content to insert (Markdown format supported)
- \`replaceSelection\`: If true, replaces current selection; default false (inserts at cursor)`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'Content to insert (Markdown format)',
      required: true,
    },
    {
      name: 'replaceSelection',
      type: 'boolean',
      description: 'If true, replaces current selection; default false',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    return new Promise((resolve) => {
      let settled = false
      const articleStore = useArticleStore.getState()
      const activeFilePath = articleStore.activeFilePath
      const finalize = (result: ToolResult) => {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      const timeoutId = setTimeout(() => {
        finalize({ success: false, error: 'EDITOR_UNAVAILABLE', message: '编辑器未及时响应，已取消插入，不会回退为直接覆盖笔记。' })
      }, EDITOR_TOOL_RESPONSE_TIMEOUT_MS)

      emitter.emit('editor-insert', {
        isCancelled: () => settled,
        filePath: typeof params.filePath === 'string' ? params.filePath : activeFilePath || '',
        content: params.content,
        position: typeof params.position === 'number' ? params.position : undefined,
        expectedVersion: typeof params.version === 'number' ? params.version : undefined,
        replaceSelection: params.replaceSelection === true,
        expectedSelection: params.replaceSelection === true && typeof params.expectedSelection === 'string'
          ? params.expectedSelection
          : undefined,
        expectedSelectionToken: params.replaceSelection === true && typeof params.expectedSelectionToken === 'string'
          ? params.expectedSelectionToken
          : undefined,
        resolve: (result) => {
          clearTimeout(timeoutId)
          finalize({
            success: result.success,
            data: result,
            error: result.success ? undefined : result.error || (result.versionMismatch ? 'EDITOR_VERSION_MISMATCH' : 'EDITOR_INSERT_FAILED'),
            message: result.success
              ? `成功插入 ${result.insertedLength} 个字符`
              : result.error || '插入失败',
          })
        },
      })
    })
  },
}

// 4. 替换指定范围的内容
export const replaceEditorContentTool: Tool = {
  name: 'replace_editor_content',
  description: `📝 **Editor Operation**: Replace content in the specified range with new content.

**IMPORTANT - Editing Priority**:
For the currently open document, prefer these modes in order:
1. Position-based (\`from\`/\`to\`) when the user provided an exact quoted selection
2. Line-based (\`startLine\`/\`endLine\`) for section/list/block edits in the current editor content
3. Text-based search (\`searchContent\`) only as a fallback when line numbers are unavailable and the target text is short and unique

**IMPORTANT - Prefer Exact Quoted Range**:
When the user quotes content from the editor and exact selection positions are provided, you MUST use position-based mode (\`from\`/\`to\`) so that only the quoted selection is replaced.
- If quote context includes \`from\` and \`to\`, use them directly
- For current-document structural edits without exact positions, use line-based mode (\`startLine\`/\`endLine\`)
- Only use text-based search when exact positions and line numbers are both unavailable
- NEVER expand a quoted edit to the whole document

**Use Cases:**
- AI wants to modify specific lines/paragraphs
- Precise content replacement based on selection or text search
- Replace specific text throughout the document

**Parameters (choose one of these modes):**

**Mode 1: Line-based (fallback when exact positions are unavailable)**
- \`startLine\`: Start line number (1-based, required for line-based mode)
- \`endLine\`: End line number (1-based, required for line-based mode)
- \`replaceContent\`: New content to replace with

**Mode 2: Text-based search (fallback only)**
- \`searchContent\`: Text to search for (must match exactly)
- \`replaceContent\`: New content to replace with
- \`occurrence\`: Which occurrence to replace (1-based, default: 1)

**Mode 3: Position-based (RECOMMENDED for quoted editor selections)**
- \`content\`: New content to replace with
- \`from\`: Start position (0-indexed, optional)
- \`to\`: End position (0-indexed, optional)

**Note:** Use \`get_editor_content\` only when necessary. Prefer exact quoted positions (\`from\`/\`to\`) when they are available from the user's selection.`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'startLine',
      type: 'number',
      description: 'Start line number (1-based, REQUIRED when user quotes content)',
      required: false,
    },
    {
      name: 'endLine',
      type: 'number',
      description: 'End line number (1-based, REQUIRED when user quotes content)',
      required: false,
    },
    {
      name: 'replaceContent',
      type: 'string',
      description: 'New content to replace with (text-based/line-based mode)',
      required: false,
    },
    {
      name: 'searchContent',
      type: 'string',
      description: 'Text to search for (text-based mode)',
      required: false,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content to replace with (position-based mode)',
      required: false,
    },
    {
      name: 'from',
      type: 'number',
      description: 'Start position (0-indexed, optional)',
      required: false,
    },
    {
      name: 'to',
      type: 'number',
      description: 'End position (0-indexed, optional)',
      required: false,
    },
    {
      name: 'occurrence',
      type: 'number',
      description: 'Which occurrence to replace (1-based, default: 1)',
      required: false,
    },
    {
      name: 'version',
      type: 'number',
      description: 'Version number from get_editor_content (to ensure content has not changed, highly recommended)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    return new Promise((resolve) => {
      let settled = false

      const finalize = (result: ToolResult) => {
        if (settled) {
          return
        }
        settled = true
        resolve(result)
      }

      // 确定使用哪种模式
      const hasPositionParams = params.from !== undefined || params.to !== undefined;
      const hasSearchParams = params.searchContent;
      const hasLineParams = params.startLine !== undefined && params.endLine !== undefined;

      if (!hasPositionParams && !hasSearchParams && !hasLineParams && !params.content) {
        finalize({
          success: false,
          error: 'Missing required parameters',
          message: '请提供 content 或 searchContent 或 startLine/endLine 参数',
        });
        return;
      }

      const timeoutId = setTimeout(() => {
        finalize({
          success: false,
          error: 'EDITOR_UNAVAILABLE',
          message: '编辑器未及时响应，已取消写入。请等待编辑器就绪后重新读取状态，不会回退为直接覆盖笔记。',
        })
      }, EDITOR_TOOL_RESPONSE_TIMEOUT_MS)

      emitter.emit('editor-replace', {
        isCancelled: () => settled,
        filePath: typeof params.filePath === 'string'
          ? params.filePath
          : useArticleStore.getState().activeFilePath || '',
        content: params.content || params.replaceContent,
        range: (params.from !== undefined && params.to !== undefined)
          ? { from: params.from, to: params.to }
          : undefined,
        searchContent: params.searchContent,
        occurrence: params.occurrence || 1,
        startLine: params.startLine,
        endLine: params.endLine,
        expectedVersion: params.version,
        resolve: (result) => {
          clearTimeout(timeoutId)
          if (result.versionMismatch) {
            finalize({
              success: false,
              error: result.error,
              message: '编辑器内容已变化，请重新获取内容后再操作',
            });
          } else if (result.success) {
            finalize({
              success: true,
              data: result,
              message: result.message || `成功替换 ${result.insertedLength} 个字符`,
            });
          } else {
            finalize({
              success: false,
              error: result.error,
              message: result.message || '替换失败',
            });
          }
        },
      });
    });
  },
}

export const editorTools: Tool[] = [
  getEditorSelectionTool,
  getEditorContentTool,
  insertAtCursorTool,
  replaceEditorContentTool,
]
