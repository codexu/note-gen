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

  // 方法
  initSkills: () => Promise<void>
  loadSkillsConfig: () => Promise<void>

  // 配置管理
  setEnabled: (enabled: boolean) => Promise<void>
  setAutoMatch: (autoMatch: boolean) => Promise<void>

  // Skill 管理方法
  toggleSkill: (id: string) => Promise<void>
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

  // 初始化 Skills
  initSkills: async () => {
    // 如果已经初始化过，只加载配置
    if (get().initialized) {
      await get().loadSkillsConfig()
      return
    }

    try {
      const store = await Store.load('store.json')
      const enabled = await store.get<boolean>('skills.enabled')
      const autoMatch = await store.get<boolean>('skills.autoMatch')

      set({
        enabled: enabled ?? true,  // 默认为 true
        autoMatch: autoMatch ?? true,
        initialized: true,
      })

      // 初始化 Skill 管理器
      await skillManager.initialize()

      // 加载 Skills 到状态
      await get().refreshSkills()
    } catch (error) {
      console.error('Failed to initialize Skills:', error)
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
