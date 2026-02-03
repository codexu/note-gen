/**
 * Context Builder V2 - ST 风格的上下文构建器
 * 
 * 完全按照 SillyTavern 的上下文构建流程实现:
 * 1. 准备提示词 (preparePrompts)
 * 2. 填充上下文 (populateChatCompletion)
 * 3. 深度注入 (populateDepthInjections)
 * 4. 聊天历史填充 (populateChatHistory)
 */

import {
  TavernCard,
  TavernMessage,
  TavernPersona,
  TavernWorldInfoEntry,
  getWorldInfos,
  getWorldInfoEntries,
  getWorldInfoByName,
} from '@/db/tavern'
import {
  ChatCompletion,
  ChatMessage,
  DepthInjection,
  createMessage,
  createCollection,
} from './chat-completion'
import { TavernTemplateEngine, parseExampleDialogue } from './template-engine'
import { WorldInfoScanner, WorldInfoScanResult, createTimedEffectsState } from './world-info-scanner'
import {
  getPersonaInjection,
  shouldMergeWithAuthorsNote,
  createPersonaDepthInjection,
} from './persona-injection'
import { PersonaDescriptionPosition } from './persona-types'

// ============ 类型定义 ============

/**
 * AI 消息格式
 */
export interface AIMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
}

/**
 * 简单的 Token 估算器
 * 粗略估算：中文约 2 字/token，英文约 4 字符/token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // 计算中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  // 计算其他字符数
  const otherChars = text.length - chineseChars

  // 中文约 1.5 字/token，英文约 4 字符/token
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 扩展提示词位置类型 (ST 兼容)
 * @see SillyTavern script.js extension_prompt_types
 */
export enum ExtensionPromptPosition {
  /** 无位置 */
  NONE = -1,
  /** 在提示词末尾 (系统提示词区域末尾) */
  IN_PROMPT = 0,
  /** 在聊天历史中 (按深度注入) */
  IN_CHAT = 1,
  /** 在提示词开头 (系统提示词区域开头) */
  BEFORE_PROMPT = 2,
  /** 在提示词之后 (角色信息之后, 聊天历史之前) */
  AFTER_PROMPT = 3,
}

/**
 * 扩展提示词角色类型 (ST 兼容)
 */
export enum ExtensionPromptRole {
  SYSTEM = 0,
  USER = 1,
  ASSISTANT = 2,
}

/**
 * 扩展提示词
 */
export interface ExtensionPrompt {
  identifier: string
  value: string
  /** 位置: 支持字符串 (legacy) 或枚举 */
  position: 'before' | 'after' | 'in_chat' | ExtensionPromptPosition
  /** 深度 (仅 IN_CHAT 位置有效) */
  depth?: number
  /** 同深度时的优先级 (数字越大越靠后) */
  order?: number
  /** 消息角色 */
  role?: 'system' | 'user' | 'assistant' | ExtensionPromptRole
  /** 注入深度 (alias for depth, ST 兼容) */
  injection_depth?: number
  /** 注入顺序 (alias for order, ST 兼容) */
  injection_order?: number
}

/**
 * 上下文构建配置
 */
export interface ContextBuilderV2Config {
  // Token 预算
  maxContext: number
  maxResponse: number
  
  // 功能开关
  includeExamples: boolean
  includeWorldInfo: boolean
  pinExamples: boolean  // 是否固定示例对话 (不受预算限制)
  
  // 群聊设置
  isGroupChat: boolean
  groupMembers?: string[]  // 群聊成员名称列表
  
  // 扩展提示词
  extensionPrompts?: Record<string, ExtensionPrompt>
  
  // 系统提示词覆盖
  systemPromptOverride?: string
  jailbreakOverride?: string
  
  // 调试
  enableLogging?: boolean
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ContextBuilderV2Config = {
  maxContext: 8192,
  maxResponse: 1024,
  includeExamples: true,
  includeWorldInfo: true,
  pinExamples: false,
  isGroupChat: false,
}

/**
 * 解析后的扩展提示词
 */
interface ParsedExtensionPrompt {
  identifier: string
  content: string
  role: 'system' | 'user' | 'assistant'
  depth: number
  order: number
}

/**
 * 提示词集合
 */
interface PromptCollection {
  // 系统提示词
  main: string
  nsfw: string
  jailbreak: string
  
