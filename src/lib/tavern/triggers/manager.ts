/**
 * 触发器管理器
 * 负责触发器的注册、匹配和执行
 */

import {
  Trigger,
  TriggerEventType,
  TriggerEventData,
  TriggerCondition,
  ConditionGroup,
  TriggerAction,
  TriggerExecutionResult,
} from './types'
import { executeScript } from '../stscript'
import { getVariableManager, VariableValue } from '../stscript/variables'

// ============ 触发器管理器 ============

/**
 * 触发器管理器
 */
export class TriggerManager {
  /** 触发器列表 */
  private triggers: Map<string, Trigger> = new Map()
  /** 事件订阅 */
  private eventSubscribers: Map<TriggerEventType, Set<string>> = new Map()
  /** 冷却记录 */
  private cooldowns: Map<string, number> = new Map()
  /** 事件处理回调 */
  private callbacks: TriggerCallbacks = {}
  
  constructor(callbacks?: TriggerCallbacks) {
    if (callbacks) {
      this.callbacks = callbacks
    }
  }
  
  // ============ 触发器管理 ============
  
  /**
   * 注册触发器
   */
  register(trigger: Trigger): void {
    this.triggers.set(trigger.id, trigger)
    
    // 添加事件订阅
    if (!this.eventSubscribers.has(trigger.event)) {
      this.eventSubscribers.set(trigger.event, new Set())
    }
    this.eventSubscribers.get(trigger.event)!.add(trigger.id)
  }
  
