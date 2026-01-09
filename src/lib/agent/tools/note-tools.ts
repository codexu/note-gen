import { Tool, ToolResult } from '../types'
import { readTextFile, writeTextFile, remove } from '@tauri-apps/plugin-fs'
import { getAllMarkdownFiles } from '@/lib/files'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { join } from '@tauri-apps/api/path'
import useArticleStore from '@/stores/article'

export const listMarkdownFilesTool: Tool = {
  name: 'list_markdown_files',
  description: '列出所有 Markdown 笔记文件',
  category: 'note',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const files = await getAllMarkdownFiles()
      return {
        success: true,
        data: files,
        message: `找到 ${files.length} 个 Markdown 文件`,
      }
    } catch (error) {
      return {
        success: false,
        error: `获取 Markdown 文件列表失败: ${error}`,
      }
    }
  },
}

export const readMarkdownFileTool: Tool = {
  name: 'read_markdown_file',
  description: '读取指定 Markdown 笔记文件的内容',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Markdown 文件的路径（相对路径或绝对路径）',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const workspace = await getWorkspacePath()
      let content = ''
      
      if (workspace.isCustom) {
        content = await readTextFile(params.filePath)
      } else {
        const { path, baseDir } = await getFilePathOptions(params.filePath)
        content = await readTextFile(path, { baseDir })
      }
      
      return {
        success: true,
        data: { filePath: params.filePath, content },
        message: `成功读取文件: ${params.filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `读取文件失败: ${error}`,
      }
    }
  },
}

export const createMarkdownFileTool: Tool = {
  name: 'create_markdown_file',
  description: '创建一个新的 Markdown 笔记文件',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'fileName',
      type: 'string',
      description: '文件名（包含 .md 扩展名）',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '笔记的内容（Markdown 格式）',
      required: true,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: '可选：子文件夹路径，默认为根目录',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      // 验证内容参数
      if (!params.content || typeof params.content !== 'string') {
        return {
          success: false,
          error: '缺少必需参数 content 或参数类型错误',
        }
      }
      
      // 如果没有提供 fileName，生成默认文件名
      let fileName = params.fileName
      if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        fileName = `note-${timestamp}.md`
      }
      
      const workspace = await getWorkspacePath()
      let filePath = fileName
      
      // 如果指定了文件夹路径，拼接路径
      if (params.folderPath) {
        filePath = `${params.folderPath}/${fileName}`
      }
      
      // 确保文件名以 .md 结尾
      if (!filePath.endsWith('.md')) {
        filePath += '.md'
      }
      
      if (workspace.isCustom) {
        const fullPath = await join(workspace.path, filePath)
        await writeTextFile(fullPath, params.content)
      } else {
        const { path, baseDir } = await getFilePathOptions(filePath)
        await writeTextFile(path, params.content, { baseDir })
      }
      
      // 刷新文件列表
      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()
      
      // 选中新创建的文件
      await articleStore.setActiveFilePath(filePath)
      
      // 读取文件内容到编辑器
      await articleStore.readArticle(filePath)
      
      return {
        success: true,
        data: { filePath },
        message: `成功创建文件: ${filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建文件失败: ${error}`,
      }
    }
  },
}

export const updateMarkdownFileTool: Tool = {
  name: 'update_markdown_file',
  description: '更新 Markdown 笔记文件的内容',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Markdown 文件的路径',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: '新的内容（Markdown 格式）',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const workspace = await getWorkspacePath()
      
      if (workspace.isCustom) {
        await writeTextFile(params.filePath, params.content)
      } else {
        const { path, baseDir } = await getFilePathOptions(params.filePath)
        await writeTextFile(path, params.content, { baseDir })
      }
      
      // 如果更新的是当前打开的文件，通过 saveCurrentArticle 刷新编辑器内容
      // 注意：不要使用 setCurrentArticle，因为它会触发 clearStack 清空撤销历史
      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === params.filePath) {
        // 使用 emitter 通知编辑器内容已从外部更新
        const emitter = (await import('@/lib/emitter')).default
        emitter.emit('external-content-update', params.content)
      }
      
      return {
        success: true,
        message: `成功更新文件: ${params.filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `更新文件失败: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFileTool: Tool = {
  name: 'delete_markdown_file',
  description: '删除指定的 Markdown 笔记文件',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: '要删除的 Markdown 文件路径',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const workspace = await getWorkspacePath()
      const articleStore = useArticleStore.getState()
      
      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === params.filePath
      
      if (workspace.isCustom) {
        await remove(params.filePath)
      } else {
        const { path, baseDir } = await getFilePathOptions(params.filePath)
        await remove(path, { baseDir })
      }
      
      // 刷新文件列表
      await articleStore.loadFileTree()
      
      // 如果删除的是当前打开的文件，取消选择并清空内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }
      
      return {
        success: true,
        message: `成功删除文件: ${params.filePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除文件失败: ${error}`,
      }
    }
  },
}

export const searchMarkdownFilesTool: Tool = {
  name: 'search_markdown_files',
  description: '在所有 Markdown 笔记文件中搜索包含关键词的内容',
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: '搜索关键词',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const files = await getAllMarkdownFiles()
      const results: Array<{ filePath: string; fileName: string; matchedContent: string }> = []
      const workspace = await getWorkspacePath()
      
      for (const file of files) {
        try {
          let content = ''
          
          if (workspace.isCustom) {
            content = await readTextFile(file.path)
          } else {
            const { path, baseDir } = await getFilePathOptions(file.relativePath)
            content = await readTextFile(path, { baseDir })
          }
          
          if (content.toLowerCase().includes(params.query.toLowerCase())) {
            // 提取匹配的上下文（前后各50个字符）
            const index = content.toLowerCase().indexOf(params.query.toLowerCase())
            const start = Math.max(0, index - 50)
            const end = Math.min(content.length, index + params.query.length + 50)
            const matchedContent = content.substring(start, end)
            
            results.push({
              filePath: file.relativePath,
              fileName: file.name,
              matchedContent: `...${matchedContent}...`,
            })
          }
        } catch (error) {
          console.error(`读取文件 ${file.path} 失败:`, error)
        }
      }
      
      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 个匹配的文件`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索文件失败: ${error}`,
      }
    }
  },
}

export const modifyCurrentNoteTool: Tool = {
  name: 'modify_current_note',
  description: '修改当前打开的笔记内容。使用前提：必须先用 read_markdown_file 读取当前笔记的内容，了解现有内容后再调用此工具进行修改。此工具会自动获取当前打开的笔记路径，无需指定文件名。',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'content',
      type: 'string',
      description: '修改后的完整笔记内容（Markdown 格式）。必须基于已读取的原内容进行修改，不能凭空生成。',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const currentFilePath = articleStore.activeFilePath
      
      if (!currentFilePath) {
        return {
          success: false,
          error: '当前没有打开任何笔记，请先打开一个笔记文件',
        }
      }
      
      if (!params.content || typeof params.content !== 'string') {
        return {
          success: false,
          error: '缺少必需参数 content 或参数类型错误',
        }
      }
      
      const workspace = await getWorkspacePath()
      
      if (workspace.isCustom) {
        await writeTextFile(currentFilePath, params.content)
      } else {
        const { path, baseDir } = await getFilePathOptions(currentFilePath)
        await writeTextFile(path, params.content, { baseDir })
      }
      
      // 使用 emitter 通知编辑器内容已从外部更新，而不是直接调用 setCurrentArticle
      // 这样可以保留编辑器的撤销历史
      const emitter = (await import('@/lib/emitter')).default
      emitter.emit('external-content-update', params.content)
      
      return {
        success: true,
        data: { filePath: currentFilePath },
        message: `成功修改当前笔记: ${currentFilePath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `修改当前笔记失败: ${error}`,
      }
    }
  },
}

export const readMarkdownFilesBatchTool: Tool = {
  name: 'read_markdown_files_batch',
  description: '批量读取多个 Markdown 笔记文件的内容，避免循环调用。适用于需要一次性读取多个文件的场景。',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Markdown 文件路径数组',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: '参数 filePaths 必须是非空数组',
        }
      }

      const workspace = await getWorkspacePath()
      const results = []
      const errors = []

      for (const filePath of params.filePaths) {
        try {
          let content = ''
          
          if (workspace.isCustom) {
            content = await readTextFile(filePath)
          } else {
            const { path, baseDir } = await getFilePathOptions(filePath)
            content = await readTextFile(path, { baseDir })
          }
          
          results.push({ filePath, content })
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      return {
        success: results.length > 0,
        data: { 
          files: results, 
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: `成功读取 ${results.length} 个文件${errors.length > 0 ? `，${errors.length} 个失败` : ''}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量读取文件失败: ${error}`,
      }
    }
  },
}

export const deleteMarkdownFilesBatchTool: Tool = {
  name: 'delete_markdown_files_batch',
  description: '批量删除多个 Markdown 笔记文件，避免循环调用。',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: '要删除的 Markdown 文件路径数组',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.filePaths) || params.filePaths.length === 0) {
        return {
          success: false,
          error: '参数 filePaths 必须是非空数组',
        }
      }

      const workspace = await getWorkspacePath()
      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileDeleted = false

      for (const filePath of params.filePaths) {
        try {
          if (articleStore.activeFilePath === filePath) {
            currentFileDeleted = true
          }

          if (workspace.isCustom) {
            await remove(filePath)
          } else {
            const { path, baseDir } = await getFilePathOptions(filePath)
            await remove(path, { baseDir })
          }
          
          results.push(filePath)
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      await articleStore.loadFileTree()

      if (currentFileDeleted) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      return {
        success: results.length > 0,
        data: { 
          deleted: results, 
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: `成功删除 ${results.length} 个文件${errors.length > 0 ? `，${errors.length} 个失败` : ''}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除文件失败: ${error}`,
      }
    }
  },
}

export const noteTools: Tool[] = [
  listMarkdownFilesTool,
  readMarkdownFileTool,
  createMarkdownFileTool,
  updateMarkdownFileTool,
  deleteMarkdownFileTool,
  searchMarkdownFilesTool,
  modifyCurrentNoteTool,
  readMarkdownFilesBatchTool,
  deleteMarkdownFilesBatchTool,
]
