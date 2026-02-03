/**
 * Prompt Manager 实现
 * 管理和组织 AI 提示词的顺序和内容
 * 
 * 复刻 SillyTavern PromptManager.js 核心功能
 */

import { AIMessage } from './context-builder-v2'

// ============ 类型定义 ============

/**
 * 注入位置类型
 */
export enum InjectionPosition {
  /** 相对位置 (按顺序) */
  Relative = 0,
  /** 绝对位置 (按深度) */
  Absolute = 1,
}

/**
 * 提示词角色
 */
export type PromptRole = 'system' | 'user' | 'assistant'

/**
 * 提示词定义
 */
export interface PromptEntry {
  /** 唯一标识符 */
  identifier: string
  /** 显示名称 */
  name: string
  /** 角色 */
  role: PromptRole
  /** 内容 (可包含宏) */
  content: string
  /** 是否为系统提示词 (不可删除) */
  systemPrompt: boolean
  /** 是否为标记提示词 (用于插入动态内容) */
  marker: boolean
  /** 注入位置类型 */
  injectionPosition: InjectionPosition
  /** 注入深度 (仅 Absolute 模式) */
  injectionDepth: number
  /** 注入顺序 (同深度时的排序) */
  injectionOrder: number
  /** 是否禁止覆盖 */
  forbidOverrides: boolean
}

/**
 * 提示词顺序条目
 */
export interface PromptOrderEntry {
  /** 提示词标识符 */
  identifier: string
  /** 是否启用 */
  enabled: boolean
}

/**
 * Prompt Manager 配置
 */
export interface PromptManagerConfig {
  /** 提示词列表 */
  prompts: PromptEntry[]
  /** 提示词顺序 */
  promptOrder: PromptOrderEntry[]
}

// ============ 默认提示词 ============

/**
 * 默认系统提示词
 */
