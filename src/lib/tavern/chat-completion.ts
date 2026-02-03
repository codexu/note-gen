/**
 * ChatCompletion - ST 风格的上下文管理类
 * 
 * 核心功能:
 * - Token 预算管理 (精确预留/释放)
 * - 消息集合管理
 * - 深度注入支持
 * - 预算预留/释放追踪
 * 
 * 参考: SillyTavern PromptManager.js
 */

import { estimateTokens } from './context-builder-v2'

// ============ 预算追踪 ============

/**
 * 预算预留记录
 */
interface BudgetReservation {
  identifier: string
  tokens: number
  timestamp: number
}

// ============ 类型定义 ============

/**
 * AI 消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  name?: string
  identifier?: string
  tokens?: number
}

/**
 * 消息集合
 */
export class MessageCollection {
  identifier: string
  collection: (ChatMessage | MessageCollection)[]
  
  constructor(identifier: string) {
    this.identifier = identifier
    this.collection = []
  }
  
  add(item: ChatMessage | MessageCollection): void {
    this.collection.push(item)
  }
  
  unshift(item: ChatMessage | MessageCollection): void {
    this.collection.unshift(item)
  }
  
  getTokens(): number {
    return this.collection.reduce((sum, item) => {
      if (item instanceof MessageCollection) {
        return sum + item.getTokens()
      }
      return sum + (item.tokens ?? estimateTokens(item.content))
    }, 0)
  }
  
  flatten(): ChatMessage[] {
    const result: ChatMessage[] = []
    for (const item of this.collection) {
      if (item instanceof MessageCollection) {
        result.push(...item.flatten())
      } else {
        result.push(item)
      }
    }
    return result
  }
  
  hasItemWithIdentifier(identifier: string): boolean {
    for (const item of this.collection) {
      if (item instanceof MessageCollection) {
        if (item.identifier === identifier || item.hasItemWithIdentifier(identifier)) {
          return true
        }
      } else if (item.identifier === identifier) {
        return true
      }
    }
    return false
  }
  
  /**
   * 获取指定标识符的消息/集合 (ST 兼容)
   */
  getItemByIdentifier(identifier: string): ChatMessage | MessageCollection | null {
    for (const item of this.collection) {
      if (item instanceof MessageCollection) {
        if (item.identifier === identifier) {
          return item
        }
        const found = item.getItemByIdentifier(identifier)
        if (found) return found
      } else if (item.identifier === identifier) {
        return item
      }
    }
    return null
  }
  
  /**
   * 获取集合长度
   */
  get length(): number {
    return this.collection.length
  }
  
  /**
   * 检查集合是否为空
   */
  isEmpty(): boolean {
    return this.collection.length === 0
  }
  
  /**
   * 清空集合
   */
  clear(): void {
    this.collection = []
  }
  
  /**
   * 按索引获取项
   */
  at(index: number): ChatMessage | MessageCollection | undefined {
    return this.collection[index]
  }
  
  /**
   * 移除指定标识符的项
   */
  removeByIdentifier(identifier: string): boolean {
    const index = this.collection.findIndex(item => {
      if (item instanceof MessageCollection) {
        return item.identifier === identifier
      }
      return item.identifier === identifier
    })
    
    if (index !== -1) {
      this.collection.splice(index, 1)
      return true
    }
    
    // 递归检查子集合
    for (const item of this.collection) {
      if (item instanceof MessageCollection && item.removeByIdentifier(identifier)) {
        return true
      }
    }
    
    return false
  }
}

/**
 * 注入位置
 */
export enum InjectionPosition {
  /** 相对位置 (按提示词顺序) */
  Relative = 0,
  /** 绝对位置 (按深度注入聊天历史) */
  Absolute = 1,
}

/**
 * 深度注入项
 */
export interface DepthInjection {
  role: 'system' | 'user' | 'assistant'
  content: string
  depth: number
  order: number
  identifier?: string
}

// ============ ChatCompletion 类 ============

/**
 * ChatCompletion - 上下文管理器
 * 
 * 负责:
 * - 管理 token 预算
 * - 组织消息顺序
 * - 处理深度注入
 */
export class ChatCompletion {
  private tokenBudget: number = 0
  private reservedTokens: number = 0
  private reservations: Map<string, BudgetReservation> = new Map()
  private messages: MessageCollection
  private depthInjections: DepthInjection[] = []
  private loggingEnabled: boolean = false
  
  constructor() {
    this.messages = new MessageCollection('root')
  }
  
  /**
   * 重置上下文管理器
   */
  reset(): void {
    this.reservedTokens = 0
    this.reservations.clear()
    this.messages = new MessageCollection('root')
    this.depthInjections = []
    this.log('ChatCompletion reset')
  }
  
