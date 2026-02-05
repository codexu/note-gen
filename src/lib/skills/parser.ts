/**
 * SKILL.md 文件解析器
 *
 * 解析 SKILL.md 文件，提取 YAML 前置元数据和 Markdown 内容。
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

import {
  ParsedSkillFile,
  SkillYamlMetadata,
  ScriptType,
  SCRIPT_EXTENSIONS,
  SCRIPT_SHEBANG,
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
  let inMetadataSection = false

  for (const line of lines) {
    const trimmed = line.trim()

    // 跳过空行和注释
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // 检查是否进入 metadata 部分
    if (trimmed === 'metadata:') {
      inMetadataSection = true
      continue
    }

    // 如果在 metadata 部分中，处理缩进的键值对
    if (inMetadataSection) {
      if (trimmed.startsWith('- ')) {
        // 列表项，跳过（由下面的逻辑处理）
      } else if (trimmed.startsWith('[')) {
        // 数组格式，跳过
      } else {
        const metadataIndent = line.match(/^(\s+)/)?.[1]?.length || 0
        if (metadataIndent > 0) {
          // metadata 下的子项
          const colonIndex = trimmed.indexOf(':')
          if (colonIndex > 0) {
            const key = trimmed.slice(0, colonIndex).trim()
            const value = trimmed.slice(colonIndex + 1).trim()

            if (!metadata.metadata) {
              metadata.metadata = {}
            }
            metadata.metadata[key] = parseValue(value)
            continue
          }
        } else {
          // 退出 metadata 部分
          inMetadataSection = false
        }
      }
    }

    // 检测 allowedTools 的 YAML 列表格式: allowedTools: 后跟 - item 行
    if ((trimmed.startsWith('allowedTools:') || trimmed.startsWith('allowed-tools:')) &&
        !trimmed.includes(': ') && !trimmed.includes(':[')) {
      // 这是列表格式的开始，收集后续的 - item 行
      const tools: string[] = []
      const currentLineIndex = lines.indexOf(line)
      const currentIndent = line.match(/^(\s+)/)?.[1]?.length || 0

      // 收集后续行
      for (let i = currentLineIndex + 1; i < lines.length; i++) {
        const nextLine = lines[i]
        const nextTrimmed = nextLine.trim()

        // 检查是否退出（无缩进或非列表项）
        const nextIndent = nextLine.match(/^(\s+)/)?.[1]?.length || 0
        if (nextTrimmed && nextIndent <= currentIndent && !nextTrimmed.startsWith('-')) {
          break
        }

        if (nextTrimmed.startsWith('- ')) {
          const tool = nextTrimmed.replace(/^- /, '').trim().replace(/['"]/g, '')
          if (tool) {
            tools.push(tool)
          }
        }
      }

      if (tools.length > 0) {
        metadata.allowedTools = tools
        continue
      }
    }

    // 解析顶级键值对
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
      case 'license':
        metadata.license = value
        break
      case 'compatibility':
        metadata.compatibility = value
        break
      case 'metadata':
        // metadata: 开始标记，将在下一次迭代处理
        inMetadataSection = true
        if (!metadata.metadata) {
          metadata.metadata = {}
        }
        break
      case 'allowed-tools':
      case 'allowedTools':
        metadata.allowedTools = parseAllowedTools(value)
        break
      case 'version':
        metadata.version = value
        // 同时存入 metadata 中（向后兼容）
        if (!metadata.metadata) {
          metadata.metadata = {}
        }
        metadata.metadata.version = value
        break
      case 'author':
        metadata.author = value
        // 同时存入 metadata 中（向后兼容）
        if (!metadata.metadata) {
          metadata.metadata = {}
        }
        metadata.metadata.author = value
        break
      case 'model':
        metadata.model = value
        break
      case 'userInvocable':
        metadata.userInvocable = parseBoolean(value)
        break
    }
  }

  return metadata
}

/**
 * 解析值（去除引号）
 */