  // 角色信息
  charDescription: string
  charPersonality: string
  scenario: string
  personaDescription: string
  
  // 世界书
  worldInfoBefore: string
  worldInfoAfter: string
  
  // 扩展
  summary?: string
  authorsNote?: string
  vectorsMemory?: string
  
  // 深度注入
  depthPrompts: DepthInjection[]
  
  // 扩展提示词 (按位置分类)
  extensionPrompts: {
    /** 在提示词开头 */
    beforePrompt: ParsedExtensionPrompt[]
    /** 在提示词末尾 */
    inPrompt: ParsedExtensionPrompt[]
    /** 在提示词之后 (角色信息之后, 聊天历史之前) */
    afterPrompt: ParsedExtensionPrompt[]
    /** 在聊天历史中 (深度注入) */
    inChat: ParsedExtensionPrompt[]
  }
}

/**
 * Token 分类统计
 */
export interface TokenBreakdown {
  /** 系统提示词 (Main Prompt) */
  systemPrompt: number
  /** 角色描述 */
  charDescription: number
  /** 角色性格 */
  charPersonality: number
  /** 场景 */
  scenario: number
  /** 用户人设 */
  personaDescription: number
  /** 世界书 (Before) */
  worldInfoBefore: number
  /** 世界书 (After) */
  worldInfoAfter: number
  /** 示例对话 */
  exampleDialogue: number
  /** 聊天历史 */
  chatHistory: number
  /** 作者注释/记忆 */
  authorsNote: number
  /** 深度注入 */
  depthInjections: number
  /** 其他扩展 */
  extensions: number
  /** 总计 */
  total: number
}

/**
 * 构建结果
 */
export interface ContextBuildResultV2 {
  messages: ChatMessage[]
  tokenCount: number
  tokenBreakdown?: TokenBreakdown
  worldInfoResult?: WorldInfoScanResult
}

// ============ Context Builder V2 ============

export class ContextBuilderV2 {
  private card: TavernCard
  private persona: TavernPersona
  private config: ContextBuilderV2Config
  private templateEngine: TavernTemplateEngine
  private worldInfoEntries: TavernWorldInfoEntry[] = []
  private chatCompletion: ChatCompletion
  
  constructor(
    card: TavernCard,
    persona: TavernPersona,
    config: Partial<ContextBuilderV2Config> = {}
  ) {
    this.card = card
    this.persona = persona
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.templateEngine = TavernTemplateEngine.fromCardAndPersona(card, persona)
    this.chatCompletion = new ChatCompletion()
    
    if (this.config.enableLogging) {
      this.chatCompletion.enableLogging()
    }
  }
  
  /**
   * 加载世界书
   * 包括: 全局世界书 + 角色世界书 + Persona 关联世界书
   */
  async loadWorldInfo(): Promise<void> {
    if (!this.config.includeWorldInfo) return
    
    try {
      // 加载全局世界书
      const globalWI = await getWorldInfos('global')
      // 加载角色世界书
      const charWI = await getWorldInfos('character', this.card.id)
      
      for (const wi of [...globalWI, ...charWI]) {
        if (wi.enabled) {
          const entries = await getWorldInfoEntries(wi.id)
          this.worldInfoEntries.push(...entries.filter(e => e.enabled))
        }
      }
      
      // 加载 Persona 关联世界书 (Phase 5.1)
      if (this.persona.lorebook) {
        const personaWI = await getWorldInfoByName(this.persona.lorebook)
        if (personaWI && personaWI.enabled) {
          const entries = await getWorldInfoEntries(personaWI.id)
          this.worldInfoEntries.push(...entries.filter(e => e.enabled))
        }
      }
    } catch (e) {
      console.warn('Failed to load world info:', e)
    }
  }
  
