/**
 * Skills 相关工具函数
 *
 * 用于处理 Skills 文件夹的特殊逻辑
 */

import { SKILLS_DIR_NAME } from '@/lib/skills'

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
