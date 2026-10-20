/**
 * Skill 执行器
 *
 * 负责 Skill 的执行和指令格式化。
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

import type {
  SkillContent,
  SkillExecutionResult,
  SkillExecutionRecord,
} from './types'

// ============================================================================
// SkillExecutor 类
// ============================================================================

/**
 * Skill 执行器类
 *
 * 负责：
 * - 在当前上下文执行 Skill
 * - 格式化 Skill 指令为系统提示
 * - 管理 Skill 执行记录
 * - 执行脚本 (scripts/)
 */
export class SkillExecutor {
  private executionHistory: SkillExecutionRecord[] = []
  private maxHistorySize = 100

  // ========================================================================
  // 执行方法
  // ========================================================================

  /**
   * 执行单个 Skill
   *
   * 注意：此方法只格式化和返回指令，实际的 AI 执行由调用方完成
   *
   * @param skill - 要执行的 Skill
   * @param userInput - 用户输入
   * @returns 格式化后的指令内容
   */
  formatSkillForExecution(skill: SkillContent, userInput: string): string {
    const sections: string[] = []

    // 添加 Skill 标题
    sections.push(`## Using Skill: ${skill.metadata.name}`)
    sections.push('')

    // 添加 Skill 描述
    if (skill.metadata.description) {
      sections.push(`**Description**: ${skill.metadata.description}`)
      sections.push('')
    }

    // 添加兼容性信息 (官方规范)
    if (skill.metadata.compatibility) {
      sections.push(`**Compatibility**: ${skill.metadata.compatibility}`)
      sections.push('')
    }

    // 添加许可证信息 (官方规范)
    if (skill.metadata.license) {
      sections.push(`**License**: ${skill.metadata.license}`)
      sections.push('')
    }

    // 添加 Skill 版本信息
    if (skill.metadata.version) {
      sections.push(`**Version**: ${skill.metadata.version}`)
    }
    if (skill.metadata.author) {
      sections.push(`**Author**: ${skill.metadata.author}`)
    }
    sections.push('')

    // 添加可用脚本列表 (官方规范)
    if (skill.scripts && skill.scripts.length > 0) {
      sections.push('**Available Scripts**:')
      for (const script of skill.scripts) {
        sections.push(`  - \`${script.name}\` (${script.type})`)
      }
      sections.push('')
    }

    // 添加可用参考文档 (官方规范)
    if (skill.references && skill.references.length > 0) {
      sections.push('**Available References**:')
      for (const ref of skill.references) {
        sections.push(`  - [${ref.name}](${ref.path})`)
      }
      sections.push('')
    }

    // 添加分隔线
    sections.push('---')
    sections.push('')

    // 添加指令内容
    sections.push('### Instructions')
    sections.push('')
    sections.push(skill.instructions)
    sections.push('')

    // 添加用户输入上下文
    sections.push('### User Request')
    sections.push('')
    sections.push(`> ${userInput}`)
    sections.push('')

    return sections.join('\n')
  }

  /**
   * 格式化多个 Skills 为系统提示
   *
   * @param skills - Skills 列表
   * @returns 格式化后的系统提示
   */
  formatSkillsAsSystemPrompt(skills: SkillContent[]): string {
    if (skills.length === 0) {
      return ''
    }

    const sections: string[] = []

    sections.push('# Available Skills')
    sections.push('')
    sections.push(
      `You have access to ${skills.length} specialized skill(s). ` +
      'When the user request matches a skill description, use that skill instructions to guide your response.'
    )
    sections.push('')

    for (const skill of skills) {
      sections.push(`## Skill: ${skill.metadata.name}`)
      sections.push('')

      if (skill.metadata.description) {
        sections.push(`**Description**: ${skill.metadata.description}`)
        sections.push('')
      }

      if (skill.metadata.compatibility) {
        sections.push(`**Compatibility**: ${skill.metadata.compatibility}`)
        sections.push('')
      }

      sections.push(skill.instructions)
      sections.push('')

      // 添加可用脚本
      if (skill.scripts && skill.scripts.length > 0) {
        sections.push('**Available Scripts**:')
        for (const script of skill.scripts) {
          sections.push(`  - \`${script.name}\` (${script.type})`)
        }
        sections.push('')
      }

      // 添加工具权限提示
      if (skill.metadata.allowedTools && skill.metadata.allowedTools.length > 0) {
        sections.push(
          `**Pre-approved tools**: ${skill.metadata.allowedTools.join(', ')}`
        )
        sections.push('')
      }

      sections.push('---')
      sections.push('')
    }

    return sections.join('\n')
  }

  /**
   * 格式化单个 Skill 为系统提示
   *
   * @param skill - Skill 内容
   * @returns 格式化后的系统提示
   */
  formatSkillAsSystemPrompt(skill: SkillContent): string {
    return this.formatSkillsAsSystemPrompt([skill])
  }

  /**
   * 检查 Skill 是否有指定脚本
   *
   * @param skill - Skill 内容
   * @param scriptName - 脚本名称
   * @returns 是否存在
   */
  hasScript(skill: SkillContent, scriptName: string): boolean {
    return skill.scripts.some(s => s.name === scriptName)
  }

  // ========================================================================
  // 渐进式加载 (官方规范)
  // ========================================================================

