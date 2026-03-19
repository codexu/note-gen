import { Tool, ToolResult } from '../types'
import emitter from '@/lib/emitter'

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
      emitter.emit('editor-get-selection', {
        resolve: (data) => {
          resolve({
            success: !!data.text,
            data,
            message: data.text
              ? `选中内容：${data.text.slice(0, 50)}${data.text.length > 50 ? '...' : ''} (行 ${data.startLine}-${data.endLine})`
              : '当前没有选中文本',
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

**Note:** Use read_markdown_file if you need the saved file content.`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return new Promise((resolve) => {
      emitter.emit('editor-get-content', {
        resolve: (data: { markdown: string; html?: string; text: string; wordCount: number; charCount: number; totalLines?: number; numberedLines?: string; version: number }) => {
          resolve({
            success: true,
            data: {
              ...data,
              version: data.version,
            },
            message: `编辑器内容：${data.markdown.slice(0, 50)}${data.markdown.length > 50 ? '...' : ''} (${data.wordCount} 字，${data.totalLines || '?'} 行, v${data.version})`,
          })
        },
      })
    })
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
      emitter.emit('editor-insert', {
        content: params.content,
        resolve: (result) => {
          resolve({
            success: result.success,
            data: result,
            message: result.success
              ? `成功插入 ${result.insertedLength} 个字符`
              : '插入失败',
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

**IMPORTANT - Prefer Exact Quoted Range**:
When the user quotes content from the editor and exact selection positions are provided, you MUST use position-based mode (\`from\`/\`to\`) so that only the quoted selection is replaced.
- If quote context includes \`from\` and \`to\`, use them directly
- Only use line-based mode (\`startLine\`/\`endLine\`) when exact positions are not available
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

**Mode 2: Text-based search**
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
      // 确定使用哪种模式
      const hasPositionParams = params.from !== undefined || params.to !== undefined;
      const hasSearchParams = params.searchContent;
      const hasLineParams = params.startLine !== undefined && params.endLine !== undefined;

      if (!hasPositionParams && !hasSearchParams && !hasLineParams && !params.content) {
        resolve({
          success: false,
          error: 'Missing required parameters',
          message: '请提供 content 或 searchContent 或 startLine/endLine 参数',
        });
        return;
      }

      emitter.emit('editor-replace', {
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
          if (result.versionMismatch) {
            resolve({
              success: false,
              error: result.error,
              message: '编辑器内容已变化，请重新获取内容后再操作',
            });
          } else if (result.success) {
            resolve({
              success: true,
              data: result,
              message: result.message || `成功替换 ${result.insertedLength} 个字符`,
            });
          } else {
            resolve({
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
