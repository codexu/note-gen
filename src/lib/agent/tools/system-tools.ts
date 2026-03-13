import { Tool, ToolResult } from '../types'
import { skillManager } from '@/lib/skills'
import { executeSkillRuntime } from '@/lib/skills/runtime'
import useArticleStore from '@/stores/article'

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Get the current date and time. Returns format: YYYY-MM-DD (e.g., 2026-01-18), which is suitable for direct use as part of a filename.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [],
  execute: async (): Promise<ToolResult> => {
    try {
      const now = new Date()

      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')

      // 安全的文件名格式：YYYY-MM-DD
      const safeFileNameDate = `${year}-${month}-${day}`

      return {
        success: true,
        data: safeFileNameDate,
        message: `当前日期：${safeFileNameDate}`,
      }
    } catch (error) {
      console.error('[get_current_time] 获取失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `获取时间失败: ${error}`,
      }
    }
  },
}

/**
 * 选择 Skill 工具
 * 用于 AI 在第一次迭代时选择合适的 Skill 来指导后续操作
 */
export const selectSkillTool: Tool = {
  name: 'select_skill',
  description: 'Select one or more Skills to guide task execution. On the first iteration, select the most relevant Skills based on the user task. After selection, complete Skill instructions will be provided in subsequent iterations.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_ids',
      type: 'array',
      description: 'List of Skill IDs to select. Choose the most relevant Skills from the available Skills. You can check the ID field in the Skills list.',
      required: true,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const { skill_ids } = params

      if (!Array.isArray(skill_ids)) {
        return {
          success: false,
          error: 'skill_ids 必须是一个数组',
        }
      }

      // 验证所有 Skill ID 是否存在
      const validSkills: string[] = []
      const invalidSkills: string[] = []

      for (const skillId of skill_ids) {
        const skill = skillManager.getSkill(skillId)
        if (skill) {
          validSkills.push(skillId)
        } else {
          invalidSkills.push(skillId)
        }
      }

      if (invalidSkills.length > 0) {
        return {
          success: false,
          error: `无效的 Skill ID: ${invalidSkills.join(', ')}`,
        }
      }

      if (validSkills.length === 0) {
        return {
          success: false,
          error: '没有选择任何有效的 Skill',
        }
      }

      return {
        success: true,
        data: {
          selected_skills: validSkills,
          count: validSkills.length,
        },
        message: `已选择 ${validSkills.length} 个 Skills: ${validSkills.join(', ')}。这些 Skills 的完整指令将在后续步骤中提供。`,
      }
    } catch (error) {
      console.error('[select_skill] 执行失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `选择 Skill 失败: ${error}`,
      }
    }
  },
}

/**
 * 加载 Skill 支持文件内容工具
 * 用于 AI 获取 Skill 的补充资料（如 KEYWORDS.md、EXAMPLES.md 等文件的内容）
 * 也支持加载根目录的自定义 .md 文件（如 editing.md, pptxgenjs.md）
 */
