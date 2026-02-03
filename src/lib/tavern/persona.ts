/**
 * Persona 模块统一导出
 * 
 * 包含:
 * - 类型定义 (persona-types.ts)
 * - 注入服务 (persona-injection.ts)
 * - 锁定服务 (persona-lock.ts)
 */

// 类型定义
export {
  PersonaDescriptionPosition,
  PersonaDescriptionRole,
  PersonaPositionLabels,
  PersonaRoleLabels,
  DEFAULT_PERSONA_POSITION,
  DEFAULT_PERSONA_DEPTH,
  DEFAULT_PERSONA_ROLE,
  personaRoleToString,
  stringToPersonaRole,
  createDefaultPersonaConfig,
  type PersonaDescriptionPositionType,
  type PersonaDescriptionRoleType,
  type PersonaConfig,
  type ChatPersonaMetadata,
} from './persona-types'

// 注入服务
export {
  formatPersonaDescription,
  getPersonaInjection,
  shouldMergeWithAuthorsNote,
  isDepthInjection,
  isPromptInjection,
  createPersonaDepthInjection,
  type PersonaInjectionResult,
  type PersonaInjectionConfig,
  type PersonaDepthInjection,
} from './persona-injection'

// 锁定服务
export {
  lockPersonaToChat,
  unlockPersonaFromChat,
  getLockedPersonaId,
  isPersonaLockedToChat,
  togglePersonaLock,
  resolveActivePersona,
  getPersonaLockState,
} from './persona-lock'

// 从 persona-types 重新导出 PersonaState
export {
  type PersonaState,
  type PersonaConnection,
  type PersonaLockType,
  parsePersonaConnections,
  stringifyPersonaConnections,
} from './persona-types'
