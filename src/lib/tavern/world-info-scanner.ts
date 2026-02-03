/**
 * World Info 高级扫描器
 * 支持递归扫描、定时效果、分组评分等高级功能
 * 
 * 复刻 SillyTavern world-info.js 核心功能
 */

import { TavernWorldInfoEntry } from '@/db/tavern'
import {
  createReferenceContext,
  resolveReferences,
  hasReferences,
  ReferenceContext,
} from './wi-references'

// ============ 类型定义 ============

/**
 * 选择性逻辑类型
 */
export enum SelectiveLogic {
  /** AND ALL - 所有次要关键词都匹配 */
  AND_ALL = 0,
  /** NOT ALL - 不是所有次要关键词都匹配 */
  NOT_ALL = 1,
  /** NOT ANY - 没有任何次要关键词匹配 */
  NOT_ANY = 2,
  /** AND ANY - 至少一个次要关键词匹配 */
  AND_ANY = 3,
}

/**
 * 扫描状态
 */
export enum ScanState {
  /** 停止扫描 */
  NONE = 0,
  /** 初始扫描 */
  INITIAL = 1,
  /** 递归扫描 */
  RECURSION = 2,
  /** 最小激活数扫描 */
  MIN_ACTIVATIONS = 3,
}

/**
 * 已知装饰器
 */
export const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'] as const
export type DecoratorType = typeof KNOWN_DECORATORS[number]

/**
 * 定时效果类型
 */
export type TimedEffectType = 'sticky' | 'cooldown' | 'delay'

/**
 * 定时效果
 */
export interface TimedEffect {
  /** 条目哈希 */
  hash: number
  /** 效果开始的聊天索引 */
  start: number
  /** 效果结束的聊天索引 */
  end: number
  /** 是否受保护（聊天未推进时不能移除） */
  protected: boolean
}

/**
 * 定时效果状态
 */
export interface TimedEffectsState {
  sticky: Record<string, TimedEffect>
  cooldown: Record<string, TimedEffect>
  delay: Record<string, TimedEffect>
}

/**
 * 全局扫描数据 (聊天无关的上下文)
 */
export interface GlobalScanData {
  /** 用户人设描述 */
  personaDescription?: string
  /** 角色描述 */
  characterDescription?: string
  /** 角色性格 */
  characterPersonality?: string
  /** 角色深度提示词 */
  characterDepthPrompt?: string
  /** 场景 */
  scenario?: string
  /** 创作者注释 */
  creatorNotes?: string
}

/**
 * 条件激活类型
 */
export type ConditionOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'regex'

/**
 * 条件激活规则
 */
export interface ActivationCondition {
  /** 变量名 */
  variable: string
  /** 比较操作符 */
  operator: ConditionOperator
  /** 期望值 */
  value: string
  /** 是否取反 */
  negate?: boolean
}

/**
 * 条件组
 */
export interface ConditionGroup {
  /** 组内条件逻辑: and = 所有条件都匹配, or = 任一条件匹配 */
  logic: 'and' | 'or'
  /** 条件列表 */
  conditions: ActivationCondition[]
}

/**
 * 扫描配置
 */
export interface WorldInfoScanConfig {
  /** 扫描深度（检查最近N条消息） */
  scanDepth: number
  /** 是否启用递归扫描 */
  recursive: boolean
  /** 最大递归步数 */
  maxRecursionSteps: number
  /** 最小激活数 */
  minActivations: number
  /** 最小激活数最大深度 */
  minActivationsDepthMax: number
  /** 是否大小写敏感 */
  caseSensitive: boolean
  /** 是否全词匹配 */
  matchWholeWords: boolean
  /** 是否使用分组评分 */
  useGroupScoring: boolean
  /** Token 预算 */
  budgetTokens: number
  /** Token 预算上限 */
  budgetCap: number
  /** 是否启用引用解析 */
  resolveReferences: boolean
  /** 是否启用条件激活 */
  useConditions: boolean
  
  // 全局扫描字段开关
  /** 扫描用户人设描述 */
  matchPersonaDescription?: boolean
  /** 扫描角色描述 */
  matchCharacterDescription?: boolean
  /** 扫描角色性格 */
  matchCharacterPersonality?: boolean
  /** 扫描角色深度提示词 */
  matchCharacterDepthPrompt?: boolean
  /** 扫描场景 */
  matchScenario?: boolean
  /** 扫描创作者注释 */
  matchCreatorNotes?: boolean
}