  /**
   * 注销触发器
   */
  unregister(triggerId: string): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      // 移除事件订阅
      const subscribers = this.eventSubscribers.get(trigger.event)
      if (subscribers) {
        subscribers.delete(triggerId)
      }
      this.triggers.delete(triggerId)
    }
  }
  
  /**
   * 获取触发器
   */
  get(triggerId: string): Trigger | undefined {
    return this.triggers.get(triggerId)
  }
  
  /**
   * 获取所有触发器
   */
  getAll(): Trigger[] {
    return Array.from(this.triggers.values())
  }
  
  /**
   * 更新触发器
   */
  update(triggerId: string, updates: Partial<Trigger>): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      // 如果事件类型改变，需要更新订阅
      if (updates.event && updates.event !== trigger.event) {
        this.eventSubscribers.get(trigger.event)?.delete(triggerId)
        if (!this.eventSubscribers.has(updates.event)) {
          this.eventSubscribers.set(updates.event, new Set())
        }
        this.eventSubscribers.get(updates.event)!.add(triggerId)
      }
      
      Object.assign(trigger, updates, { updatedAt: Date.now() })
    }
  }
  
  /**
   * 启用/禁用触发器
   */
  setEnabled(triggerId: string, enabled: boolean): void {
    const trigger = this.triggers.get(triggerId)
    if (trigger) {
      trigger.enabled = enabled
      trigger.updatedAt = Date.now()
    }
  }
  
  // ============ 事件处理 ============
  
  /**
   * 触发事件
   */
  async emit(event: TriggerEventData): Promise<TriggerExecutionResult[]> {
    const results: TriggerExecutionResult[] = []
    
    // 获取订阅该事件的触发器
    const subscriberIds = this.eventSubscribers.get(event.type)
    if (!subscriberIds || subscriberIds.size === 0) {
      return results
    }
    
    // 获取并排序触发器
    const triggers = Array.from(subscriberIds)
      .map(id => this.triggers.get(id))
      .filter((t): t is Trigger => t !== undefined && t.enabled)
      .filter(t => this.matchesContext(t, event))
      .filter(t => this.checkCooldown(t))
      .sort((a, b) => a.priority - b.priority)
    
    // 执行触发器
    for (const trigger of triggers) {
      // 检查条件
      if (trigger.conditions && !this.evaluateConditions(trigger.conditions, event)) {
        continue
      }
      
      // 执行动作
      const result = await this.executeTrigger(trigger, event)
      results.push(result)
      
      // 更新冷却
      if (trigger.cooldown) {
        this.cooldowns.set(trigger.id, Date.now())
      }
      
      // 更新触发次数
      if (trigger.triggerCount !== undefined) {
        trigger.triggerCount++
        
        // 检查最大触发次数
        if (trigger.maxTriggers && trigger.triggerCount >= trigger.maxTriggers) {
          trigger.enabled = false
        }
      }
    }
    
    return results
  }
  
  /**
   * 检查触发器是否匹配上下文
   */
  private matchesContext(trigger: Trigger, event: TriggerEventData): boolean {
    // 检查聊天 ID
    if (trigger.chatId !== undefined && trigger.chatId !== event.chatId) {
      return false
    }
    
    // 检查角色 ID
    if (trigger.cardId !== undefined && trigger.cardId !== event.cardId) {
      return false
    }
    
    // 检查事件过滤器
    if (trigger.eventFilter) {
      for (const [key, value] of Object.entries(trigger.eventFilter)) {
        if (event.data?.[key] !== value) {
          return false
        }
      }
    }
    
    return true
  }
  
  /**
   * 检查冷却时间
   */
  private checkCooldown(trigger: Trigger): boolean {
    if (!trigger.cooldown) return true
    
    const lastTrigger = this.cooldowns.get(trigger.id)
    if (!lastTrigger) return true
    
    return Date.now() - lastTrigger >= trigger.cooldown
  }
  
  /**
   * 执行触发器
   */
  private async executeTrigger(
    trigger: Trigger,
    event: TriggerEventData
  ): Promise<TriggerExecutionResult> {
    const startTime = Date.now()
    let actionsExecuted = 0
    let lastError: string | undefined
    let outputs: string[] = []
    
    for (const action of trigger.actions) {
      try {
        // 延迟执行
        if (action.delay) {
          await new Promise(resolve => setTimeout(resolve, action.delay))
        }
        
        const output = await this.executeAction(action, event)
        if (output) {
          outputs.push(output)
        }
        actionsExecuted++
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        console.error(`[Trigger] 动作执行失败: ${lastError}`)
      }
    }
    
    return {
      triggerId: trigger.id,
      success: !lastError,
      output: outputs.join('\n'),
      error: lastError,
      actionsExecuted,
      duration: Date.now() - startTime,
    }
  }
  
  /**
   * 执行动作
   */
  private async executeAction(
    action: TriggerAction,
    event: TriggerEventData
  ): Promise<string | undefined> {
    switch (action.type) {
      case 'script':
        if (action.script) {
          const result = await executeScript(action.script, {
            chatId: event.chatId,
          })
          return result.output
        }
        break
        
      case 'command':
        if (action.command) {
          const result = await executeScript(action.command, {
            chatId: event.chatId,
          })
          return result.output
        }
        break
        
      case 'set_variable':
        if (action.variable) {
          const manager = getVariableManager(event.chatId)
          const scope = action.variable.scope || 'chat'
          const prefix = scope === 'global' ? 'global.' : scope === 'chat' ? 'chat.' : ''
          manager.set(prefix + action.variable.name, action.variable.value)
          return `变量 ${action.variable.name} = ${action.variable.value}`
        }
        break
        
      case 'send_message':
        if (action.message && this.callbacks.onSendMessage) {
          await this.callbacks.onSendMessage(action.message)
          return `发送消息: ${action.message}`
        }
        break
        
      case 'notify':
        if (action.notification && this.callbacks.onNotify) {
          this.callbacks.onNotify(
            action.notification.title,
            action.notification.body,
            action.notification.type
          )
          return `通知: ${action.notification.title}`
        }
        break
    }
    
    return undefined
  }
  
  // ============ 条件求值 ============
  
  /**
   * 求值条件组
   */
  private evaluateConditions(
    group: ConditionGroup,
    event: TriggerEventData
  ): boolean {
    const results = group.conditions.map(cond => {
      if ('logic' in cond) {
        return this.evaluateConditions(cond, event)
      }
      return this.evaluateCondition(cond, event)
    })
    
    if (group.logic === 'AND') {
      return results.every(r => r)
    } else {
      return results.some(r => r)
    }
  }
  
  /**
   * 求值单个条件
   */
  private evaluateCondition(
    condition: TriggerCondition,
    event: TriggerEventData
  ): boolean {
    let fieldValue: VariableValue
    
    // 获取字段值
    if (condition.type === 'variable') {
      const manager = getVariableManager(event.chatId)
      fieldValue = manager.get(condition.field)
    } else if (condition.type === 'event_data') {
      fieldValue = this.getEventField(event, condition.field)
    } else {
      // expression - 暂不支持
      return false
    }
    
    let result = this.compareValues(fieldValue, condition.operator, condition.value)
    
    if (condition.negate) {
      result = !result
    }
    
    return result
  }
  
  /**
   * 获取事件字段值
   */
  private getEventField(event: TriggerEventData, field: string): VariableValue {
    const parts = field.split('.')
    let value: unknown = event
    
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }
    
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    
    return undefined
  }
  
  /**
   * 比较值
   */
  private compareValues(
    left: VariableValue,
    operator: string,
    right: VariableValue
  ): boolean {
    const leftStr = String(left ?? '')
    const rightStr = String(right ?? '')
    const leftNum = Number(left)
    const rightNum = Number(right)
    
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
      case 'contains':
        return leftStr.includes(rightStr)
      case 'startsWith':
        return leftStr.startsWith(rightStr)
      case 'endsWith':
        return leftStr.endsWith(rightStr)
      case 'matches':
        try {
          return new RegExp(rightStr).test(leftStr)
        } catch {
          return false
        }
      case 'exists':
        return left !== undefined && left !== null
      case 'empty':
        return left === undefined || left === null || leftStr === ''
      default:
        return false
    }
  }
  
  // ============ 清理 ============
  
  /**
   * 清除所有触发器
   */
  clear(): void {
    this.triggers.clear()
    this.eventSubscribers.clear()
    this.cooldowns.clear()
  }
  
  /**
   * 重置触发次数
   */
  resetTriggerCounts(): void {
    for (const trigger of this.triggers.values()) {
      trigger.triggerCount = 0
    }
  }
}

