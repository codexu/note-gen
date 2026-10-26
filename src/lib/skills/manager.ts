/**
 * Skill 管理器
 *
 * 负责 Skills 的发现、加载、注册和匹配。
 * 遵循 Agent Skills 官方规范: https://agentskills.io/specification
 */

import {
  SkillContent,
  SkillScope,
  SkillFileInfo,
  SkillMatchScore,
  SkillScript,
  SkillReference,
  SkillAsset,
  SKILL_FILE_NAME,
  SCRIPTS_DIR_NAME,
  REFERENCES_DIR_NAME,
  ASSETS_DIR_NAME,
  REFERENCE_FILE_NAME,
  EXAMPLES_FILE_NAME,
  KEYWORDS_FILE_NAME,
  DEFAULT_SKILL_VERSION,
  DEFAULT_SKILL_ENABLED,
  DEFAULT_USER_INVOCABLE,
} from './types'
import { parseSkillFile, generateSkillId, detectScriptType } from './parser'
import { validateSkillYamlMetadata } from './validator'
import { readFile, readDir, lstat, open, BaseDirectory, DirEntry } from '@tauri-apps/plugin-fs'
import { getFilePathOptions } from '@/lib/workspace'
import { exists } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'

const MAX_SKILL_RESOURCE_DEPTH = 10
const MAX_SKILL_RESOURCES = 1000
const MAX_SKILL_SCAN_ENTRIES = 4000
const MAX_SKILL_RESOURCE_BYTES = 512 * 1024
const SKIPPED_SKILL_DIRECTORIES = new Set([
  'runtime', 'skill-runtimes', 'node_modules', 'venv', '__pycache__', 'outputs',
])
const TEXT_RESOURCE_EXTENSIONS = new Set([
  'md', 'mdx', 'txt', 'rst', 'adoc', 'json', 'jsonl', 'yaml', 'yml', 'toml',
  'xml', 'xsd', 'xsl', 'xslt', 'rels', 'dtd', 'ent', 'html', 'htm', 'css', 'scss', 'svg', 'csv', 'tsv',
  'ini', 'cfg', 'conf', 'properties', 'tex', 'bib', 'template', 'j2', 'jinja',
  'jinja2', 'liquid', 'mustache', 'hbs', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'sh', 'bash', 'zsh', 'ps1', 'sql',
])

function isTextResourcePath(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase() || ''
  return ['license', 'licence', 'notice', 'readme', 'makefile'].includes(name)
    || TEXT_RESOURCE_EXTENSIONS.has(name.split('.').pop() || '')
}

function isSafeSkillEntry(entry: DirEntry): boolean {
  return !!entry.name && !entry.isSymlink && !entry.name.startsWith('.')
    && !/[\\/\0]/.test(entry.name)
    && !(entry.isDirectory && SKIPPED_SKILL_DIRECTORIES.has(entry.name.toLowerCase()))
}

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
 * - 管理脚本、参考文档和资源文件
 */
class SkillManager {
  private skills: Map<string, SkillContent> = new Map()
  private installedSkills: Map<string, SkillContent> = new Map()
  private skillFiles: Map<string, SkillFileInfo> = new Map()
  private installedSkillFiles: Map<string, SkillFileInfo> = new Map()
  private enabledOverrides: Record<string, boolean> = {}
  private initialized = false

  private async hashFile(filePath: string, scope: SkillScope): Promise<string> {
    const bytes = scope === 'global'
      ? await readFile(filePath, { baseDir: BaseDirectory.AppData })
      : await (async () => {
          const options = await getFilePathOptions(filePath)
          return options.baseDir
            ? await readFile(options.path, { baseDir: options.baseDir })
            : await readFile(options.path)
        })()
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  }

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