  // ============ Token 预算管理 ============
  
  /**
   * 设置 token 预算
   * @param maxContext 最大上下文 token 数
   * @param maxResponse 最大响应 token 数
   */
  setTokenBudget(maxContext: number, maxResponse: number): void {
    this.tokenBudget = maxContext - maxResponse
    this.log(`Token budget set: ${this.tokenBudget} (context: ${maxContext}, response: ${maxResponse})`)
  }
  
  /**
   * 获取剩余预算
   */
  getRemainingBudget(): number {
    return this.tokenBudget - this.reservedTokens
  }
  
  /**
   * 预留预算 (带标识符追踪)
   */
  reserveBudget(tokens: number | ChatMessage | MessageCollection, identifier?: string): void {
    const amount = this.getTokenAmount(tokens)
    const id = identifier || `reserve_${Date.now()}_${Math.random().toString(36).slice(2)}`
    
    this.reservedTokens += amount
    this.reservations.set(id, {
      identifier: id,
      tokens: amount,
      timestamp: Date.now(),
    })
    
    this.log(`Reserved ${amount} tokens (${id}). Remaining: ${this.getRemainingBudget()}`)
  }
  
  /**
   * 释放预算 (按标识符或数量)
   */
  freeBudget(tokens: number | ChatMessage | MessageCollection | string): void {
    // 如果是字符串，按标识符释放
    if (typeof tokens === 'string') {
      const reservation = this.reservations.get(tokens)
      if (reservation) {
        this.reservedTokens = Math.max(0, this.reservedTokens - reservation.tokens)
        this.reservations.delete(tokens)
        this.log(`Freed ${reservation.tokens} tokens by identifier (${tokens}). Remaining: ${this.getRemainingBudget()}`)
      }
      return
    }
    
    const amount = this.getTokenAmount(tokens)
    this.reservedTokens = Math.max(0, this.reservedTokens - amount)
    this.log(`Freed ${amount} tokens. Remaining: ${this.getRemainingBudget()}`)
  }
  
  /**
   * 检查预算预留是否存在
   */
  hasReservation(identifier: string): boolean {
    return this.reservations.has(identifier)
  }
  
  /**
   * 检查是否能负担指定 token 数
   */
  canAfford(tokens: number | ChatMessage | MessageCollection): boolean {
    const amount = this.getTokenAmount(tokens)
    return this.getRemainingBudget() >= amount
  }
  
  /**
   * 检查是否能负担所有消息 (ST 兼容)
   */
  canAffordAll(items: (number | ChatMessage | MessageCollection)[]): boolean {
    const totalAmount = items.reduce<number>((sum, item) => sum + this.getTokenAmount(item), 0)
    return this.getRemainingBudget() >= totalAmount
  }
  
  /**
   * 获取 token 数量 (统一处理)
   */
  private getTokenAmount(tokens: number | ChatMessage | MessageCollection): number {
    if (typeof tokens === 'number') return tokens
    if (tokens instanceof MessageCollection) return tokens.getTokens()
    return tokens.tokens ?? estimateTokens(tokens.content)
  }
  
  /**
   * 获取预算使用详情
   */
  getBudgetBreakdown(): { identifier: string; tokens: number }[] {
    return Array.from(this.reservations.values()).map(r => ({
      identifier: r.identifier,
      tokens: r.tokens,
    }))
  }
  
  // ============ 消息管理 ============
  
  /**
   * 添加消息集合
   */
  add(collection: MessageCollection, position?: number): boolean {
    const tokens = collection.getTokens()
    
    if (!this.canAfford(tokens)) {
      this.log(`Cannot afford ${collection.identifier} (${tokens} tokens)`)
      return false
    }
    
    if (position !== undefined && position >= 0) {
      this.messages.collection.splice(position, 0, collection)
    } else {
      this.messages.collection.push(collection)
    }
    
    this.reserveBudget(tokens, collection.identifier)
    this.log(`Added ${collection.identifier}. Remaining: ${this.getRemainingBudget()}`)
    return true
  }
  
  /**
   * 在指定集合中插入消息
   */
  insert(message: ChatMessage, collectionId: string, position: 'start' | 'end' | number = 'end'): boolean {
    const tokens = message.tokens ?? estimateTokens(message.content)
    
    if (!this.canAfford(tokens)) {
      this.log(`Cannot afford message (${tokens} tokens)`)
      return false
    }
    
    const collection = this.findCollection(collectionId)
    if (!collection) {
      this.log(`Collection ${collectionId} not found`)
      return false
    }
    
    if (position === 'start') {
      collection.unshift(message)
    } else if (position === 'end') {
      collection.add(message)
    } else {
      collection.collection.splice(position, 0, message)
    }
    
    this.reserveBudget(tokens, message.identifier)
    this.log(`Inserted message into ${collectionId}. Remaining: ${this.getRemainingBudget()}`)
    return true
  }
  
