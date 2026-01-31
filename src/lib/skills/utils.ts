/**
 * Skills 相关工具函数
 *
 * 用于处理 Skills 文件夹的特殊逻辑
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

import {
  SKILLS_DIR_NAME,
  SCRIPTS_DIR_NAME,
  REFERENCES_DIR_NAME,
  ASSETS_DIR_NAME,
  SKILL_FILE_NAME,
} from './types'

/**
 * 检查文件夹是否是 Skills 文件夹
 */
export function isSkillsFolder(folderName: string): boolean {
  return folderName === SKILLS_DIR_NAME
}

/**
 * 检查路径是否在 Skills 文件夹内
 */
export function isInSkillsFolder(path: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/')
  return (
    normalizedPath.includes(`/${SKILLS_DIR_NAME}/`) ||
    normalizedPath.startsWith(`${SKILLS_DIR_NAME}/`)
  )
}

/**
 * 检查路径是否在 Skill 子目录中 (scripts/, references/, assets/)
 */
export function isInSkillSubdirectory(path: string): {
  inSkill: boolean
  skillId: string | null
  subdirectory: 'scripts' | 'references' | 'assets' | null
} {
  const normalizedPath = path.replace(/\\/g, '/')

  // 检查 scripts/
  const scriptsMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${SCRIPTS_DIR_NAME}/`)
  )
  if (scriptsMatch) {
    return {
      inSkill: true,
      skillId: scriptsMatch[1],
      subdirectory: 'scripts',
    }
  }

  // 检查 references/
  const referencesMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${REFERENCES_DIR_NAME}/`)
  )
  if (referencesMatch) {
    return {
      inSkill: true,
      skillId: referencesMatch[1],
      subdirectory: 'references',
    }
  }

  // 检查 assets/
  const assetsMatch = normalizedPath.match(
    new RegExp(`${SKILLS_DIR_NAME}/([^/]+)/${ASSETS_DIR_NAME}/`)
  )
  if (assetsMatch) {
    return {
      inSkill: true,
      skillId: assetsMatch[1],
      subdirectory: 'assets',
    }
  }

  return {
    inSkill: false,
    skillId: null,
    subdirectory: null,
  }
}

/**
 * 获取 Skills 文件夹的特殊图标组件
 */
export function getSkillsFolderIcon(): string {
  return 'Sparkles'  // lucide-react 图标名称
}

/**
 * 判断是否应该隐藏知识库相关选项
 */
export function shouldHideKnowledgeBaseOptions(folderName: string, filePath: string): boolean {
  return isSkillsFolder(folderName) || isInSkillsFolder(filePath)
}

/**
 * 从右键菜单项中移除知识库相关选项
 */
export function filterKnowledgeBaseMenuItems(
  menuItems: any[],
  folderName: string,
  filePath: string
): any[] {
  if (!shouldHideKnowledgeBaseOptions(folderName, filePath)) {
    return menuItems
  }

  // 过滤掉知识库相关的菜单项
  return menuItems.filter((item: any) => {
    const itemId = item.props?.id || item.id || ''
    return !itemId.includes('knowledge-base')
  })
}

/**
 * 提取 Skill ID 从路径中
 * 例如: "skills/code-reviewer" -> "code-reviewer"
 */
export function extractSkillIdFromPath(path: string): string | null {
  const normalizedPath = path.replace(/\\/g, '/')

  // 检查是否在 skills 文件夹下
  const skillsFolderPattern = new RegExp(
    `${SKILLS_DIR_NAME}/([^/]+)`
  )
  const match = normalizedPath.match(skillsFolderPattern)

  if (match && match[1]) {
    return match[1]
  }

  return null
}

/**
 * 检查路径是否是 Skill 子文件夹
 * 例如: "skills/code-reviewer" -> true
 *       "skills" -> false
 *       "other/code-reviewer" -> false
 */
export function isSkillSubfolder(path: string): boolean {
  return extractSkillIdFromPath(path) !== null
}

/**
 * 检查文件是否是 SKILL.md
 */
export function isSkillFile(fileName: string): boolean {
  return fileName === SKILL_FILE_NAME
}

/**
 * 获取 Skill 目录结构信息
 * 返回 Skill 目录的完整结构描述
 */