  /**
   * 获取 Skill 的元数据摘要 (用于启动时加载)
   * 官方规范建议只加载约 100 tokens 的元数据
   *
   * @param skill - Skill 内容
   * @returns 元数据摘要
   */
  getMetadataSummary(skill: SkillContent): string {
    const parts: string[] = []
    parts.push(`**${skill.metadata.name}**`)
    parts.push(skill.metadata.description)

    if (skill.metadata.compatibility) {
      parts.push(`*Compatibility: ${skill.metadata.compatibility}*`)
    }

    return parts.join('\n')
  }

  /**
   * 读取参考文档内容 (按需加载)
   *
   * @param skill - Skill 内容
   * @param referenceName - 参考文档名称
   * @returns 参考文档内容
   */
  async loadReference(
    skill: SkillContent,
    referenceName: string
  ): Promise<string | null> {
    const reference = skill.references.find(r => r.name === referenceName)
    if (!reference) {
      return null
    }

    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      let content: string
      if (skill.metadata.scope === 'global') {
        content = await readTextFile(reference.path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(reference.path)
        if (options.baseDir) {
          content = await readTextFile(options.path, { baseDir: options.baseDir })
        } else {
          content = await readTextFile(options.path)
        }
      }

      return content
    } catch (error) {
      console.error(`读取参考文档失败: ${reference.path}`, error)
      return null
    }
  }

  /**
   * 读取资源文件内容 (按需加载)
   *
   * @param skill - Skill 内容
   * @param assetName - 资源文件名称
   * @returns 资源文件内容
   */
  async loadAsset(
    skill: SkillContent,
    assetName: string
  ): Promise<string | null> {
    const asset = skill.assets.find(a => a.name === assetName)
    if (!asset) {
      return null
    }

    try {
      const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      const { getFilePathOptions } = await import('@/lib/workspace')

      let content: string
      if (skill.metadata.scope === 'global') {
        content = await readTextFile(asset.path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(asset.path)
        if (options.baseDir) {
          content = await readTextFile(options.path, { baseDir: options.baseDir })
        } else {
          content = await readTextFile(options.path)
        }
      }

      return content
    } catch (error) {
      console.error(`读取资源文件失败: ${asset.path}`, error)
      return null
    }
  }

  // ========================================================================
  // 执行记录管理
  // ========================================================================

  /**
   * 创建执行记录
   *
   * @param skillId - Skill ID
   * @param userInput - 用户输入
   * @param result - 执行结果
   * @returns 执行记录
   */
  createExecutionRecord(
    skillId: string,
    skillName: string,
    userInput: string,
    result: SkillExecutionResult
  ): SkillExecutionRecord {
    const record: SkillExecutionRecord = {
      id: this.generateRecordId(),
      skillId,
      skillName,
      userInput,
      result,
      timestamp: Date.now(),
    }

    // 添加到历史记录
    this.executionHistory.unshift(record)

    // 限制历史记录大小
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(0, this.maxHistorySize)
    }

    return record
  }

  /**
   * 获取执行历史
   *
   * @param limit - 限制返回数量
   * @returns 执行记录列表
   */
  getExecutionHistory(limit?: number): SkillExecutionRecord[] {
    if (limit) {
      return this.executionHistory.slice(0, limit)
    }
    return [...this.executionHistory]
  }

  /**
   * 获取指定 Skill 的执行历史
   *
   * @param skillId - Skill ID
   * @param limit - 限制返回数量
   * @returns 执行记录列表
   */
  getSkillExecutionHistory(skillId: string, limit?: number): SkillExecutionRecord[] {
    const records = this.executionHistory.filter(r => r.skillId === skillId)
    if (limit) {
      return records.slice(0, limit)
    }
    return records
  }

  /**
   * 清除执行历史
   */
  clearExecutionHistory(): void {
    this.executionHistory = []
  }

  // ========================================================================
  // 工具权限检查
  // ========================================================================

  /**
   * 检查工具是否在 Skill 的允许列表中
   *
   * @param skill - Skill 内容
   * @param toolName - 工具名称
   * @returns 是否允许使用
   */
  isToolAllowed(skill: SkillContent, toolName: string): boolean {
    if (!skill.metadata.allowedTools || skill.metadata.allowedTools.length === 0) {
      return false
    }
    return skill.metadata.allowedTools.includes(toolName)
  }

  /**
   * 获取 Skill 的所有允许工具
   *
   * @param skill - Skill 内容
   * @returns 允许的工具列表
   */
  getAllowedTools(skill: SkillContent): string[] {
    return skill.metadata.allowedTools || []
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  /**
   * 生成记录 ID
   */
  private generateRecordId(): string {
    return `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 创建执行结果
   *
   * @param success - 是否成功
   * @param skillId - Skill ID
   * @param result - 结果内容
   * @param error - 错误信息
   * @param toolsUsed - 使用的工具
   * @param scriptsUsed - 使用的脚本
   * @param startTime - 开始时间
   * @returns 执行结果
   */
  createExecutionResult(
    success: boolean,
    skillId: string,
    result?: string,
    error?: string,
    toolsUsed: string[] = [],
    scriptsUsed: string[] = [],
    startTime?: number
  ): SkillExecutionResult {
    const executionTime = startTime
      ? Date.now() - startTime
      : 0

    return {
      success,
      skillId,
      result,
      error,
      toolsUsed,
      scriptsUsed,
      executionTime,
    }
  }
}

// ============================================================================
// 单例导出
// ============================================================================

export const skillExecutor = new SkillExecutor()
