import { Tool, ToolResult } from '../types'
import { BaseDirectory, readTextFile, writeTextFile, remove, rename, copyFile, stat } from '@tauri-apps/plugin-fs'
import { appDataDir } from '@tauri-apps/api/path'
import { getAllMarkdownFiles, MarkdownFile } from '@/lib/files'
import { ensureSafeWorkspaceRelativePath, getFilePathOptions } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useChatStore from '@/stores/chat'
import { isLinkedFolder } from '@/lib/files'
import emitter from '@/lib/emitter'
import { getVectorDocumentKey } from '@/lib/vector-document-key'

function normalizeLinkedCandidate(candidate: unknown): string {
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function getLinkedFileName(path: unknown): string {
  const normalized = normalizeLinkedCandidate(path)
  return normalized.split('/').pop() || normalized
}

function matchesLinkedFileCandidate(
  candidate: unknown,
  linkedResource: { relativePath?: string; name?: string; path?: string }
): boolean {
  const normalized = normalizeLinkedCandidate(candidate)
  if (!normalized) {
    return false
  }

  const linkedPaths = new Set([
    linkedResource.relativePath,
    linkedResource.name,
    linkedResource.path,
    getLinkedFileName(linkedResource.relativePath),
    getLinkedFileName(linkedResource.path),
  ].filter(Boolean))

  return linkedPaths.has(normalized) || linkedPaths.has(getLinkedFileName(normalized))
}

function getBatchLinkedFileReadPlan(
  filePaths: string[],
  linkedResource: { relativePath?: string; name?: string; path?: string }
): { filesToRead: string[]; skippedFiles: string[] } {
  const filesToRead: string[] = []
  const skippedFiles: string[] = []

  for (const filePath of filePaths) {
    if (matchesLinkedFileCandidate(filePath, linkedResource)) {
      skippedFiles.push(filePath)
    } else {
      filesToRead.push(filePath)
    }
  }

  return {
    filesToRead,
    skippedFiles,
  }
}

function joinRelativePath(folderPath: string | undefined, fileName: string): string {
  return folderPath ? `${folderPath}/${fileName}` : fileName
}

async function mirrorVectorDocuments(sourcePath: string, targetPath: string): Promise<number | null> {
  const { getVectorDocumentsByFilename, upsertVectorDocument } = await import('@/db/vector')
  const sourceKey = getVectorDocumentKey(sourcePath)
  const targetKey = getVectorDocumentKey(targetPath)
  const sourceDocs = await getVectorDocumentsByFilename(sourceKey)

  if (sourceDocs.length === 0) {
    return null
  }

  let latestUpdatedAt = 0
  for (const doc of sourceDocs) {
    await upsertVectorDocument({
      filename: targetKey,
      chunk_id: doc.chunk_id,
      content: doc.content,
      embedding: doc.embedding,
      updated_at: doc.updated_at,
    })
    latestUpdatedAt = Math.max(latestUpdatedAt, doc.updated_at)
  }

  return latestUpdatedAt
}

async function removeVectorDocumentsForPath(filePath: string): Promise<void> {
  const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
  const vectorKey = getVectorDocumentKey(filePath)
  const legacyFilename = filePath.split('/').pop() || filePath

  await deleteVectorDocumentsByFilename(vectorKey)
  if (legacyFilename !== vectorKey) {
    await deleteVectorDocumentsByFilename(legacyFilename)
  }
}

function updateVectorIndexedState(oldPath: string | null, newPath: string | null, updatedAt?: number | null) {
  const articleState = useArticleStore.getState()
  const nextMap = new Map(articleState.vectorIndexedFiles)

  if (oldPath) {
    nextMap.delete(getVectorDocumentKey(oldPath))
  }

  if (newPath && updatedAt) {
    nextMap.set(getVectorDocumentKey(newPath), updatedAt)
  }

  useArticleStore.setState({ vectorIndexedFiles: nextMap })
}

export const listMarkdownFilesTool: Tool = {
  name: 'list_markdown_files',
  description: 'List all Markdown files in the workspace.',
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
      console.error('[list_markdown_files] 获取文件列表失败', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `获取 Markdown 文件列表失败: ${error}`,
      }
    }
  },
}

// Read the saved on-disk content for a note file.
// Prefer get_editor_content for the currently open note so unsaved/runtime state is included.
export const readMarkdownFileTool: Tool = {
  name: 'read_markdown_file',
  description: 'Read the saved on-disk content of a Markdown note by path. Prefer `get_editor_content` for the currently open note.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file whose saved content should be read (relative path, e.g., "folder/note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 检查是否已关联该文件到对话中（避免重复读取）
      const chatStore = useChatStore.getState()
      const { linkedResource } = chatStore

      // 如果有关联的文件（非文件夹），且路径匹配，则提示内容已在上下文中
      if (linkedResource && !isLinkedFolder(linkedResource)) {
        // 提取文件名进行比较，支持相对路径和绝对路径的匹配
        const requestedFileName = normalizedFilePath.split('/').pop() || normalizedFilePath
        const linkedFileName = linkedResource.relativePath.split('/').pop() || linkedResource.relativePath

        if (requestedFileName === linkedFileName) {
          return {
            success: true,
            data: {
              filePath: normalizedFilePath,
              content: `[该文件内容已在对话上下文中] 文件 "${linkedResource.name}" (${linkedResource.relativePath}) 已关联到当前对话，其完整内容已在上下文中，无需再次读取。请直接使用上下文中已有的文件内容。`,
              alreadyInContext: true,
            },
            message: `文件 "${linkedResource.name}" 已在对话上下文中，无需再次读取`,
          }
        }
      }

      let content = ''

      // 统一使用 getFilePathOptions 来处理路径，无论是自定义工作区还是默认工作区
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      if (baseDir) {
        content = await readTextFile(path, { baseDir })
      } else {
        content = await readTextFile(path)
      }

      return {
        success: true,
        data: { filePath: normalizedFilePath, content },
        message: `成功读取文件: ${normalizedFilePath}`,
      }
    } catch (error) {
      console.error('[read_markdown_file] 读取失败', {
        filePath: params.filePath,
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `读取文件失败: ${error}`,
      }
    }
  },
}

