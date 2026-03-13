import { fetchAi } from './chat'
import { Chat } from '@/db/chats'
import { estimateTokens } from './token-counter'
import useSettingStore from '@/stores/setting'
import OpenAI from 'openai'

const CONDENSE_THRESHOLD = 3 // AI 消息超过 3 条时检查压缩
const MIN_TOKEN_TO_CONDENSE = 100 // 单条消息超过 100 token 才压缩

/**
 * 获取可压缩的 AI 消息（排除用户消息和已压缩的）
 * 规则：
 * - 用户消息永不压缩
 * - 最新的 N 条 AI 消息不压缩
 * - 已有摘要的消息不重复压缩
 */
function getCondensableChats(chats: Chat[], keepLatestCount: number): Chat[] {
  // 只处理 AI (system) 的 chat 和 note 类型消息
  const aiMessages = chats.filter(c =>
    (c.type === 'chat' || c.type === 'note') &&
    c.role === 'system'
  )

  // 排除最新的 N 条
  const toCheck = aiMessages.slice(0, -keepLatestCount)

  // 只返回没有摘要的消息
  return toCheck.filter(c => !c.condensedContent)
}

/**
 * 检查是否需要压缩
 */
export async function shouldCondense(chatsAfterClear: Chat[]): Promise<boolean> {
  const settings = useSettingStore.getState()

  // 检查是否启用摘要
  if (!settings.enableCondense) {
    return false
  }

  // 获取可压缩的 AI 消息
  const condensableChats = getCondensableChats(chatsAfterClear, settings.keepLatestCount)

  if (condensableChats.length < CONDENSE_THRESHOLD) {
    return false
  }

  // 检查这些消息中是否有需要压缩的（超过 token 阈值）
  const needsCondense = condensableChats.some(chat =>
    estimateTokens(chat.content || '') > MIN_TOKEN_TO_CONDENSE
  )

  return needsCondense
}

/**
 * 为多条消息生成摘要
 * @returns 每条消息的摘要结果数组
 */
export async function condenseChats(chatsAfterClear: Chat[]): Promise<Array<{ chatId: number, summary: string | null }>> {
  const settings = useSettingStore.getState()

  // 检查是否启用摘要
  if (!settings.enableCondense) {
    return []
  }

  // 获取需要压缩的消息
  const toCondense = getCondensableChats(chatsAfterClear, settings.keepLatestCount)

  if (toCondense.length === 0) {
    return []
  }

  // 获取用户配置的摘要模型
  const { condenseModel } = settings
  const hasCondenseModel = !!condenseModel

  // 如果配置了 condenseModel，使用 'condenseModel' store key，否则使用 'primaryModel'
  const storeKey = hasCondenseModel ? 'condenseModel' : 'primaryModel'

  // 构建提示词
  const prompt = `请将以下对话内容压缩为简洁的摘要，用于节省 token 使用量。

压缩原则：
1. 保留代码块、数据、结论、TODO 等关键信息
2. 简化过程描述和中间思考
3. 使用清晰的段落或要点组织内容
4. 控制在 ${settings.condenseMaxLength} 字以内

原始内容：
{content}

请输出摘要：`

  const results: Array<{ chatId: number, summary: string | null }> = []

  // 为每条消息生成摘要
  for (const chat of toCondense) {
    const content = chat.content || ''
    const originalTokenCount = estimateTokens(content)

    // 只压缩超过阈值的消息
    if (originalTokenCount <= MIN_TOKEN_TO_CONDENSE) {
      results.push({ chatId: chat.id, summary: null })
      continue
    }

    try {
      const finalPrompt = prompt.replace('{content}', content)
      const summary = await fetchAi(finalPrompt, storeKey)

      if (summary) {
        results.push({ chatId: chat.id, summary })
      } else {
        results.push({ chatId: chat.id, summary: null })
      }
    } catch (error) {
      console.error('[Condense] 消息', chat.id, '摘要生成出错:', error)
      results.push({ chatId: chat.id, summary: null })
    }
  }

  return results
}

/**
 * 获取最后一次清除后的消息
 */
export function getChatsAfterLastClear(chats: Chat[]): Chat[] {
  const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
  return lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)
}