export const DEFAULT_PROMPTS: PromptEntry[] = [
  {
    identifier: 'main',
    name: '主提示词',
    role: 'system',
    content: '扮演 {{char}}，在与 {{user}} 的虚构对话中撰写下一条回复。',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'nsfw',
    name: '辅助提示词',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'charDescription',
    name: '角色描述',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'charPersonality',
    name: '角色性格',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'scenario',
    name: '场景',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'personaDescription',
    name: '用户设定',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'worldInfoBefore',
    name: '世界书 (角色前)',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'worldInfoAfter',
    name: '世界书 (角色后)',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'dialogueExamples',
    name: '对话示例',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'chatHistory',
    name: '聊天历史',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: true,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
  {
    identifier: 'jailbreak',
    name: '历史后指令',
    role: 'system',
    content: '',
    systemPrompt: true,
    marker: false,
    injectionPosition: InjectionPosition.Relative,
    injectionDepth: 0,
    injectionOrder: 100,
    forbidOverrides: false,
  },
]

/**
 * 默认提示词顺序
 */
export const DEFAULT_PROMPT_ORDER: PromptOrderEntry[] = [
  { identifier: 'main', enabled: true },
  { identifier: 'worldInfoBefore', enabled: true },
  { identifier: 'personaDescription', enabled: true },
  { identifier: 'charDescription', enabled: true },
  { identifier: 'charPersonality', enabled: true },
  { identifier: 'scenario', enabled: true },
  { identifier: 'nsfw', enabled: false },
  { identifier: 'worldInfoAfter', enabled: true },
  { identifier: 'dialogueExamples', enabled: true },
  { identifier: 'chatHistory', enabled: true },
  { identifier: 'jailbreak', enabled: true },
]

// ============ Prompt Manager 类 ============

/**
 * 动态内容提供者接口
 */
export interface DynamicContentProvider {
  charDescription?: string
  charPersonality?: string
  scenario?: string
  personaDescription?: string
  worldInfoBefore?: string
  worldInfoAfter?: string
  dialogueExamples?: AIMessage[]
  chatHistory?: AIMessage[]
}

/**
 * Prompt Manager - 提示词管理器
 */
export class PromptManager {
  private prompts: Map<string, PromptEntry>
  private promptOrder: PromptOrderEntry[]
  
  constructor(config?: Partial<PromptManagerConfig>) {
    this.prompts = new Map()
    this.promptOrder = []
    
    // 初始化默认提示词
    for (const prompt of DEFAULT_PROMPTS) {
      this.prompts.set(prompt.identifier, { ...prompt })
    }
    
    // 初始化默认顺序
    this.promptOrder = [...DEFAULT_PROMPT_ORDER]
    
    // 应用配置
    if (config?.prompts) {
      for (const prompt of config.prompts) {
        this.prompts.set(prompt.identifier, prompt)
      }
    }
    
    if (config?.promptOrder) {
      this.promptOrder = config.promptOrder
    }
  }
  
  // ============ 提示词管理 ============
  
  /**
   * 获取提示词
   */
  getPrompt(identifier: string): PromptEntry | undefined {
    return this.prompts.get(identifier)
  }
  
  /**
   * 获取所有提示词
   */
  getAllPrompts(): PromptEntry[] {
    return Array.from(this.prompts.values())
  }
  
  /**
   * 添加或更新提示词
   */
  setPrompt(prompt: PromptEntry): void {
    this.prompts.set(prompt.identifier, prompt)
  }
  
  /**
   * 删除提示词 (仅限非系统提示词)
   */
  deletePrompt(identifier: string): boolean {
    const prompt = this.prompts.get(identifier)
    if (!prompt || prompt.systemPrompt) {
      return false
    }
    
    this.prompts.delete(identifier)
    this.promptOrder = this.promptOrder.filter(e => e.identifier !== identifier)
    return true
  }
  
  /**
   * 创建新提示词
   */
  createPrompt(name: string, content: string = '', role: PromptRole = 'system'): PromptEntry {
    const identifier = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    
    const prompt: PromptEntry = {
      identifier,
      name,
      role,
      content,
      systemPrompt: false,
      marker: false,
      injectionPosition: InjectionPosition.Relative,
      injectionDepth: 0,
      injectionOrder: 100,
      forbidOverrides: false,
    }
    
    this.prompts.set(identifier, prompt)
    this.promptOrder.push({ identifier, enabled: true })
    
    return prompt
  }
  
  // ============ 顺序管理 ============
  
  /**
   * 获取提示词顺序
   */
  getPromptOrder(): PromptOrderEntry[] {
    return [...this.promptOrder]
  }
  
  /**
   * 设置提示词顺序
   */
  setPromptOrder(order: PromptOrderEntry[]): void {
    this.promptOrder = order
  }
  
  /**
   * 移动提示词位置
   */
  movePrompt(identifier: string, newIndex: number): void {
    const currentIndex = this.promptOrder.findIndex(e => e.identifier === identifier)
    if (currentIndex < 0) return
    
    const [entry] = this.promptOrder.splice(currentIndex, 1)
    this.promptOrder.splice(newIndex, 0, entry)
  }
  
  /**
   * 启用/禁用提示词
   */
  togglePrompt(identifier: string, enabled?: boolean): void {
    const entry = this.promptOrder.find(e => e.identifier === identifier)
    if (entry) {
      entry.enabled = enabled ?? !entry.enabled
    }
  }
  
  /**
   * 检查提示词是否启用
   */
  isPromptEnabled(identifier: string): boolean {
    const entry = this.promptOrder.find(e => e.identifier === identifier)
    return entry?.enabled ?? false
  }
  
  // ============ 构建消息 ============
  
  /**
   * 根据配置构建 AI 消息数组
   */
  buildMessages(dynamicContent: DynamicContentProvider): AIMessage[] {
    const messages: AIMessage[] = []
    const absolutePrompts: Array<{ prompt: PromptEntry; message: AIMessage }> = []
    
    // 按顺序处理相对位置的提示词
    for (const orderEntry of this.promptOrder) {
      if (!orderEntry.enabled) continue
      
      const prompt = this.prompts.get(orderEntry.identifier)
      if (!prompt) continue
      
      // 处理标记提示词 (动态内容)
      if (prompt.marker) {
        const dynamicMessages = this.resolveDynamicContent(prompt.identifier, dynamicContent)
        
        if (prompt.injectionPosition === InjectionPosition.Absolute) {
          // 绝对位置的动态内容
          for (const msg of dynamicMessages) {
            absolutePrompts.push({ prompt, message: msg })
          }
        } else {
          messages.push(...dynamicMessages)
        }
        continue
      }
      
      // 处理普通提示词
      if (!prompt.content.trim()) continue
      
      const message: AIMessage = {
        role: prompt.role,
        content: prompt.content,
      }
      
      if (prompt.injectionPosition === InjectionPosition.Absolute) {
        absolutePrompts.push({ prompt, message })
      } else {
        messages.push(message)
      }
    }
    
    // 注入绝对位置的提示词
    // 按深度和顺序排序
    absolutePrompts.sort((a, b) => {
      if (a.prompt.injectionDepth !== b.prompt.injectionDepth) {
        return b.prompt.injectionDepth - a.prompt.injectionDepth // 深度大的先处理
      }
      return a.prompt.injectionOrder - b.prompt.injectionOrder
    })
    
    for (const { prompt, message } of absolutePrompts) {
      const insertIndex = Math.max(0, messages.length - prompt.injectionDepth)
      messages.splice(insertIndex, 0, message)
    }
    
    return messages
  }
  
  /**
   * 解析动态内容
   */
  private resolveDynamicContent(
    identifier: string,
    content: DynamicContentProvider
  ): AIMessage[] {
    switch (identifier) {
      case 'charDescription':
        return content.charDescription
          ? [{ role: 'system', content: `[角色描述]\n${content.charDescription}` }]
          : []
          
      case 'charPersonality':
        return content.charPersonality
          ? [{ role: 'system', content: `[性格]\n${content.charPersonality}` }]
          : []
          
      case 'scenario':
        return content.scenario
          ? [{ role: 'system', content: `[场景]\n${content.scenario}` }]
          : []
          
      case 'personaDescription':
        return content.personaDescription
          ? [{ role: 'system', content: `[用户设定]\n${content.personaDescription}` }]
          : []
          
      case 'worldInfoBefore':
        return content.worldInfoBefore
          ? [{ role: 'system', content: `[世界设定]\n${content.worldInfoBefore}` }]
          : []
          
      case 'worldInfoAfter':
        return content.worldInfoAfter
          ? [{ role: 'system', content: `[补充设定]\n${content.worldInfoAfter}` }]
          : []
          
      case 'dialogueExamples':
        return content.dialogueExamples || []
        
      case 'chatHistory':
        return content.chatHistory || []
        
      default:
        return []
    }
  }
  
  // ============ 序列化 ============
  
  /**
   * 导出配置
   */
  export(): PromptManagerConfig {
    return {
      prompts: this.getAllPrompts(),
      promptOrder: this.getPromptOrder(),
    }
  }
  
  /**
   * 导入配置
   */
  import(config: PromptManagerConfig): void {
    // 导入提示词
    for (const prompt of config.prompts) {
      // 不覆盖系统提示词的 systemPrompt 和 marker 属性
      const existing = this.prompts.get(prompt.identifier)
      if (existing?.systemPrompt) {
        this.prompts.set(prompt.identifier, {
          ...prompt,
          systemPrompt: true,
          marker: existing.marker,
        })
      } else {
        this.prompts.set(prompt.identifier, prompt)
      }
    }
    
    // 导入顺序
    this.promptOrder = config.promptOrder
    
    // 确保所有系统提示词都在顺序中
    for (const prompt of DEFAULT_PROMPTS) {
      if (!this.promptOrder.find(e => e.identifier === prompt.identifier)) {
        this.promptOrder.push({ identifier: prompt.identifier, enabled: false })
      }
    }
  }
  
  /**
   * 重置为默认配置
   */
  reset(): void {
    this.prompts.clear()
    for (const prompt of DEFAULT_PROMPTS) {
      this.prompts.set(prompt.identifier, { ...prompt })
    }
    this.promptOrder = [...DEFAULT_PROMPT_ORDER]
  }
}

// ============ 工具函数 ============

/**
 * 创建默认 Prompt Manager 配置
 */
export function createDefaultPromptManagerConfig(): PromptManagerConfig {
  return {
    prompts: DEFAULT_PROMPTS.map(p => ({ ...p })),
    promptOrder: DEFAULT_PROMPT_ORDER.map(e => ({ ...e })),
  }
}

/**
 * 验证 Prompt Manager 配置
 */
export function validatePromptManagerConfig(config: Partial<PromptManagerConfig>): string[] {
  const errors: string[] = []
  
  if (config.prompts) {
    const identifiers = new Set<string>()
    for (const prompt of config.prompts) {
      if (!prompt.identifier) {
        errors.push('提示词缺少标识符')
      } else if (identifiers.has(prompt.identifier)) {
        errors.push(`重复的提示词标识符: ${prompt.identifier}`)
      } else {
        identifiers.add(prompt.identifier)
      }
      
      if (!prompt.name) {
        errors.push(`提示词 ${prompt.identifier} 缺少名称`)
      }
    }
  }
  
  if (config.promptOrder) {
    for (const entry of config.promptOrder) {
      if (!entry.identifier) {
        errors.push('顺序条目缺少标识符')
      }
    }
  }
  
  return errors
}