  /**
   * 扫描世界书
   * 包含 Persona 描述参与扫描 (Phase 2.3)
   */
  scanWorldInfo(messages: TavernMessage[], userInput?: string): WorldInfoScanResult {
    if (this.worldInfoEntries.length === 0) {
      return {
        activatedEntries: [],
        contentBefore: '',
        contentAfter: '',
        depthContent: new Map(),
        resolvedContent: new Map(),
        stats: {
          totalScanned: 0,
          totalActivated: 0,
          recursionSteps: 0,
          tokensUsed: 0,
          referencesResolved: 0,
          conditionsChecked: 0,
        },
      }
    }
    
    const scanner = new WorldInfoScanner(
      this.worldInfoEntries,
      { scanDepth: 10 },
      createTimedEffectsState(),
      messages.length
    )
    
    const texts = messages.map(m => m.content)
    if (userInput) texts.push(userInput)
    
    // Persona 描述参与世界书扫描 (Phase 2.3)
    // 根据 ST 的实现，Persona 描述默认参与扫描
    const personaInjection = getPersonaInjection(this.persona)
    if (personaInjection.shouldInject && personaInjection.scanForWorldInfo) {
      texts.push(personaInjection.content)
    }
    
    return scanner.scan(texts, userInput)
  }
  
  /**
   * 解析扩展提示词角色
   */
  private parseExtensionRole(role?: 'system' | 'user' | 'assistant' | ExtensionPromptRole): 'system' | 'user' | 'assistant' {
    if (typeof role === 'number') {
      switch (role) {
        case ExtensionPromptRole.USER: return 'user'
        case ExtensionPromptRole.ASSISTANT: return 'assistant'
        default: return 'system'
      }
    }
    return role || 'system'
  }
  
  /**
   * 解析扩展提示词位置
   */
  private parseExtensionPosition(position: ExtensionPrompt['position']): ExtensionPromptPosition {
    if (typeof position === 'number') {
      return position
    }
    // 字符串转换为枚举 (legacy 支持)
    switch (position) {
      case 'before': return ExtensionPromptPosition.BEFORE_PROMPT
      case 'after': return ExtensionPromptPosition.AFTER_PROMPT
      case 'in_chat': return ExtensionPromptPosition.IN_CHAT
      default: return ExtensionPromptPosition.IN_PROMPT
    }
  }
  
  /**
   * 解析所有扩展提示词到按位置分类的数组
   */
  private parseExtensionPrompts(): PromptCollection['extensionPrompts'] {
    const result: PromptCollection['extensionPrompts'] = {
      beforePrompt: [],
      inPrompt: [],
      afterPrompt: [],
      inChat: [],
    }
    
    const ext = this.config.extensionPrompts || {}
    const knownPrompts = ['1_memory', '2_floating_prompt', '3_vectors']
    
    for (const [key, prompt] of Object.entries(ext)) {
      if (!prompt?.value) continue
      
      const position = this.parseExtensionPosition(prompt.position)
      const role = this.parseExtensionRole(prompt.role)
      const depth = prompt.injection_depth ?? prompt.depth ?? 4
      const order = prompt.injection_order ?? prompt.order ?? 100
      
      const parsed: ParsedExtensionPrompt = {
        identifier: prompt.identifier || key,
        content: prompt.value,
        role,
        depth,
        order,
      }
      
      switch (position) {
        case ExtensionPromptPosition.BEFORE_PROMPT:
          result.beforePrompt.push(parsed)
          break
        case ExtensionPromptPosition.IN_PROMPT:
          // 已知提示词单独处理
          if (!knownPrompts.includes(key)) {
            result.inPrompt.push(parsed)
          }
          break
        case ExtensionPromptPosition.AFTER_PROMPT:
          result.afterPrompt.push(parsed)
          break
        case ExtensionPromptPosition.IN_CHAT:
          result.inChat.push(parsed)
          break
      }
    }
    
    // 按 order 排序 (降序, 大的在前)
    const sortByOrder = (a: ParsedExtensionPrompt, b: ParsedExtensionPrompt) => b.order - a.order
    result.beforePrompt.sort(sortByOrder)
    result.inPrompt.sort(sortByOrder)
    result.afterPrompt.sort(sortByOrder)
    result.inChat.sort((a, b) => {
      // IN_CHAT 先按深度排序 (深度小的在前, 即靠近最新消息)
      if (a.depth !== b.depth) return a.depth - b.depth
      // 同深度按 order 排序 (降序)
      return b.order - a.order
    })
    
    return result
  }
  
