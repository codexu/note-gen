/**
 * STscript 变量作用域管理
 * 支持全局变量、聊天变量和局部变量
 */

import { useTavernVariablesStore } from '@/stores/tavern-variables'

// ============ 类型定义 ============

/**
 * 变量值类型
 */
export type VariableValue = string | number | boolean | null | undefined

/**
 * 变量作用域类型
 */
export enum VariableScopeType {
  /** 全局变量 - 跨聊天持久化 */
  GLOBAL = 'global',
  /** 聊天变量 - 聊天级别持久化 */
  CHAT = 'chat',
  /** 局部变量 - 脚本执行期间有效 */
  LOCAL = 'local',
}

/**
 * 变量定义
 */
export interface Variable {
  name: string
  value: VariableValue
  scope: VariableScopeType
  /** 是否只读 */
  readonly?: boolean
}

// ============ 变量管理器 ============

/**
 * 变量作用域管理器
 * 管理脚本执行期间的变量读写
 */
export class VariableManager {
  /** 局部变量栈 (支持嵌套作用域) */
  private localScopes: Map<string, VariableValue>[] = []
  
  /** 当前聊天 ID */
  private chatId?: number
  
  constructor(chatId?: number) {
    this.chatId = chatId
    // 初始化根局部作用域
    this.pushScope()
  }
  
  /**
   * 设置聊天 ID
   */
  setChatId(chatId: number): void {
    this.chatId = chatId
  }
  
  /**
   * 推入新的局部作用域
   */
  pushScope(): void {
    this.localScopes.push(new Map())
  }
  
  /**
   * 弹出当前局部作用域
   */
  popScope(): void {
    if (this.localScopes.length > 1) {
      this.localScopes.pop()
    }
  }
  
  /**
   * 获取当前局部作用域
   */
  private get currentScope(): Map<string, VariableValue> {
    return this.localScopes[this.localScopes.length - 1]
  }
  
  /**
   * 解析变量名和作用域
   * 支持格式: name, local.name, chat.name, global.name
   */
  private parseVariableName(name: string): { scope: VariableScopeType; name: string } {
    if (name.startsWith('global.')) {
      return { scope: VariableScopeType.GLOBAL, name: name.slice(7) }
    }
    if (name.startsWith('chat.')) {
      return { scope: VariableScopeType.CHAT, name: name.slice(5) }
    }
    if (name.startsWith('local.')) {
      return { scope: VariableScopeType.LOCAL, name: name.slice(6) }
    }
    // 默认: 先查找局部，再查找聊天，最后全局
    return { scope: VariableScopeType.LOCAL, name }
  }
  
  /**
   * 获取变量值
   */
  get(name: string): VariableValue {
    const { scope, name: varName } = this.parseVariableName(name)
    
    // 局部变量 - 从内到外查找
    if (scope === VariableScopeType.LOCAL) {
      // 先在局部作用域查找
      for (let i = this.localScopes.length - 1; i >= 0; i--) {
        if (this.localScopes[i].has(varName)) {
          return this.localScopes[i].get(varName)
        }
      }
      
      // 再查找聊天变量
      if (this.chatId !== undefined) {
        const store = useTavernVariablesStore.getState()
        const chatValue = store.getVariable(varName, this.chatId)
        if (chatValue !== null) {
          return chatValue
        }
      }
      
      // 最后查找全局变量
      const store = useTavernVariablesStore.getState()
      return store.getVariable(varName) ?? undefined
    }
    
    // 聊天变量
    if (scope === VariableScopeType.CHAT) {
      if (this.chatId === undefined) {
        console.warn(`[Variables] 尝试访问聊天变量但没有 chatId: ${varName}`)
        return undefined
      }
      const store = useTavernVariablesStore.getState()
      return store.getVariable(varName, this.chatId) ?? undefined
    }
    
    // 全局变量
    const store = useTavernVariablesStore.getState()
    return store.getVariable(varName) ?? undefined
  }
  
  /**
   * 设置变量值
   */
  set(name: string, value: VariableValue, scope?: VariableScopeType): void {
    const parsed = this.parseVariableName(name)
    const targetScope = scope || parsed.scope
    const varName = parsed.name
    
    // 转换为字符串存储
    const strValue = this.valueToString(value)
    
    switch (targetScope) {
      case VariableScopeType.LOCAL:
        // 检查是否在外层作用域存在
        let found = false
        for (let i = this.localScopes.length - 1; i >= 0; i--) {
          if (this.localScopes[i].has(varName)) {
            this.localScopes[i].set(varName, value)
            found = true
            break
          }
        }
        // 如果不存在，在当前作用域创建
        if (!found) {
          this.currentScope.set(varName, value)
        }
        break
        
      case VariableScopeType.CHAT:
        if (this.chatId === undefined) {
          console.warn(`[Variables] 尝试设置聊天变量但没有 chatId: ${varName}`)
          // 降级到全局变量
          useTavernVariablesStore.getState().setGlobalVariable(varName, strValue)
        } else {
          useTavernVariablesStore.getState().setChatVariable(this.chatId, varName, strValue)
        }
        break
        
      case VariableScopeType.GLOBAL:
        useTavernVariablesStore.getState().setGlobalVariable(varName, strValue)
        break
    }
  }
  
