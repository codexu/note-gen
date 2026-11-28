import type { Chat } from '@/db/chats'
import { getChatMessageHistoryText } from './history-messages'

// Twelfths of a token keep the existing 2/3 and 1/4 estimates additive before rounding.
export const TOKEN_WEIGHT_SCALE = 12

export function tokenWeightOfCodeUnit(code: number): number {
  return code >= 0x4e00 && code <= 0x9fa5 ? 8 : 3
}

export function getTokenWeight(text: string): number {
  if (!text) return 0
  const firstChinese = text.search(/[\u4e00-\u9fa5]/)
  if (firstChinese < 0) return text.length * 3
  let weight = firstChinese * 3
  for (let i = firstChinese; i < text.length; i++) {
    weight += tokenWeightOfCodeUnit(text.charCodeAt(i))
  }
  return weight
}

export function estimateTokens(text: string): number {
  return Math.ceil(getTokenWeight(text) / TOKEN_WEIGHT_SCALE)
}

/**
 * 计算 Chat 数组的总 token 量
 */
export function estimateChatTokens(chats: Chat[]): number {
  return chats.reduce((sum, chat) => {
    return sum + estimateTokens(getChatMessageHistoryText(chat))
  }, 0)
}

/**
 * 计算用户消息的 token 总量
 */
export function estimateUserTokens(chats: Chat[]): number {
  return chats
    .filter(c => c.role === 'user')
    .reduce((sum, chat) => sum + estimateTokens(getChatMessageHistoryText(chat)), 0)
}