  /**
   * 准备提示词集合
   */
  private preparePrompts(worldInfoResult: WorldInfoScanResult): PromptCollection {
    const process = (text: string) => this.templateEngine.process(text || '')
    
    // 解析扩展提示词
    const extensionPrompts = this.parseExtensionPrompts()
    
    // 获取扩展提示词配置
    const ext = this.config.extensionPrompts || {}
    
    // 获取 Persona 注入配置
    const personaInjection = getPersonaInjection(this.persona, {
      authorsNote: ext['2_floating_prompt']?.value,
      hasAuthorsNote: !!ext['2_floating_prompt']?.value,
    })
    
    // 基础提示词 - 根据 Persona 位置动态处理
    const prompts: PromptCollection = {
      main: this.config.systemPromptOverride || process(this.card.systemPrompt || ''),
      nsfw: '',
      jailbreak: this.config.jailbreakOverride || process(this.card.postHistoryInstructions || ''),
      charDescription: process(this.card.description || ''),
      charPersonality: process(this.card.personality || ''),
      scenario: process(this.card.scenario || ''),
      // 只在 IN_PROMPT 位置时才注入到此处
      personaDescription: personaInjection.shouldInject && 
        personaInjection.position === PersonaDescriptionPosition.IN_PROMPT
          ? personaInjection.content
          : '',
      worldInfoBefore: worldInfoResult.contentBefore,
      worldInfoAfter: worldInfoResult.contentAfter,
      depthPrompts: [],
      extensionPrompts,
    }
    
    // 角色深度提示词
    if (this.card.depthPromptText) {
      prompts.depthPrompts.push({
        role: (this.card.depthPromptRole || 'system') as 'system' | 'user' | 'assistant',
        content: process(this.card.depthPromptText),
        depth: this.card.depthPromptDepth ?? 4,
        order: 100,
        identifier: 'charDepthPrompt',
      })
    }
    
    // 世界书深度注入
    for (const [depth, contents] of worldInfoResult.depthContent) {
      const content = contents.join('\n')
      prompts.depthPrompts.push({
        role: 'system',
        content,
        depth,
        order: 50,
        identifier: `worldInfoDepth_${depth}`,
      })
    }
    
    // 扩展提示词 (已知提示词)
    
    // Summary (Memory)
    if (ext['1_memory']?.value) {
      prompts.summary = ext['1_memory'].value
    }
    
    // Author's Note - 考虑 Persona TOP_AN/BOTTOM_AN 合并
    if (ext['2_floating_prompt']?.value) {
      const an = ext['2_floating_prompt']
      const position = this.parseExtensionPosition(an.position)
      
      // 如果 Persona 需要合并到作者注释
      let authorsNoteContent = an.value
      if (personaInjection.shouldInject && shouldMergeWithAuthorsNote(personaInjection.position)) {
        authorsNoteContent = personaInjection.content
      }
      
      if (position === ExtensionPromptPosition.IN_CHAT) {
        prompts.depthPrompts.push({
          role: this.parseExtensionRole(an.role),
          content: authorsNoteContent,
          depth: an.injection_depth ?? an.depth ?? 4,
          order: an.injection_order ?? an.order ?? 100,
          identifier: 'authorsNote',
        })
      } else {
        prompts.authorsNote = authorsNoteContent
      }
    } else if (personaInjection.shouldInject && shouldMergeWithAuthorsNote(personaInjection.position)) {
      // 没有作者注释但 Persona 需要合并位置，直接作为作者注释
      prompts.authorsNote = personaInjection.content
    }
    
    // Vectors Memory
    if (ext['3_vectors']?.value) {
      prompts.vectorsMemory = ext['3_vectors'].value
    }
    
    // 将 IN_CHAT 扩展提示词添加到深度注入列表
    for (const extPrompt of extensionPrompts.inChat) {
      prompts.depthPrompts.push({
        role: extPrompt.role,
        content: extPrompt.content,
        depth: extPrompt.depth,
        order: extPrompt.order,
        identifier: extPrompt.identifier,
      })
    }
    
    // Persona AT_DEPTH 深度注入
    const personaDepthInjection = createPersonaDepthInjection(this.persona)
    if (personaDepthInjection) {
      prompts.depthPrompts.push(personaDepthInjection)
    }
    
    return prompts
  }
  
