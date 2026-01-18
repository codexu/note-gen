/**
 * Skill 管理器
 *
 * 负责 Skills 的发现、加载、注册和匹配。
 */

import {
  SkillContent,
  SkillScope,
  SkillFileInfo,
  SkillMatchScore,
  SKILL_FILE_NAME,
  SKILLS_DIR_NAME,
  DEFAULT_SKILL_VERSION,
  DEFAULT_SKILL_ENABLED,
  DEFAULT_USER_INVOCABLE,
} from './types'
import { parseSkillFile, generateSkillId } from './parser'
import { validateSkillYamlMetadata } from './validator'
import { readTextFile, readDir, BaseDirectory, DirEntry } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { exists } from '@tauri-apps/plugin-fs'

// ============================================================================
// SkillManager 类
// ============================================================================

/**
 * Skill 管理器类
 *
 * 负责：
 * - 发现和加载 Skills
 * - 注册和注销 Skills
 * - 匹配相关 Skills
 * - 验证 Skill 格式
 */
class SkillManager {
  private skills: Map<string, SkillContent> = new Map()
  private skillFiles: Map<string, SkillFileInfo> = new Map()
  private initialized = false

  // ========================================================================
  // 初始化
  // ========================================================================

  /**
   * 初始化 Skill 管理器
   * 加载所有可用的 Skills
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await this.discoverSkills()
    this.initialized = true
  }

  /**
   * 重新加载所有 Skills
   */
  async reload(): Promise<void> {
    this.skills.clear()
    this.skillFiles.clear()
    this.initialized = false
    await this.initialize()
  }

  // ========================================================================
  // 发现和加载
  // ========================================================================

  /**
   * 发现并加载所有 Skills
   */
  async discoverSkills(): Promise<void> {
    // 加载工作区 Skills
    await this.discoverProjectSkills()

    // 加载全局 Skills
    await this.discoverGlobalSkills()
  }

