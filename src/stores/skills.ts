import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import type { SkillMetadata, SkillContent, SkillExecutionRecord } from '@/lib/skills/types'
import { skillManager } from '@/lib/skills/manager'

interface SkillsState {
  // 配置
  enabled: boolean
  autoMatch: boolean              // 是否自动匹配 Skills

  // Skills
  skills: SkillMetadata[]
  globalSkills: SkillMetadata[]   // 全局 Skills
  projectSkills: SkillMetadata[]  // 工作区 Skills

  // 运行时
  activeSkill: string | null      // 当前活跃的 Skill
  skillHistory: SkillExecutionRecord[]

  // 是否已初始化
  initialized: boolean
  initializing: boolean  // 是否正在初始化，防止重复初始化

  // 方法
  initSkills: () => Promise<void>
  loadSkillsConfig: () => Promise<void>

  // 配置管理
  setEnabled: (enabled: boolean) => Promise<void>
  setAutoMatch: (autoMatch: boolean) => Promise<void>

  // Skill 管理方法
  toggleSkill: (id: string) => Promise<void>
  updateSkillInstructions: (id: string, instructions: string) => Promise<void>
  deleteSkill: (id: string) => Promise<void>
  refreshSkills: () => Promise<void>

  // 获取方法
  getSkill: (id: string) => SkillContent | undefined
  getEnabledSkills: () => Promise<SkillContent[]>
  getUserInvocableSkills: () => SkillContent[]
  getSkillsByScope: (scope: 'global' | 'project') => SkillContent[]

  // 执行历史
  addExecutionRecord: (record: SkillExecutionRecord) => void
  clearExecutionHistory: () => void
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  // 初始状态
  enabled: true,  // 默认启用
  autoMatch: true,
  skills: [],
  globalSkills: [],
  projectSkills: [],
  activeSkill: null,
  skillHistory: [],
  initialized: false,
  initializing: false,  // 防止重复初始化

  // 初始化 Skills
  initSkills: async () => {
    const state = get()

    // 防止重复初始化
    if (state.initializing) {
      // 等待正在进行的初始化完成
      while (get().initializing) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return
    }

    // 如果已经初始化过，只加载配置
    if (state.initialized) {
      await get().loadSkillsConfig()
      return
    }

    try {
      set({ initializing: true })

      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('skills.enabled')
      const autoMatch = await store.get<boolean>('skills.autoMatch')

      // 先设置配置，不设置 initialized
      set({
        enabled: enabled ?? true,  // 默认为 true
        autoMatch: autoMatch ?? true,
      })

      // 初始化 Skill 管理器
      await skillManager.initialize()

      // 加载 Skills 到状态
      await get().refreshSkills()

      // 只有成功完成所有初始化后才设置 initialized 为 true
      set({ initialized: true })
    } catch (error) {
      console.error('Failed to initialize Skills:', error)
      // 初始化失败，重置状态
      set({ initialized: false })
    } finally {
      set({ initializing: false })
    }
  },

