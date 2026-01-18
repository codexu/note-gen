/**
 * Skill 验证器
 *
 * 验证 Skill 元数据和内容的完整性和正确性。
 */

import {
  SkillContent,
  SkillYamlMetadata,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types'
import { isValidSkillId } from './parser'

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证 Skill YAML 元数据
 *
 * @param metadata - YAML 元数据
 * @returns 验证结果
 */
export function validateSkillYamlMetadata(metadata: SkillYamlMetadata): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 验证必填字段
  if (!metadata.name || metadata.name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'name 字段不能为空',
      severity: 'error',
    })
  } else {
    // 验证 name 格式
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(metadata.name)) {
      errors.push({
        field: 'name',
        message: 'name 必须是小写字母、数字和连字符，且只能以字母或数字开头',
        severity: 'error',
      })
    }
  }

  if (!metadata.description || metadata.description.trim().length === 0) {
    errors.push({
      field: 'description',
      message: 'description 字段不能为空',
      severity: 'error',
    })
  } else {
    // 验证 description 长度
    if (metadata.description.length > 1024) {
      warnings.push({
        field: 'description',
        message: 'description 建议不超过 1024 个字符',
        severity: 'warning',
      })
    }

    // 验证 description 是否包含触发关键词
    if (!hasTriggerKeywords(metadata.description)) {
      warnings.push({
        field: 'description',
        message: 'description 建议包含触发关键词，如"当用户说...时使用"',
        severity: 'warning',
      })
    }
  }

  // 验证可选字段
  if (metadata.version && !isValidVersion(metadata.version)) {
    errors.push({
      field: 'version',
      message: 'version 格式无效，应为 semver 格式 (如: 1.0.0)',
      severity: 'error',
    })
  }

  // 验证 allowedTools
  if (metadata.allowedTools && Array.isArray(metadata.allowedTools)) {
    if (metadata.allowedTools.length === 0) {
      warnings.push({
        field: 'allowedTools',
        message: 'allowedTools 为空数组，建议移除此字段或添加工具',
        severity: 'warning',
      })
    }

    // 验证工具名称格式
    const invalidTools = metadata.allowedTools.filter(
      (tool) => !isValidToolName(tool)
    )
    if (invalidTools.length > 0) {
      errors.push({
        field: 'allowedTools',
        message: `无效的工具名称: ${invalidTools.join(', ')}`,
        severity: 'error',
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 验证 Skill 完整内容
 *
 * @param skill - Skill 内容
 * @returns 验证结果
 */
export function validateSkillContent(skill: SkillContent): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 验证元数据
  const metadataResult = validateSkillYamlMetadata(skill.metadata)
  errors.push(...metadataResult.errors)
  warnings.push(...metadataResult.warnings)

  // 验证指令内容
  if (!skill.instructions || skill.instructions.trim().length === 0) {
    errors.push({
      field: 'instructions',
      message: '指令内容不能为空',
      severity: 'error',
    })
  } else {
    // 验证指令长度
    if (skill.instructions.length < 50) {
      warnings.push({
        field: 'instructions',
        message: '指令内容过短，建议提供更详细的说明',
        severity: 'warning',
      })
    }

    // 验证指令长度 (避免过长)
    if (skill.instructions.length > 10000) {
      warnings.push({
        field: 'instructions',
        message: '指令内容过长，建议将详细文档移到 REFERENCE.md',
        severity: 'warning',
      })
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * 验证 Skill ID
 *
 * @param id - Skill ID
 * @returns 是否有效
 */
export function validateSkillId(id: string): boolean {
  return isValidSkillId(id)
}

// ============================================================================
// 辅助验证函数
// ============================================================================

/**
 * 验证版本号格式 (semver)
 *
 * @param version - 版本号字符串
 * @returns 是否有效
 */
function isValidVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)
}

/**
 * 验证工具名称格式
 *
 * @param toolName - 工具名称
 * @returns 是否有效
 */
function isValidToolName(toolName: string): boolean {
  return /^[a-z_][a-z0-9_]*$/i.test(toolName)
}

/**
 * 检查描述是否包含触发关键词
 *
 * @param description - 描述文本
 * @returns 是否包含触发关键词
 */
function hasTriggerKeywords(description: string): boolean {
  const triggerPatterns = [
    /当.*?时使用/,
    /when.*?user/i,
    /触发/i,
    /适用场景/,
  ]

  return triggerPatterns.some((pattern) => pattern.test(description))
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 格式化验证结果为可读文本
 *
 * @param result - 验证结果
 * @returns 格式化的错误和警告信息
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []

  if (result.valid) {
    lines.push('✓ 验证通过')
  } else {
    lines.push('✗ 验证失败')
  }

  if (result.errors.length > 0) {
    lines.push('\n错误:')
    for (const error of result.errors) {
      lines.push(`  - ${error.field}: ${error.message}`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('\n警告:')
    for (const warning of result.warnings) {
      lines.push(`  - ${warning.field}: ${warning.message}`)
    }
  }

  return lines.join('\n')
}

/**
 * 获取验证错误的摘要
 *
 * @param result - 验证结果
 * @returns 错误摘要
 */
export function getValidationSummary(result: ValidationResult): string {
  if (result.valid) {
    return '验证通过'
  }

  const errorCount = result.errors.length
  const warningCount = result.warnings.length

  const parts: string[] = []
  if (errorCount > 0) {
    parts.push(`${errorCount} 个错误`)
  }
  if (warningCount > 0) {
    parts.push(`${warningCount} 个警告`)
  }

  return `验证失败: ${parts.join(', ')}`
}