  /**
   * 删除变量
   */
  delete(name: string): boolean {
    const { scope, name: varName } = this.parseVariableName(name)
    
    if (scope === VariableScopeType.LOCAL) {
      for (let i = this.localScopes.length - 1; i >= 0; i--) {
        if (this.localScopes[i].has(varName)) {
          this.localScopes[i].delete(varName)
          return true
        }
      }
      return false
    }
    
    if (scope === VariableScopeType.CHAT && this.chatId !== undefined) {
      useTavernVariablesStore.getState().deleteChatVariable(this.chatId, varName)
      return true
    }
    
    if (scope === VariableScopeType.GLOBAL) {
      useTavernVariablesStore.getState().deleteGlobalVariable(varName)
      return true
    }
    
    return false
  }
  
  /**
   * 检查变量是否存在
   */
  has(name: string): boolean {
    const value = this.get(name)
    return value !== undefined && value !== null
  }
  
  /**
   * 数值增加
   */
  increment(name: string, amount: number = 1): number {
    const current = this.getAsNumber(name)
    const newValue = current + amount
    this.set(name, newValue)
    return newValue
  }
  
  /**
   * 数值减少
   */
  decrement(name: string, amount: number = 1): number {
    return this.increment(name, -amount)
  }
  
  /**
   * 获取变量作为数字
   */
  getAsNumber(name: string): number {
    const value = this.get(name)
    if (typeof value === 'number') return value
    if (typeof value === 'string') return parseFloat(value) || 0
    if (typeof value === 'boolean') return value ? 1 : 0
    return 0
  }
  
  /**
   * 获取变量作为字符串
   */
  getAsString(name: string): string {
    const value = this.get(name)
    return this.valueToString(value)
  }
  
  /**
   * 获取变量作为布尔值
   */
  getAsBoolean(name: string): boolean {
    const value = this.get(name)
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    if (typeof value === 'string') {
      return value !== '' && value !== '0' && value.toLowerCase() !== 'false'
    }
    return false
  }
  
  /**
   * 列出所有局部变量
   */
  listLocalVariables(): Variable[] {
    const result: Variable[] = []
    const seen = new Set<string>()
    
    // 从内到外遍历，确保内层变量覆盖外层
    for (let i = this.localScopes.length - 1; i >= 0; i--) {
      for (const [name, value] of this.localScopes[i]) {
        if (!seen.has(name)) {
          result.push({
            name,
            value,
            scope: VariableScopeType.LOCAL,
          })
          seen.add(name)
        }
      }
    }
    
    return result
  }
  
  /**
   * 列出所有变量
   */
  listAllVariables(): Variable[] {
    const result: Variable[] = []
    
    // 局部变量
    result.push(...this.listLocalVariables())
    
    // 聊天变量
    if (this.chatId !== undefined) {
      const store = useTavernVariablesStore.getState()
      const chatVars = store.listChatVariables(this.chatId)
      for (const v of chatVars) {
        result.push({
          name: v.name,
          value: v.value,
          scope: VariableScopeType.CHAT,
        })
      }
    }
    
    // 全局变量
    const store = useTavernVariablesStore.getState()
    const globalVars = store.listGlobalVariables()
    for (const v of globalVars) {
      result.push({
        name: v.name,
        value: v.value,
        scope: VariableScopeType.GLOBAL,
      })
    }
    
    return result
  }
  
  /**
   * 清除所有局部变量
   */
  clearLocalVariables(): void {
    this.localScopes = [new Map()]
  }
  
  /**
   * 值转换为字符串
   */
  private valueToString(value: VariableValue): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return String(value)
  }
}

// ============ 全局实例 ============

let defaultManager: VariableManager | null = null

/**
 * 获取默认变量管理器
 */
export function getVariableManager(chatId?: number): VariableManager {
  if (!defaultManager) {
    defaultManager = new VariableManager(chatId)
  } else if (chatId !== undefined) {
    defaultManager.setChatId(chatId)
  }
  return defaultManager
}

/**
 * 创建新的变量管理器
 */
export function createVariableManager(chatId?: number): VariableManager {
  return new VariableManager(chatId)
}

// ============ 工具函数 ============

/**
 * 解析变量表达式 {{varName}}
 */
export function parseVariableExpression(text: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g
  const matches: string[] = []
  let match
  
  while ((match = regex.exec(text)) !== null) {
    matches.push(match[1])
  }
  
  return matches
}

/**
 * 替换文本中的变量
 */
export function replaceVariables(
  text: string, 
  manager: VariableManager,
  additionalVars?: Record<string, VariableValue>
): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
    // 先检查额外变量
    if (additionalVars && varName in additionalVars) {
      const value = additionalVars[varName]
      return value?.toString() ?? ''
    }
    
    // 从变量管理器获取
    const value = manager.get(varName)
    return value?.toString() ?? match // 如果找不到，保留原文
  })
}

/**
 * 计算条件表达式
 */
export function evaluateCondition(
  left: VariableValue,
  operator: string,
  right: VariableValue
): boolean {
  // 数值比较
  const leftNum = typeof left === 'number' ? left : parseFloat(String(left))
  const rightNum = typeof right === 'number' ? right : parseFloat(String(right))
  
  switch (operator) {
    case '==':
      return left == right
    case '===':
      return left === right
    case '!=':
      return left != right
    case '!==':
      return left !== right
    case '<':
      return leftNum < rightNum
    case '>':
      return leftNum > rightNum
    case '<=':
      return leftNum <= rightNum
    case '>=':
      return leftNum >= rightNum
    default:
      return false
  }
}
