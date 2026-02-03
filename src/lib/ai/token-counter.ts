import { Chat } from '@/db/chats'

/**
 * 简单的 Token 估算（不依赖外部库）
 * 规则：中文约 1.5 字符/token，英文约 4 字符/token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 4)
}

/**
 * 计算 Chat 数组的总 token 量
 */
export function estimateChatTokens(chats: Chat[]): number {
  return chats.reduce((sum, chat) => {
    return sum + estimateTokens(chat.content || '')
  }, 0)
}

/**
 * 计算用户消息的 token 总量
 */
export function estimateUserTokens(chats: Chat[]): number {
  return chats
    .filter(c => c.role === 'user')
    .reduce((sum, chat) => sum + estimateTokens(chat.content || ''), 0)
}
