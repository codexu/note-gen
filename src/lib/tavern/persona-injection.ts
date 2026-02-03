/**
 * Persona 注入服务
 * 处理不同位置的 Persona 描述注入逻辑
 * 对齐 SillyTavern 的 addPersonaDescriptionExtensionPrompt()
 */

import type { TavernPersona } from '@/db/tavern'
import {
  PersonaDescriptionPosition,
  PersonaDescriptionRole,
  type PersonaDescriptionPositionType,
  type PersonaDescriptionRoleType,
  personaRoleToString,
} from './persona-types'

/**
 * Persona 注入结果
 */
export interface PersonaInjectionResult {
  /** 是否应该注入 */
  shouldInject: boolean
  /** 注入位置类型 */
  position: PersonaDescriptionPositionType
  /** 注入内容 (处理后) */
  content: string
  /** 是否是深度注入 */
  isDepthInjection: boolean
  /** 深度 (AT_DEPTH 模式) */
  depth: number
  /** 角色 */
  role: 'system' | 'user' | 'assistant'
  /** 是否参与世界书扫描 */
  scanForWorldInfo: boolean
}

/**
 * 注入配置
 */
export interface PersonaInjectionConfig {
  /** 作者注释内容 (用于 TOP_AN/BOTTOM_AN 合并) */
  authorsNote?: string
  /** 是否有作者注释 */
  hasAuthorsNote?: boolean
}

/**
 * 格式化 Persona 描述内容
 * @param persona Persona 数据
 * @returns 格式化后的描述
 */
export function formatPersonaDescription(persona: TavernPersona): string {
  if (!persona.description?.trim()) {
    return ''
  }
  
  // 包含用户名和描述
  return `[用户设定: ${persona.name}]\n${persona.description.trim()}`
}

/**
 * 获取 Persona 注入配置
 * 根据 Persona 的位置设置返回注入方式
 * 
 * @param persona Persona 数据
 * @param config 注入配置
 * @returns 注入结果
 */
export function getPersonaInjection(
  persona: TavernPersona,
  config: PersonaInjectionConfig = {}
): PersonaInjectionResult {
  const position = (persona.position ?? PersonaDescriptionPosition.IN_PROMPT) as PersonaDescriptionPositionType
  const depth = persona.depth ?? 2
  const role = (persona.role ?? PersonaDescriptionRole.SYSTEM) as PersonaDescriptionRoleType
  
  // 默认结果 (不注入)
  const defaultResult: PersonaInjectionResult = {
    shouldInject: false,
    position,
    content: '',
    isDepthInjection: false,
    depth,
    role: personaRoleToString(role),
    scanForWorldInfo: false,
  }
  
  // 无描述或位置为 NONE，不注入
  if (!persona.description?.trim() || position === PersonaDescriptionPosition.NONE) {
    return defaultResult
  }
  
  const formattedContent = formatPersonaDescription(persona)
  
  switch (position) {
    case PersonaDescriptionPosition.IN_PROMPT:
      // 在提示词区域 (作为系统消息)
      return {
        shouldInject: true,
        position,
        content: formattedContent,
        isDepthInjection: false,
        depth: 0,
        role: personaRoleToString(role),
        scanForWorldInfo: true,
      }
      
    case PersonaDescriptionPosition.TOP_AN:
      // 在作者注释顶部
      return {
        shouldInject: true,
        position,
        content: config.hasAuthorsNote
          ? `${formattedContent}\n${config.authorsNote || ''}`
          : formattedContent,
        isDepthInjection: false,
        depth: 0,
        role: personaRoleToString(role),
        scanForWorldInfo: true,
      }
      
    case PersonaDescriptionPosition.BOTTOM_AN:
      // 在作者注释底部
      return {
        shouldInject: true,
        position,
        content: config.hasAuthorsNote
          ? `${config.authorsNote || ''}\n${formattedContent}`
          : formattedContent,
        isDepthInjection: false,
        depth: 0,
        role: personaRoleToString(role),
        scanForWorldInfo: true,
      }
      
    case PersonaDescriptionPosition.AT_DEPTH:
      // 在聊天历史的指定深度注入
      return {
        shouldInject: true,
        position,
        content: formattedContent,
        isDepthInjection: true,
        depth,
        role: personaRoleToString(role),
        scanForWorldInfo: true,
      }
      
    default:
      return defaultResult
  }
}

/**
 * 判断是否应该合并到作者注释
 */
export function shouldMergeWithAuthorsNote(position: PersonaDescriptionPositionType): boolean {
  return position === PersonaDescriptionPosition.TOP_AN || 
         position === PersonaDescriptionPosition.BOTTOM_AN
}

/**
 * 判断是否是深度注入
 */
export function isDepthInjection(position: PersonaDescriptionPositionType): boolean {
  return position === PersonaDescriptionPosition.AT_DEPTH
}

/**
 * 判断是否是普通提示词注入
 */
export function isPromptInjection(position: PersonaDescriptionPositionType): boolean {
  return position === PersonaDescriptionPosition.IN_PROMPT
}

/**
 * 创建深度注入条目
 */
export interface PersonaDepthInjection {
  role: 'system' | 'user' | 'assistant'
  content: string
  depth: number
  order: number
  identifier: string
}

/**
 * 从 Persona 创建深度注入条目
 * @param persona Persona 数据
 * @returns 深度注入条目 (如果不是 AT_DEPTH 模式则返回 null)
 */
export function createPersonaDepthInjection(persona: TavernPersona): PersonaDepthInjection | null {
  const injection = getPersonaInjection(persona)
  
  if (!injection.shouldInject || !injection.isDepthInjection) {
    return null
  }
  
  return {
    role: injection.role,
    content: injection.content,
    depth: injection.depth,
    order: 150, // Persona 深度注入优先级 (高于角色深度提示词的 100)
    identifier: 'personaDescription',
  }
}