/**
 * 默认扫描配置
 */
export const DEFAULT_SCAN_CONFIG: WorldInfoScanConfig = {
  scanDepth: 4,
  recursive: false,
  maxRecursionSteps: 3,
  minActivations: 0,
  minActivationsDepthMax: 50,
  caseSensitive: false,
  matchWholeWords: false,
  useGroupScoring: false,
  budgetTokens: 2048,
  budgetCap: 0,
  resolveReferences: true,
  useConditions: true,
}

/**
 * 扫描结果
 */
export interface WorldInfoScanResult {
  /** 激活的条目 */
  activatedEntries: TavernWorldInfoEntry[]
  /** 按位置分组的内容 */
  contentBefore: string
  contentAfter: string
  /** 深度注入内容 */
  depthContent: Map<number, string[]>
  /** 解析后的内容（包含引用解析） */
  resolvedContent: Map<number, string>
  /** 扫描统计 */
  stats: {
    totalScanned: number
    totalActivated: number
    recursionSteps: number
    tokensUsed: number
    referencesResolved: number
    conditionsChecked: number
  }
}

// ============ World Info Scanner 类 ============

/**
 * World Info 扫描器
 */
export class WorldInfoScanner {
  private entries: TavernWorldInfoEntry[]
  private config: WorldInfoScanConfig
  private timedEffects: TimedEffectsState
  private chatLength: number
  private globalScanData: GlobalScanData
  private variables: Record<string, string>
  private referenceContext: ReferenceContext | null = null
  
  constructor(
    entries: TavernWorldInfoEntry[],
    config: Partial<WorldInfoScanConfig> = {},
    timedEffects?: TimedEffectsState,
    chatLength: number = 0,
    globalScanData: GlobalScanData = {},
    variables: Record<string, string> = {}
  ) {
    this.entries = entries.filter(e => e.enabled)
    this.config = { ...DEFAULT_SCAN_CONFIG, ...config }
    this.timedEffects = timedEffects || { sticky: {}, cooldown: {}, delay: {} }
    this.chatLength = chatLength
    this.globalScanData = globalScanData
    this.variables = variables
    
    // 初始化引用上下文
    if (this.config.resolveReferences) {
      this.referenceContext = createReferenceContext(entries, variables)
    }
  }
  
  /**
   * 执行扫描
   */
  scan(messages: string[], userInput?: string): WorldInfoScanResult {
    const result: WorldInfoScanResult = {
      activatedEntries: [],
      contentBefore: '',
      contentAfter: '',
      depthContent: new Map(),
      resolvedContent: new Map(),
      stats: {
        totalScanned: this.entries.length,
        totalActivated: 0,
        recursionSteps: 0,
        tokensUsed: 0,
        referencesResolved: 0,
        conditionsChecked: 0,
      },
    }
    
    // 已激活的条目 ID 集合
    const activatedIds = new Set<number>()
    
    // 递归扫描缓冲区
    let recurseBuffer = ''
    
    // 初始扫描
    let currentScanState = ScanState.INITIAL
    let recursionStep = 0
    
    // 最小激活数深度偏移 (用于深度递增扫描)
    let depthSkew = 0
    const startDepth = this.config.scanDepth
    
    while (currentScanState !== ScanState.NONE) {
      // 构建扫描文本 (考虑深度偏移)
      const effectiveDepth = startDepth + depthSkew
      const scanText = this.buildScanTextWithDepth(messages, userInput, effectiveDepth)
      const fullScanText = scanText + recurseBuffer
      const newlyActivated: TavernWorldInfoEntry[] = []
      
      for (const entry of this.entries) {
        // 跳过已激活的
        if (activatedIds.has(entry.id)) continue
        
        // 检查定时效果
        if (!this.checkTimedEffects(entry)) continue
        
        // 检查递归排除
        if (currentScanState === ScanState.RECURSION && entry.excludeRecursion) continue
        
        // 检查延迟递归
        if (currentScanState === ScanState.INITIAL && entry.delayUntilRecursion) continue
        
        // 检查条件激活
        if (this.config.useConditions && !this.checkActivationConditions(entry, result)) {
          continue
        }
        
        // 执行匹配
        if (this.matchEntry(entry, fullScanText)) {
          newlyActivated.push(entry)
          activatedIds.add(entry.id)
        }
      }
      
      // 应用分组评分
      const finalActivated = this.config.useGroupScoring
        ? this.applyGroupScoring(newlyActivated)
        : newlyActivated
      
      result.activatedEntries.push(...finalActivated)
      
      // 更新递归缓冲区
      if (this.config.recursive && finalActivated.length > 0) {
        for (const entry of finalActivated) {
          if (!entry.preventRecursion) {
            recurseBuffer += '\n' + entry.content
          }
        }
      }
      
      // 决定下一步
      recursionStep++
      result.stats.recursionSteps = recursionStep
      
      if (!this.config.recursive || recursionStep >= this.config.maxRecursionSteps) {
        // 检查最小激活数
        if (this.shouldContinueMinActivations(result, depthSkew, messages.length)) {
          depthSkew++
          currentScanState = ScanState.MIN_ACTIVATIONS
          continue
        }
        currentScanState = ScanState.NONE
      } else if (finalActivated.length > 0) {
        currentScanState = ScanState.RECURSION
      } else {
        // 检查最小激活数
        if (this.shouldContinueMinActivations(result, depthSkew, messages.length)) {
          depthSkew++
          currentScanState = ScanState.MIN_ACTIVATIONS
          continue
        }
        currentScanState = ScanState.NONE
      }
    }
    
    // 处理激活的条目
    this.processActivatedEntries(result)
    
    // 更新定时效果
    this.updateTimedEffects(result.activatedEntries)
    
    result.stats.totalActivated = result.activatedEntries.length
    
    return result
  }
  