    const store = await Store.load('store.json')
    this.enabledOverrides = await store.get<Record<string, boolean>>('skills.enabledSkills') || {}
    await this.discoverSkills()
    this.initialized = true
  }

  /**
   * 重新加载所有 Skills
   */
  async reload(): Promise<void> {
    this.reset()
    await this.initialize()
  }

  reset(): void {
    this.skills.clear()
    this.installedSkills.clear()
    this.skillFiles.clear()
    this.installedSkillFiles.clear()
    this.initialized = false
  }

  private registerSkillFileInfo(id: string, scope: SkillScope, info: SkillFileInfo): void {
    this.installedSkillFiles.set(`${scope}:${id}`, info)
    const activeSkill = this.skills.get(id)
    if (!activeSkill || activeSkill.metadata.scope === scope) this.skillFiles.set(id, info)
  }

  // ========================================================================
  // 发现和加载
  // ========================================================================

  /**
   * 发现并加载所有 Skills
   */
  async discoverSkills(): Promise<void> {
    // 加载全局 Skills
    await this.discoverGlobalSkills()

    // 工作区 Skill 与全局 Skill 同名时覆盖全局版本。
    await this.discoverProjectSkills()
  }

  /**
   * 发现工作区 Skills
   */
  private async discoverProjectSkills(): Promise<void> {
    try {
      const skillsDirExists = await this.directoryExists('skills', 'project')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories('skills', 'project')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory('skills', dirName, 'project')
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
      const skillsDirExists = await this.directoryExists('skills', 'global')
      if (!skillsDirExists) {
        return
      }

      const skillDirs = await this.listSkillDirectories('skills', 'global')

      for (const dirName of skillDirs) {
        try {
          await this.loadSkillFromDirectory('skills', dirName, 'global')
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
      this.registerSkillFileInfo(skillId, scope, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasScriptsDir: false,
        hasReferencesDir: false,
        hasAssetsDir: false,
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
      this.registerSkillFileInfo(skillId, scope, {
        id: skillId,
        directory: skillDirPath,
        mainFile: skillFilePath,
        hasScriptsDir: false,
        hasReferencesDir: false,
        hasAssetsDir: false,
        isValid: false,
        error: validation.errors.map((e) => e.message).join('; '),
      })
      return
    }

    // 检查官方规范目录结构
    const hasScriptsDir = await this.directoryExists(
      `${skillDirPath}/${SCRIPTS_DIR_NAME}`,
      scope
    )
    const hasReferencesDir = await this.directoryExists(
      `${skillDirPath}/${REFERENCES_DIR_NAME}`,
      scope
    )
    const hasAssetsDir = await this.directoryExists(
      `${skillDirPath}/${ASSETS_DIR_NAME}`,
      scope
    )

    // 向后兼容：检查旧的根目录文件
    const hasReferenceFile = await this.fileExists(
      `${skillDirPath}/${REFERENCE_FILE_NAME}`,
      scope
    )
    const hasExamplesFile = await this.fileExists(
      `${skillDirPath}/${EXAMPLES_FILE_NAME}`,
      scope
    )
    const hasKeywordsFile = await this.fileExists(
      `${skillDirPath}/${KEYWORDS_FILE_NAME}`,
      scope
    )

    // 加载脚本 (scripts/)
    const scripts: SkillScript[] = []
    if (hasScriptsDir) {
      const scriptFiles = await this.loadScriptsFromDirectory(
        `${skillDirPath}/${SCRIPTS_DIR_NAME}`,
        scope
      )
      scripts.push(...scriptFiles)
    }

    // Resources may also live in examples/, themes/, agents/, or nested
    // directories. Index them without executing or rewriting the package.
    const { references, assets } = await this.loadPackageResources(skillDirPath, scope, scripts)

    // 向后兼容：加载根目录的 REFERENCE.md
    if (hasReferenceFile && !hasReferencesDir) {
      const refContent = await this.readFileContent(
        `${skillDirPath}/${REFERENCE_FILE_NAME}`,
        scope
      )
      // 将旧格式内容附加到指令中
      parsed.content += '\n\n---\n\n## 参考文档 (Legacy)\n\n' + refContent
    }

    // 向后兼容：加载 KEYWORDS.md
    if (hasKeywordsFile) {
      const keywordsContent = await this.readFileContent(
        `${skillDirPath}/${KEYWORDS_FILE_NAME}`,
        scope
      )
      parsed.content += '\n\n---\n\n## 关键词 (Legacy)\n\n' + keywordsContent
    }

    // 构建 Skill 内容
    const now = Date.now()
    const skill: SkillContent = {
      metadata: {
        id: skillId,
        name: parsed.metadata.name,
        description: parsed.metadata.description,
        license: parsed.metadata.license,
        compatibility: parsed.metadata.compatibility,
        metadata: parsed.metadata.metadata,
        version: parsed.metadata.version || parsed.metadata.metadata?.version || DEFAULT_SKILL_VERSION,
        author: parsed.metadata.author || parsed.metadata.metadata?.author,
        scope,
        model: parsed.metadata.model,
        allowedTools: Array.isArray(parsed.metadata.allowedTools)
          ? parsed.metadata.allowedTools
          : typeof parsed.metadata.allowedTools === 'string'
            ? parsed.metadata.allowedTools.split(/\s+/).filter(v => v.length > 0)
            : undefined,
        userInvocable: parsed.metadata.userInvocable ?? DEFAULT_USER_INVOCABLE,
        enabled: this.enabledOverrides[skillId] ?? DEFAULT_SKILL_ENABLED,
        createdAt: now,
        updatedAt: now,
      },
      instructions: parsed.content,
      scripts,
      references,
      assets,
    }

    // 注册 Skill
    this.registerSkill(skill)

    // 记录文件信息
    this.registerSkillFileInfo(skillId, scope, {
      id: skillId,
      directory: skillDirPath,
      mainFile: skillFilePath,
      hasScriptsDir,
      hasReferencesDir,
      hasAssetsDir,
      hasReferenceFile,
      hasExamplesFile,
      hasKeywordsFile,
      isValid: true,
      scriptCount: scripts.length,
      referenceCount: references.length,
      assetCount: assets.length,
    })
  }

  /**
   * 从 scripts/ 目录加载脚本，限制递归深度以避免无界扫描。
   */
  private async loadScriptsFromDirectory(
    scriptsDir: string,
    scope: SkillScope,
    basePath: string = '',
    depth: number = 0,
    budget: { count: number; visited: number } = { count: 0, visited: 0 }
  ): Promise<SkillScript[]> {
    const scripts: SkillScript[] = []

    // 与导入层保持一致，允许合理的嵌套结构但避免无界扫描。
    const maxDepth = 10

    try {
      const entries = await this.readDirectoryEntries(scriptsDir, scope)

      for (const entry of entries) {
        if (++budget.visited > MAX_SKILL_SCAN_ENTRIES || budget.count >= MAX_SKILL_RESOURCES) break
        if (!isSafeSkillEntry(entry)) {
          continue
        }

        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

        if (entry.isFile) {
          // 检测脚本类型
          const scriptType = detectScriptType(entry.name)
          if (!scriptType) {
            // 非脚本文件，静默跳过（减少日志噪音）
            continue
          }

          // scriptsDir already points at the current recursion level. Using
          // relativePath here duplicates parent segments (for example
          // scripts/office/office/soffice.py) and silently drops nested scripts
          // when hashing fails.
          const scriptPath = `${scriptsDir}/${entry.name}`
          scripts.push({
            name: relativePath, // 使用相对路径作为脚本名称（如 "office/unpack.py"）
            path: scriptPath,
            type: scriptType,
            sha256: await this.hashFile(scriptPath, scope),
          })
          budget.count += 1
        } else if (entry.isDirectory && depth < maxDepth) {
          // 递归加载子目录中的脚本（受 maxDepth 限制）
          const subScripts = await this.loadScriptsFromDirectory(
            `${scriptsDir}/${entry.name}`,
            scope,
            relativePath,
            depth + 1,
            budget
          )
          scripts.push(...subScripts)
        }
      }
    } catch (error) {
      console.error(`[SkillManager] 读取脚本目录失败: ${scriptsDir}`, error)
    }

    return scripts
  }

  private async readDirectoryEntries(path: string, scope: SkillScope): Promise<DirEntry[]> {
    const options = await this.ensureRegularResourcePath(path, scope, true)
    return readDir(options.path, options.baseDir ? { baseDir: options.baseDir } : undefined)
  }

  /** Index package resources, keeping only scripts/ entries executable. */
  private async loadPackageResources(
    skillDirPath: string,
    scope: SkillScope,
    scripts: SkillScript[]
  ): Promise<{ references: SkillReference[]; assets: SkillAsset[] }> {
    const references: SkillReference[] = []
    const assets: SkillAsset[] = []
    const executablePaths = new Set(scripts.map(script => `scripts/${script.name}`))
    let visited = 0

    const visit = async (directory: string, relative: string, depth: number): Promise<void> => {
      if (depth > MAX_SKILL_RESOURCE_DEPTH || visited >= MAX_SKILL_SCAN_ENTRIES
        || references.length + assets.length >= MAX_SKILL_RESOURCES) return
      try {
        const entries = (await this.readDirectoryEntries(directory, scope))
          .filter(isSafeSkillEntry)
          .sort((left, right) => {
            // Discover root documents and canonical references before optional
            // examples or large support trees consume the bounded index.
            const priority = (entry: DirEntry) => entry.isFile ? 0 : entry.name === REFERENCES_DIR_NAME ? 1 : 2
            return priority(left) - priority(right) || left.name.localeCompare(right.name)
          })
        for (const entry of entries) {
          if (++visited > MAX_SKILL_SCAN_ENTRIES
            || references.length + assets.length >= MAX_SKILL_RESOURCES) break
          const logicalPath = relative ? `${relative}/${entry.name}` : entry.name
          const storedPath = `${directory}/${entry.name}`
          if (entry.isDirectory) {
            await visit(storedPath, logicalPath, depth + 1)
          } else if (entry.isFile && logicalPath !== SKILL_FILE_NAME && !executablePaths.has(logicalPath)) {
            if (isTextResourcePath(logicalPath)) {
              references.push({ name: logicalPath, path: storedPath })
            } else {
              const extension = entry.name.split('.').pop()?.toLowerCase() || ''
              assets.push({
                name: logicalPath,
                path: storedPath,
                type: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(extension) ? 'image' : 'other',
                encoding: 'binary',
              })
            }
          }
        }
      } catch (error) {
        console.error(`[SkillManager] Failed to index resources: ${directory}`, error)
      }
    }

    await visit(skillDirPath, '', 0)
    return { references, assets }
  }

  /** Reject symbolic links in every component before opening package resources. */
  private async ensureRegularResourcePath(
    path: string,
    scope: SkillScope,
    directory = false
  ): Promise<{ path: string; baseDir?: BaseDirectory }> {
    const options = scope === 'global'
      ? { path, baseDir: BaseDirectory.AppData }
      : await getFilePathOptions(path)
    const normalized = options.path.replace(/\\/g, '/')
    // Preserve filesystem roots. In particular, C: is drive-relative while
    // C:/ is absolute; a UNC share must also remain one complete root.
    const root = normalized.match(/^(?:[A-Za-z]:\/|\/\/[^/]+\/[^/]+(?:\/|$)|\/)/)?.[0] || ''
    const segments = normalized.slice(root.length).split('/').filter(Boolean)
    if (segments.some(segment => segment === '.' || segment === '..')) {
      throw new Error('Invalid Skill resource path')
    }
    const paths = root ? [root] : []
    let currentPath = root.replace(/\/$/, '')
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : root ? `${root}${segment}` : segment
      paths.push(currentPath)
    }
    for (let index = 0; index < paths.length; index += 1) {
      const info = await lstat(paths[index], options.baseDir ? { baseDir: options.baseDir } : undefined)
      const expectsDirectory = directory || index < paths.length - 1
      if (info.isSymlink || (expectsDirectory ? !info.isDirectory : !info.isFile)) {
        throw new Error('Skill resources must be regular files without symbolic links')
      }
    }
    return { ...options, path: normalized }
  }

  private async readResourceText(path: string, scope: SkillScope): Promise<string> {
    const options = await this.ensureRegularResourcePath(path, scope)
    const handle = await open(options.path, { read: true, baseDir: options.baseDir })
    try {
      const info = await handle.stat()
      if (!info.isFile || info.size > MAX_SKILL_RESOURCE_BYTES) {
        throw new Error(`Skill resource exceeds the ${MAX_SKILL_RESOURCE_BYTES} byte text limit`)
      }
      const buffer = new Uint8Array(MAX_SKILL_RESOURCE_BYTES + 1)
      let size = 0
      while (size < buffer.length) {
        const read = await handle.read(buffer.subarray(size))
        if (!read) break
        size += read
      }
      if (size > MAX_SKILL_RESOURCE_BYTES) {
        throw new Error(`Skill resource exceeds the ${MAX_SKILL_RESOURCE_BYTES} byte text limit`)
      }
      const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))
      if (content.includes('\0')) throw new Error('Binary Skill resources cannot be read as text')
      return content
    } finally {
      await handle.close()
    }
  }

  // ========================================================================
  // 注册和注销
  // ========================================================================

  /**
   * 注册 Skill
   */
  registerSkill(skill: SkillContent): void {
    this.installedSkills.set(
      `${skill.metadata.scope}:${skill.metadata.id}`,
      skill
    )
    this.skills.set(skill.metadata.id, skill)
  }

  /**
   * 注销 Skill
   */
  unregisterSkill(skillId: string): void {
    this.skills.delete(skillId)
    for (const key of this.installedSkills.keys()) {
      if (key.endsWith(`:${skillId}`)) {
        this.installedSkills.delete(key)
      }
    }
    this.skillFiles.delete(skillId)
    for (const key of this.installedSkillFiles.keys()) {
      if (key.endsWith(`:${skillId}`)) this.installedSkillFiles.delete(key)
    }
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
   * 获取所有作用域中实际安装的 Skills，包括被同名项目 Skill 覆盖的全局 Skill。
   */
  getAllInstalledSkills(): SkillContent[] {
    return Array.from(this.installedSkills.values())
  }

  /**
   * 获取指定作用域的 Skills
   */
  getSkillsByScope(scope: SkillScope): SkillContent[] {
    return this.getAllInstalledSkills().filter(
      (skill) => skill.metadata.scope === scope
    )
  }

  /**
   * 获取所有已启用的 Skills
   */
  async getEnabledSkills(): Promise<SkillContent[]> {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.enabled !== false
    )
  }

  /**
   * 获取可用户调用的 Skills
   */
  getUserInvocableSkills(): SkillContent[] {
    return this.getAllSkills().filter(
      (skill) => skill.metadata.enabled !== false && skill.metadata.userInvocable !== false
    )
  }

  /**
   * 根据 ID 获取 Skill
   */
  getSkill(id: string, scope?: SkillScope): SkillContent | undefined {
    return scope ? this.installedSkills.get(`${scope}:${id}`) : this.skills.get(id)
  }

  /**
   * 检查 Skill 是否存在
   */
  hasSkill(id: string): boolean {
    return this.skills.has(id)
  }

  /**
   * 获取 Skill 的脚本
   */
  getSkillScripts(skillId: string): SkillScript[] {
    const skill = this.getSkill(skillId)
    return skill?.scripts || []
  }

  /**
   * 获取 Skill 的参考文档
   */
  getSkillReferences(skillId: string): SkillReference[] {
    const skill = this.getSkill(skillId)
    return skill?.references || []
  }

  /**
   * 获取 Skill 的资源文件
   */
  getSkillAssets(skillId: string): SkillAsset[] {
    const skill = this.getSkill(skillId)
    return skill?.assets || []
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
        if (entry.isDirectory && isSafeSkillEntry(entry)) {
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
    return this.readResourceText(path, scope)
  }

  /**
   * 获取 Skill 文件信息
   */
  getSkillFileInfo(id: string, scope?: SkillScope): SkillFileInfo | undefined {
    return scope ? this.installedSkillFiles.get(`${scope}:${id}`) : this.skillFiles.get(id)
  }

  /**
   * 获取所有 Skill 文件信息
   */
  getAllSkillFileInfo(): SkillFileInfo[] {
    return Array.from(this.skillFiles.values())
  }

  /**
   * Read one installed Skill resource through a logical path.
   *
   * Agent-facing callers must never resolve Skill resources through note
   * paths. Keeping this lookup inside the manager makes the installed Skill
   * package a separate, read-only namespace.
   */
  async readSkillResource(id: string, resourcePath: string): Promise<string> {
    const skill = this.skills.get(id)
    const fileInfo = this.skillFiles.get(id)
    if (!skill || !fileInfo) {
      throw new Error(`Skill not found: ${id}`)
    }

    const normalized = resourcePath.replace(/\\/g, '/').replace(/^\.\//, '')
    const segments = normalized.split('/')
    if (
      !normalized
      || normalized.startsWith('/')
      || /^[a-zA-Z]:\//.test(normalized)
      || segments.some(segment => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error('Invalid Skill resource path')
    }

    if (normalized === 'SKILL.md') {
      return skill.instructions
    }

    const relativeToSkill = (storedPath: string) => {
      const normalizedStored = storedPath.replace(/\\/g, '/')
      const normalizedDirectory = fileInfo.directory.replace(/\\/g, '/').replace(/\/+$/, '')
      return normalizedStored.startsWith(`${normalizedDirectory}/`)
        ? normalizedStored.slice(normalizedDirectory.length + 1)
        : normalizedStored
    }

    const resources = [
      ...skill.scripts.map(script => ({ logicalPath: `scripts/${script.name}`, storedPath: script.path, binary: false })),
      ...skill.references.map(reference => ({
        logicalPath: relativeToSkill(reference.path),
        storedPath: reference.path.includes('/')
          ? reference.path
          : `${fileInfo.directory}/${reference.path}`,
        binary: false,
      })),
      ...skill.assets.map(asset => ({
        logicalPath: relativeToSkill(asset.path),
        storedPath: asset.path.includes('/')
          ? asset.path
          : `${fileInfo.directory}/${asset.path}`,
        binary: asset.encoding === 'binary' || (asset.encoding !== 'utf-8' && !isTextResourcePath(asset.path)),
      })),
    ]
    const resource = resources.find(candidate => candidate.logicalPath === normalized)
    if (!resource) {
      throw new Error(`Skill resource is not registered: ${normalized}`)
    }
    if (resource.binary) {
      throw new Error(`Skill resource is binary and cannot be read as UTF-8 text: ${normalized}`)
    }

    const content = await this.readFileContent(resource.storedPath, skill.metadata.scope)
    const maxLength = 100_000
    return content.length > maxLength
      ? `${content.slice(0, maxLength)}\n\n[Resource truncated at ${maxLength} characters]`
      : content
  }
}

// ============================================================================
// 单例导出
// ============================================================================

export const skillManager = new SkillManager()

// 重置管理器（主要用于测试）
export function resetSkillManager(): void {
  skillManager.reset()
}
