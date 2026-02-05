import { Tool, ToolResult } from '../types'
import { skillManager } from '@/lib/skills'

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
- Working directory is automatically set to the Skill's root directory
- Script paths can be either:
  - Relative to Skill directory (e.g., "scripts/my-script.py")
  - Full path with skills prefix (e.g., "skills/run-script/scripts/my-script.py")
- If you need to pass complex or long script content, create a script file first using create_file, then execute it
- If you create a new script file using create_file, use the full path (skills/{skill_id}/scripts/xxx.py)
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
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const startTime = Date.now()
    const { skill_id, command, args } = params

    try {
      // Validate skill_id
      if (!skill_id || typeof skill_id !== 'string') {
        return {
          success: false,
          error: `Invalid skill_id: must be a non-empty string`,
        }
      }

      // Validate command
      if (!command || typeof command !== 'string') {
        return {
          success: false,
          error: `Invalid command: must be a non-empty string`,
        }
      }

      // Get Skill information
      const skill = skillManager.getSkill(skill_id)
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${skill_id}`,
        }
      }

      // Get Skill file info
      const fileInfo = skillManager.getSkillFileInfo(skill_id)
      if (!fileInfo) {
        return {
          success: false,
          error: `Cannot determine Skill directory for: ${skill_id}`,
        }
      }

      // Import Tauri APIs
      const { Command } = await import('@tauri-apps/plugin-shell')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const { getFilePathOptions } = await import('@/lib/workspace')

      // Resolve the skill directory path (this is where we execute scripts from)
      let skillDir: string
      if (skill.metadata.scope === 'global') {
        const appDataPath = await appDataDir()
        skillDir = `${appDataPath}/${fileInfo.directory}`
      } else {
        const options = await getFilePathOptions(fileInfo.directory)
        if (options.baseDir) {
          const appDataPath = await appDataDir()
          skillDir = `${appDataPath}/${options.path}`
        } else {
          skillDir = options.path
        }
      }

      // Parse command and args
      let cmd: string
      let cmdArgs: string[]

      if (command.includes(' ')) {
        // Full command string like "python -m markitdown file.pxt"
        const commandParts = command.trim().split(/\s+/)
        cmd = commandParts[0]
        cmdArgs = [...commandParts.slice(1), ...(args || [])]
      } else {
        // Simple command like "python"
        cmd = command
        cmdArgs = [...(args || [])]
      }

      // Process args - convert full paths to relative paths if needed
      const processedCmdArgs = cmdArgs.map((arg: string) => {
        // If arg starts with "skills/{skill_id}/", extract the relative path
        const skillPrefix = `skills/${skill_id}/`
        if (arg.startsWith(skillPrefix)) {
          const relativePath = arg.substring(skillPrefix.length)
          return relativePath
        }
        return arg
      })

      // Build shell command - handle bash -c specially
      let shellCommand: string
      if (cmd === 'bash' && processedCmdArgs[0] === '-c') {
        // Handle bash -c case: args = ["-c", "node script.js"]
        // Shell command should be: cd "dir" && node script.js
        const cmdPart = processedCmdArgs.slice(1).join(' ')
        shellCommand = `cd "${skillDir}" && ${cmdPart}`
      } else {
        // Normal case: cd "dir" && cmd arg1 arg2 ...
        shellCommand = `cd "${skillDir}" && ${cmd} ${processedCmdArgs.map((a: string) => `"${a}"`).join(' ')}`
      }

      // Execute command
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []

      const cmdProcess = Command.create('bash', ['-c', shellCommand])

      cmdProcess.stdout.on('data', (line: string) => {
        stdoutChunks.push(line)
      })

      cmdProcess.stderr.on('data', (line: string) => {
        stderrChunks.push(line)
      })

      const r = await cmdProcess.execute()

      const stdout = stdoutChunks.join('') || r.stdout || ''
      const stderr = stderrChunks.join('') || r.stderr || ''
      const exitCode = r.code ?? -1
      const executionTime = Date.now() - startTime

      return {
        success: exitCode === 0,
        data: {
          exit_code: exitCode,
          execution_time_ms: executionTime,
          working_directory: skillDir,
          stdout,
          stderr,
        },
        message: exitCode === 0
          ? `Command executed successfully (exit code: ${exitCode}, time: ${executionTime}ms).\n\nOutput:\n${stdout || '(no output)'}`
          : `Command failed with exit code ${exitCode} (time: ${executionTime}ms).\n\n${stderr ? `Error:\n${stderr}` : 'No error message'}${stdout ? `\n\nOutput:\n${stdout}` : ''}`,
      }
    } catch (error) {
      const executionTime = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      console.error('[execute_skill_script] Execution error', {
        error: errorMessage,
        execution_time_ms: executionTime,
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
