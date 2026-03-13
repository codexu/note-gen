import { Tool, ToolResult } from '../types'
import { mkdir, remove, exists, readDir } from '@tauri-apps/plugin-fs'
import { getWorkspacePath, getFilePathOptions, normalizeWorkspaceRelativePath } from '@/lib/workspace'
import { join } from '@tauri-apps/api/path'
import useArticleStore from '@/stores/article'

export const checkFolderExistsTool: Tool = {
  name: 'check_folder_exists',
  description: 'Check if the specified folder exists',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path to check (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFolderPath = await normalizeWorkspaceRelativePath(params.folderPath)
      const workspace = await getWorkspacePath()

      let fullPath = ''
      let folderExists = false

      if (workspace.isCustom) {
        fullPath = await join(workspace.path, normalizedFolderPath)
        folderExists = await exists(fullPath)
      } else {
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        fullPath = path
        folderExists = await exists(fullPath, { baseDir })
      }

      return {
        success: true,
        data: {
          folderPath: normalizedFolderPath,
          exists: folderExists,
          fullPath,
        },
        message: folderExists
          ? `文件夹 "${normalizedFolderPath}" 存在`
          : `文件夹 "${normalizedFolderPath}" 不存在`,
      }
    } catch (error) {
      console.error('[check_folder_exists] 检查失败', {
        folderPath: params.folderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `检查文件夹失败: ${error}`,
      }
    }
  },
}

export const createFolderTool: Tool = {
  name: 'create_folder',
  description: 'Create a new folder for organizing notes',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
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

      const normalizedFolderPath = await normalizeWorkspaceRelativePath(params.folderPath)

      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const fullPath = await join(workspace.path, normalizedFolderPath)
        
        // 检查文件夹是否已存在
        const folderExists = await exists(fullPath)
        if (folderExists) {
          // 文件夹已存在，视为成功
          return {
            success: true,
            data: { folderPath: normalizedFolderPath, alreadyExists: true },
            message: `文件夹已存在: ${normalizedFolderPath}`,
          }
        }

        // 创建文件夹
        await mkdir(fullPath, { recursive: true })
      } else {
        // 默认工作区：使用 baseDir
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        
        // 检查文件夹是否已存在
        const folderExists = await exists(path, { baseDir })
        if (folderExists) {
          // 文件夹已存在，视为成功
          return {
            success: true,
            data: { folderPath: normalizedFolderPath, alreadyExists: true },
            message: `文件夹已存在: ${normalizedFolderPath}`,
          }
        }

        // 创建文件夹
        await mkdir(path, { baseDir, recursive: true })
      }

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(normalizedFolderPath, true)
      await articleStore.ensurePathExpanded(normalizedFolderPath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: { folderPath: normalizedFolderPath },
        message: `成功创建文件夹: ${normalizedFolderPath}`,
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
  description: 'Delete the specified folder (will delete all contents within the folder)',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Path of the folder to delete',
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

      const normalizedFolderPath = await normalizeWorkspaceRelativePath(params.folderPath)

      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const fullPath = await join(workspace.path, normalizedFolderPath)
        
        // 检查文件夹是否存在
        const folderExists = await exists(fullPath)
        if (!folderExists) {
          return {
            success: false,
            error: `文件夹不存在: ${normalizedFolderPath}`,
          }
        }

        // 删除文件夹
        await remove(fullPath, { recursive: true })
      } else {
        // 默认工作区：使用 baseDir
        const { path, baseDir } = await getFilePathOptions(normalizedFolderPath)
        
        // 检查文件夹是否存在
        const folderExists = await exists(path, { baseDir })
        if (!folderExists) {
          return {
            success: false,
            error: `文件夹不存在: ${normalizedFolderPath}`,
          }
        }

        // 删除文件夹
        await remove(path, { baseDir, recursive: true })
      }

      const articleStore = useArticleStore.getState()
      const removed = articleStore.removeLocalEntry(normalizedFolderPath)
      if (!removed) {
        await articleStore.loadFileTree()
      }

      await articleStore.cleanTabsByDeletedFolder(normalizedFolderPath)

      if (articleStore.activeFilePath && articleStore.activeFilePath.startsWith(`${normalizedFolderPath}/`)) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      return {
        success: true,
        message: `成功删除文件夹: ${normalizedFolderPath}`,
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
  description: 'List all folders under the specified path',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPath',
      type: 'string',
      description: 'Folder path to list, leave empty for root directory',
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
      console.error('[list_folders] 执行失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `列出文件夹失败: ${error}`,
      }
    }
  },
}

