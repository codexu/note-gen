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

export const systemTools: Tool[] = [
  getCurrentTimeTool,
  selectSkillTool,
  loadSkillContentTool,
]