// ============ 回调接口 ============

/**
 * 触发器回调
 */
export interface TriggerCallbacks {
  onSendMessage?: (message: string) => Promise<void>
  onNotify?: (title: string, body?: string, type?: string) => void
}

// ============ 全局实例 ============

let defaultManager: TriggerManager | null = null

/**
 * 获取默认触发器管理器
 */
export function getTriggerManager(callbacks?: TriggerCallbacks): TriggerManager {
  if (!defaultManager) {
    defaultManager = new TriggerManager(callbacks)
  }
  return defaultManager
}

/**
 * 创建新的触发器管理器
 */
export function createTriggerManager(callbacks?: TriggerCallbacks): TriggerManager {
  return new TriggerManager(callbacks)
}

// ============ 便捷函数 ============

/**
 * 触发事件
 */
export async function emitEvent(
  type: TriggerEventType,
  data?: Partial<TriggerEventData>
): Promise<TriggerExecutionResult[]> {
  return getTriggerManager().emit({
    type,
    timestamp: Date.now(),
    ...data,
  })
}

/**
 * 注册触发器
 */
export function registerTrigger(trigger: Trigger): void {
  getTriggerManager().register(trigger)
}

/**
 * 创建触发器
 */
export function createTrigger(
  name: string,
  event: TriggerEventType,
  actions: TriggerAction[],
  options?: Partial<Trigger>
): Trigger {
  return {
    id: `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    enabled: true,
    priority: 100,
    event,
    actions,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...options,
  }
}