export const createFileTool: Tool = {
  name: 'create_file',
  description: 'Create a new file in the file system. Returns filePath (relative) and fullPath (absolute for script execution).',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'fileName',
      type: 'string',
      description: 'Filename (including extension, e.g., "note.md", "config.json", "script.js")',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'File content (plain text)',
      required: true,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: subfolder path, defaults to root directory. For temporary scripts executed by execute_skill_script, prefer paths like "skills/pptx/runtime"',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined

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
        fileName = `file-${timestamp}.txt`
      }
      fileName = fileName.trim().replace(/\\/g, '/')

      if (!normalizedFolderPath && fileName.includes('/')) {
        const parts = fileName.split('/').filter(Boolean)
        fileName = parts.pop() || fileName
        normalizedFolderPath = parts.length > 0
          ? await ensureSafeWorkspaceRelativePath(parts.join('/'))
          : undefined
      }

      const filePath = await ensureSafeWorkspaceRelativePath(joinRelativePath(normalizedFolderPath, fileName))
      const isSpecialSkillPath =
        filePath.startsWith('skills/') || filePath.startsWith('outputs/')

      // 统一使用 getFilePathOptions 来处理路径
      const specialArticleRelativePath = isSpecialSkillPath
        ? `article/${filePath}`.replace(/^article\/article\//, 'article/')
        : undefined
      const { path, baseDir } = specialArticleRelativePath
        ? { path: specialArticleRelativePath as string, baseDir: BaseDirectory.AppData }
        : await getFilePathOptions(filePath)

      // 在创建文件前，确保父目录存在
      const parentFolderPath = filePath.substring(0, filePath.lastIndexOf('/'))
      const needsParentFolder = parentFolderPath && parentFolderPath !== filePath

      const { exists } = await import('@tauri-apps/plugin-fs')
      const fileAlreadyExists = baseDir
        ? await exists(path, { baseDir })
        : await exists(path)

      if (fileAlreadyExists) {
        return {
          success: false,
          error: `文件已存在: ${filePath}。create_file 只能创建新文件，请改用 update_markdown_file 或编辑器工具`,
        }
      }

      if (needsParentFolder) {
        const specialParentRelativePath = isSpecialSkillPath
          ? `article/${parentFolderPath}`.replace(/^article\/article\//, 'article/')
          : undefined
        const { path: parentPath, baseDir: parentBaseDir } = specialParentRelativePath
          ? { path: specialParentRelativePath as string, baseDir: BaseDirectory.AppData }
          : await getFilePathOptions(parentFolderPath)
        const { mkdir } = await import('@tauri-apps/plugin-fs')
        if (parentBaseDir) {
          await mkdir(parentPath, { baseDir: parentBaseDir, recursive: true })
        } else {
          await mkdir(parentPath, { recursive: true })
        }
      }

      if (baseDir) {
        await writeTextFile(path, params.content, { baseDir })
      } else {
        await writeTextFile(path, params.content)
      }

      // 获取完整路径用于返回
      const { getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()
      const workspacePath = workspace.isCustom
        ? workspace.path
        : `${await appDataDir()}/article`

      // 构建工作区完整路径
      const fullPath = `${workspacePath}/${filePath}`

      const articleStore = useArticleStore.getState()
      const inserted = articleStore.insertLocalEntry(filePath, false)
      await articleStore.ensurePathExpanded(filePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      // 如果是 Markdown 文件，选中并读取
      if (filePath.endsWith('.md')) {
        await articleStore.setActiveFilePath(filePath)
      }

      return {
        success: true,
        data: {
          filePath,
          fullPath,
        },
        message: `成功创建文件: ${fullPath}`,
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
  description: 'Update the content of a Markdown note file. Optionally provide `expectedModifiedAt` to avoid overwriting a file that changed since it was last read.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file',
      required: true,
    },
    {
      name: 'content',
      type: 'string',
      description: 'New content (Markdown format)',
      required: true,
    },
    {
      name: 'expectedModifiedAt',
      type: 'string',
      description: 'Optional ISO timestamp of the file\'s last known modified time. If the on-disk file changed since then, the update will be rejected.',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 统一使用 getFilePathOptions 来处理路径
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      if (params.expectedModifiedAt) {
        const expectedModifiedAt = new Date(params.expectedModifiedAt)
        if (Number.isNaN(expectedModifiedAt.getTime())) {
          return {
            success: false,
            error: `expectedModifiedAt 无效: ${params.expectedModifiedAt}`,
          }
        }

        const currentStat = baseDir
          ? await stat(path, { baseDir })
          : await stat(path)
        const currentModifiedAt = currentStat.mtime

        if (currentModifiedAt && currentModifiedAt.getTime() !== expectedModifiedAt.getTime()) {
          return {
            success: false,
            error: `文件已在磁盘上发生变化，已取消更新: ${normalizedFilePath}`,
            data: {
              filePath: normalizedFilePath,
              conflict: true,
              expectedModifiedAt: expectedModifiedAt.toISOString(),
              currentModifiedAt: currentModifiedAt.toISOString(),
            },
          }
        }
      }

      if (baseDir) {
        await writeTextFile(path, params.content, { baseDir })
      } else {
        await writeTextFile(path, params.content)
      }

      // 如果更新的是当前打开的文件，通过 saveCurrentArticle 刷新编辑器内容
      // 注意：不要使用 setCurrentArticle，因为它会触发 clearStack 清空撤销历史
      const articleStore = useArticleStore.getState()
      if (articleStore.activeFilePath === normalizedFilePath) {
        // 使用 emitter 通知编辑器内容已从外部更新
        emitter.emit('external-content-update', params.content)
      }

      const updatedStat = baseDir
        ? await stat(path, { baseDir })
        : await stat(path)

      return {
        success: true,
        data: {
          filePath: normalizedFilePath,
          modifiedAt: updatedStat.mtime?.toISOString(),
        },
        message: `成功更新文件: ${normalizedFilePath}`,
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
  description: 'Delete a Markdown file from the file system.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to delete',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // 统一使用 getFilePathOptions 来处理路径
      const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

      if (baseDir) {
        await remove(path, { baseDir })
      } else {
        await remove(path)
      }

      // 删除向量数据库中的记录
      const filename = normalizedFilePath.split('/').pop() || normalizedFilePath
      try {
        const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
        await deleteVectorDocumentsByFilename(filename)
      } catch (error) {
        console.error(`删除文件 ${filename} 的向量数据失败:`, error)
      }

      const removed = articleStore.removeLocalEntry(normalizedFilePath)
      if (!removed) {
        await articleStore.loadFileTree()
      }

      await articleStore.cleanTabsByDeletedFile(normalizedFilePath)

      // 如果删除的是当前打开的文件，取消选择并清空内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      return {
        success: true,
        message: `成功删除文件: ${normalizedFilePath}`,
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
  description: `Search content within Markdown files in the file system.

**IMPORTANT - Only use when user EXPLICITLY requests search**:
- ✅ CORRECT: User says "搜索关于React的笔记" / "查找包含xxx的内容" / "帮我找找"
- ❌ WRONG: User asks a question without explicitly asking to search (e.g., "What is React?" without asking to search)

Two modes:
- keyword (default): Fast exact matching for specific terms like "useState", "React", "API"
- rag: Semantic search - ONLY use when user explicitly asks for semantic/AI search (e.g., "语义搜索" / "AI搜索" / "相关笔记")

Use folderPath to limit scope to a specific folder.`,
  category: 'search',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search keyword or natural language query',
      required: true,
    },
    {
      name: 'mode',
      type: 'string',
      description: 'Search mode: keyword (default, keyword matching) or rag (semantic search)',
      required: false,
    },
    {
      name: 'folderPath',
      type: 'string',
      description: 'Optional: limit search to specified folder (relative path)',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const normalizedFolderPath = params.folderPath
        ? await ensureSafeWorkspaceRelativePath(params.folderPath)
        : undefined

      // RAG 模式：调用 RAG 搜索
      if (params.mode === 'rag') {
        const { getContextForQuery, getContextForQueryInFolder } = await import('@/lib/rag')

        // 将查询转换为关键词格式
        const keywords = [{ text: params.query, weight: 1 }]

        // 根据是否指定文件夹选择不同的 RAG 方法
        const ragResult = normalizedFolderPath
          ? await getContextForQueryInFolder(keywords, normalizedFolderPath)
          : await getContextForQuery(keywords)

        // 获取所有文件列表，用于补全路径（向量数据库只存文件名，需要补全相对路径）
        const allFiles = await getAllMarkdownFiles()
        // 创建文件名到相对路径的映射（处理同名文件）
        const fileNameToPath = new Map<string, string[]>()
        for (const file of allFiles) {
          const name = file.name
          if (!fileNameToPath.has(name)) {
            fileNameToPath.set(name, [])
          }
          fileNameToPath.get(name)!.push(file.relativePath)
        }

        // 格式化返回结果，补全路径
        const formattedResults = ragResult.sourceDetails.map(source => {
          // 向量搜索返回的 filepath 可能只是文件名，需要补全路径
          let filePath = source.filepath
          if (!filePath.includes('/')) {
            // filepath 只是文件名，从映射中获取完整路径
            const paths = fileNameToPath.get(source.filename)
            if (paths && paths.length > 0) {
              // 如果有多个同名文件，使用第一个
              filePath = paths[0]
            }
          }
          return {
            filePath,
            fileName: source.filename,
            matchedContent: source.content,
          }
        })

        return {
          success: true,
          data: formattedResults,
          message: `RAG 搜索找到 ${ragResult.sources.length} 个相关笔记${normalizedFolderPath ? `（文件夹：${normalizedFolderPath}）` : ''}`,
        }
      }

      // 关键词模式：原有的精确匹配搜索
      // 如果指定了文件夹路径，先过滤文件列表
      let allFiles = await getAllMarkdownFiles()
      if (normalizedFolderPath) {
        allFiles = allFiles.filter(file => file.relativePath.startsWith(normalizedFolderPath))
      }

      const results: Array<{
        filePath: string
        fileName: string
        matchedContent: string
        lineNumber?: number
      }> = []

      for (const file of allFiles) {
        try {
          let content = ''

          // 统一使用 getFilePathOptions 来处理路径
          const { path, baseDir } = await getFilePathOptions(file.relativePath)

          if (baseDir) {
            content = await readTextFile(path, { baseDir })
          } else {
            content = await readTextFile(path)
          }

          if (content.toLowerCase().includes(params.query.toLowerCase())) {
            // 按行分割内容
            const lines = content.split('\n')

            // 查找匹配的行
            for (let i = 0; i < lines.length; i++) {
              if (lines[i].toLowerCase().includes(params.query.toLowerCase())) {
                // 提取上下文（前后各 2 行）
                const contextStart = Math.max(0, i - 2)
                const contextEnd = Math.min(lines.length, i + 3)
                const contextLines = lines.slice(contextStart, contextEnd)

                // 格式化匹配内容，包含行号
                const formattedLines = contextLines.map((line, idx) => {
                  const actualLineNum = contextStart + idx + 1
                  const isMatchLine = actualLineNum === i + 1
                  const prefix = isMatchLine ? '>' : ' '
                  return `${prefix} ${actualLineNum}: ${line}`
                })

                results.push({
                  filePath: file.relativePath,
                  fileName: file.name,
                  matchedContent: formattedLines.join('\n'),
                  lineNumber: i + 1,
                })

                break // 只添加第一个匹配位置，避免重复
              }
            }
          }
        } catch (error) {
          console.error(`读取文件 ${file.path} 失败:`, error)
        }
      }

      return {
        success: true,
        data: results,
        message: `找到 ${results.length} 个匹配的文件${normalizedFolderPath ? `（文件夹：${normalizedFolderPath}）` : ''}`,
      }
    } catch (error) {
      return {
        success: false,
        error: `搜索文件失败: ${error}`,
      }
    }
  },
}

// ⚠️ DEPRECATED: Use replace_editor_content from editor-tools.ts instead
// This tool writes to disk, but since content is saved in real-time,
// replace_editor_content provides the same result with better performance.
// @deprecated since content is saved in real-time, use replace_editor_content instead
export const modifyCurrentNoteTool: Tool = {
  name: 'modify_current_note',
  description: '**DEPRECATED**: Use replace_editor_content from editor-tools instead. This tool writes to disk, but replace_editor_content provides better performance for real-time saved content.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    return {
      success: false,
      error: 'This tool is deprecated. Use replace_editor_content from editor-tools instead.',
    }
  },
}

export const readMarkdownFilesBatchTool: Tool = {
  name: 'read_markdown_files_batch',
  description: 'Batch read the saved on-disk contents of multiple Markdown notes. Prefer `get_editor_content` for any note that is currently open in the editor.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths whose saved contents should be read',
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

      const results = []
      const errors = []
      const skipped = []
      const { linkedResource } = useChatStore.getState()
      const readPlan = linkedResource && !isLinkedFolder(linkedResource)
        ? getBatchLinkedFileReadPlan(params.filePaths, linkedResource)
        : { filesToRead: params.filePaths, skippedFiles: [] }

      for (const filePath of readPlan.skippedFiles) {
        skipped.push({
          filePath,
          alreadyInContext: true,
        })
      }

      for (const filePath of readPlan.filesToRead) {
        try {
          let content = ''

          // 统一使用 getFilePathOptions 来处理路径
          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)
          const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

          if (baseDir) {
            content = await readTextFile(path, { baseDir })
          } else {
            content = await readTextFile(path)
          }

          results.push({ filePath: normalizedFilePath, content })
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      // 只要有任何文件读取失败，就标记为失败状态
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          files: results,
          skipped,
          failed: errors,
          successCount: results.length,
          skippedCount: skipped.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `部分失败：成功读取 ${results.length} 个文件，跳过 ${skipped.length} 个已在上下文中的文件，${errors.length} 个失败`
          : `成功读取 ${results.length} 个文件，跳过 ${skipped.length} 个已在上下文中的文件`,
        error: hasErrors
          ? `部分文件读取失败：${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
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
  description: 'Batch delete multiple Markdown note files to avoid loop calls.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePaths',
      type: 'array',
      description: 'Array of Markdown file paths to delete',
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

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileDeleted = false

      for (const filePath of params.filePaths) {
        try {
          const normalizedFilePath = await ensureSafeWorkspaceRelativePath(filePath)

          if (articleStore.activeFilePath === normalizedFilePath) {
            currentFileDeleted = true
          }

          // 统一使用 getFilePathOptions 来处理路径
          const { path, baseDir } = await getFilePathOptions(normalizedFilePath)

          if (baseDir) {
            await remove(path, { baseDir })
          } else {
            await remove(path)
          }

          results.push(normalizedFilePath)
        } catch (error) {
          errors.push({ filePath, error: String(error) })
        }
      }

      // 批量删除向量数据库中的记录（只删除成功的文件）
      const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
      for (const filePath of results) {
        const filename = filePath.split('/').pop() || filePath
        try {
          await deleteVectorDocumentsByFilename(filename)
        } catch (error) {
          console.error(`删除文件 ${filename} 的向量数据失败:`, error)
        }
      }

      await articleStore.loadFileTree()

      if (currentFileDeleted) {
        await articleStore.setActiveFilePath('')
        articleStore.setCurrentArticle('')
      }

      // 只要有任何文件删除失败，就标记为失败状态
      const hasErrors = errors.length > 0
      return {
        success: !hasErrors,
        data: {
          deleted: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: hasErrors
          ? `部分失败：成功删除 ${results.length} 个文件，${errors.length} 个失败`
          : `成功删除 ${results.length} 个文件`,
        error: hasErrors
          ? `部分文件删除失败：${errors.map(e => `${e.filePath}: ${e.error}`).join('; ')}`
          : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量删除文件失败: ${error}`,
      }
    }
  },
}

