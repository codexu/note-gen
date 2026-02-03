/**
 * Persona 类型定义
 * 与 SillyTavern 的 Persona 系统对齐
 */

/**
 * Persona 描述注入位置
 * 对应 ST 的 persona_description_positions
 */
export const PersonaDescriptionPosition = {
  /** 在提示词区域 (作为系统消息, 默认) */
  IN_PROMPT: 0,
  /** 在作者注释顶部 */
  TOP_AN: 2,
  /** 在作者注释底部 */
  BOTTOM_AN: 3,
  /** 在聊天历史的指定深度注入 */
  AT_DEPTH: 4,
  /** 不注入 */
  NONE: 9,
} as const

export type PersonaDescriptionPositionType = typeof PersonaDescriptionPosition[keyof typeof PersonaDescriptionPosition]

/**
 * Persona 描述角色
 */
export const PersonaDescriptionRole = {
  SYSTEM: 0,
  USER: 1,
  ASSISTANT: 2,
} as const

export type PersonaDescriptionRoleType = typeof PersonaDescriptionRole[keyof typeof PersonaDescriptionRole]

/**
 * 位置显示名称映射
 */
export const PersonaPositionLabels: Record<PersonaDescriptionPositionType, string> = {
  [PersonaDescriptionPosition.IN_PROMPT]: '在提示词中',
  [PersonaDescriptionPosition.TOP_AN]: '作者注释顶部',
  [PersonaDescriptionPosition.BOTTOM_AN]: '作者注释底部',
  [PersonaDescriptionPosition.AT_DEPTH]: '深度注入',
  [PersonaDescriptionPosition.NONE]: '不注入',
}

/**
 * 角色显示名称映射
 */
export const PersonaRoleLabels: Record<PersonaDescriptionRoleType, string> = {
  [PersonaDescriptionRole.SYSTEM]: '系统',
  [PersonaDescriptionRole.USER]: '用户',
  [PersonaDescriptionRole.ASSISTANT]: '助手',
}

/**
 * 默认 Persona 配置值
 */
export const DEFAULT_PERSONA_POSITION = PersonaDescriptionPosition.IN_PROMPT
export const DEFAULT_PERSONA_DEPTH = 2
export const DEFAULT_PERSONA_ROLE = PersonaDescriptionRole.SYSTEM

/**
 * 将角色枚举转换为字符串
 */
export function personaRoleToString(role: PersonaDescriptionRoleType): 'system' | 'user' | 'assistant' {
  switch (role) {
    case PersonaDescriptionRole.USER:
      return 'user'
    case PersonaDescriptionRole.ASSISTANT:
      return 'assistant'
    default:
      return 'system'
  }
}

/**
 * 将字符串转换为角色枚举
 */
export function stringToPersonaRole(role: string): PersonaDescriptionRoleType {
  switch (role) {
    case 'user':
      return PersonaDescriptionRole.USER
    case 'assistant':
      return PersonaDescriptionRole.ASSISTANT
    default:
      return PersonaDescriptionRole.SYSTEM
  }
}

/**
 * 扩展的 Persona 配置接口
 */
export interface PersonaConfig {
  /** 注入位置 */
  position: PersonaDescriptionPositionType
  /** 深度 (AT_DEPTH 模式用) */
  depth: number
  /** 角色 */
  role: PersonaDescriptionRoleType
  /** 关联的世界书名称 */
  lorebook: string
}

/**
 * 创建默认的 Persona 配置
 */
export function createDefaultPersonaConfig(): PersonaConfig {
  return {
    position: DEFAULT_PERSONA_POSITION,
    depth: DEFAULT_PERSONA_DEPTH,
    role: DEFAULT_PERSONA_ROLE,
    lorebook: '',
  }
}

/**
 * 聊天元数据中的 Persona 锁定信息
 */
export interface ChatPersonaMetadata {
  /** 锁定的 Persona ID (null 表示未锁定) */
  persona?: number | null
}

/**
 * Persona 连接类型
 * 用于关联 Persona 到特定角色或群组
 */
export interface PersonaConnection {
  /** 连接类型 */
  type: 'character' | 'group'
  /** 连接目标 ID (cardId 或 groupId) */
  id: number
}

/**
 * Persona 锁定类型枚举
 */
export type PersonaLockType = 'chat' | 'character' | 'default'

/**
 * Persona 状态信息
 * 描述 Persona 当前的各种锁定状态
 */
export interface PersonaState {
  /** Persona ID */
  personaId: number
  /** 是否是默认 Persona */
  isDefault: boolean
  /** 锁定状态 */
  locked: {
    /** 是否锁定到当前聊天 */
    chat: boolean
    /** 是否绑定到当前角色/群组 */
    character: boolean
  }
}

/**
 * 临时 Persona 状态信息
 */
export interface PersonaTemporaryInfo {
  /** 是否是临时选择 (非锁定状态) */
  isTemporary: boolean
  /** 是否有不同的聊天锁定 Persona */
  hasDifferentChatLock: boolean
  /** 是否有不同的默认 Persona */
  hasDifferentDefaultLock: boolean
  /** 状态说明文本 */
  info: string
}

/**
 * 解析 Persona 连接 JSON
 */
export function parsePersonaConnections(connectionsJson: string): PersonaConnection[] {
  try {
    const parsed = JSON.parse(connectionsJson || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 序列化 Persona 连接
 */
export function stringifyPersonaConnections(connections: PersonaConnection[]): string {
  return JSON.stringify(connections)
}
