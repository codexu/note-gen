/**
 * 触发器系统类型定义
 */

/**
 * 触发器事件类型
 */
export enum TriggerEventType {
  // 消息事件
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_SENT = 'message_sent',
  MESSAGE_EDITED = 'message_edited',
  MESSAGE_DELETED = 'message_deleted',
  
  // 生成事件
  GENERATION_STARTED = 'generation_started',
  GENERATION_COMPLETE = 'generation_complete',
  GENERATION_ABORTED = 'generation_aborted',
  
  // 聊天事件
  CHAT_STARTED = 'chat_started',
  CHAT_ENDED = 'chat_ended',
  CHAT_LOADED = 'chat_loaded',
  CHAT_SAVED = 'chat_saved',
  
  // 角色事件
  CHARACTER_SELECTED = 'character_selected',
  CHARACTER_LOADED = 'character_loaded',
  
  // 变量事件
  VARIABLE_CHANGED = 'variable_changed',
  
  // 用户交互
  USER_INPUT = 'user_input',
  BUTTON_CLICKED = 'button_clicked',
  
  // 定时事件
  TIMER = 'timer',
  INTERVAL = 'interval',
}

/**
 * 触发器条件操作符
 */
export type ConditionOperator = 
  | '==' | '===' | '!=' | '!==' 
  | '<' | '>' | '<=' | '>=' 
  | 'contains' | 'startsWith' | 'endsWith'
  | 'matches' | 'exists' | 'empty'

/**
 * 触发器条件
 */
export interface TriggerCondition {
  /** 条件类型 */
  type: 'variable' | 'event_data' | 'expression'
  /** 变量/字段名 */
  field: string
  /** 操作符 */
  operator: ConditionOperator
  /** 比较值 */
  value?: string | number | boolean
  /** 是否取反 */
  negate?: boolean
}

/**
 * 条件组 (AND/OR)
 */
export interface ConditionGroup {
  /** 逻辑运算符 */
  logic: 'AND' | 'OR'
  /** 条件列表 */
  conditions: (TriggerCondition | ConditionGroup)[]
}

/**
 * 触发器动作
 */
export interface TriggerAction {
  /** 动作类型 */
  type: 'script' | 'command' | 'set_variable' | 'send_message' | 'notify'
  /** 脚本内容 (type=script) */
  script?: string
  /** 命令 (type=command) */
  command?: string
  /** 变量设置 (type=set_variable) */
  variable?: {
    name: string
    value: string
    scope?: 'global' | 'chat' | 'local'
  }
  /** 消息 (type=send_message) */
  message?: string
  /** 通知 (type=notify) */
  notification?: {
    title: string
    body?: string
    type?: 'info' | 'success' | 'warning' | 'error'
  }
  /** 延迟执行 (ms) */
  delay?: number
}

/**
 * 触发器定义
 */
export interface Trigger {
  /** 触发器 ID */
  id: string
  /** 名称 */
  name: string
  /** 描述 */
  description?: string
  /** 是否启用 */
  enabled: boolean
  /** 优先级 (数字越小越先执行) */
  priority: number
  
  /** 触发事件 */
  event: TriggerEventType
  /** 事件过滤器 */
  eventFilter?: Record<string, unknown>
  
  /** 触发条件 */
  conditions?: ConditionGroup
  
  /** 触发动作 */
  actions: TriggerAction[]
  
  /** 冷却时间 (ms) */
  cooldown?: number
  /** 最大触发次数 (0=无限) */
  maxTriggers?: number
  /** 当前触发次数 */
  triggerCount?: number
  
  /** 关联的聊天 ID (undefined=全局) */
  chatId?: number
  /** 关联的角色 ID */
  cardId?: number
  
  /** 创建时间 */
  createdAt: number
  /** 更新时间 */
  updatedAt: number
}

/**
 * 触发器组
 */
export interface TriggerGroup {
  id: string
  name: string
  triggers: Trigger[]
  enabled: boolean
}

/**
 * 事件数据
 */
export interface TriggerEventData {
  /** 事件类型 */
  type: TriggerEventType
  /** 时间戳 */
  timestamp: number
  /** 聊天 ID */
  chatId?: number
  /** 角色 ID */
  cardId?: number
  /** 消息内容 */
  message?: string
  /** 消息 ID */
  messageId?: number
  /** 发送者 */
  sender?: 'user' | 'character' | 'system'
  /** 额外数据 */
  data?: Record<string, unknown>
}

/**
 * 触发器执行结果
 */
export interface TriggerExecutionResult {
  triggerId: string
  success: boolean
  output?: string
  error?: string
  /** 执行的动作数 */
  actionsExecuted: number
  /** 耗时 (ms) */
  duration: number
}