export const listMarkdownFilesByDateTool: Tool = {
  name: 'list_markdown_files_by_date',
  description: 'List Markdown note files updated within a specified time range. Supports filtering by relative time (e.g., last N days, N days ago) or absolute time range.',
  category: 'note',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'lastNDays',
      type: 'number',
      description: 'Optional: get files modified within the last N days. Mutually exclusive with olderThanDays/startDate/endDate, has highest priority.',
      required: false,
    },
    {
      name: 'olderThanDays',
      type: 'number',
      description: 'Optional: get files modified more than N days ago (excluding recent N days). Mutually exclusive with lastNDays/startDate/endDate.',
      required: false,
    },
    {
      name: 'startDate',
      type: 'string',
      description: 'Optional: start date (ISO 8601 format, e.g., 2024-01-01 or 2024-01-01T00:00:00Z)',
      required: false,
    },
    {
      name: 'endDate',
      type: 'string',
      description: 'Optional: end date (ISO 8601 format, e.g., 2024-12-31 or 2024-12-31T23:59:59Z), defaults to current time',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      let startDate: Date | undefined
      let endDate: Date | undefined

      // 优先使用 lastNDays 参数（最近 N 天）
      if (params.lastNDays && typeof params.lastNDays === 'number') {
        const now = new Date()
        startDate = new Date(now.getTime() - params.lastNDays * 24 * 60 * 60 * 1000)
        endDate = now
      }
      // 其次使用 olderThanDays 参数（N 天之前）
      else if (params.olderThanDays && typeof params.olderThanDays === 'number') {
        const now = new Date()
        endDate = new Date(now.getTime() - params.olderThanDays * 24 * 60 * 60 * 1000)
        // startDate 不设置，表示从最早开始到 endDate
      }
      // 最后使用 startDate/ endDate 参数（绝对时间范围）
      else {
        if (params.startDate) {
          startDate = new Date(params.startDate)
          if (isNaN(startDate.getTime())) {
            return {
              success: false,
              error: `无效的 startDate 格式: ${params.startDate}，请使用 ISO 8601 格式（如 2024-01-01）`,
            }
          }
        }
        if (params.endDate) {
          endDate = new Date(params.endDate)
          if (isNaN(endDate.getTime())) {
            return {
              success: false,
              error: `无效的 endDate 格式: ${params.endDate}，请使用 ISO 8601 格式（如 2024-12-31）`,
            }
          }
        } else {
          endDate = new Date()
        }
      }

      // 获取包含元数据的文件列表
      const allFiles = await getAllMarkdownFiles(true)

      // 根据时间范围过滤
      const filteredFiles: MarkdownFile[] = []
      for (const file of allFiles) {
        if (!file.modifiedAt) {
          continue // 没有修改时间的文件跳过
        }

        const modifiedTime = new Date(file.modifiedAt)

        // 检查是否在时间范围内
        if (startDate && modifiedTime < startDate) {
          continue
        }
        if (endDate && modifiedTime > endDate) {
          continue
        }

        filteredFiles.push(file)
      }

      // 按修改时间倒序排列
      filteredFiles.sort((a, b) => {
        const aTime = a.modifiedAt ? new Date(a.modifiedAt).getTime() : 0
        const bTime = b.modifiedAt ? new Date(b.modifiedAt).getTime() : 0
        return bTime - aTime
      })

      return {
        success: true,
        data: filteredFiles.map(({ name, relativePath, modifiedAt, metadata }) => ({
          name,
          relativePath,
          modifiedAt: modifiedAt?.toISOString(),
          size: metadata?.size,
          createdAt: metadata?.createdAt?.toISOString(),
          accessedAt: metadata?.accessedAt?.toISOString(),
          isReadOnly: metadata?.isReadOnly,
        })),
        message: `找到 ${filteredFiles.length} 个符合条件的文件（${startDate ? `从 ${startDate.toISOString()}` : ''}${endDate ? `到 ${endDate.toISOString()}` : ''}）`,
      }
    } catch (error) {
      console.error('[list_markdown_files_by_date] 获取文件列表失败', {
        error: String(error),
        errorName: error instanceof Error ? error.name : 'unknown',
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `按时间获取 Markdown 文件列表失败: ${error}`,
      }
    }
  },
}