  /**
   * 检查条件激活
   */
  private checkActivationConditions(
    entry: TavernWorldInfoEntry,
    result: WorldInfoScanResult
  ): boolean {
    // 从 automationId 或 extensions 字段解析条件
    const conditions = this.parseEntryConditions(entry)
    if (!conditions || conditions.conditions.length === 0) {
      return true // 无条件，通过
    }
    
    result.stats.conditionsChecked++
    
    const results = conditions.conditions.map(cond => 
      this.evaluateCondition(cond)
    )
    
    if (conditions.logic === 'and') {
      return results.every(r => r)
    } else {
      return results.some(r => r)
    }
  }
  
  /**
   * 解析条目的条件配置
   */
  private parseEntryConditions(entry: TavernWorldInfoEntry): ConditionGroup | null {
    // 尝试从 automationId 解析 (ST 兼容格式)
    // 格式: "condition:varname:operator:value" 或 JSON
    if (entry.automationId) {
      try {
        // 尝试 JSON 格式
        const parsed = JSON.parse(entry.automationId)
        if (parsed.conditions) {
          return parsed as ConditionGroup
        }
      } catch {
        // 尝试简单格式: "condition:varname:operator:value"
        const match = entry.automationId.match(/^condition:([^:]+):([^:]+):(.+)$/)
        if (match) {
          return {
            logic: 'and',
            conditions: [{
              variable: match[1],
              operator: match[2] as ConditionOperator,
              value: match[3],
            }],
          }
        }
      }
    }
    
    return null
  }
  
  /**
   * 评估单个条件
   */
  private evaluateCondition(cond: ActivationCondition): boolean {
    const actualValue = this.variables[cond.variable] ?? ''
    const expectedValue = cond.value
    
    let result: boolean
    
    switch (cond.operator) {
      case 'eq':
        result = actualValue === expectedValue
        break
      case 'neq':
        result = actualValue !== expectedValue
        break
      case 'gt':
        result = parseFloat(actualValue) > parseFloat(expectedValue)
        break
      case 'lt':
        result = parseFloat(actualValue) < parseFloat(expectedValue)
        break
      case 'gte':
        result = parseFloat(actualValue) >= parseFloat(expectedValue)
        break
      case 'lte':
        result = parseFloat(actualValue) <= parseFloat(expectedValue)
        break
      case 'contains':
        result = actualValue.includes(expectedValue)
        break
      case 'regex':
        try {
          result = new RegExp(expectedValue).test(actualValue)
        } catch {
          result = false
        }
        break
      default:
        result = actualValue === expectedValue
    }
    
    return cond.negate ? !result : result
  }
  
