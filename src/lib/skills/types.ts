/**
 * Skills 类型定义
 *
 * Skills 是可重用的 AI 能力包，让 AI 助手能够根据任务自动应用特定的行为模式。
 */

// ============================================================================
// 核心类型
// ============================================================================

/**
 * Skill 作用域
 */
export type SkillScope = 'global' | 'project'

/**
 * Skill 元数据
 */
export interface SkillMetadata {
  // 基本信息
  id: string                    // 唯一标识 (skill-name)
  name: string                  // 显示名称
  description: string           // 功能描述 (用于 AI 匹配)
  version: string               // 版本号
  author?: string               // 作者

  // 存储位置
  scope: SkillScope             // 作用域：全局(应用数据目录) 或 项目(工作区)

  // 执行配置
  model?: string                // 指定使用的模型
  allowedTools?: string[]       // 允许使用的工具 (无需权限确认)

  // 可见性控制
  userInvocable: boolean        // 是否在斜杠菜单显示

  // 状态
  enabled: boolean              // 是否启用
  createdAt: number
  updatedAt: number
}

/**
 * Skill 内容
 */
export interface SkillContent {
  metadata: SkillMetadata
  instructions: string          // Markdown 格式的指令
  examples?: string             // 使用示例
  resources: SkillResource[]    // 支持资源文件
}

/**
 * Skill 资源类型
 */
export interface SkillResource {
  type: 'reference' | 'template'
  path: string                  // 相对路径
  description?: string
}

// ============================================================================
// 解析相关类型
// ============================================================================

/**
 * SKILL.md 文件的 YAML 前置元数据
 */
export interface SkillYamlMetadata {
  name: string
  description: string
  version?: string
  author?: string
  model?: string
  allowedTools?: string[] | string
  userInvocable?: boolean
}

/**
 * 解析后的 SKILL.md 内容
 */
export interface ParsedSkillFile {
  metadata: SkillYamlMetadata
  content: string               // Markdown 内容（不包含 YAML 前置）
  rawContent: string            // 原始文件内容
}

// ============================================================================
// 验证相关类型
// ============================================================================

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

/**
 * 验证错误
 */
export interface ValidationError {
  field: string
  message: string
  severity: 'error'
}

/**
 * 验证警告
 */
export interface ValidationWarning {
  field: string
  message: string
  severity: 'warning'
}

// ============================================================================
// 执行相关类型
// ============================================================================

/**
 * Skill 执行结果
 */
export interface SkillExecutionResult {
  success: boolean
  skillId: string
  result?: string
  error?: string
  toolsUsed: string[]
  executionTime: number
}

/**
 * Skill 执行记录
 */
export interface SkillExecutionRecord {
  id: string
  skillId: string
  skillName: string
  userInput: string
  result: SkillExecutionResult
  timestamp: number
}

// ============================================================================
// 存储相关类型
// ============================================================================

/**
 * Skill 文件信息
 */
export interface SkillFileInfo {
  id: string                    // 从目录名派生
  directory: string             // Skill 目录路径
  mainFile: string              // SKILL.md 文件路径
  hasReference: boolean         // 是否有 REFERENCE.md
  hasExamples: boolean          // 是否有 EXAMPLES.md
  hasKeywords?: boolean         // 是否有 KEYWORDS.md
  isValid: boolean              // 是否有效 Skill
  error?: string                // 错误信息
}

// ============================================================================
// 工具函数类型
// ============================================================================

/**
 * Skill 匹配分数
 */
export interface SkillMatchScore {
  skill: SkillContent
  score: number                 // 匹配分数 (0-1)
  reasons: string[]             // 匹配原因
}

// ============================================================================
// 常量
// ============================================================================

/**
 * Skill 文件名常量
 */
export const SKILL_FILE_NAME = 'SKILL.md'
export const REFERENCE_FILE_NAME = 'REFERENCE.md'
export const EXAMPLES_FILE_NAME = 'EXAMPLES.md'

/**
 * Skills 目录名称
 */
export const SKILLS_DIR_NAME = 'skills'

/**
 * 默认元数据值
 */
export const DEFAULT_SKILL_VERSION = '1.0.0'
export const DEFAULT_SKILL_ENABLED = true
export const DEFAULT_USER_INVOCABLE = true