export const loadSkillContentTool: Tool = {
  name: 'load_skill_content',
  description: 'Get the support file content for the specified Skill. Supports standard files (KEYWORDS.md, EXAMPLES.md, REFERENCE.md) and custom root-level .md files (e.g., editing.md, pptxgenjs.md). These files contain detailed style guides, keyword lists, and usage examples to help better apply the Skill.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'Skill ID, e.g., "style-detector"',
      required: true,
    },
    {
      name: 'file_type',
      type: 'string',
      description: 'File type or filename to load: supports "keywords" (KEYWORDS.md), "examples" (EXAMPLES.md), "reference" (REFERENCE.md), or a specific filename like "editing.md", "pptxgenjs.md". If not specified, returns all available support file content.',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const { skill_id, file_type } = params

      const skill = skillManager.getSkill(skill_id)
      if (!skill) {
        return {
          success: false,
          error: `未找到 Skill: ${skill_id}`,
        }
      }

      // 获取 Skill 的文件信息
      const fileInfo = skillManager.getSkillFileInfo(skill_id)
      if (!fileInfo) {
        return {
          success: false,
          error: `无法获取 Skill 文件信息: ${skill_id}`,
        }
      }

      const results: Record<string, string> = {}

      // 标准文件类型映射
      const standardTypeMapping: Record<string, string> = {
        keywords: 'KEYWORDS.md',
        examples: 'EXAMPLES.md',
        reference: 'REFERENCE.md',
      }

      // 读取文件内容
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')
      const { exists } = await import('@tauri-apps/plugin-fs')

      // 辅助函数：读取文件
      const readFile = async (fileName: string, filePath: string): Promise<boolean> => {
        let fileExists = false
        if (skill.metadata.scope === 'global') {
          fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData })
          if (fileExists) {
            try {
              results[fileName] = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
              return true
            } catch (error) {
              console.error(`[load_skill_content] 读取文件失败: ${filePath}`, error)
            }
          }
        } else {
          const options = await getFilePathOptions(filePath)
          fileExists = options.baseDir
            ? await exists(options.path, { baseDir: options.baseDir })
            : await exists(options.path)
          if (fileExists) {
            try {
              if (options.baseDir) {
                results[fileName] = await readTextFile(options.path, { baseDir: options.baseDir })
              } else {
                results[fileName] = await readTextFile(options.path)
              }
              return true
            } catch (error) {
              console.error(`[load_skill_content] 读取文件失败: ${filePath}`, error)
            }
          }
        }
        return false
      }

      if (file_type) {
        // 指定了 file_type，尝试加载特定文件
        const fileName = file_type

        // 先检查是否是标准类型
        const standardFile = standardTypeMapping[file_type]
        if (standardFile) {
          const filePath = `${fileInfo.directory}/${standardFile}`
          await readFile(file_type, filePath)
        } else {
          // 可能是根目录的自定义 .md 文件（如 editing.md, pptxgenjs.md）
          const filePath = `${fileInfo.directory}/${fileName}`
          await readFile(fileName, filePath)
        }
      } else {
        // 未指定 file_type，加载所有可用的支持文件
        // 1. 加载标准文件
        for (const [type, fileName] of Object.entries(standardTypeMapping)) {
          const filePath = `${fileInfo.directory}/${fileName}`
          await readFile(type, filePath)
        }

        // 2. 加载 Skill.references 中的根目录 .md 文件
        // references 数组中的 rootMdFiles 有 path 属性（文件名而非完整路径）
        for (const ref of skill.references) {
          // 检查是否是根目录的 .md 文件（path 不包含目录分隔符）
          if (!ref.path.includes('/') && ref.path.endsWith('.md') && ref.path !== 'SKILL.md') {
            // 检查是否已经通过标准文件加载过了
            const alreadyLoaded = Object.values(standardTypeMapping).includes(ref.path)
            if (!alreadyLoaded) {
              const filePath = `${fileInfo.directory}/${ref.path}`
              await readFile(ref.name, filePath)
            }
          }
        }
      }

      if (Object.keys(results).length === 0) {
        return {
          success: true,
          data: {
            skill_id,
            available_files: skill.references.map(r => r.name),
            message: '该 Skill 没有额外的支持文件，所有内容已包含在主 Skill 文件中。',
          },
          message: `Skill "${skill_id}" 没有找到额外的支持文件。所有必要信息已包含在主 Skill 指令中。`,
        }
      }

      const loadedFiles = Object.keys(results)
      const totalLength = Object.values(results).reduce((sum, content) => sum + content.length, 0)

      return {
        success: true,
        data: {
          skill_id,
          loaded_files: loadedFiles,
          files: results,
          total_length: totalLength,
        },
        message: `成功加载 ${loadedFiles.length} 个支持文件（${loadedFiles.join(', ')}），共 ${totalLength} 字符。这些内容将帮助你更好地应用 ${skill_id} Skill。`,
      }
    } catch (error) {
      console.error('[load_skill_content] 执行失败', {
        error: String(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      return {
        success: false,
        error: `加载 Skill 内容失败: ${error}`,
      }
    }
  },
}

/**
 * 执行 Skill 脚本工具
 * 用于 AI 在 Skill 目录上下文中执行 Python/Shell 脚本
 *
 * 支持的调用方式：
 * 1. 模块执行: command="python", args=["-m", "markitdown", "file.pptx"]
 * 2. 脚本执行: command="python", args=["scripts/thumbnail.py", "file.pptx"]
 * 3. 子目录脚本: command="python", args=["scripts/office/unpack.py", "file.pptx"]
 * 4. 整体命令: command="python -m markitdown file.pptx", args=[]
 *
 * 重要说明：
 * - 工作目录会自动切换到 Skill 的根目录
 * - 脚本路径相对于 Skill 目录（如 "scripts/office/unpack.py"）
 * - 文件参数会自动从工作目录读取
 */
export const executeSkillScriptTool: Tool = {
  name: 'execute_skill_script',
  description: `Execute a Python or Shell script within a Skill directory context.

**When to create a script file vs passing args:**
- Use args for simple commands: \`{"command": "python", "args": ["-m", "markitdown", "file.pptx"]}\`
- Create a script file for complex/long scripts, then execute it

**Supported calling patterns:**
1. Module execution: \`{"command": "python", "args": ["-m", "markitdown", "file.pptx"]}\`
2. Script execution: \`{"command": "python", "args": ["scripts/thumbnail.py", "file.pptx"]}\`
3. Nested script: \`{"command": "python", "args": ["scripts/office/unpack.py", "file.pptx"]}\`
4. Full command: \`{"command": "python -m markitdown file.pptx", "args": []}\`

**Key notes:**
- Working directory is automatically set to the Skill's root directory (article/skills/{skill_id}/)
- Temporary/generated scripts should live under \`runtime/\` inside the Skill directory
- User-visible output files should be written to \`article/outputs/{skill_id}/\` whenever possible
- TWO types of scripts:
  1. **Skill's built-in scripts**: Use relative path like "scripts/my-script.py" (these exist in the skill directory)
  2. **Runtime scripts**: Use bare filename like "generate_ppt.js" (these should be created in the Skill's \`runtime/\` directory and will be resolved automatically)
- For runtime files: just pass the filename (e.g., "generate_ppt.js") - it will be resolved from the Skill's \`runtime/\` directory when present
- For skill's scripts: use path relative to skill directory (e.g., "scripts/thumbnail.py")
- If you need to pass complex or long script content, create a script file first using create_file, then execute it
- The skill_id must match the Skill's ID (e.g., "pptx", "pdf")`,
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'The ID of the Skill (e.g., "pptx", "pdf", "weekly")',
      required: true,
    },
    {
      name: 'command',
      type: 'string',
      description: 'The command to execute. Use "python" for Python modules/scripts, or a full command string (e.g., "python -m markitdown").',
      required: true,
    },
    {
      name: 'args',
      type: 'array',
      description: 'Arguments to pass to the command. Max 10 items. For scripts, include the script path relative to Skill directory (e.g., "scripts/office/unpack.py"). If you need to pass complex script content, create a script file first.',
      required: false,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Timeout in milliseconds for script execution. Default is 60000ms (1 minute). Maximum is 300000ms (5 minutes).',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    try {
      const { skill_id, command, args, timeout } = params

      if (!skill_id || typeof skill_id !== 'string') {
        return {
          success: false,
          error: 'Invalid skill_id: must be a non-empty string',
        }
      }

      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: 'Invalid command: must be a non-empty string',
        }
      }

      const outcome = await executeSkillRuntime({
        skillId: skill_id,
        command,
        args: Array.isArray(args) ? args : [],
        timeout,
      })

      if (outcome.success && Array.isArray(outcome.data?.output_files) && outcome.data.output_files.length > 0) {
        const articleStore = useArticleStore.getState()
        let insertedAny = false

        for (const outputFile of outcome.data.output_files) {
          const inserted = articleStore.insertLocalEntry(outputFile, false)
          insertedAny = insertedAny || inserted
          await articleStore.ensurePathExpanded(outputFile)
        }

        if (!insertedAny) {
          await articleStore.loadFileTree()
        }
      }

      return outcome
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      console.error('[execute_skill_script] Execution error', {
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      })

      return {
        success: false,
        error: `Script execution error: ${errorMessage}`,
      }
    }
  },
}

export const systemTools: Tool[] = [
  getCurrentTimeTool,
  selectSkillTool,
  loadSkillContentTool,
  executeSkillScriptTool,
]