  /**
   * 检查是否应继续最小激活数扫描
   */
  private shouldContinueMinActivations(
    result: WorldInfoScanResult,
    depthSkew: number,
    totalMessages: number
  ): boolean {
    // 没有设置最小激活数
    if (this.config.minActivations <= 0) return false
    
    // 已达到最小激活数
    if (result.activatedEntries.length >= this.config.minActivations) return false
    
    // 已达到最大深度
    const maxDepth = Math.min(
      this.config.minActivationsDepthMax,
      totalMessages
    )
    if (this.config.scanDepth + depthSkew >= maxDepth) return false
    
    return true
  }
  
  /**
   * 构建扫描文本
   */
  private buildScanText(messages: string[], userInput?: string): string {
    return this.buildScanTextWithDepth(messages, userInput, this.config.scanDepth)
  }
  
  /**
   * 构建扫描文本 (指定深度)
   */
  private buildScanTextWithDepth(messages: string[], userInput?: string, depth?: number): string {
    const effectiveDepth = Math.min(depth ?? this.config.scanDepth, messages.length)
    const recentMessages = messages.slice(-effectiveDepth)
    
    let text = recentMessages.join('\n')
    if (userInput) {
      text += '\n' + userInput
    }
    
    // 添加全局扫描数据
    text += this.buildGlobalScanText()
    
    return text
  }
  
  /**
   * 构建全局扫描文本 (聊天无关的上下文)
   */
  private buildGlobalScanText(): string {
    const parts: string[] = []
    
    if (this.config.matchPersonaDescription && this.globalScanData.personaDescription) {
      parts.push(this.globalScanData.personaDescription)
    }
    
    if (this.config.matchCharacterDescription && this.globalScanData.characterDescription) {
      parts.push(this.globalScanData.characterDescription)
    }
    
    if (this.config.matchCharacterPersonality && this.globalScanData.characterPersonality) {
      parts.push(this.globalScanData.characterPersonality)
    }
    
    if (this.config.matchCharacterDepthPrompt && this.globalScanData.characterDepthPrompt) {
      parts.push(this.globalScanData.characterDepthPrompt)
    }
    
    if (this.config.matchScenario && this.globalScanData.scenario) {
      parts.push(this.globalScanData.scenario)
    }
    
    if (this.config.matchCreatorNotes && this.globalScanData.creatorNotes) {
      parts.push(this.globalScanData.creatorNotes)
    }
    
    return parts.length > 0 ? '\n' + parts.join('\n') : ''
  }
  
  /**
   * 检查定时效果
   */
  private checkTimedEffects(entry: TavernWorldInfoEntry): boolean {
    const entryKey = this.getEntryKey(entry)
    
    // 检查 Sticky（粘性）- 如果在粘性期间，强制激活
    const stickyEffect = this.timedEffects.sticky[entryKey]
    if (stickyEffect && this.isEffectActive(stickyEffect)) {
      return true // 强制激活
    }
    
    // 检查 Cooldown（冷却）- 如果在冷却期间，跳过
    const cooldownEffect = this.timedEffects.cooldown[entryKey]
    if (cooldownEffect && this.isEffectActive(cooldownEffect)) {
      return false // 跳过
    }
    
    // 检查 Delay（延迟）- 如果延迟未结束，跳过
    const delayEffect = this.timedEffects.delay[entryKey]
    if (delayEffect && this.isEffectActive(delayEffect)) {
      return false // 跳过
    }
    
    return true
  }
  
  /**
   * 检查效果是否激活
   */
  private isEffectActive(effect: TimedEffect): boolean {
    return this.chatLength >= effect.start && this.chatLength < effect.end
  }
  
  /**
   * 解析内容中的装饰器
   */
  private parseDecorators(content: string): DecoratorType[] {
    const decorators: DecoratorType[] = []
    for (const decorator of KNOWN_DECORATORS) {
      if (content.includes(decorator)) {
        decorators.push(decorator)
      }
    }
    return decorators
  }
  
  /**
   * 检查装饰器状态
   * @returns 'activate' = 强制激活, 'skip' = 跳过, 'continue' = 继续检查
   */
  private checkDecorators(entry: TavernWorldInfoEntry): 'activate' | 'skip' | 'continue' {
    const decorators = this.parseDecorators(entry.content || '')
    
    // @@activate 强制激活
    if (decorators.includes('@@activate')) {
      return 'activate'
    }
    
    // @@dont_activate 跳过
    if (decorators.includes('@@dont_activate')) {
      return 'skip'
    }
    
    return 'continue'
  }
  