  /**
   * 填充上下文
   */
  private async populateChatCompletion(
    prompts: PromptCollection,
    messages: TavernMessage[],
    userInput?: string
  ): Promise<void> {
    const cc = this.chatCompletion
    
    // 设置预算
    cc.setTokenBudget(this.config.maxContext, this.config.maxResponse)
    
    // 预留 3 tokens 给 assistant 开头
    cc.reserveBudget(3)
    
    // ========== 0. BEFORE_PROMPT 扩展提示词 (最前面) ==========
    
    for (const extPrompt of prompts.extensionPrompts.beforePrompt) {
      const extCollection = createCollection(extPrompt.identifier, [
        createMessage(extPrompt.role, extPrompt.content, extPrompt.identifier)
      ])
      cc.add(extCollection)
    }
    
    // ========== 1. 系统提示词区域 ==========
    
    // World Info Before
    if (prompts.worldInfoBefore) {
      const wiBeforeCollection = createCollection('worldInfoBefore', [
        createMessage('system', `[世界设定]\n${prompts.worldInfoBefore}`, 'worldInfoBefore')
      ])
      cc.add(wiBeforeCollection)
    }
    
    // Main System Prompt
    if (prompts.main) {
      const mainCollection = createCollection('main', [
        createMessage('system', prompts.main, 'main')
      ])
      cc.add(mainCollection)
    }
    
    // World Info After
    if (prompts.worldInfoAfter) {
      const wiAfterCollection = createCollection('worldInfoAfter', [
        createMessage('system', `[补充设定]\n${prompts.worldInfoAfter}`, 'worldInfoAfter')
      ])
      cc.add(wiAfterCollection)
    }
    
    // Character Description
    if (prompts.charDescription) {
      const descCollection = createCollection('charDescription', [
        createMessage('system', `[角色描述]\n${prompts.charDescription}`, 'charDescription')
      ])
      cc.add(descCollection)
    }
    
    // Character Personality
    if (prompts.charPersonality) {
      const persCollection = createCollection('charPersonality', [
        createMessage('system', `[性格]\n${prompts.charPersonality}`, 'charPersonality')
      ])
      cc.add(persCollection)
    }
    
    // Scenario
    if (prompts.scenario) {
      const scenarioCollection = createCollection('scenario', [
        createMessage('system', `[场景]\n${prompts.scenario}`, 'scenario')
      ])
      cc.add(scenarioCollection)
    }
    
    // Persona Description
    if (prompts.personaDescription) {
      const personaCollection = createCollection('personaDescription', [
        createMessage('system', `[用户设定]\n${prompts.personaDescription}`, 'personaDescription')
      ])
      cc.add(personaCollection)
    }
    
    // ========== 2. IN_PROMPT 扩展提示词 (提示词区域末尾) ==========
    
    for (const extPrompt of prompts.extensionPrompts.inPrompt) {
      const extCollection = createCollection(extPrompt.identifier, [
        createMessage(extPrompt.role, extPrompt.content, extPrompt.identifier)
      ])
      cc.add(extCollection)
    }
    
    // ========== 3. 已知扩展提示词 ==========
    
    // Summary (Memory) - 通常在角色信息之后
    if (prompts.summary) {
      const summaryCollection = createCollection('summary', [
        createMessage('system', `[摘要]\n${prompts.summary}`, 'summary')
      ])
      cc.add(summaryCollection)
    }
    
    // Vectors Memory
    if (prompts.vectorsMemory) {
      const vectorsCollection = createCollection('vectorsMemory', [
        createMessage('system', `[相关记忆]\n${prompts.vectorsMemory}`, 'vectorsMemory')
      ])
      cc.add(vectorsCollection)
    }
    
    // Author's Note (非深度注入的)
    if (prompts.authorsNote) {
      const anCollection = createCollection('authorsNote', [
        createMessage('system', prompts.authorsNote, 'authorsNote')
      ])
      cc.add(anCollection)
    }
    
    // ========== 4. 对话示例 ==========
    
    if (this.config.includeExamples && this.card.mesExample) {
      await this.populateDialogueExamples()
    }
    
    // ========== 5. AFTER_PROMPT 扩展提示词 (角色信息之后, 聊天历史之前) ==========
    
    for (const extPrompt of prompts.extensionPrompts.afterPrompt) {
      const extCollection = createCollection(extPrompt.identifier, [
        createMessage(extPrompt.role, extPrompt.content, extPrompt.identifier)
      ])
      cc.add(extCollection)
    }
    
    // ========== 6. 聊天历史 ==========
    
    await this.populateChatHistory(messages, userInput)
    
    // ========== 7. 深度注入 (IN_CHAT 已在 preparePrompts 中处理) ==========
    
    for (const injection of prompts.depthPrompts) {
      cc.addDepthInjection(injection)
    }
    
    // ========== 8. Jailbreak (历史后指令) ==========
    
    if (prompts.jailbreak) {
      const jbCollection = createCollection('jailbreak', [
        createMessage('system', prompts.jailbreak, 'jailbreak')
      ])
      cc.add(jbCollection)
    }
  }
  
