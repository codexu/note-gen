/**
 * Skill 验证器
 *
 * 验证 Skill 元数据和内容的完整性和正确性。
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

import {
  SkillContent,
  SkillYamlMetadata,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types'
import {
  isValidSkillId,
  isValidSkillName,
  isValidSkillDescription,
} from './parser'

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证 Skill YAML 元数据 (符合官方规范)
 *
 * @param metadata - YAML 元数据
 * @returns 验证结果
 */
export function validateSkillYamlMetadata(metadata: SkillYamlMetadata): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 验证必填字段 - name
  if (!metadata.name || metadata.name.trim().length === 0) {
    errors.push({
      field: 'name',
      message: 'name 字段不能为空',
      severity: 'error',
    })
  } else if (!isValidSkillName(metadata.name)) {
    errors.push({
      field: 'name',
      message: 'name 必须是 1-64 字符，只能包含小写字母、数字和连字符，不能以连字符开头或结尾，不能包含连续连字符',
      severity: 'error',
    })
  }

  // 验证必填字段 - description
  if (!metadata.description || metadata.description.trim().length === 0) {
    errors.push({
      field: 'description',
      message: 'description 字段不能为空',
      severity: 'error',
    })
  } else if (!isValidSkillDescription(metadata.description)) {
    errors.push({
      field: 'description',
      message: 'description 必须是 1-1024 字符',
      severity: 'error',
    })
  }

  // 验证可选字段 - license
  if (metadata.license) {
    if (metadata.license.length > 200) {
      warnings.push({
        field: 'license',
        message: 'license 建议不超过 200 个字符',
        severity: 'warning',
      })
    }
  }

  // 验证可选字段 - compatibility
  if (metadata.compatibility) {
    if (metadata.compatibility.length > 500) {
      errors.push({
        field: 'compatibility',
        message: 'compatibility 不能超过 500 个字符',
        severity: 'error',
      })
    }
  }

  // 验证 metadata 字段
  if (metadata.metadata) {
    for (const [key, value] of Object.entries(metadata.metadata)) {
      if (key.length > 50) {
        warnings.push({
          field: 'metadata',
          message: `metadata 键名 "${key}" 过长，建议不超过 50 个字符`,
          severity: 'warning',
        })
      }
      if (value.length > 500) {
        warnings.push({
          field: 'metadata',
          message: `metadata "${key}" 的值过长，建议不超过 500 个字符`,
          severity: 'warning',
        })
      }
    }
  }

  // 验证 allowedTools (官方规范使用空格分隔)
  if (metadata.allowedTools) {
    const tools = Array.isArray(metadata.allowedTools)
      ? metadata.allowedTools
      : typeof metadata.allowedTools === 'string'
        ? metadata.allowedTools.split(/\s+/).filter(v => v.length > 0)
        : []

    if (tools.length === 0) {
      warnings.push({
        field: 'allowedTools',
        message: 'allowedTools 为空，建议移除此字段或添加工具',
        severity: 'warning',
      })
    }

    // 验证工具名称格式
    const invalidTools = tools.filter((tool) => !isValidToolName(tool))
    if (invalidTools.length > 0) {
      errors.push({
        field: 'allowedTools',
        message: `无效的工具名称: ${invalidTools.join(', ')}`,
        severity: 'error',
      })
    }
  }

  // 验证扩展字段 (向后兼容)
  if (metadata.version && !isValidVersion(metadata.version)) {
    warnings.push({
      field: 'version',
      message: 'version 格式无效，应为 semver 格式 (如: 1.0.0)',
      severity: 'warning',
    })
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
  const metadataResult = validateSkillYamlMetadata({
    name: skill.metadata.name,
    description: skill.metadata.description,
    license: skill.metadata.license,
    compatibility: skill.metadata.compatibility,
    metadata: skill.metadata.metadata,
    allowedTools: skill.metadata.allowedTools,
    version: skill.metadata.version,
    author: skill.metadata.author,
    model: skill.metadata.model,
    userInvocable: skill.metadata.userInvocable,
  })
  errors.push(...metadataResult.errors)
  warnings.push(...metadataResult.warnings)

  // 验证 ID 格式
  if (!isValidSkillId(skill.metadata.id)) {
    errors.push({
      field: 'id',
      message: 'Skill ID 格式无效，必须与目录名匹配，且符合 name 字段格式要求',
      severity: 'error',
    })
  }

  // 验证 ID 与 name 匹配 (官方规范要求)
  if (skill.metadata.id !== skill.metadata.name) {
    warnings.push({
      field: 'id',
      message: 'Skill ID 应与 name 字段保持一致 (官方规范建议)',
      severity: 'warning',
    })
  }

  // 验证指令内容
  if (!skill.instructions || skill.instructions.trim().length === 0) {
    errors.push({
      field: 'instructions',
      message: '指令内容不能为空',
      severity: 'error',
    })
  } else {
    // 官方规范建议指令长度
    if (skill.instructions.length > 10000) {
      warnings.push({
        field: 'instructions',
        message: '指令内容超过 10000 字符，建议将详细文档移到 references/ 目录',
        severity: 'warning',
      })
    }

    if (skill.instructions.length < 50) {
      warnings.push({
        field: 'instructions',
        message: '指令内容过短，建议提供更详细的说明',
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
  return /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?(?:\+[a-zA-Z0-9.-]+)?$/.test(version)
}

/**
 * 验证工具名称格式
 *
 * @param toolName - 工具名称
 * @returns 是否有效
 */
function isValidToolName(toolName: string): boolean {
  // 工具名称可以包含字母、数字、下划线、冒号和星号
  // 例如: Bash, Read, git:*, jq:*
  return /^[a-zA-Z_][a-zA-Z0-9_:*]*$/.test(toolName)
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