  /**
   * 匹配条目
   */
  private matchEntry(entry: TavernWorldInfoEntry, text: string): boolean {
    // 检查装饰器
    const decoratorResult = this.checkDecorators(entry)
    if (decoratorResult === 'activate') return true
    if (decoratorResult === 'skip') return false
    
    // 常驻激活
    if (entry.constant) return true
    
    // 解析关键词
    const keys: string[] = this.parseKeys(entry.keys)
    if (keys.length === 0) return false
    
    // 检查主关键词
    const caseSensitive = entry.caseSensitive ?? this.config.caseSensitive
    const matchWholeWords = entry.matchWholeWords ?? this.config.matchWholeWords
    
    const primaryMatched = this.matchKeys(keys, text, caseSensitive, matchWholeWords, entry.useRegex)
    if (!primaryMatched) return false
    
    // 选择性激活
    if (entry.selective) {
      const secondaryKeys: string[] = this.parseKeys(entry.secondaryKeys)
      if (secondaryKeys.length > 0) {
        const secondaryMatched = this.checkSelectiveLogic(
          secondaryKeys,
          entry.selectiveLogic as SelectiveLogic,
          text,
          caseSensitive,
          matchWholeWords,
          entry.useRegex
        )
        if (!secondaryMatched) return false
      }
    }
    
    // 概率检查
    if (entry.useProbability && entry.probability < 100) {
      if (Math.random() * 100 > entry.probability) return false
    }
    
    return true
  }
  
  /**
   * 解析关键词
   */
  private parseKeys(keysJson: string): string[] {
    try {
      const keys = JSON.parse(keysJson || '[]')
      return Array.isArray(keys) ? keys.filter(k => k && typeof k === 'string') : []
    } catch {
      return []
    }
  }
  
  /**
   * 匹配关键词
   */
  private matchKeys(
    keys: string[],
    text: string,
    caseSensitive: boolean,
    matchWholeWords: boolean,
    useRegex: boolean
  ): boolean {
    const searchText = caseSensitive ? text : text.toLowerCase()
    
    return keys.some(key => {
      const searchKey = caseSensitive ? key : key.toLowerCase()
      
      if (useRegex) {
        try {
          const regex = new RegExp(searchKey, caseSensitive ? '' : 'i')
          return regex.test(text)
        } catch {
          return false
        }
      }
      
      if (matchWholeWords) {
        const regex = new RegExp(`\\b${escapeRegex(searchKey)}\\b`, caseSensitive ? '' : 'i')
        return regex.test(text)
      }
      
      return searchText.includes(searchKey)
    })
  }
  
  /**
   * 检查选择性逻辑
   */
  private checkSelectiveLogic(
    keys: string[],
    logic: SelectiveLogic,
    text: string,
    caseSensitive: boolean,
    matchWholeWords: boolean,
    useRegex: boolean
  ): boolean {
    const matches = keys.map(key => 
      this.matchKeys([key], text, caseSensitive, matchWholeWords, useRegex)
    )
    
    switch (logic) {
      case SelectiveLogic.AND_ALL:
        return matches.every(m => m)
      case SelectiveLogic.NOT_ALL:
        return !matches.every(m => m)
      case SelectiveLogic.NOT_ANY:
        return !matches.some(m => m)
      case SelectiveLogic.AND_ANY:
        return matches.some(m => m)
      default:
        return matches.some(m => m)
    }
  }
  
  /**
   * 应用分组评分
   */
  private applyGroupScoring(entries: TavernWorldInfoEntry[]): TavernWorldInfoEntry[] {
    // 按分组分类
    const groups = new Map<string, TavernWorldInfoEntry[]>()
    const ungrouped: TavernWorldInfoEntry[] = []
    
    for (const entry of entries) {
      if (entry.group) {
        const group = groups.get(entry.group) || []
        group.push(entry)
        groups.set(entry.group, group)
      } else {
        ungrouped.push(entry)
      }
    }
    
    // 对每个分组选择最高权重的条目
    const result: TavernWorldInfoEntry[] = [...ungrouped]
    
    for (const groupEntries of groups.values()) {
      if (groupEntries.length === 1) {
        result.push(groupEntries[0])
      } else {
        // 按权重排序，选择最高的
        // 如果有 groupOverride，则该条目优先
        const overrideEntry = groupEntries.find(e => e.groupOverride)
        if (overrideEntry) {
          result.push(overrideEntry)
        } else {
          // 按权重选择
          const sorted = groupEntries.sort((a, b) => (b.groupWeight || 0) - (a.groupWeight || 0))
          result.push(sorted[0])
        }
      }
    }
    
    return result
  }
  