export const renameFileTool: Tool = {
  name: 'rename_file',
  description: 'Rename the specified Markdown file. Only changes the filename, not the folder containing the file.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to rename',
      required: true,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'New filename (including .md extension, e.g., "new-note.md")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // 验证新文件名以 .md 结尾
      let newName = params.newName
      if (!newName.endsWith('.md')) {
        newName += '.md'
      }

      // 获取原文件的完整路径信息
      const { path: oldPath, baseDir } = await getFilePathOptions(normalizedFilePath)

      // 构建新路径（保持原文件夹，只改文件名）
      const pathParts = normalizedFilePath.split('/')
      pathParts[pathParts.length - 1] = newName
      const newRelativePath = pathParts.join('/')

      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查新文件名是否已存在
      const { exists } = await import('@tauri-apps/plugin-fs')
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      if (targetExists) {
        return {
          success: false,
          error: `文件名 "${newName}" 已存在，请使用其他文件名`,
        }
      }

      // 执行重命名
      if (baseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)

      // 如果重命名的是当前打开的文件，更新 activeFilePath 并重新读取内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
          newName,
        },
        message: `成功将 "${normalizedFilePath}" 重命名为 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[rename_file] 重命名失败', {
        filePath: params.filePath,
        newName: params.newName,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `重命名文件失败: ${error}`,
      }
    }
  },
}

export const moveFileTool: Tool = {
  name: 'move_file',
  description: 'Move the specified Markdown file to another folder. The filename remains unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to move',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes")',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = await ensureSafeWorkspaceRelativePath(params.targetFolderPath)

      // 检查是否是当前打开的文件
      const isCurrentFile = articleStore.activeFilePath === normalizedFilePath

      // 提取原文件名
      const fileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      // 构建新路径
      const newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${fileName}`
        : fileName

      // 验证目标文件夹是否存在
      const { exists } = await import('@tauri-apps/plugin-fs')
      const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

      const targetFolderExists = targetBaseDir
        ? await exists(targetFolderDir, { baseDir: targetBaseDir })
        : await exists(targetFolderDir)

      if (!targetFolderExists) {
        return {
          success: false,
          error: `目标文件夹 "${normalizedTargetFolderPath}" 不存在，请先创建该文件夹`,
        }
      }

      // 获取原文件和新文件的完整路径信息
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查目标位置是否已存在同名文件
      const targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      if (targetExists) {
        return {
          success: false,
          error: `目标位置已存在同名文件 "${fileName}"，请先重命名或删除该文件`,
        }
      }

      // 执行移动（使用 rename）
      if (oldBaseDir) {
        await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: oldBaseDir })
      } else {
        await rename(oldPath, newPath)
      }

      const migratedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (migratedVectorUpdatedAt !== null) {
        await removeVectorDocumentsForPath(normalizedFilePath)
        updateVectorIndexedState(normalizedFilePath, newRelativePath, migratedVectorUpdatedAt)
      } else {
        updateVectorIndexedState(normalizedFilePath, null)
      }

      const moved = articleStore.moveLocalEntry(normalizedFilePath, newRelativePath)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!moved) {
        await articleStore.loadFileTree()
      }

      await articleStore.syncOpenTabsForPathChange(normalizedFilePath, newRelativePath)

      // 如果移动的是当前打开的文件，更新 activeFilePath 并重新读取内容
      if (isCurrentFile) {
        await articleStore.setActiveFilePath(newRelativePath)
      }

      return {
        success: true,
        data: {
          oldPath: normalizedFilePath,
          newPath: newRelativePath,
        },
        message: `成功将 "${normalizedFilePath}" 移动到 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[move_file] 移动失败', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `移动文件失败: ${error}`,
      }
    }
  },
}

export const copyFileTool: Tool = {
  name: 'copy_file',
  description: 'Copy the specified Markdown file to another folder. The original file remains unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'filePath',
      type: 'string',
      description: 'Path of the Markdown file to copy',
      required: true,
    },
    {
      name: 'targetFolderPath',
      type: 'string',
      description: 'Target folder path (relative to notes root directory, e.g., "frontend/React" or "study-notes"). Leave empty to copy to current folder',
      required: false,
    },
    {
      name: 'newName',
      type: 'string',
      description: 'Optional: new filename (including .md extension). If not specified, uses the original filename, and automatically adds a number if a file with the same name exists',
      required: false,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      const articleStore = useArticleStore.getState()
      const normalizedFilePath = await ensureSafeWorkspaceRelativePath(params.filePath)
      const normalizedTargetFolderPath = params.targetFolderPath
        ? await ensureSafeWorkspaceRelativePath(params.targetFolderPath)
        : undefined

      // 提取原文件名
      const originalFileName = normalizedFilePath.split('/').pop() || normalizedFilePath

      // 确定新文件名
      let newFileName = params.newName || originalFileName
      if (!newFileName.endsWith('.md')) {
        newFileName += '.md'
      }

      // 构建新路径
      let newRelativePath = normalizedTargetFolderPath
        ? `${normalizedTargetFolderPath}/${newFileName}`
        : newFileName

      // 验证目标文件夹是否存在（如果指定了目标文件夹）
      if (normalizedTargetFolderPath) {
        const { exists } = await import('@tauri-apps/plugin-fs')
        const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(normalizedTargetFolderPath)

        const targetFolderExists = targetBaseDir
          ? await exists(targetFolderDir, { baseDir: targetBaseDir })
          : await exists(targetFolderDir)

        if (!targetFolderExists) {
          return {
            success: false,
            error: `目标文件夹 "${normalizedTargetFolderPath}" 不存在，请先创建该文件夹`,
          }
        }
      }

      // 获取原文件和新文件的完整路径信息
      const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(normalizedFilePath)
      const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

      // 检查目标位置是否已存在同名文件
      const { exists } = await import('@tauri-apps/plugin-fs')
      let targetExists = newBaseDir
        ? await exists(newPath, { baseDir: newBaseDir })
        : await exists(newPath)

      // 如果存在同名文件且没有指定新文件名，自动添加序号
      if (targetExists && !params.newName) {
        const baseName = newFileName.replace(/\.md$/, '')
        let counter = 1
        do {
          newFileName = `${baseName} ${counter}.md`
          newRelativePath = normalizedTargetFolderPath
            ? `${normalizedTargetFolderPath}/${newFileName}`
            : newFileName

          const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
          targetExists = checkBaseDir
            ? await exists(checkPath, { baseDir: checkBaseDir })
            : await exists(checkPath)
          counter++
        } while (targetExists && counter < 1000)
      }

      // 重新获取最终的新路径
      const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

      // 执行复制
      if (oldBaseDir && finalNewBaseDir) {
        await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
      } else {
        await copyFile(oldPath, finalNewPath)
      }

      const copiedVectorUpdatedAt = await mirrorVectorDocuments(normalizedFilePath, newRelativePath)
      if (copiedVectorUpdatedAt !== null) {
        updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
      }

      const inserted = articleStore.insertLocalEntry(newRelativePath, false)
      await articleStore.ensurePathExpanded(newRelativePath)
      if (!inserted) {
        await articleStore.loadFileTree()
      }

      return {
        success: true,
        data: {
          sourcePath: normalizedFilePath,
          newPath: newRelativePath,
          newName: newFileName,
        },
        message: `成功将 "${normalizedFilePath}" 复制为 "${newRelativePath}"`,
      }
    } catch (error) {
      console.error('[copy_file] 复制失败', {
        filePath: params.filePath,
        targetFolderPath: params.targetFolderPath,
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `复制文件失败: ${error}`,
      }
    }
  },
}

export const moveFilesBatchTool: Tool = {
  name: 'move_files_batch',
  description: 'Batch move multiple Markdown files to another folder to avoid loop calls. The filenames remain unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to move, each file contains filePath (source path) and targetFolderPath (destination folder)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileMoved = false

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = await ensureSafeWorkspaceRelativePath(file.targetFolderPath)

          // 检查是否是当前打开的文件
          if (articleStore.activeFilePath === filePath) {
            currentFileMoved = true
          }

          // 提取原文件名
          const fileName = filePath.split('/').pop() || filePath

          // 构建新路径
          const newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${fileName}`
            : fileName

          // 验证目标文件夹是否存在
          const { exists } = await import('@tauri-apps/plugin-fs')
          const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

          const targetFolderExists = targetBaseDir
            ? await exists(targetFolderDir, { baseDir: targetBaseDir })
            : await exists(targetFolderDir)

          if (!targetFolderExists) {
            errors.push({ filePath, error: `目标文件夹 "${targetFolderPath}" 不存在` })
            continue
          }

          // 获取原文件和新文件的完整路径信息
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查目标位置是否已存在同名文件
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: '目标位置已存在同名文件' })
            continue
          }

          // 执行移动（使用 rename）
          if (oldBaseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: oldBaseDir, newPathBaseDir: oldBaseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({ oldPath: filePath, newPath: newRelativePath })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 如果移动了当前打开的文件，需要更新 activeFilePath
      if (currentFileMoved && results.length > 0) {
        const movedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (movedFile) {
          await articleStore.setActiveFilePath(movedFile.newPath)
          await articleStore.readArticle(movedFile.newPath)
        }
      }

      // 只要有任何文件移动失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          moved: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功移动 ${results.length} 个文件`
          : `部分失败：成功移动 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量移动文件失败: ${error}`,
      }
    }
  },
}

