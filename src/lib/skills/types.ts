/**
 * Skills 类型定义
 *
 * Skills 是可重用的 AI 能力包，让 AI 助手能够根据任务自动应用特定的行为模式。
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

// ============================================================================
// 核心类型
// ============================================================================

/**
 * Skill 作用域
 */
export type SkillScope = 'global' | 'project'

/**
 * Skill 脚本类型
 */
export type ScriptType = 'python' | 'bash' | 'javascript' | 'node' | 'shell'

/**
 * Skill 脚本文件
 */
export interface SkillScript {
  name: string                  // 脚本文件名
  path: string                  // 相对路径 (scripts/script-name.py)
  type: ScriptType              // 脚本类型
  description?: string          // 脚本描述
}

/**
 * Skill 参考文件
 */
export interface SkillReference {
  name: string                  // 参考文件名
  path: string                  // 相对路径 (references/reference.md)
  description?: string          // 参考内容描述
}

/**
 * Skill 资源文件 (assets/)
 */
export interface SkillAsset {
  name: string                  // 资源文件名
  path: string                  // 相对路径 (assets/template.json)
  type: 'template' | 'image' | 'data' | 'other'
  description?: string          // 资源描述
}

/**
 * Skill 元数据 (符合官方规范)
 */
export interface SkillMetadata {
  // 基本信息 (官方规范必填字段)
  id: string                    // 唯一标识 (skill-name, 必须与目录名匹配)
  name: string                  // Skill 名称 (1-64字符, 小写字母数字和连字符)
  description: string           // 功能描述 (1-1024字符, 用于 AI 匹配)

  // 官方规范可选字段
  license?: string              // 许可证名称或引用的许可证文件
  compatibility?: string        // 环境要求 (1-500字符)
  metadata?: Record<string, string>  // 额外的元数据键值对

  // 扩展字段 (应用特定)
  version?: string              // 版本号 (存储在 metadata.version 中)
  author?: string               // 作者 (存储在 metadata.author 中)

  // 存储位置
  scope: SkillScope             // 作用域：全局(应用数据目录) 或 项目(工作区)

  // 执行配置 (扩展字段)
  model?: string                // 指定使用的模型
  allowedTools?: string[]       // 允许使用的工具 (无需权限确认)

  // 可见性控制 (扩展字段)
  userInvocable?: boolean       // 是否在斜杠菜单显示

  // 状态 (扩展字段)
  enabled?: boolean             // 是否启用
  createdAt: number
  updatedAt: number

  // 依赖声明
  dependencies?: SkillDependency[]
}

/**
 * Skill 内容
 */
export interface SkillContent {
  metadata: SkillMetadata
  instructions: string          // Markdown 格式的指令 (SKILL.md 内容)

  // 官方规范支持的目录结构
  scripts: SkillScript[]        // scripts/ 目录中的脚本
  references: SkillReference[]  // references/ 目录中的参考文档
  assets: SkillAsset[]          // assets/ 目录中的静态资源
}

// ============================================================================
// 解析相关类型
// ============================================================================

/**
 * SKILL.md 文件的 YAML 前置元数据 (符合官方规范)
 */
export interface SkillYamlMetadata {
  // 必填字段
  name: string
  description: string

  // 可选字段 (官方规范)
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[] | string  // 空格分隔的工具列表或数组

  // 扩展字段 (向后兼容)
  version?: string
  author?: string
  model?: string
  userInvocable?: boolean

  // 依赖声明
  dependencies?: SkillDependency[]
}

/**
 * Skill 依赖声明
 */
export interface SkillDependency {
  name: string           // 依赖名称，如 "requests" 或 "lodash"
  version?: string      // 版本要求，如 ">=2.0.0"（可选）
  manager: 'pip' | 'npm' | 'yarn' | 'pnpm'  // 包管理器
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
 * 脚本执行结果
 */
export interface ScriptExecutionResult {
  success: boolean
  scriptName: string
  output?: string               // 脚本输出
  error?: string                // 错误信息
  exitCode?: number             // 退出码
  executionTime: number          // 执行耗时 (ms)
}

/**
 * Skill 执行结果
 */
export interface SkillExecutionResult {
  success: boolean
  skillId: string
  result?: string
  error?: string
  toolsUsed: string[]
  scriptsUsed: string[]          // 使用的脚本列表
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

  // 官方规范目录结构
  hasScriptsDir: boolean        // 是否有 scripts/ 目录
  hasReferencesDir: boolean     // 是否有 references/ 目录
  hasAssetsDir: boolean         // 是否有 assets/ 目录

  // 向后兼容 (已弃用，但保留以支持旧结构)
  hasReferenceFile?: boolean    // 根目录是否有 REFERENCE.md
  hasExamplesFile?: boolean     // 根目录是否有 EXAMPLES.md
  hasKeywordsFile?: boolean     // 根目录是否有 KEYWORDS.md

  isValid: boolean              // 是否有效 Skill
  error?: string                // 错误信息

  // 统计信息
  scriptCount?: number          // 脚本数量
  referenceCount?: number       // 参考文件数量
  assetCount?: number           // 资源文件数量
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

/**
 * 官方规范目录名称
 */
export const SCRIPTS_DIR_NAME = 'scripts'
export const REFERENCES_DIR_NAME = 'references'
export const ASSETS_DIR_NAME = 'assets'

/**
 * 向后兼容的文件名 (已弃用)
 * @deprecated 使用 references/ 目录代替
 */
export const REFERENCE_FILE_NAME = 'REFERENCE.md'
export const EXAMPLES_FILE_NAME = 'EXAMPLES.md'
export const KEYWORDS_FILE_NAME = 'KEYWORDS.md'

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

/**
 * 支持的脚本类型及其扩展名
 */
export const SCRIPT_EXTENSIONS: Record<ScriptType, string[]> = {
  python: ['.py'],
  bash: ['.sh', '.bash'],
  javascript: ['.js', '.mjs'],
  node: ['.js'],
  shell: ['.sh'],
}

/**
 * 脚本类型的 shebang 标记
 */
export const SCRIPT_SHEBANG: Record<ScriptType, string[]> = {
  python: ['#!/usr/bin/env python', '#!/usr/bin/python'],
  bash: ['#!/bin/bash', '#!/usr/bin/env bash'],
  javascript: ['#!/usr/bin/env node'],
  node: ['#!/usr/bin/env node'],
  shell: ['#!/bin/sh'],
}