  /**
   * 在集合开头插入消息 (ST 兼容)
   */
  insertAtStart(message: ChatMessage, collectionId: string): boolean {
    return this.insert(message, collectionId, 'start')
  }
  
  /**
   * 在集合末尾插入消息 (ST 兼容)
   */
  insertAtEnd(message: ChatMessage, collectionId: string): boolean {
    return this.insert(message, collectionId, 'end')
  }
  
  /**
   * 查找消息集合
   */
  private findCollection(identifier: string): MessageCollection | null {
    const search = (collection: MessageCollection): MessageCollection | null => {
      if (collection.identifier === identifier) {
        return collection
      }
      for (const item of collection.collection) {
        if (item instanceof MessageCollection) {
          const found = search(item)
          if (found) return found
        }
      }
      return null
    }
    return search(this.messages)
  }
  
  /**
   * 检查是否存在指定标识符的消息
   */
  has(identifier: string): boolean {
    return this.messages.hasItemWithIdentifier(identifier)
  }
  
  /**
   * 获取指定标识符的消息/集合 (ST 兼容)
   */
  getItemByIdentifier(identifier: string): ChatMessage | MessageCollection | null {
    return this.messages.getItemByIdentifier(identifier)
  }
  
  /**
   * 获取集合在消息列表中的索引位置 (ST 兼容)
   */
  index(identifier: string): number {
    return this.messages.collection.findIndex(item => {
      if (item instanceof MessageCollection) {
        return item.identifier === identifier
      }
      return item.identifier === identifier
    })
  }
  
  /**
   * 移除指定标识符的消息/集合
   */
  remove(identifier: string): boolean {
    const item = this.getItemByIdentifier(identifier)
    if (item) {
      const tokens = item instanceof MessageCollection ? item.getTokens() : (item.tokens ?? estimateTokens(item.content))
      this.messages.removeByIdentifier(identifier)
      this.freeBudget(identifier)
      this.log(`Removed ${identifier}. Freed ${tokens} tokens.`)
      return true
    }
    return false
  }
  
  // ============ 深度注入 ============
  
  /**
   * 添加深度注入
   */
  addDepthInjection(injection: DepthInjection): void {
    this.depthInjections.push(injection)
    this.log(`Added depth injection at depth ${injection.depth}, order ${injection.order}`)
  }
  
  /**
   * 清除深度注入
   */
  clearDepthInjections(): void {
    this.depthInjections = []
  }
  
  // ============ 输出 ============
  
  /**
   * 获取最终的消息数组
   */
  getChat(): ChatMessage[] {
    // 1. 扁平化消息集合
    const messages = this.messages.flatten()
    
    // 2. 应用深度注入
    if (this.depthInjections.length > 0) {
      // 按深度和顺序排序 (深度大的先处理，同深度按 order 从高到低)
      const sortedInjections = [...this.depthInjections].sort((a, b) => {
        if (a.depth !== b.depth) {
          return b.depth - a.depth
        }
        return b.order - a.order
      })
      
      for (const injection of sortedInjections) {
        const insertIndex = Math.max(0, messages.length - injection.depth)
        messages.splice(insertIndex, 0, {
          role: injection.role,
          content: injection.content,
          identifier: injection.identifier,
        })
      }
    }
    
    // 3. 清理输出 (移除空消息和内部属性)
    return messages
      .filter(m => m.content?.trim())
      .map(m => ({
        role: m.role,
        content: m.content,
        ...(m.name ? { name: m.name } : {}),
      }))
  }
  
  /**
   * 获取总 token 数
   */
  getTotalTokens(): number {
    return this.messages.getTokens()
  }
  
  // ============ 日志 ============
  
  enableLogging(): void {
    this.loggingEnabled = true
  }
  
  disableLogging(): void {
    this.loggingEnabled = false
  }
  
  private log(message: string): void {
    if (this.loggingEnabled) {
      console.log(`[ChatCompletion] ${message}`)
    }
  }
}

// ============ 工具函数 ============

/**
 * 创建消息
 */
export function createMessage(
  role: 'system' | 'user' | 'assistant',
  content: string,
  identifier?: string,
  name?: string
): ChatMessage {
  return {
    role,
    content,
    identifier,
    name,
    tokens: estimateTokens(content),
  }
}

/**
 * 创建消息集合
 */
export function createCollection(identifier: string, messages?: ChatMessage[]): MessageCollection {
  const collection = new MessageCollection(identifier)
  if (messages) {
    for (const msg of messages) {
      collection.add(msg)
    }
  }
  return collection
}
