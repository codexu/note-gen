/**
 * Persona 锁定服务
 * 实现聊天级别的 Persona 锁定/解锁功能
 * 对齐 SillyTavern 的 chat_metadata['persona'] 机制
 */

import {
  TavernPersona,
  getChatById,
  updateChat,
  getDefaultPersona,
  getPersonaById,
  getPersonas,
  updatePersona,
} from '@/db/tavern'
import {
  type ChatPersonaMetadata,
  type PersonaConnection,
  type PersonaState,
  type PersonaLockType,
  parsePersonaConnections,
  stringifyPersonaConnections,
} from './persona-types'

/**
 * 解析聊天元数据
 */
function parseChatMetadata(metadataJson: string): Record<string, unknown> & ChatPersonaMetadata {
  try {
    return JSON.parse(metadataJson || '{}')
  } catch {
    return {}
  }
}

/**
 * 序列化聊天元数据
 */
function stringifyChatMetadata(metadata: Record<string, unknown>): string {
  return JSON.stringify(metadata)
}

/**
 * 锁定 Persona 到聊天
 * @param chatId 聊天 ID
 * @param personaId Persona ID
 */
export async function lockPersonaToChat(chatId: number, personaId: number): Promise<void> {
  const chat = await getChatById(chatId)
  if (!chat) {
    throw new Error(`Chat not found: ${chatId}`)
  }
  
  const metadata = parseChatMetadata(chat.metadata)
  metadata.persona = personaId
  
  await updateChat(chatId, {
    metadata: stringifyChatMetadata(metadata),
  })
}

/**
 * 解锁 Persona 从聊天
 * @param chatId 聊天 ID
 */
export async function unlockPersonaFromChat(chatId: number): Promise<void> {
  const chat = await getChatById(chatId)
  if (!chat) {
    throw new Error(`Chat not found: ${chatId}`)
  }
  
  const metadata = parseChatMetadata(chat.metadata)
  delete metadata.persona
  
  await updateChat(chatId, {
    metadata: stringifyChatMetadata(metadata),
  })
}

/**
 * 获取聊天锁定的 Persona ID
 * @param chatId 聊天 ID
 * @returns Persona ID 或 null (未锁定)
 */
export async function getLockedPersonaId(chatId: number): Promise<number | null> {
  const chat = await getChatById(chatId)
  if (!chat) {
    return null
  }
  
  const metadata = parseChatMetadata(chat.metadata)
  return metadata.persona ?? null
}

/**
 * 检查 Persona 是否锁定到聊天
 * @param chatId 聊天 ID
 * @param personaId Persona ID
 */
export async function isPersonaLockedToChat(chatId: number, personaId: number): Promise<boolean> {
  const lockedId = await getLockedPersonaId(chatId)
  return lockedId === personaId
}

/**
 * 切换 Persona 锁定状态
 * @param chatId 聊天 ID
 * @param personaId Persona ID
 * @returns 新的锁定状态 (true = 已锁定)
 */
export async function togglePersonaLock(chatId: number, personaId: number): Promise<boolean> {
  const isLocked = await isPersonaLockedToChat(chatId, personaId)
  
  if (isLocked) {
    await unlockPersonaFromChat(chatId)
    return false
  } else {
    await lockPersonaToChat(chatId, personaId)
    return true
  }
}

/**
 * 解析当前活动 Persona
 * 优先级: 聊天锁定 > 默认 Persona
 * 
 * @param chatId 聊天 ID
 * @param getPersonaById 获取 Persona 的函数
 * @returns 活动的 Persona 或 null
 */
export async function resolveActivePersona(
  chatId: number,
  getPersonaById: (id: number) => Promise<TavernPersona | null>
): Promise<TavernPersona | null> {
  // 1. 检查聊天锁定
  const lockedPersonaId = await getLockedPersonaId(chatId)
  if (lockedPersonaId !== null) {
    const lockedPersona = await getPersonaById(lockedPersonaId)
    if (lockedPersona) {
      return lockedPersona
    }
  }
  
  // 2. 回退到默认 Persona
  return await getDefaultPersona()
}

/**
 * 获取 Persona 锁定状态
 * @param chatId 聊天 ID
 * @param personaId 当前 Persona ID
 * @param isDefaultPersona 是否是默认 Persona
 * @param cardId 当前角色卡 ID (用于检查角色绑定)
 */
export async function getPersonaLockState(
  chatId: number,
  personaId: number,
  isDefaultPersona: boolean,
  cardId?: number
): Promise<PersonaState> {
  const lockedPersonaId = await getLockedPersonaId(chatId)
  
  // 检查角色绑定
  let isLockedToCharacter = false
  if (cardId) {
    const persona = await getPersonaById(personaId)
    if (persona) {
      const connections = parsePersonaConnections(persona.connections)
      isLockedToCharacter = connections.some(
        c => c.type === 'character' && c.id === cardId
      )
    }
  }
  
  return {
    personaId,
    isDefault: isDefaultPersona,
    locked: {
      chat: lockedPersonaId === personaId,
      character: isLockedToCharacter,
    },
  }
}

// ============ 角色连接管理 ============

