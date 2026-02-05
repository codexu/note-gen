import { Tool, ToolResult } from '../types'
import { skillManager } from '@/lib/skills'
import { handleDependencyError } from '@/lib/skills/dependency-installer'

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
 */
export const loadSkillContentTool: Tool = {
  name: 'load_skill_content',
  description: 'Get the support file content for the specified Skill (such as KEYWORDS.md, EXAMPLES.md). These files contain detailed style guides, keyword lists, and usage examples to help better apply the Skill.',
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
      description: 'File type to load: supports "keywords" (KEYWORDS.md), "examples" (EXAMPLES.md), "reference" (REFERENCE.md). If not specified, returns all available support file content.',
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

      // 根据 file_type 或加载所有可用的文件
      const fileTypes = file_type ? [file_type] : ['keywords', 'examples', 'reference']
      const typeMapping: Record<string, string> = {
        keywords: 'KEYWORDS.md',
        examples: 'EXAMPLES.md',
        reference: 'REFERENCE.md',
      }

      // 读取文件内容
      const { readTextFile, BaseDirectory, exists } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      for (const type of fileTypes) {
        const fileName = typeMapping[type]
        const filePath = `${fileInfo.directory}/${fileName}`

        // 检查文件是否存在
        let fileExists = false
        if (skill.metadata.scope === 'global') {
          fileExists = await exists(filePath, { baseDir: BaseDirectory.AppData })
        } else {
          const options = await getFilePathOptions(filePath)
          fileExists = options.baseDir
            ? await exists(options.path, { baseDir: options.baseDir })
            : await exists(options.path)
        }

        if (fileExists) {
          try {
            let content: string
            if (skill.metadata.scope === 'global') {
              content = await readTextFile(filePath, { baseDir: BaseDirectory.AppData })
            } else {
              const options = await getFilePathOptions(filePath)
              if (options.baseDir) {
                content = await readTextFile(options.path, { baseDir: options.baseDir })
              } else {
                content = await readTextFile(options.path)
              }
            }
            results[type] = content
          } catch (error) {
            console.error(`[load_skill_content] 读取 ${type} 文件失败:`, error)
          }
        }
      }

      if (Object.keys(results).length === 0) {
        return {
          success: true,
          data: {
            skill_id,
            available_files: [],
            message: '该 Skill 没有额外的支持文件，所有内容已包含在主 Skill 文件中。',
          },
          message: `Skill "${skill_id}" 没有找到额外的支持文件（KEYWORDS.md、EXAMPLES.md、REFERENCE.md）。所有必要信息已包含在主 Skill 指令中。`,
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
 */
export const executeSkillScriptTool: Tool = {
  name: 'execute_skill_script',
  description: 'Execute a Python or Shell script within a Skill directory context. Use this when a Skill requires running scripts (e.g., python -m markitdown file.pptx). The script will be executed with the Skill directory as the working directory.',
  category: 'system',
  requiresConfirmation: false,
  parameters: [
    {
      name: 'skill_id',
      type: 'string',
      description: 'The ID of the Skill (e.g., "pptx", "pdf")',
      required: true,
    },
    {
      name: 'command',
      type: 'string',
      description: 'The command to execute. For Python modules, use "python" followed by "-m" and arguments (e.g., "python -m markitdown file.pptx"). For direct scripts, use the script name (e.g., "python scripts/thumbnail.py file.pptx").',
      required: true,
    },
    {
      name: 'args',
      type: 'array',
      description: 'Additional arguments to pass to the command (optional). Use this for file paths and options that need proper escaping.',
      required: false,
    },
  ],
  execute: async (params: Record<string, any>): Promise<ToolResult> => {
    const startTime = Date.now()
    const { skill_id, command, args } = params

    // Debug log: Start execution
    console.log('[execute_skill_script] Starting execution', {
      skill_id,
      command,
      args,
      timestamp: new Date().toISOString(),
    })

    try {
      // Validate skill_id
      if (!skill_id || typeof skill_id !== 'string') {
        console.error('[execute_skill_script] Invalid skill_id', { skill_id })
        return {
          success: false,
          error: `Invalid skill_id: must be a non-empty string`,
        }
      }

      // Validate command
      if (!command || typeof command !== 'string') {
        console.error('[execute_skill_script] Invalid command', { command })
        return {
          success: false,
          error: `Invalid command: must be a non-empty string`,
        }
      }

      // Get Skill information
      const skill = skillManager.getSkill(skill_id)
      if (!skill) {
        console.error('[execute_skill_script] Skill not found', { skill_id })
        return {
          success: false,
          error: `Skill not found: ${skill_id}`,
        }
      }

      // Get Skill file info to find the directory
      const fileInfo = skillManager.getSkillFileInfo(skill_id)
      if (!fileInfo) {
        console.error('[execute_skill_script] Skill file info not found', { skill_id })
        return {
          success: false,
          error: `Cannot determine Skill directory for: ${skill_id}`,
        }
      }

      // Debug log: Skill info
      console.log('[execute_skill_script] Skill info retrieved', {
        skill_id: skill.metadata.id,
        skill_name: skill.metadata.name,
        directory: fileInfo.directory,
        scope: skill.metadata.scope,
      })

      // Import Tauri APIs
      const { Command } = await import('@tauri-apps/plugin-shell')
      const { appDataDir } = await import('@tauri-apps/api/path')
      const { getFilePathOptions } = await import('@/lib/workspace')

      // Resolve the working directory path
      // For global skills, fileInfo.directory contains the relative path under AppData
      // For project skills, fileInfo.directory may contain BaseDirectory enum
      let workingDirectory: string

      if (skill.metadata.scope === 'global') {
        // For global skills, resolve the relative path under AppData
        const appDataPath = await appDataDir()
        workingDirectory = `${appDataPath}/${fileInfo.directory}`
      } else {
        // For project skills, use the resolved path
        const options = await getFilePathOptions(fileInfo.directory)

        // If baseDir is provided (BaseDirectory.AppData), resolve to actual path
        if (options.baseDir) {
          // Get the actual AppData path and construct full path
          const appDataPath = await appDataDir()
          workingDirectory = `${appDataPath}/${options.path}`
        } else {
          workingDirectory = options.path
        }
      }

      // Debug log: Working directory
      console.log('[execute_skill_script] Working directory resolved', {
        working_directory: workingDirectory,
      })

      // Parse command and build command array
      const commandParts = command.trim().split(/\s+/)
      const cmd = commandParts[0]
      const cmdArgs = [...commandParts.slice(1), ...(args || [])]

      // Debug log: Command execution
      console.log('[execute_skill_script] Executing command', {
        cmd,
        cmd_args: cmdArgs,
        working_directory: workingDirectory,
      })

      // Execute command with auto-retry on dependency failure
      const result = await executeWithRetry(cmd, cmdArgs, workingDirectory)

      /**
       * Execute command with automatic dependency installation and retry
       * Uses streaming output for real-time feedback
       */
      async function executeWithRetry(
        cmd: string,
        cmdArgs: string[],
        workingDirectory: string,
        isRetry: boolean = false
      ): Promise<{ code: number | null; stdout?: string; stderr?: string }> {
        // On macOS/Linux, use shell to change directory and execute command
        const shellCommand = `cd "${workingDirectory}" && ${cmd} ${cmdArgs.map(a => `"${a}"`).join(' ')}`

        // Debug log: Shell command
        console.log('[execute_skill_script] Shell command', {
          shell_command: shellCommand,
          retry: isRetry,
        })

        // Collect output for streaming
        const stdoutChunks: string[] = []
        const stderrChunks: string[] = []

        const command = Command.create('bash', ['-c', shellCommand])

        // Set up event listeners for streaming output
        // Note: Command.stdout and Command.stderr are EventEmitter<OutputEvents<O>>
        // which emit 'data' events with string payload
        command.stdout.on('data', (line: string) => {
          stdoutChunks.push(line)
          // Real-time log to console (visible in dev tools)
          console.log('[execute_skill_script] stdout:', line)
        })

        command.stderr.on('data', (line: string) => {
          stderrChunks.push(line)
          // Real-time log to console (visible in dev tools)
          console.error('[execute_skill_script] stderr:', line)
        })

        // Execute the command (waits for completion)
        const r = await command.execute()

        // Combine streamed output with final result
        const stdout = stdoutChunks.join('') || r.stdout || ''
        const stderr = stderrChunks.join('') || r.stderr || ''

        // Fallback for common commands: try with '3' suffix if command not found (exit code 127)
        if (r.code === 127 && stderr?.includes('command not found')) {
          const commonCommands = ['python', 'node', 'npm', 'pip']
          if (commonCommands.includes(cmd)) {
            const fallbackCmd = `${cmd}3`
            console.log('[execute_skill_script] Command not found, trying fallback', {
              original_command: cmd,
              fallback_command: fallbackCmd,
            })

            return await executeWithRetry(fallbackCmd, cmdArgs, workingDirectory, true)
          }
        }

        // If command failed and this is the first attempt, try to install missing dependencies
        if (r.code !== 0 && !isRetry && stderr) {
          console.log('[execute_skill_script] Command failed, checking for missing dependencies...', {
            exit_code: r.code,
          })

          const installResult = await handleDependencyError(stderr)

          if (installResult?.success) {
            console.log('[execute_skill_script] Dependency installed, retrying command...', {
              installed: installResult.installed,
            })

            // Retry the original command after installing dependency
            return await executeWithRetry(cmd, cmdArgs, workingDirectory, true)
          }

          if (installResult) {
            console.log('[execute_skill_script] Dependency installation failed', {
              message: installResult.message,
            })
          }
        }

        return {
          code: r.code,
          stdout,
          stderr,
        }
      }

      const executionTime = Date.now() - startTime

      // Debug log: Execution result
      console.log('[execute_skill_script] Execution completed', {
        exit_code: result.code,
        execution_time_ms: executionTime,
        stdout_length: result.stdout?.length || 0,
        stderr_length: result.stderr?.length || 0,
        success: (result.code ?? 0) === 0,
      })

      if ((result.code ?? 0) !== 0) {
        console.error('[execute_skill_script] Command failed', {
          exit_code: result.code,
          stderr: result.stderr,
        })
      }

      // Prepare output for AI - include both stdout and stderr separately for clarity
      const stdout = result.stdout || ''
      const stderr = result.stderr || ''
      const exitCode = result.code ?? -1

      return {
        success: exitCode === 0,
        data: {
          exit_code: exitCode,
          execution_time_ms: executionTime,
          working_directory: workingDirectory,
          stdout: stdout,
          stderr: stderr,
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