  /**
   * 填充对话示例
   */
  private async populateDialogueExamples(): Promise<void> {
    if (!this.card.mesExample) return
    
    const examples = parseExampleDialogue(
      this.card.mesExample,
      this.card.name,
      this.persona.name
    )
    
    if (examples.length === 0) return
    
    const examplesCollection = createCollection('dialogueExamples')
    
    // 添加示例开始标记
    examplesCollection.add(createMessage('system', '[对话示例]', 'exampleStart'))
    
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i]
      const msg = createMessage(
        ex.role as 'user' | 'assistant',
        this.templateEngine.process(ex.content),
        `example_${i}`,
        ex.role === 'assistant' ? this.card.name : this.persona.name
      )
      
      // 如果固定示例，不检查预算
      if (this.config.pinExamples || this.chatCompletion.canAfford(msg)) {
        examplesCollection.add(msg)
      }
    }
    
    this.chatCompletion.add(examplesCollection)
  }
  
  /**
   * 填充聊天历史
   */
  private async populateChatHistory(
    messages: TavernMessage[],
    userInput?: string
  ): Promise<void> {
    const cc = this.chatCompletion
    const historyCollection = createCollection('chatHistory')
    
    // 添加新聊天标记
    const newChatMsg = createMessage(
      'system',
      this.config.isGroupChat
        ? `[开始新的群聊。群成员: ${this.config.groupMembers?.join(', ') || this.card.name}]`
        : '[开始新聊天]',
      'newChat'
    )
    cc.reserveBudget(newChatMsg)
    
    // 群聊提示
    let groupNudgeMsg: ChatMessage | null = null
    if (this.config.isGroupChat) {
      groupNudgeMsg = createMessage(
        'system',
        `[仅以 ${this.card.name} 的身份回复。]`,
        'groupNudge'
      )
      cc.reserveBudget(groupNudgeMsg)
    }
    
    // 如果没有历史消息，添加首条消息
    if (messages.length === 0 && this.card.firstMes) {
      const firstMsg = createMessage(
        'assistant',
        this.templateEngine.process(this.card.firstMes),
        'firstMessage',
        this.card.name
      )
      if (cc.canAfford(firstMsg)) {
        historyCollection.add(firstMsg)
      }
    }
    
    // 从最新到最旧遍历，添加能负担的消息
    const historyMessages: ChatMessage[] = []
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.isHidden) continue
      
      const chatMsg = createMessage(
        msg.role as 'user' | 'assistant',
        msg.content,
        `chat_${i}`,
        msg.name
      )
      
      if (!cc.canAfford(chatMsg)) break
      
      historyMessages.unshift(chatMsg)
      cc.reserveBudget(chatMsg)
    }
    
    // 添加历史消息
    for (const msg of historyMessages) {
      historyCollection.add(msg)
    }
    
    // 添加当前用户输入
    if (userInput) {
      const userMsg = createMessage('user', userInput, 'userInput', this.persona.name)
      if (cc.canAfford(userMsg)) {
        historyCollection.add(userMsg)
      }
    }
    
    // 释放并插入新聊天标记
    cc.freeBudget(newChatMsg)
    historyCollection.collection.unshift(newChatMsg)
    
    // 释放并插入群聊提示
    if (groupNudgeMsg) {
      cc.freeBudget(groupNudgeMsg)
      historyCollection.add(groupNudgeMsg)
    }
    
    cc.add(historyCollection)
  }
  
  /**
   * 计算 Token 分类统计
   */
  private calculateTokenBreakdown(prompts: PromptCollection): TokenBreakdown {
    const breakdown: TokenBreakdown = {
      systemPrompt: estimateTokens(prompts.main) + estimateTokens(prompts.nsfw) + estimateTokens(prompts.jailbreak),
      charDescription: estimateTokens(prompts.charDescription),
      charPersonality: estimateTokens(prompts.charPersonality),
      scenario: estimateTokens(prompts.scenario),
      personaDescription: estimateTokens(prompts.personaDescription),
      worldInfoBefore: estimateTokens(prompts.worldInfoBefore),
      worldInfoAfter: estimateTokens(prompts.worldInfoAfter),
      exampleDialogue: 0,  // 在 populateExamples 中计算
      chatHistory: 0,      // 在 populateChatHistory 中计算
      authorsNote: estimateTokens(prompts.authorsNote || '') + estimateTokens(prompts.summary || ''),
      depthInjections: prompts.depthPrompts.reduce((sum, dp) => sum + estimateTokens(dp.content), 0),
      extensions: [
        ...prompts.extensionPrompts.beforePrompt,
        ...prompts.extensionPrompts.inPrompt,
        ...prompts.extensionPrompts.afterPrompt,
        ...prompts.extensionPrompts.inChat,
      ].reduce((sum, ep) => sum + estimateTokens(ep.content), 0) + estimateTokens(prompts.vectorsMemory || ''),
      total: 0,
    }
    
    // 计算总计 (不包含 chatHistory 和 exampleDialogue，这两个在后续步骤更新)
    breakdown.total = Object.values(breakdown).reduce((sum, val) => sum + val, 0)
    
    return breakdown
  }
  
  /**
   * 构建上下文
   */
  async build(
    messages: TavernMessage[],
    userInput?: string
  ): Promise<ContextBuildResultV2> {
    // 1. 加载世界书
    await this.loadWorldInfo()
    
    // 2. 扫描世界书
    const worldInfoResult = this.scanWorldInfo(messages, userInput)
    
    // 3. 准备提示词
    const prompts = this.preparePrompts(worldInfoResult)
    
    // 4. 计算 Token 分类
    const tokenBreakdown = this.calculateTokenBreakdown(prompts)
    
    // 5. 填充上下文
    await this.populateChatCompletion(prompts, messages, userInput)
    
    // 6. 更新聊天历史和示例对话的 Token 统计
    const finalMessages = this.chatCompletion.getChat()
    
    // 计算聊天历史 Token
    let chatHistoryTokens = 0
    let exampleTokens = 0
    for (const msg of finalMessages) {
      const tokens = estimateTokens(msg.content)
      if (msg.identifier?.startsWith('chat_') || msg.identifier === 'userInput' || msg.identifier === 'firstMessage') {
        chatHistoryTokens += tokens
      } else if (msg.identifier?.startsWith('example_')) {
        exampleTokens += tokens
      }
    }
    tokenBreakdown.chatHistory = chatHistoryTokens
    tokenBreakdown.exampleDialogue = exampleTokens
    
    // 重新计算总计
    tokenBreakdown.total = this.chatCompletion.getTotalTokens()
    
    return {
      messages: finalMessages,
      tokenCount: tokenBreakdown.total,
      tokenBreakdown,
      worldInfoResult,
    }
  }
}

// ============ 快捷函数 ============

/**
 * 快速构建上下文
 */
export async function buildContextV2(
  card: TavernCard,
  persona: TavernPersona,
  messages: TavernMessage[],
  userInput?: string,
  config?: Partial<ContextBuilderV2Config>
): Promise<ContextBuildResultV2> {
  const builder = new ContextBuilderV2(card, persona, config)
  return builder.build(messages, userInput)
}