/**
 * 构建用于 AI 的消息历史
 * 规则：
 * 1. 用户消息：始终使用原文（永不使用摘要）
 * 2. AI 消息：如果有 condensedContent，使用摘要；否则使用原文
 *
 * @param chats 原始聊天记录数组
 * @param systemPrompt 系统提示词（可选）
 * @returns 用于 AI 的 messages 数组
 */
export function buildChatHistoryForAI(chats: Chat[], systemPrompt?: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  // 获取最后一次清除后的消息
  const chatsAfterClear = getChatsAfterLastClear(chats)

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

  // 添加系统提示词（如果有）
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  // 遍历聊天记录，构建 messages 数组
  for (const chat of chatsAfterClear) {
    // 只包含 chat 和 note 类型的消息
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    // 确定角色
    const role: 'user' | 'assistant' = chat.role === 'user' ? 'user' : 'assistant'

    // 确定内容
    let content: string
    if (chat.role === 'user') {
      // 用户消息：始终使用原文
      content = chat.content || ''
    } else {
      // AI 消息：使用摘要（如果有），否则使用原文
      content = chat.condensedContent || chat.content || ''
    }

    // 如果有内容才添加消息
    if (content) {
      messages.push({
        role,
        content
      })
    }
  }

  return messages
}

/**
 * 构建包含对话历史的完整 messages 数组
 * 用于替代旧的 context 字符串拼接方式
 *
 * @param chats 原始聊天记录数组
 * @param systemPrompt 系统提示词（可选）
 * @param additionalContext 额外的上下文信息（可选）
 * @param currentUserInput 当前用户输入（可选）
 * @returns 完整的 messages 数组
 */
export function buildMessagesWithHistory(
  chats: Chat[],
  systemPrompt?: string,
  additionalContext?: string,
  currentUserInput?: string,
  options?: {
    includeAssistantMessages?: boolean
    includeLatestUserMessage?: boolean
    maxUserMessages?: number
  }
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = []
  const includeAssistantMessages = options?.includeAssistantMessages ?? true
  const includeLatestUserMessage = options?.includeLatestUserMessage ?? true
  const maxUserMessages = options?.maxUserMessages

  // 1. 添加系统提示词（如果有）
  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  // 2. 添加对话历史
  let chatsAfterClear = getChatsAfterLastClear(chats)

  if (!includeLatestUserMessage) {
    const lastUserIndex = [...chatsAfterClear].map(chat => chat.role).lastIndexOf('user')
    if (lastUserIndex !== -1) {
      chatsAfterClear = chatsAfterClear.filter((_, index) => index !== lastUserIndex)
    }
  }

  if (typeof maxUserMessages === 'number' && maxUserMessages >= 0) {
    const userIndexes = chatsAfterClear
      .map((chat, index) => chat.role === 'user' ? index : -1)
      .filter(index => index !== -1)
    const allowedUserIndexes = new Set(userIndexes.slice(-maxUserMessages))
    chatsAfterClear = chatsAfterClear.filter((chat, index) => {
      if (chat.role !== 'user') {
        return true
      }

      return allowedUserIndexes.has(index)
    })
  }

  for (const chat of chatsAfterClear) {
    // 只包含 chat 和 note 类型的消息
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    if (chat.role !== 'user' && !includeAssistantMessages) {
      continue
    }

    const role: 'user' | 'assistant' = chat.role === 'user' ? 'user' : 'assistant'

    // 确定内容
    let content: string
    if (chat.role === 'user') {
      // 用户消息：始终使用原文
      content = chat.content || ''
    } else {
      // AI 消息：使用摘要（如果有），否则使用原文
      content = chat.condensedContent || chat.content || ''
    }

    // 如果有内容才添加消息
    if (content) {
      messages.push({
        role,
        content
      })
    }
  }

  // 3. 添加额外上下文（如果有）
  if (additionalContext) {
    // 将上下文作为一条 system 消息添加
    messages.push({
      role: 'system',
      content: additionalContext
    })
  }

  // 4. 添加当前用户输入（如果有）
  if (currentUserInput) {
    messages.push({
      role: 'user',
      content: currentUserInput
    })
  }

  return messages
}