  // 加载 Skills 配置
  loadSkillsConfig: async () => {
    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('skills.enabled')
      const autoMatch = await store.get<boolean>('skills.autoMatch')

      set({
        enabled: enabled ?? false,
        autoMatch: autoMatch ?? true,
      })
    } catch (error) {
      console.error('Failed to load Skills config:', error)
    }
  },

  // 设置启用状态
  setEnabled: async (enabled: boolean) => {
    const store = await Store.load('store.json')
    await store.set('skills.enabled', enabled)
    await store.save()
    set({ enabled })
  },

  // 设置自动匹配
  setAutoMatch: async (autoMatch: boolean) => {
    const store = await Store.load('store.json')
    await store.set('skills.autoMatch', autoMatch)
    await store.save()
    set({ autoMatch })
  },

  // 刷新 Skills 列表
  refreshSkills: async () => {
    await skillManager.reload()

    const allSkills = skillManager.getAllSkills()
    const globalSkills = skillManager.getSkillsByScope('global')
    const projectSkills = skillManager.getSkillsByScope('project')

    set({
      skills: allSkills.map(s => s.metadata),
      globalSkills: globalSkills.map(s => s.metadata),
      projectSkills: projectSkills.map(s => s.metadata),
    })
  },

  // 切换 Skill 启用状态
  toggleSkill: async (id: string) => {
    const skill = skillManager.getSkill(id)
    if (!skill) return

    // 更新 Skill 的启用状态
    skill.metadata.enabled = !skill.metadata.enabled
    skill.metadata.updatedAt = Date.now()

    // 保存到本地存储
    const store = await Store.load('store.json')
    const enabledSkills = await store.get<Record<string, boolean>>('skills.enabledSkills') || {}
    enabledSkills[id] = skill.metadata.enabled
    await store.set('skills.enabledSkills', enabledSkills)
    await store.save()

    // 更新状态
    await get().refreshSkills()
  },

  // 更新 Skill 指令
  updateSkillInstructions: async (id: string, instructions: string) => {
    const skill = skillManager.getSkill(id)
    if (!skill) return

    // 更新内存中的指令内容
    skill.instructions = instructions
    skill.metadata.updatedAt = Date.now()

    // 获取 Skill 文件信息
    const fileInfo = skillManager.getSkillFileInfo(id)
    if (!fileInfo) return

    // 构建完整的 Skill 文件内容
    const metadata = skill.metadata
    const yamlMetadata = `---
name: ${metadata.name}
description: ${metadata.description}
version: ${metadata.version}
${metadata.author ? `author: ${metadata.author}` : ''}
${metadata.allowedTools ? `allowedTools:\n${metadata.allowedTools.map(t => `  - ${t}`).join('\n')}` : ''}
${metadata.userInvocable !== undefined ? `userInvocable: ${metadata.userInvocable}` : ''}
---

${instructions}
`

    // 写入文件
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')

    if (metadata.scope === 'global') {
      await writeTextFile(fileInfo.mainFile, yamlMetadata, { baseDir: BaseDirectory.AppData })
    } else {
      const { getFilePathOptions } = await import('@/lib/workspace')
      const options = await getFilePathOptions(fileInfo.mainFile)
      if (options.baseDir) {
        await writeTextFile(options.path, yamlMetadata, { baseDir: options.baseDir })
      } else {
        await writeTextFile(options.path, yamlMetadata)
      }
    }

    // 更新状态
    await get().refreshSkills()
  },

  // 删除 Skill
  deleteSkill: async (id: string) => {
    const skill = skillManager.getSkill(id)
    const fileInfo = skillManager.getSkillFileInfo(id)
    if (!skill || !fileInfo) return

    // 删除目录
    const { remove } = await import('@tauri-apps/plugin-fs')
    const { BaseDirectory } = await import('@tauri-apps/plugin-fs')

    if (skill.metadata.scope === 'global') {
      // fileInfo.directory 已经是完整路径（如 skills/style-detector）
      await remove(fileInfo.directory, { baseDir: BaseDirectory.AppData, recursive: true })
    } else {
      const { getFilePathOptions } = await import('@/lib/workspace')
      const options = await getFilePathOptions(fileInfo.directory)
      if (options.baseDir) {
        await remove(options.path, { baseDir: options.baseDir, recursive: true })
      } else {
        await remove(options.path, { recursive: true })
      }
    }

    // 从管理器中注销 Skill
    skillManager.unregisterSkill(id)

    // 更新状态
    await get().refreshSkills()
  },

  // 获取 Skill
  getSkill: (id: string) => {
    return skillManager.getSkill(id)
  },

  // 获取已启用的 Skills
  getEnabledSkills: async () => {
    return await skillManager.getEnabledSkills()
  },

  // 获取可用户调用的 Skills
  getUserInvocableSkills: () => {
    return skillManager.getUserInvocableSkills()
  },

  // 按作用域获取 Skills
  getSkillsByScope: (scope: 'global' | 'project') => {
    return skillManager.getSkillsByScope(scope)
  },

  // 添加执行记录
  addExecutionRecord: (record: SkillExecutionRecord) => {
    const history = get().skillHistory
    const newHistory = [record, ...history].slice(0, 100) // 保留最近 100 条
    set({ skillHistory: newHistory })
  },

  // 清除执行历史
  clearExecutionHistory: () => {
    set({ skillHistory: [] })
  },
}))