  /**
   * 处理激活的条目
   */
  private processActivatedEntries(result: WorldInfoScanResult): void {
    // 按 order 排序
    result.activatedEntries.sort((a, b) => a.order - b.order)
    
    // 按位置分组
    const beforeContent: string[] = []
    const afterContent: string[] = []
    
    for (const entry of result.activatedEntries) {
      let content = entry.content.trim()
      if (!content) continue
      
      // 解析引用
      if (this.config.resolveReferences && this.referenceContext && hasReferences(content)) {
        const resolved = resolveReferences(content, {
          ...this.referenceContext,
          visited: new Set(),
        })
        content = resolved.content
        result.stats.referencesResolved += resolved.totalReferences
        result.resolvedContent.set(entry.id, content)
      }
      
      // position: 0 = before char, 1 = after char, 4 = at depth
      if (entry.position === 4 && entry.depth !== undefined) {
        // 深度注入
        const depthEntries = result.depthContent.get(entry.depth) || []
        depthEntries.push(content)
        result.depthContent.set(entry.depth, depthEntries)
      } else if (entry.position === 0) {
        beforeContent.push(content)
      } else {
        afterContent.push(content)
      }
      
      // 估算 token
      result.stats.tokensUsed += this.estimateTokens(content)
    }
    
    result.contentBefore = beforeContent.join('\n\n')
    result.contentAfter = afterContent.join('\n\n')
  }
  
  /**
   * 更新定时效果
   */
  private updateTimedEffects(activatedEntries: TavernWorldInfoEntry[]): void {
    for (const entry of activatedEntries) {
      const entryKey = this.getEntryKey(entry)
      
      // 设置 Sticky
      if (entry.sticky && entry.sticky > 0) {
        if (!this.timedEffects.sticky[entryKey]) {
          this.timedEffects.sticky[entryKey] = {
            hash: this.getEntryHash(entry),
            start: this.chatLength,
            end: this.chatLength + entry.sticky,
            protected: false,
          }
        }
      }
      
      // 设置 Cooldown（在效果结束后开始）
      if (entry.cooldown && entry.cooldown > 0) {
        const stickyEnd = entry.sticky ? this.chatLength + entry.sticky : this.chatLength
        this.timedEffects.cooldown[entryKey] = {
          hash: this.getEntryHash(entry),
          start: stickyEnd,
          end: stickyEnd + entry.cooldown,
          protected: false,
        }
      }
    }
  }
  
  /**
   * 获取条目键
   */
  private getEntryKey(entry: TavernWorldInfoEntry): string {
    return `${entry.worldInfoId}_${entry.uid}`
  }
  
  /**
   * 获取条目哈希
   */
  private getEntryHash(entry: TavernWorldInfoEntry): number {
    const str = `${entry.worldInfoId}_${entry.uid}_${entry.keys}`
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return hash
  }
  
  /**
   * 估算 token 数
   */
  private estimateTokens(text: string): number {
    if (!text) return 0
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const otherChars = text.length - chineseChars
    return Math.ceil(chineseChars / 1.5 + otherChars / 4)
  }
  
  /**
   * 获取定时效果状态
   */
  getTimedEffects(): TimedEffectsState {
    return this.timedEffects
  }
  
  /**
   * 清理过期的定时效果
   */
  cleanupTimedEffects(): void {
    for (const type of ['sticky', 'cooldown', 'delay'] as TimedEffectType[]) {
      const effects = this.timedEffects[type]
      for (const key of Object.keys(effects)) {
        if (effects[key].end <= this.chatLength) {
          delete effects[key]
        }
      }
    }
  }
}

// ============ 工具函数 ============

/**
 * 转义正则表达式特殊字符
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 创建默认定时效果状态
 */
export function createTimedEffectsState(): TimedEffectsState {
  return {
    sticky: {},
    cooldown: {},
    delay: {},
  }
}

/**
 * 序列化定时效果状态
 */
export function serializeTimedEffects(state: TimedEffectsState): string {
  return JSON.stringify(state)
}

/**
 * 反序列化定时效果状态
 */
export function deserializeTimedEffects(json: string): TimedEffectsState {
  try {
    return JSON.parse(json)
  } catch {
    return createTimedEffectsState()
  }
}