  /**
   * 发现工作区 Skills
   */
  private async discoverProjectSkills(): Promise<void> {
    try {
      const skillsDirExists = await this.directoryExists(SKILLS_DIR_NAME, 'project')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories(SKILLS_DIR_NAME, 'project')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory(SKILLS_DIR_NAME, dirName, 'project')
        } catch (error) {
          console.error(`加载工作区 Skill 失败: ${dirName}`, error)
        }
      }
    } catch (error) {
      console.error('发现工作区 Skills 失败:', error)
    }
  }

  /**
   * 发现全局 Skills
   */
  private async discoverGlobalSkills(): Promise<void> {
    try {
      const skillsDirExists = await this.directoryExists(SKILLS_DIR_NAME, 'global')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories(SKILLS_DIR_NAME, 'global')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory(SKILLS_DIR_NAME, dirName, 'global')
        } catch (error) {
          console.error(`加载全局 Skill 失败: ${dirName}`, error)
        }
      }
    } catch (error) {
      console.error('发现全局 Skills 失败:', error)
    }
  }

  /**
   * 从目录加载单个 Skill
   */
  private async loadSkillFromDirectory(
    baseDir: string,
    dirName: string,
    scope: SkillScope
  ): Promise<void> {
    const skillId = generateSkillId(dirName)
    const skillDirPath = `${baseDir}/${dirName}`
    const skillFilePath = `${skillDirPath}/${SKILL_FILE_NAME}`

    // 检查 SKILL.md 是否存在
    const fileExists = await this.fileExists(skillFilePath, scope)
    if (!fileExists) {
      this.skillFiles.set(skillId, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasReference: false,
        hasExamples: false,
        isValid: false,
        error: 'SKILL.md 文件不存在',
      })
      return
    }

    // 读取 SKILL.md 内容
    const content = await this.readFileContent(skillFilePath, scope)

    // 解析 Skill 文件
    const parsed = parseSkillFile(content)

    // 验证元数据
    const validation = validateSkillYamlMetadata(parsed.metadata)
    if (!validation.valid) {
      this.skillFiles.set(skillId, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasReference: false,
        hasExamples: false,
        isValid: false,
        error: validation.errors.map((e) => e.message).join('; '),
      })
      return
    }

    // 检查支持文件
    const hasReference = await this.fileExists(
      `${skillDirPath}/REFERENCE.md`,
      scope
    )
    const hasExamples = await this.fileExists(
      `${skillDirPath}/EXAMPLES.md`,
      scope
    )
    const hasKeywords = await this.fileExists(
      `${skillDirPath}/KEYWORDS.md`,
      scope
    )

    // 读取支持文件内容
    let referenceContent: string | undefined
    let examplesContent: string | undefined
    let keywordsContent: string | undefined

    if (hasReference) {
      referenceContent = await this.readFileContent(`${skillDirPath}/REFERENCE.md`, scope)
    }
    if (hasExamples) {
      examplesContent = await this.readFileContent(`${skillDirPath}/EXAMPLES.md`, scope)
    }
    if (hasKeywords) {
      keywordsContent = await this.readFileContent(`${skillDirPath}/KEYWORDS.md`, scope)
    }

    // 构建 Skill 内容
    const now = Date.now()
    const skill: SkillContent = {
      metadata: {
        id: skillId,
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        version: parsed.metadata.version || DEFAULT_SKILL_VERSION,
        author: parsed.metadata.author,
        scope,
        model: parsed.metadata.model,
        allowedTools: Array.isArray(parsed.metadata.allowedTools)
          ? parsed.metadata.allowedTools
          : undefined,
        userInvocable: parsed.metadata.userInvocable ?? DEFAULT_USER_INVOCABLE,
        enabled: DEFAULT_SKILL_ENABLED,
        createdAt: now,
        updatedAt: now,
      },
      instructions: parsed.content,
      examples: examplesContent,
      resources: [],
    }

    // 将额外的支持文件内容附加到 instructions 中，以便 AI 可以访问
    if (keywordsContent || referenceContent) {
      skill.instructions += '\n\n---\n\n## 补充资料\n\n'
      if (keywordsContent) {
        skill.instructions += '### 关键词和详细说明\n\n' + keywordsContent + '\n\n'
      }
      if (referenceContent) {
        skill.instructions += '### 参考文档\n\n' + referenceContent + '\n\n'
      }
    }

    // 注册 Skill
    this.registerSkill(skill)

    // 记录文件信息
    this.skillFiles.set(skillId, {
      id: skillId,
      directory: skillDirPath,
      mainFile: skillFilePath,
      hasReference,
      hasExamples,
      isValid: true,
      hasKeywords,
    })
  }

  // ========================================================================
  // 注册和注销
  // ========================================================================

  /**
   * 注册 Skill
   */
  registerSkill(skill: SkillContent): void {
    this.skills.set(skill.metadata.id, skill)
  }

  /**
   * 注销 Skill
   */
  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId)
    this.skillFiles.delete(skillId)
  }

  // ========================================================================
  // 获取 Skills
  // ========================================================================

  /**
   * 获取所有 Skills
   */
  getAllSkills(): SkillContent[] {
    return Array.from(this.skills.values())
  }

  /**
   * 获取指定作用域的 Skills
   */
  getSkillsByScope(scope: SkillScope): SkillContent[] {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.scope === scope
    )
  }

  /**
   * 获取所有已加载的 Skills（移除启用/禁用判断，直接返回所有）
   */
  async getEnabledSkills(): Promise<SkillContent[]> {
    // 直接返回所有已加载的 Skills，不进行启用/禁用过滤
    const allSkills = this.getAllSkills()
    return allSkills
  }

  /**
   * 获取可用户调用的 Skills
   */
  getUserInvocableSkills(): SkillContent[] {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.userInvocable
    )
  }

  /**
   * 根据 ID 获取 Skill
   */
  getSkill(id: string): SkillContent | undefined {
    return this.skills.get(id)
  }

  /**
   * 检查 Skill 是否存在
   */
  hasSkill(id: string): boolean {
    return this.skills.has(id)
  }

  // ========================================================================
  // 匹配相关
  // ========================================================================

  /**
   * 根据用户输入匹配相关 Skills
   *
   * @param userInput - 用户输入
   * @param maxResults - 最大返回结果数
   * @returns 匹配的 Skills 列表（按匹配分数排序）
   */
  async matchRelevantSkills(
    userInput: string,
    maxResults: number = 3
  ): Promise<SkillContent[]> {
    const enabledSkills = await this.getEnabledSkills()
    const scores: SkillMatchScore[] = []

    for (const skill of enabledSkills) {
      const score = this.calculateMatchScore(skill, userInput)
      if (score.score > 0) {
        scores.push(score)
      }
    }

    // 按分数降序排序
    scores.sort((a, b) => b.score - a.score)

    const result = scores
      .slice(0, maxResults)
      .map((score) => score.skill)

    return result
  }

  /**
   * 计算 Skill 与用户输入的匹配分数
   */
  private calculateMatchScore(
    skill: SkillContent,
    userInput: string
  ): SkillMatchScore {
    const description = skill.metadata.description.toLowerCase()
    const input = userInput.toLowerCase()
    const reasons: string[] = []
    let score = 0

    // 完全匹配
    if (description.includes(input)) {
      score += 1
      reasons.push('描述包含用户输入')
    }

    // 关键词匹配
    const keywords = this.extractKeywords(description)
    const matchedKeywords = keywords.filter((keyword) =>
      input.includes(keyword)
    )
    if (matchedKeywords.length > 0) {
      score += matchedKeywords.length * 0.5
      reasons.push(`匹配关键词: ${matchedKeywords.join(', ')}`)
    }

    // 语义相似度（简化版）
    if (this.hasSemanticOverlap(description, input)) {
      score += 0.3
      reasons.push('语义相关')
    }

    return {
      skill,
      score: Math.min(score, 1), // 限制在 0-1 之间
      reasons,
    }
  }

  /**
   * 从描述中提取关键词
   */
  private extractKeywords(description: string): string[] {
    const keywords: string[] = []

    // 提取各种引号中的内容作为关键词（支持中文引号）
    const quoteRegex = /[""""「」『』\[\]（）()](.+?)[""""「」『』\[\]（）()]/g
    let match
    while ((match = quoteRegex.exec(description)) !== null) {
      keywords.push(match[1].toLowerCase())
    }

    // 提取"当...时使用"或"当...时调用"中的内容
    const triggerRegex = /当(?:.*?)?(.+?)(?:时使用|时调用|时)/gi
    let triggerMatch
    while ((triggerMatch = triggerRegex.exec(description)) !== null) {
      keywords.push(triggerMatch[1].toLowerCase())
    }

    // 提取"关于...的内容"中的关键词
    const aboutRegex = /关于[""""「」『』\[\]（）()]?([^""""「」『』\[\]（）()\s]+)[""""「」『』\[\]】()]?的内容/g
    let aboutMatch
    while ((aboutMatch = aboutRegex.exec(description)) !== null) {
      keywords.push(aboutMatch[1].toLowerCase())
    }

    // 提取描述中的所有中文词汇（2-4个字的词）
    const chineseWords = description.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    keywords.push(...chineseWords)

    // 提取描述中的所有英文单词
    const englishWords = description.match(/[a-zA-Z]{2,}/g) || []
    keywords.push(...englishWords.map(w => w.toLowerCase()))

    return keywords
  }

  /**
   * 检查语义重叠
   */
  private hasSemanticOverlap(text1: string, text2: string): boolean {
    const words1 = new Set(text1.split(/\s+/))
    const words2 = new Set(text2.split(/\s+/))

    let overlap = 0
    for (const word of words2) {
      if (words1.has(word)) {
        overlap++
      }
    }

    // 至少 20% 的词重叠
    return overlap / words2.size >= 0.2
  }

  // ========================================================================
  // 验证
  // ========================================================================

  /**
   * 验证 Skill 内容
   */
  validateSkill(content: string): { valid: boolean; errors: string[] } {
    try {
      const parsed = parseSkillFile(content)
      const validation = validateSkillYamlMetadata(parsed.metadata)

      return {
        valid: validation.valid,
        errors: validation.errors.map((e) => e.message),
      }
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : String(error)],
      }
    }
  }

  // ========================================================================
  // 辅助方法
  // ========================================================================

  /**
   * 检查文件是否存在
   */
  private async fileExists(
    path: string,
    scope: SkillScope
  ): Promise<boolean> {
    try {
      if (scope === 'global') {
        return await exists(path, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(path)
        if (options.baseDir) {
          return await exists(options.path, { baseDir: options.baseDir })
        }
        return await exists(options.path)
      }
    } catch {
      return false
    }
  }

  /**
   * 检查目录是否存在
   */
  private async directoryExists(
    path: string,
    scope: SkillScope
  ): Promise<boolean> {
    return this.fileExists(path, scope)
  }

  /**
   * 列出 Skill 子目录
   */
  private async listSkillDirectories(
    baseDir: string,
    scope: SkillScope
  ): Promise<string[]> {
    const dirs: string[] = []

    try {
      let entries: DirEntry[]

      if (scope === 'global') {
        entries = await readDir(baseDir, { baseDir: BaseDirectory.AppData })
      } else {
        const options = await getFilePathOptions(baseDir)
        if (options.baseDir) {
          entries = await readDir(options.path, { baseDir: options.baseDir })
        } else {
          entries = await readDir(options.path)
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory && !entry.name.startsWith('.')) {
          dirs.push(entry.name)
        }
      }
    } catch (error) {
      console.error(`列出目录失败: ${baseDir}`, error)
    }

    return dirs
  }

  /**
   * 读取文件内容
   */
  private async readFileContent(
    path: string,
    scope: SkillScope
  ): Promise<string> {
    if (scope === 'global') {
      return await readTextFile(path, { baseDir: BaseDirectory.AppData })
    } else {
      const options = await getFilePathOptions(path)
      if (options.baseDir) {
        return await readTextFile(options.path, { baseDir: options.baseDir })
      }
      return await readTextFile(options.path)
    }
  }

  /**
   * 获取 Skill 文件信息
   */
  getSkillFileInfo(id: string): SkillFileInfo | undefined {
    return this.skillFiles.get(id)
  }

  /**
   * 获取所有 Skill 文件信息
   */
  getAllSkillFileInfo(): SkillFileInfo[] {
    return Array.from(this.skillFiles.values())
  }
}

// ============================================================================
// 单例导出
// ============================================================================

export const skillManager = new SkillManager()

// 重置管理器（主要用于测试）
export function resetSkillManager(): void {
  ;(skillManager as any).skills.clear()
  ;(skillManager as any).skillFiles.clear()
  ;(skillManager as any).initialized = false
}
