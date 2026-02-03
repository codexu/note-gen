/**
 * 触发器系统导出
 */

// 类型
export {
  TriggerEventType,
  type Trigger,
  type TriggerGroup,
  type TriggerCondition,
  type ConditionGroup,
  type ConditionOperator,
  type TriggerAction,
  type TriggerEventData,
  type TriggerExecutionResult,
} from './types'

// 管理器
export {
  TriggerManager,
  getTriggerManager,
  createTriggerManager,
  emitEvent,
  registerTrigger,
  createTrigger,
  type TriggerCallbacks,
} from './manager'