export const createFoldersBatchTool: Tool = {
  name: 'create_folders_batch',
  description: 'Batch create multiple folders to avoid loop calls. Use for scenarios requiring multiple folders to be created at once.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'folderPaths',
      type: 'array',
      description: 'Array of folder paths to create',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.folderPaths) || params.folderPaths.length === 0) {
        return {
          success: false,
          error: '参数 folderPaths 必须是非空数组',
        }
      }

      const workspace = await getWorkspacePath()
      const created = []
      const skipped = []  // 已存在，跳过创建
      const errors = []   // 真正的错误

      for (const folderPath of params.folderPaths) {
        try {
          if (workspace.isCustom) {
            const fullPath = await join(workspace.path, folderPath)
            const folderExists = await exists(fullPath)
            if (folderExists) {
              skipped.push({ path: folderPath, reason: '文件夹已存在' })
              continue
            }
            await mkdir(fullPath, { recursive: true })
          } else {
            const { path, baseDir } = await getFilePathOptions(folderPath)
            const folderExists = await exists(path, { baseDir })
            if (folderExists) {
              skipped.push({ path: folderPath, reason: '文件夹已存在' })
              continue
            }
            await mkdir(path, { baseDir, recursive: true })
          }
          created.push(folderPath)
        } catch (error) {
          errors.push({ path: folderPath, error: String(error) })
        }
      }

      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()

      // 只要有任何真正错误，就标记为失败状态（已存在的 skipped 不算错误）
      return {
        success: errors.length === 0,
        data: {
          created,
          skipped,
          errors,
          createdCount: created.length,
          skippedCount: skipped.length,
          errorCount: errors.length,
        },
        message: errors.length === 0
          ? `创建 ${created.length} 个，跳过 ${skipped.length} 个`
          : `部分失败：创建 ${created.length} 个，跳过 ${skipped.length} 个，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量创建文件夹失败: ${error}`,
      }
    }
  },
}

export const deleteFoldersBatchTool: Tool = {
  name: 'delete_folders_batch',
  description: 'Batch delete multiple folders (will delete all contents within the folders) to avoid loop calls.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'folderPaths',
      type: 'array',
      description: 'Array of folder paths to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.folderPaths) || params.folderPaths.length === 0) {
        return {
          success: false,
          error: '参数 folderPaths 必须是非空数组',
        }
      }

      const workspace = await getWorkspacePath()
      const results = []
      const errors = []

      for (const folderPath of params.folderPaths) {
        try {
          if (workspace.isCustom) {
            const fullPath = await join(workspace.path, folderPath)
            const folderExists = await exists(fullPath)
            if (!folderExists) {
              errors.push({ path: folderPath, error: '文件夹不存在' })
              continue
            }
            await remove(fullPath, { recursive: true })
          } else {
            const { path, baseDir } = await getFilePathOptions(folderPath)
            const folderExists = await exists(path, { baseDir })
            if (!folderExists) {
              errors.push({ path: folderPath, error: '文件夹不存在' })
              continue
            }
            await remove(path, { baseDir, recursive: true })
          }
          results.push(folderPath)
        } catch (error) {
          errors.push({ path: folderPath, error: String(error) })
        }
      }

      const articleStore = useArticleStore.getState()
      await articleStore.loadFileTree()

      // 只要有任何文件夹删除失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          deleted: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功删除 ${results.length} 个文件夹`
          : `部分失败：成功删除 ${results.length} 个文件夹，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除文件夹失败: ${error}`,
      }
    }
  },
}

export const folderTools: Tool[] = [
  checkFolderExistsTool,
  createFolderTool,
  deleteFolderTool,
  listFoldersTool,
  createFoldersBatchTool,
  deleteFoldersBatchTool,
]
