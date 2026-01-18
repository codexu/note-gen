/**
 * Skill 执行器
 *
 * 负责 Skill 的执行和指令格式化。
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

    // 添加 Skill 版本信息
    sections.push(`**Version**: ${skill.metadata.version}`)
    if (skill.metadata.author) {
      sections.push(`**Author**: ${skill.metadata.author}`)
    }
    sections.push('')

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

      sections.push(skill.instructions)
      sections.push('')

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
   * @param startTime - 开始时间
   * @returns 执行结果
   */
  createExecutionResult(
    success: boolean,
    skillId: string,
    result?: string,
    error?: string,
    toolsUsed: string[] = [],
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
      executionTime,
    }
  }
}

// ============================================================================
// 单例导出
// ============================================================================

export const skillExecutor = new SkillExecutor()
