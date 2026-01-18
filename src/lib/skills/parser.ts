/**
 * SKILL.md 文件解析器
 *
 * 解析 SKILL.md 文件，提取 YAML 前置元数据和 Markdown 内容。
 */

import {
  ParsedSkillFile,
  SkillYamlMetadata,
} from './types'

// ============================================================================
// 解析函数
// ============================================================================

/**
 * 解析 SKILL.md 文件内容
 *
 * @param content - SKILL.md 文件的原始内容
 * @returns 解析后的 Skill 文件对象
 */
export function parseSkillFile(content: string): ParsedSkillFile {
  // 检查是否包含 YAML 前置
  if (!content.startsWith('---')) {
    return {
      metadata: {
        name: '',
        description: '',
      },
      content: content.trim(),
      rawContent: content,
    }
  }

  // 提取 YAML 前置部分
  const yamlEnd = content.indexOf('\n---', 3)
  if (yamlEnd === -1) {
    throw new Error('Invalid SKILL.md: YAML frontmatter not properly closed')
  }

  const yamlContent = content.slice(3, yamlEnd).trim()
  const markdownContent = content.slice(yamlEnd + 4).trim()

  // 解析 YAML 元数据
  const metadata = parseYamlMetadata(yamlContent)

  return {
    metadata,
    content: markdownContent,
    rawContent: content,
  }
}

/**
 * 解析 YAML 元数据
 *
 * @param yamlContent - YAML 格式的元数据内容
 * @returns 解析后的元数据对象
 */
function parseYamlMetadata(yamlContent: string): SkillYamlMetadata {
  const metadata: SkillYamlMetadata = {
    name: '',
    description: '',
  }

  const lines = yamlContent.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // 解析键值对
    const colonIndex = trimmed.indexOf(':')
    if (colonIndex === -1) {
      continue
    }

    const key = trimmed.slice(0, colonIndex).trim()
    const value = trimmed.slice(colonIndex + 1).trim()

    switch (key) {
      case 'name':
        metadata.name = value
        break
      case 'description':
        metadata.description = value
        break
      case 'version':
        metadata.version = value
        break
      case 'author':
        metadata.author = value
        break
      case 'model':
        metadata.model = value
        break
      case 'allowedTools':
        metadata.allowedTools = parseAllowedTools(value)
        break
      case 'userInvocable':
        metadata.userInvocable = parseBoolean(value)
        break
    }
  }

  return metadata
}

/**
 * 解析 allowedTools 字段
 *
 * 支持两种格式：
 * - 数组格式: allowedTools: [tool1, tool2]
 * - YAML 列表格式:
 *   allowedTools:
 *     - tool1
 *     - tool2
 *
 * @param value - allowedTools 的值
 * @returns 工具名称数组
 */
function parseAllowedTools(value: string): string[] {
  value = value.trim()

  // 数组格式: [tool1, tool2]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => v.trim().replace(/['"]/g, ''))
      .filter((v) => v.length > 0)
  }

  // 单个值
  if (value.length > 0) {
    return [value.replace(/['"]/g, '')]
  }

  return []
}

/**
 * 解析布尔值
 *
 * @param value - 布尔值的字符串表示
 * @returns 解析后的布尔值
 */
function parseBoolean(value: string): boolean {
  const normalized = value.toLowerCase().trim()
  return normalized === 'true' || normalized === 'yes' || normalized === '1'
}

// ============================================================================
// 生成函数
// ============================================================================

/**
 * 将 Skill 内容序列化为 SKILL.md 文件格式
 *
 * @param metadata - Skill 元数据
 * @param instructions - 指令内容
 * @returns SKILL.md 文件内容
 */
export function serializeSkillFile(
  metadata: SkillYamlMetadata,
  instructions: string
): string {
  const yamlLines: string[] = ['---']

  // 必填字段
  yamlLines.push(`name: ${metadata.name}`)
  yamlLines.push(`description: ${metadata.description}`)

  // 可选字段
  if (metadata.version) {
    yamlLines.push(`version: ${metadata.version}`)
  }

  if (metadata.author) {
    yamlLines.push(`author: ${metadata.author}`)
  }

  if (metadata.model) {
    yamlLines.push(`model: ${metadata.model}`)
  }

  if (metadata.allowedTools && metadata.allowedTools.length > 0) {
    if (metadata.allowedTools.length === 1) {
      yamlLines.push(`allowedTools: ["${metadata.allowedTools[0]}"]`)
    } else {
      yamlLines.push(`allowedTools:`)
      for (const tool of metadata.allowedTools) {
        yamlLines.push(`  - ${tool}`)
      }
    }
  }

  if (metadata.userInvocable !== undefined) {
    yamlLines.push(`userInvocable: ${metadata.userInvocable}`)
  }

  yamlLines.push('---')

  // Markdown 内容
  const content = yamlLines.join('\n') + '\n\n' + instructions.trim() + '\n'

  return content
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 从目录名生成 Skill ID
 *
 * @param directoryName - Skill 目录名
 * @returns Skill ID (kebab-case)
 */
export function generateSkillId(directoryName: string): string {
  return directoryName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * 验证 Skill ID 格式
 *
 * @param id - Skill ID
 * @returns 是否有效
 */
export function isValidSkillId(id: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
}

/**
 * 提取 SKILL.md 中的引用链接
 *
 * 查找 Markdown 格式的链接: [text](path.md)
 *
 * @param content - Markdown 内容
 * @returns 引用文件路径数组
 */
export function extractReferenceLinks(content: string): string[] {
  const linkRegex = /\[([^\]]+)\]\(([^)]+\.md)\)/g
  const links: string[] = []

  let match
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[2])
  }

  return links
}