export function getSkillDirectoryStructure(): {
  description: string
  structure: Record<string, { description: string; required: boolean }>
} {
  return {
    description: 'Agent Skills 目录结构 (遵循官方规范)',
    structure: {
      [SKILL_FILE_NAME]: {
        description: 'Skill 定义文件 (必填)',
        required: true,
      },
      [SCRIPTS_DIR_NAME + '/']: {
        description: '可执行脚本目录 (可选)',
        required: false,
      },
      [REFERENCES_DIR_NAME + '/']: {
        description: '参考文档目录 (可选)',
        required: false,
      },
      [ASSETS_DIR_NAME + '/']: {
        description: '静态资源目录 (可选)',
        required: false,
      },
    },
  }
}

/**
 * 格式化 Skill 列表为可读格式
 */
export function formatSkillList(skills: Array<{ id: string; name: string; description: string }>): string {
  if (skills.length === 0) {
    return '没有可用的 Skills'
  }

  const lines: string[] = [`可用的 Skills (${skills.length} 个):`, '']

  for (const skill of skills) {
    lines.push(`- ${skill.name}`)
    lines.push(`  ${skill.description}`)
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * 验证 Skill 目录结构
 * 检查目录是否符合官方规范
 */
export function validateSkillDirectoryStructure(files: string[]): {
  valid: boolean
  hasSkillFile: boolean
  hasScriptsDir: boolean
  hasReferencesDir: boolean
  hasAssetsDir: boolean
  warnings: string[]
} {
  const warnings: string[] = []

  // 检查必填文件
  const hasSkillFile = files.some(f => f.endsWith(SKILL_FILE_NAME))

  // 检查官方规范目录
  const hasScriptsDir = files.some(f => f.includes(`${SCRIPTS_DIR_NAME}/`))
  const hasReferencesDir = files.some(f => f.includes(`${REFERENCES_DIR_NAME}/`))
  const hasAssetsDir = files.some(f => f.includes(`${ASSETS_DIR_NAME}/`))

  // 检查旧格式文件 (向后兼容)
  const hasOldReferenceFile = files.some(f => f.endsWith('/REFERENCE.md'))
  const hasOldExamplesFile = files.some(f => f.endsWith('/EXAMPLES.md'))
  const hasOldKeywordsFile = files.some(f => f.endsWith('/KEYWORDS.md'))

  if (hasOldReferenceFile) {
    warnings.push(
      '检测到旧格式的 REFERENCE.md 文件，建议将其移动到 references/ 目录'
    )
  }

  if (hasOldExamplesFile) {
    warnings.push(
      '检测到旧格式的 EXAMPLES.md 文件，建议将其移动到 references/ 目录'
    )
  }

  if (hasOldKeywordsFile) {
    warnings.push(
      '检测到旧格式的 KEYWORDS.md 文件，建议将其内容合并到 SKILL.md 或移动到 references/ 目录'
    )
  }

  return {
    valid: hasSkillFile,
    hasSkillFile,
    hasScriptsDir,
    hasReferencesDir,
    hasAssetsDir,
    warnings,
  }
}

/**
 * 将旧格式 Skill 结构迁移到新格式 (官方规范)
 * 提供迁移建议和步骤
 */
export function getMigrationGuide(): {
  title: string
  description: string
  steps: Array<{ from: string; to: string; description: string }>
} {
  return {
    title: 'Skill 目录结构迁移指南',
    description: '将旧格式的 Skill 迁移到符合官方规范的新格式',
    steps: [
      {
        from: 'REFERENCE.md',
        to: 'references/REFERENCE.md',
        description: '将参考文档移动到 references/ 目录',
      },
      {
        from: 'EXAMPLES.md',
        to: 'references/EXAMPLES.md',
        description: '将示例文档移动到 references/ 目录',
      },
      {
        from: 'KEYWORDS.md',
        to: 'SKILL.md 或 references/KEYWORDS.md',
        description: '将关键词内容合并到 SKILL.md 或移动到 references/ 目录',
      },
      {
        from: '无脚本目录',
        to: 'scripts/',
        description: '创建 scripts/ 目录存放可执行脚本',
      },
      {
        from: '无资源目录',
        to: 'assets/',
        description: '创建 assets/ 目录存放模板、图片等静态资源',
      },
    ],
  }
}

/**
 * 获取 Skill 模板 (用于创建新 Skill)
 */
export function getSkillTemplate(skillName: string, description: string): string {
  return `---
name: ${skillName}
description: ${description}
---
# ${skillName}

Add your skill instructions here.

## When to use

Use this skill when...

## Instructions

1. First step
2. Second step
3. etc.

## Notes

Add any additional notes here.
`
}