export const copyFilesBatchTool: Tool = {
  name: 'copy_files_batch',
  description: 'Batch copy multiple Markdown files to other folders to avoid loop calls. The original files remain unchanged.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to copy, each file contains filePath (source path), targetFolderPath (destination folder), and optionally newName (new filename)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          const targetFolderPath = file.targetFolderPath
            ? await ensureSafeWorkspaceRelativePath(file.targetFolderPath)
            : undefined
          const newName = file.newName

          // 提取原文件名
          const originalFileName = filePath.split('/').pop() || filePath

          // 确定新文件名
          let newFileName = newName || originalFileName
          if (!newFileName.endsWith('.md')) {
            newFileName += '.md'
          }

          // 构建新路径
          let newRelativePath = targetFolderPath
            ? `${targetFolderPath}/${newFileName}`
            : newFileName

          // 验证目标文件夹是否存在（如果指定了目标文件夹）
          if (targetFolderPath) {
            const { exists } = await import('@tauri-apps/plugin-fs')
            const { path: targetFolderDir, baseDir: targetBaseDir } = await getFilePathOptions(targetFolderPath)

            const targetFolderExists = targetBaseDir
              ? await exists(targetFolderDir, { baseDir: targetBaseDir })
              : await exists(targetFolderDir)

            if (!targetFolderExists) {
              errors.push({ filePath, error: `目标文件夹 "${targetFolderPath}" 不存在` })
              continue
            }
          }

          // 获取原文件和新文件的完整路径信息
          const { path: oldPath, baseDir: oldBaseDir } = await getFilePathOptions(filePath)
          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查目标位置是否已存在同名文件
          const { exists } = await import('@tauri-apps/plugin-fs')
          let targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          // 如果存在同名文件且没有指定新文件名，自动添加序号
          if (targetExists && !newName) {
            const baseName = newFileName.replace(/\.md$/, '')
            let counter = 1
            do {
              newFileName = `${baseName} ${counter}.md`
              newRelativePath = targetFolderPath
                ? `${targetFolderPath}/${newFileName}`
                : newFileName

              const { path: checkPath, baseDir: checkBaseDir } = await getFilePathOptions(newRelativePath)
              targetExists = checkBaseDir
                ? await exists(checkPath, { baseDir: checkBaseDir })
                : await exists(checkPath)
              counter++
            } while (targetExists && counter < 1000)
          }

          // 重新获取最终的新路径
          const { path: finalNewPath, baseDir: finalNewBaseDir } = await getFilePathOptions(newRelativePath)

          // 执行复制
          if (oldBaseDir && finalNewBaseDir) {
            await copyFile(oldPath, finalNewPath, { fromPathBaseDir: oldBaseDir, toPathBaseDir: finalNewBaseDir })
          } else {
            await copyFile(oldPath, finalNewPath)
          }

          const copiedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (copiedVectorUpdatedAt !== null) {
            updateVectorIndexedState(null, newRelativePath, copiedVectorUpdatedAt)
          }

          results.push({
            sourcePath: filePath,
            newPath: newRelativePath,
            newName: newFileName,
          })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 只要有任何文件复制失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          copied: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功复制 ${results.length} 个文件`
          : `部分失败：成功复制 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      return {
        success: false,
        error: `批量复制文件失败: ${error}`,
      }
    }
  },
}

