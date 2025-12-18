import { Tool, ToolResult } from '../types'
import { mkdir, remove, exists, readDir } from '@tauri-apps/plugin-fs'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { join } from '@tauri-apps/api/path'
import useArticleStore from '@/stores/article'

export const createFolderTool: Tool = {
  name: 'create_folder',
  description: '创建一个新的文件夹用于组织笔记',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: '文件夹路径（相对于笔记根目录，例如："前端/React" 或 "学习笔记"）',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      // 验证必需参数
      if (!params.folderPath || typeof params.folderPath !== 'string') {
        return {
          success: false,
          error: '缺少必需参数 folderPath 或参数类型错误',
        }
      }

      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const fullPath = await join(workspace.path, params.folderPath)
        
        // 检查文件夹是否已存在
        const folderExists = await exists(fullPath)
        if (folderExists) {
          return {
            success: false,
            error: `文件夹已存在: ${params.folderPath}`,
          }
        }

        // 创建文件夹
        await mkdir(fullPath, { recursive: true })
      } else {
        // 默认工作区：使用 baseDir
        const { path, baseDir } = await getFilePathOptions(params.folderPath)
        
        // 检查文件夹是否已存在
        const folderExists = await exists(path, { baseDir })
        if (folderExists) {
          return {
            success: false,
            error: `文件夹已存在: ${params.folderPath}`,
          }
        }

        // 创建文件夹
        await mkdir(path, { baseDir, recursive: true })
      }

      // 刷新文件树
      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()

      return {
        success: true,
        data: { folderPath: params.folderPath },
        message: `成功创建文件夹: ${params.folderPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `创建文件夹失败: ${error}`,
      }
    }
  },
}

export const deleteFolderTool: Tool = {
  name: 'delete_folder',
  description: '删除指定的文件夹（会删除文件夹内的所有内容）',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: '要删除的文件夹路径',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      // 验证必需参数
      if (!params.folderPath || typeof params.folderPath !== 'string') {
        return {
          success: false,
          error: '缺少必需参数 folderPath 或参数类型错误',
        }
      }

      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const fullPath = await join(workspace.path, params.folderPath)
        
        // 检查文件夹是否存在
        const folderExists = await exists(fullPath)
        if (!folderExists) {
          return {
            success: false,
            error: `文件夹不存在: ${params.folderPath}`,
          }
        }

        // 删除文件夹
        await remove(fullPath, { recursive: true })
      } else {
        // 默认工作区：使用 baseDir
        const { path, baseDir } = await getFilePathOptions(params.folderPath)
        
        // 检查文件夹是否存在
        const folderExists = await exists(path, { baseDir })
        if (!folderExists) {
          return {
            success: false,
            error: `文件夹不存在: ${params.folderPath}`,
          }
        }

        // 删除文件夹
        await remove(path, { baseDir, recursive: true })
      }

      // 刷新文件树
      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()

      return {
        success: true,
        message: `成功删除文件夹: ${params.folderPath}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `删除文件夹失败: ${error}`,
      }
    }
  },
}

export const listFoldersTool: Tool = {
  name: 'list_folders',
  description: '列出指定路径下的所有文件夹',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: '要列出的文件夹路径，留空表示根目录',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const fullPath = params.folderPath 
          ? await join(workspace.path, params.folderPath)
          : workspace.path
        
        // 检查路径是否存在
        const pathExists = await exists(fullPath)
        if (!pathExists) {
          return {
            success: false,
            error: `路径不存在: ${params.folderPath || '根目录'}`,
          }
        }

        // 读取目录内容
        const entries = await readDir(fullPath)
        
        // 过滤出文件夹
        const folders = entries
          .filter(entry => entry.isDirectory)
          .map(entry => ({
            name: entry.name,
            path: params.folderPath ? `${params.folderPath}/${entry.name}` : entry.name,
          }))

        return {
          success: true,
          data: folders,
          message: `找到 ${folders.length} 个文件夹`,
        }
      } else {
        // 默认工作区：使用 baseDir
        const { path, baseDir } = await getFilePathOptions(params.folderPath || '')
        
        // 检查路径是否存在
        const pathExists = await exists(path, { baseDir })
        if (!pathExists) {
          return {
            success: false,
            error: `路径不存在: ${params.folderPath || '根目录'}`,
          }
        }

        // 读取目录内容
        const entries = await readDir(path, { baseDir })
        
        // 过滤出文件夹
        const folders = entries
          .filter(entry => entry.isDirectory)
          .map(entry => ({
            name: entry.name,
            path: params.folderPath ? `${params.folderPath}/${entry.name}` : entry.name,
          }))

        return {
          success: true,
          data: folders,
          message: `找到 ${folders.length} 个文件夹`,
        }
      }
    } catch (error) {
      return {
        success: false,
        error: `列出文件夹失败: ${error}`,
      }
    }
  },
}

export const folderTools: Tool[] = [
  createFolderTool,
  deleteFolderTool,
  listFoldersTool,
]
