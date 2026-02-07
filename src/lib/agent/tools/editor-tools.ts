import { Tool, ToolResult } from '../types'
import emitter from '@/lib/emitter'

// 1. 获取当前选中内容
export const getEditorSelectionTool: Tool = {
  name: 'get_editor_selection',
  description: `📝 **Editor Operation**: Get the currently selected text in the editor, including position information.

**Use Cases:**
- Get selected text for AI processing (translate, polish, etc.)
- Know selection range for precise replacement

**Returns:**
- \`text\`: Selected text content
- \`from\`: Start position (0-indexed)
- \`to\`: End position (0-indexed)`,
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
              ? `选中内容：${data.text.slice(0, 50)}${data.text.length > 50 ? '...' : ''}`
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

**Note:** Use read_markdown_file if you need the saved file content.`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return new Promise((resolve) => {
      emitter.emit('editor-get-content', {
        resolve: (data) => {
          resolve({
            success: true,
            data,
            message: `编辑器内容：${data.markdown.slice(0, 50)}${data.markdown.length > 50 ? '...' : ''} (${data.wordCount} 字)`,
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

**Use Cases:**
- AI wants to modify specific lines/paragraphs
- Precise content replacement based on selection

**Parameters:**
- \`content\`: New content to replace with
- \`from\`: Start position (optional, defaults to current selection start)
- \`to\`: End position (optional, defaults to current selection end)`,
  category: 'editor',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: 'New content to replace with',
      required: true,
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
  ],
  execute: async (params): Promise<ToolResult> => {
    return new Promise((resolve) => {
      emitter.emit('editor-replace', {
        content: params.content,
        range: params.from !== undefined && params.to !== undefined
          ? { from: params.from, to: params.to }
          : undefined,
        resolve: (result) => {
          resolve({
            success: result.success,
            data: result,
            message: result.success
              ? `成功替换 ${result.insertedLength} 个字符`
              : '替换失败',
          })
        },
      })
    })
  },
}

export const editorTools: Tool[] = [
  getEditorSelectionTool,
  getEditorContentTool,
  insertAtCursorTool,
  replaceEditorContentTool,
]