function parseValue(value: string): string {
  value = value.trim()
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

/**
 * 解析 allowedTools 字段
 *
 * 支持多种格式：
 * - 空格分隔: allowed-tools: Bash Read Write
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

  // 空格分隔格式 (官方规范)
  if (!value.startsWith('[') && !value.startsWith('-')) {
    return value.split(/\s+/).filter(v => v.length > 0)
  }

  // 数组格式: [tool1, tool2]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((v) => v.trim().replace(/['"]/g, ''))
      .filter((v) => v.length > 0)
  }

  // 单个值
  if (value.length > 0 && !value.startsWith('-')) {
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

  // 可选字段 (官方规范)
  if (metadata.license) {
    yamlLines.push(`license: ${metadata.license}`)
  }

  if (metadata.compatibility) {
    yamlLines.push(`compatibility: ${metadata.compatibility}`)
  }

  // metadata 字段
  if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
    yamlLines.push(`metadata:`)
    for (const [key, value] of Object.entries(metadata.metadata)) {
      yamlLines.push(`  ${key}: ${value}`)
    }
  }

  // allowedTools (官方规范使用空格分隔)
  if (metadata.allowedTools && metadata.allowedTools.length > 0) {
    const toolsValue = Array.isArray(metadata.allowedTools)
      ? metadata.allowedTools.join(' ')
      : metadata.allowedTools
    yamlLines.push(`allowed-tools: ${toolsValue}`)
  }

  // 扩展字段 (向后兼容)
  if (metadata.version && !metadata.metadata?.version) {
    yamlLines.push(`version: ${metadata.version}`)
  }

  if (metadata.author && !metadata.metadata?.author) {
    yamlLines.push(`author: ${metadata.author}`)
  }

  if (metadata.model) {
    yamlLines.push(`model: ${metadata.model}`)
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
 * 官方规范要求：
 * - 1-64 字符
 * - 只能包含小写字母、数字和连字符
 * - 不能以连字符开头或结尾
 * - 不能包含连续的连字符
 *
 * @param id - Skill ID
 * @returns 是否有效
 */
export function isValidSkillId(id: string): boolean {
  if (id.length < 1 || id.length > 64) {
    return false
  }
  if (id.startsWith('-') || id.endsWith('-')) {
    return false
  }
  if (id.includes('--')) {
    return false
  }
  return /^[a-z0-9-]+$/.test(id)
}

/**
 * 验证 name 字段格式 (官方规范)
 *
 * @param name - Skill 名称
 * @returns 是否有效
 */
export function isValidSkillName(name: string): boolean {
  if (name.length < 1 || name.length > 64) {
    return false
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    return false
  }
  if (name.includes('--')) {
    return false
  }
  // 只能包含 unicode 小写字母数字和连字符
  return /^[\p{Ll}0-9-]+$/u.test(name)
}

/**
 * 验证 description 字段格式 (官方规范)
 *
 * @param description - Skill 描述
 * @returns 是否有效
 */
export function isValidSkillDescription(description: string): boolean {
  return description.length >= 1 && description.length <= 1024
}

/**
 * 检测脚本类型
 *
 * @param filename - 脚本文件名
 * @param content - 脚本内容 (可选，用于 shebang 检测)
 * @returns 脚本类型或 null
 */
export function detectScriptType(filename: string, content?: string): ScriptType | null {
  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase()

  // 通过扩展名检测
  for (const [type, extensions] of Object.entries(SCRIPT_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return type as ScriptType
    }
  }

  // 通过 shebang 检测
  if (content) {
    const firstLine = content.split('\n')[0].trim()
    for (const [type, shebangs] of Object.entries(SCRIPT_SHEBANG)) {
      if (shebangs.some(s => firstLine.startsWith(s))) {
        return type as ScriptType
      }
    }
  }

  return null
}

/**
 * 从 SKILL.md 内容中提取引用链接
 *
 * 查找 Markdown 格式的链接: [text](path.md)
 * 支持官方规范的相对路径引用
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

/**
 * 从 SKILL.md 内容中提取脚本引用
 *
 * 查找类似 "Run the extraction script: scripts/extract.py" 的文本
 *
 * @param content - Markdown 内容
 * @returns 脚本路径数组
 */
export function extractScriptReferences(content: string): string[] {
  const patterns = [
    /scripts\/[^\s\)]+/g,
    /`scripts\/[^\s`]+`/g,
  ]

  const scripts: string[] = []

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const scriptPath = match[0].replace(/`/g, '')
      scripts.push(scriptPath)
    }
  }

  return scripts
}