export const renameFilesBatchTool: Tool = {
  name: 'rename_files_batch',
  description: 'Batch rename multiple Markdown files to avoid loop calls. Only changes the filenames, not the folders containing the files.',
  category: 'note',
  requiresConfirmation: true,
  parameters: [
    {
      name: 'files',
      type: 'array',
      description: 'Array of files to rename, each file contains filePath (original path) and newName (new filename including .md extension)',
      required: true,
    },
  ],
  execute: async (params): Promise<ToolResult> => {
    try {
      if (!Array.isArray(params.files) || params.files.length === 0) {
        return {
          success: false,
          error: '参数 files 必须是非空数组',
        }
      }

      const articleStore = useArticleStore.getState()
      const results = []
      const errors = []
      let currentFileRenamed = false

      for (const file of params.files) {
        try {
          const filePath = await ensureSafeWorkspaceRelativePath(file.filePath)
          let newName = file.newName

          // 验证新文件名以 .md 结尾
          if (!newName.endsWith('.md')) {
            newName += '.md'
          }

          // 检查是否是当前打开的文件
          if (articleStore.activeFilePath === filePath) {
            currentFileRenamed = true
          }

          // 获取原文件的完整路径信息
          const { path: oldPath, baseDir } = await getFilePathOptions(filePath)

          // 构建新路径（保持原文件夹，只改文件名）
          const pathParts = filePath.split('/')
          pathParts[pathParts.length - 1] = newName
          const newRelativePath = pathParts.join('/')

          const { path: newPath, baseDir: newBaseDir } = await getFilePathOptions(newRelativePath)

          // 检查新文件名是否已存在
          const { exists } = await import('@tauri-apps/plugin-fs')
          const targetExists = newBaseDir
            ? await exists(newPath, { baseDir: newBaseDir })
            : await exists(newPath)

          if (targetExists) {
            errors.push({ filePath, error: `文件名 "${newName}" 已存在` })
            continue
          }

          // 执行重命名
          if (baseDir) {
            await rename(oldPath, newPath, { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
          } else {
            await rename(oldPath, newPath)
          }

          const migratedVectorUpdatedAt = await mirrorVectorDocuments(filePath, newRelativePath)
          if (migratedVectorUpdatedAt !== null) {
            await removeVectorDocumentsForPath(filePath)
            updateVectorIndexedState(filePath, newRelativePath, migratedVectorUpdatedAt)
          } else {
            updateVectorIndexedState(filePath, null)
          }

          results.push({
            oldPath: filePath,
            newPath: newRelativePath,
            newName,
          })
        } catch (error) {
          errors.push({ filePath: file.filePath, error: String(error) })
        }
      }

      // 刷新文件列表
      await articleStore.loadFileTree()

      // 如果重命名了当前打开的文件，更新 activeFilePath 并重新读取内容
      if (currentFileRenamed && results.length > 0) {
        const renamedFile = results.find(r => articleStore.activeFilePath === r.oldPath)
        if (renamedFile) {
          await articleStore.setActiveFilePath(renamedFile.newPath)
          await articleStore.readArticle(renamedFile.newPath)
        }
      }

      // 只要有任何文件重命名失败，就标记为失败状态
      return {
        success: errors.length === 0,
        data: {
          renamed: results,
          failed: errors,
          successCount: results.length,
          failCount: errors.length,
        },
        message: errors.length === 0
          ? `成功重命名 ${results.length} 个文件`
          : `部分失败：成功重命名 ${results.length} 个文件，${errors.length} 个失败`,
      }
    } catch (error) {
      console.error('[rename_files_batch] 批量重命名失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `批量重命名文件失败: ${error}`,
      }
    }
  },
}

export const noteTools: Tool[] = [
  listMarkdownFilesTool,
  readMarkdownFileTool,
  createFileTool,
  updateMarkdownFileTool,
  deleteMarkdownFileTool,
  searchMarkdownFilesTool,
  // modifyCurrentNoteTool: DEPRECATED - use replace_editor_content from editor-tools.ts instead
  readMarkdownFilesBatchTool,
  deleteMarkdownFilesBatchTool,
  listMarkdownFilesByDateTool,
  renameFileTool,
  moveFileTool,
  copyFileTool,
  moveFilesBatchTool,
  copyFilesBatchTool,
  renameFilesBatchTool,
]