/**
 * 添加 Persona 连接
 * @param personaId Persona ID
 * @param connection 连接信息
 */
export async function addPersonaConnection(
  personaId: number,
  connection: PersonaConnection
): Promise<void> {
  const persona = await getPersonaById(personaId)
  if (!persona) {
    throw new Error(`Persona not found: ${personaId}`)
  }
  
  const connections = parsePersonaConnections(persona.connections)
  
  // 检查是否已存在
  const exists = connections.some(
    c => c.type === connection.type && c.id === connection.id
  )
  if (exists) {
    return // 已存在，无需添加
  }
  
  connections.push(connection)
  
  await updatePersona(personaId, {
    connections: stringifyPersonaConnections(connections),
  })
}

/**
 * 移除 Persona 连接
 * @param personaId Persona ID
 * @param connectionType 连接类型
 * @param connectionId 连接目标 ID
 */
export async function removePersonaConnection(
  personaId: number,
  connectionType: 'character' | 'group',
  connectionId: number
): Promise<void> {
  const persona = await getPersonaById(personaId)
  if (!persona) {
    throw new Error(`Persona not found: ${personaId}`)
  }
  
  const connections = parsePersonaConnections(persona.connections)
  const filtered = connections.filter(
    c => !(c.type === connectionType && c.id === connectionId)
  )
  
  await updatePersona(personaId, {
    connections: stringifyPersonaConnections(filtered),
  })
}

/**
 * 获取 Persona 的所有连接
 * @param personaId Persona ID
 */
export async function getPersonaConnections(
  personaId: number
): Promise<PersonaConnection[]> {
  const persona = await getPersonaById(personaId)
  if (!persona) {
    return []
  }
  return parsePersonaConnections(persona.connections)
}

/**
 * 获取关联到指定角色的所有 Persona
 * @param cardId 角色卡 ID
 */
export async function getConnectedPersonas(
  cardId: number
): Promise<TavernPersona[]> {
  const allPersonas = await getPersonas()
  return allPersonas.filter(persona => {
    const connections = parsePersonaConnections(persona.connections)
    return connections.some(
      c => c.type === 'character' && c.id === cardId
    )
  })
}

/**
 * 获取关联到指定群组的所有 Persona
 * @param groupId 群组 ID
 */
export async function getConnectedPersonasForGroup(
  groupId: number
): Promise<TavernPersona[]> {
  const allPersonas = await getPersonas()
  return allPersonas.filter(persona => {
    const connections = parsePersonaConnections(persona.connections)
    return connections.some(
      c => c.type === 'group' && c.id === groupId
    )
  })
}

/**
 * 切换 Persona 到角色的绑定状态
 * @param personaId Persona ID
 * @param cardId 角色卡 ID
 * @returns 新的绑定状态 (true = 已绑定)
 */
export async function togglePersonaCharacterBinding(
  personaId: number,
  cardId: number
): Promise<boolean> {
  const connections = await getPersonaConnections(personaId)
  const isBound = connections.some(
    c => c.type === 'character' && c.id === cardId
  )
  
  if (isBound) {
    await removePersonaConnection(personaId, 'character', cardId)
    return false
  } else {
    await addPersonaConnection(personaId, { type: 'character', id: cardId })
    return true
  }
}

// ============ 自动 Persona 选择 ============

/**
 * 解析聊天应使用的 Persona
 * 优先级: 聊天锁定 > 角色连接 > 默认 Persona
 * 
 * @param chatId 聊天 ID
 * @param cardId 角色卡 ID
 * @returns 解析结果
 */
export async function resolvePersonaForChat(
  chatId: number,
  cardId: number
): Promise<{
  persona: TavernPersona | null
  source: PersonaLockType | 'none'
  /** 多个连接的 Persona (当 allowMultiConnections 启用时使用) */
  multipleConnected?: TavernPersona[]
}> {
  // 1. 检查聊天锁定
  const lockedPersonaId = await getLockedPersonaId(chatId)
  if (lockedPersonaId !== null) {
    const lockedPersona = await getPersonaById(lockedPersonaId)
    if (lockedPersona) {
      return { persona: lockedPersona, source: 'chat' }
    }
  }
  
  // 2. 检查角色连接
  const connectedPersonas = await getConnectedPersonas(cardId)
  if (connectedPersonas.length > 1) {
    // 多个连接 - 返回列表让上层处理
    return {
      persona: connectedPersonas[0],
      source: 'character',
      multipleConnected: connectedPersonas,
    }
  } else if (connectedPersonas.length === 1) {
    return { persona: connectedPersonas[0], source: 'character' }
  }
  
  // 3. 回退到默认 Persona
  const defaultPersona = await getDefaultPersona()
  if (defaultPersona) {
    return { persona: defaultPersona, source: 'default' }
  }
  
  return { persona: null, source: 'none' }
}

/**
 * 检查 Persona 是否绑定到指定角色
 */
export async function isPersonaBoundToCard(
  personaId: number,
  cardId: number
): Promise<boolean> {
  const connections = await getPersonaConnections(personaId)
  return connections.some(
    c => c.type === 'character' && c.id === cardId
  )
}
