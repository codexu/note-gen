/**
 * 书签/分支服务
 * 实现对话分支点 (Checkpoint) 和分支 (Branch) 管理
 * 对齐 SillyTavern bookmarks.js
 */

import {
  type TavernMessage,
  getChatById,
  getChatsByCardId,
  insertChat,
  getMessagesByChatId,
  insertMessage,
  updateMessage,
} from '@/db/tavern'

// ============ 类型定义 ============

/**
 * 聊天元数据中的书签相关字段
 */
export interface BookmarkMetadata {
  /** 主聊天 ID (如果当前是分支) */
  main_chat?: number
  /** 检查点名称 */
  checkpoint_name?: string
  /** 创建时间 */
  checkpoint_created_at?: number
}

/**
 * 消息扩展数据中的分支相关字段
 */
export interface MessageBranchExtra {
  /** 从此消息创建的分支聊天 ID 列表 */
  branches?: number[]
}

/**
 * 分支信息
 */
export interface BranchInfo {
  chatId: number
  name: string
  createdAt: number
  messageCount: number
}

// ============ 元数据解析 ============

/**
 * 解析聊天元数据
 */
function parseChatMetadata(metadataJson: string): Record<string, unknown> & BookmarkMetadata {
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
 * 解析消息扩展数据
 */
function parseMessageExtra(extraJson: string): Record<string, unknown> & MessageBranchExtra {
  try {
    return JSON.parse(extraJson || '{}')
  } catch {
    return {}
  }
}

/**
 * 序列化消息扩展数据
 */
function stringifyMessageExtra(extra: Record<string, unknown>): string {
  return JSON.stringify(extra)
}

// ============ 检查点/书签功能 ============

/**
 * 生成检查点名称
 * @param baseName 基础名称 (可选)
 */
export function generateCheckpointName(baseName?: string): string {
  const timestamp = new Date().toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  
  if (baseName) {
    return `${baseName} - ${timestamp}`
  }
  
  return `检查点 - ${timestamp}`
}

/**
 * 创建检查点 (保存当前聊天状态为新聊天)
 * 
 * @param chatId 源聊天 ID
 * @param mesId 从哪条消息开始保存 (包含此消息)
 * @param name 检查点名称
 * @returns 新创建的聊天 ID
 */
export async function createCheckpoint(
  chatId: number,
  mesId: number,
  name?: string
): Promise<number> {
  const sourceChat = await getChatById(chatId)
  if (!sourceChat) {
    throw new Error(`聊天不存在: ${chatId}`)
  }
  
  const messages = await getMessagesByChatId(chatId)
  if (messages.length === 0) {
    throw new Error('聊天为空，无法创建检查点')
  }
  
  // 验证消息 ID
  if (mesId < 0 || mesId >= messages.length) {
    throw new Error(`无效的消息 ID: ${mesId}`)
  }
  
  const checkpointName = name || generateCheckpointName()
  
  // 获取源聊天的主聊天 ID (如果源本身是分支)
  const sourceMetadata = parseChatMetadata(sourceChat.metadata)
  const mainChatId = sourceMetadata.main_chat || chatId
  
  // 创建新聊天
  const newMetadata: BookmarkMetadata = {
    main_chat: mainChatId,
    checkpoint_name: checkpointName,
    checkpoint_created_at: Date.now(),
  }
  
  const newChatId = await insertChat({
    cardId: sourceChat.cardId,
    groupId: sourceChat.groupId,
    name: checkpointName,
    metadata: stringifyChatMetadata({ ...sourceMetadata, ...newMetadata }),
    integrity: '', // Will be auto-generated
  })
  
  // 复制消息 (到 mesId 为止)
  const messagesToCopy = messages.slice(0, mesId + 1)
  for (const msg of messagesToCopy) {
    await insertMessage({
      chatId: newChatId as number,
      role: msg.role,
      name: msg.name,
      content: msg.content,
      isHidden: msg.isHidden,
      swipeId: msg.swipeId,
      swipes: msg.swipes,
      sendDate: msg.sendDate,
      genStarted: msg.genStarted,
      genFinished: msg.genFinished,
      forceAvatar: msg.forceAvatar,
      originalAvatar: msg.originalAvatar,
      swipeInfo: msg.swipeInfo,
      extra: msg.extra,
    })
  }
  
  return newChatId as number
}

/**
 * 创建分支 (从指定消息创建新的对话分支)
 * 
 * @param chatId 源聊天 ID
 * @param mesId 从哪条消息创建分支
 * @returns 新创建的聊天 ID
 */
export async function createBranch(chatId: number, mesId: number): Promise<number> {
  const sourceChat = await getChatById(chatId)
  if (!sourceChat) {
    throw new Error(`聊天不存在: ${chatId}`)
  }
  
  const messages = await getMessagesByChatId(chatId)
  if (mesId < 0 || mesId >= messages.length) {
    throw new Error(`无效的消息 ID: ${mesId}`)
  }
  
  const branchName = `分支 #${mesId} - ${new Date().toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })}`
  
  // 获取主聊天 ID
  const sourceMetadata = parseChatMetadata(sourceChat.metadata)
  const mainChatId = sourceMetadata.main_chat || chatId
  
  // 创建分支聊天
  const newMetadata: BookmarkMetadata = {
    main_chat: mainChatId,
    checkpoint_name: branchName,
    checkpoint_created_at: Date.now(),
  }
  
  const newChatId = await insertChat({
    cardId: sourceChat.cardId,
    groupId: sourceChat.groupId,
    name: branchName,
    metadata: stringifyChatMetadata({ ...sourceMetadata, ...newMetadata }),
    integrity: '', // Will be auto-generated
  })
  
  // 复制消息 (到 mesId 为止)
  const messagesToCopy = messages.slice(0, mesId + 1)
  for (const msg of messagesToCopy) {
    await insertMessage({
      chatId: newChatId as number,
      role: msg.role,
      name: msg.name,
      content: msg.content,
      isHidden: msg.isHidden,
      swipeId: msg.swipeId,
      swipes: msg.swipes,
      sendDate: msg.sendDate,
      genStarted: msg.genStarted,
      genFinished: msg.genFinished,
      forceAvatar: msg.forceAvatar,
      originalAvatar: msg.originalAvatar,
      swipeInfo: msg.swipeInfo,
      extra: msg.extra,
    })
  }
  
  // 在源消息上记录分支
  const sourceMessage = messages[mesId]
  const extra = parseMessageExtra(sourceMessage.extra)
  if (!extra.branches) {
    extra.branches = []
  }
  extra.branches.push(newChatId as number)
  
  await updateMessage(sourceMessage.id, {
    extra: stringifyMessageExtra(extra),
  })
  
  return newChatId as number
}

// ============ 查询功能 ============

/**
 * 获取聊天的主聊天 ID
 * @param chatId 聊天 ID
 * @returns 主聊天 ID (如果是分支) 或 null (如果是主聊天)
 */
export async function getMainChatId(chatId: number): Promise<number | null> {
  const chat = await getChatById(chatId)
  if (!chat) return null
  
  const metadata = parseChatMetadata(chat.metadata)
  return metadata.main_chat ?? null
}

/**
 * 检查聊天是否是分支
 */
export async function isBranchChat(chatId: number): Promise<boolean> {
  const mainChatId = await getMainChatId(chatId)
  return mainChatId !== null
}

/**
 * 获取聊天的书签信息
 */
export async function getBookmarkInfo(chatId: number): Promise<BookmarkMetadata | null> {
  const chat = await getChatById(chatId)
  if (!chat) return null
  
  const metadata = parseChatMetadata(chat.metadata)
  if (!metadata.main_chat) return null
  
  return {
    main_chat: metadata.main_chat,
    checkpoint_name: metadata.checkpoint_name,
    checkpoint_created_at: metadata.checkpoint_created_at,
  }
}

/**
 * 获取消息的分支列表
 */
export async function getMessageBranches(messageId: number, messages: TavernMessage[]): Promise<BranchInfo[]> {
  const message = messages.find(m => m.id === messageId)
  if (!message) return []
  
  const extra = parseMessageExtra(message.extra)
  if (!extra.branches || extra.branches.length === 0) return []
  
  const branches: BranchInfo[] = []
  
  for (const branchChatId of extra.branches) {
    const branchChat = await getChatById(branchChatId)
    if (!branchChat) continue
    
    const branchMessages = await getMessagesByChatId(branchChatId)
    const metadata = parseChatMetadata(branchChat.metadata)
    
    branches.push({
      chatId: branchChatId,
      name: metadata.checkpoint_name || branchChat.name,
      createdAt: metadata.checkpoint_created_at || branchChat.createdAt,
      messageCount: branchMessages.length,
    })
  }
  
  return branches
}

/**
 * 获取角色/群组的所有分支聊天
 */
export async function getAllBranches(
  cardId: number,
  _groupId: number | null = null
): Promise<BranchInfo[]> {
  const chats = await getChatsByCardId(cardId)
  const branches: BranchInfo[] = []
  
  for (const chat of chats) {
    const metadata = parseChatMetadata(chat.metadata)
    if (metadata.main_chat) {
      const messages = await getMessagesByChatId(chat.id)
      branches.push({
        chatId: chat.id,
        name: metadata.checkpoint_name || chat.name,
        createdAt: metadata.checkpoint_created_at || chat.createdAt,
        messageCount: messages.length,
      })
    }
  }
  
  // 按创建时间降序排序
  return branches.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 获取主聊天的所有分支
 */
export async function getBranchesOfMainChat(mainChatId: number): Promise<BranchInfo[]> {
  const mainChat = await getChatById(mainChatId)
  if (!mainChat) return []
  
  const allChats = await getChatsByCardId(mainChat.cardId)
  const branches: BranchInfo[] = []
  
  for (const chat of allChats) {
    const metadata = parseChatMetadata(chat.metadata)
    if (metadata.main_chat === mainChatId) {
      const messages = await getMessagesByChatId(chat.id)
      branches.push({
        chatId: chat.id,
        name: metadata.checkpoint_name || chat.name,
        createdAt: metadata.checkpoint_created_at || chat.createdAt,
        messageCount: messages.length,
      })
    }
  }
  
  return branches.sort((a, b) => b.createdAt - a.createdAt)
}
