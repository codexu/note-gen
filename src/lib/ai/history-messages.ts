type ChatLike = {
  id?: number
  role: string
  type: string
  content?: string | null
  condensedContent?: string | null
}

type MessageLike = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const MAX_RETAINED_MESSAGE_CHARS = 16_000

function preserveContinuationTail(content: string, enabled: boolean) {
  if (!enabled || content.length <= MAX_RETAINED_MESSAGE_CHARS) return content
  const omitted = content.length - MAX_RETAINED_MESSAGE_CHARS
  return `[Earlier content in this message omitted: ${omitted} characters]\n\n${content.slice(-MAX_RETAINED_MESSAGE_CHARS)}`
}

/**
 * 获取最后一次清除后的消息
 */
export function getChatsAfterLastClear<T extends ChatLike>(chats: T[]): T[] {
  const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
  return lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)
}

/**
 * 构建用于 AI 的消息历史
 */
export function buildChatHistoryForAI(chats: ChatLike[], systemPrompt?: string): MessageLike[] {
  const chatsAfterClear = getChatsAfterLastClear(chats)
  const messages: MessageLike[] = []

  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  for (const chat of chatsAfterClear) {
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    const role: 'user' | 'assistant' = chat.role === 'user' ? 'user' : 'assistant'
    const content = chat.content || ''

    if (content) {
      messages.push({ role, content })
    }
  }

  return messages
}

/**
 * 构建包含对话历史的完整 messages 数组
 */
export function buildMessagesWithHistory(
  chats: ChatLike[],
  systemPrompt?: string,
  additionalContext?: string,
  currentUserInput?: string,
  options?: {
    includeAssistantMessages?: boolean
    includeLatestUserMessage?: boolean
    maxUserMessages?: number
    conversationSummary?: string
    coveredThroughChatId?: number
  }
): MessageLike[] {
  const messages: MessageLike[] = []
  const includeAssistantMessages = options?.includeAssistantMessages ?? true
  const includeLatestUserMessage = options?.includeLatestUserMessage ?? true
  const maxUserMessages = options?.maxUserMessages

  if (systemPrompt) {
    messages.push({
      role: 'system',
      content: systemPrompt
    })
  }

  let chatsAfterClear = getChatsAfterLastClear(chats)

  if (options?.conversationSummary) {
    messages.push({
      role: 'system',
      content: `以下是较早对话的锚定摘要，仅用于恢复上下文。摘要可能省略细节；如果它与最近原始消息冲突，以最近原始消息为准。

<conversation-summary>
${options.conversationSummary}
</conversation-summary>`
    })
  }

  if (typeof options?.coveredThroughChatId === 'number') {
    chatsAfterClear = chatsAfterClear.filter(chat =>
      typeof chat.id !== 'number' || chat.id > options.coveredThroughChatId!
    )
  }

  if (!includeLatestUserMessage) {
    const lastUserIndex = [...chatsAfterClear].map(chat => chat.role).lastIndexOf('user')
    if (lastUserIndex !== -1) {
      // The current user message is appended explicitly below. Remove it together
      // with any placeholder assistant rows created after it so history remains a
      // sequence of completed turns.
      chatsAfterClear = chatsAfterClear.slice(0, lastUserIndex)
    }
  }

  if (typeof maxUserMessages === 'number' && maxUserMessages >= 0) {
    const userIndexes = chatsAfterClear
      .map((chat, index) => chat.role === 'user' ? index : -1)
      .filter(index => index !== -1)

    if (maxUserMessages === 0 || userIndexes.length === 0) {
      chatsAfterClear = []
    } else {
      const firstRetainedUserIndex = userIndexes.at(-maxUserMessages) ?? userIndexes[0]
      // Retain complete chronological turns. Keeping old assistant messages while
      // dropping the user messages they answered creates misleading, orphaned
      // assertions that smaller models may treat as current app state.
      chatsAfterClear = chatsAfterClear.slice(firstRetainedUserIndex)
    }
  }

  for (const chat of chatsAfterClear) {
    if (chat.type !== 'chat' && chat.type !== 'note') {
      continue
    }

    if (chat.role !== 'user' && !includeAssistantMessages) {
      continue
    }

    const role: 'user' | 'assistant' = chat.role === 'user' ? 'user' : 'assistant'
    const content = preserveContinuationTail(
      chat.content || '',
      Boolean(options?.conversationSummary)
    )

    if (content) {
      messages.push({ role, content })
    }
  }

  if (additionalContext) {
    messages.push({
      role: 'system',
      content: additionalContext
    })
  }

  if (currentUserInput) {
    messages.push({
      role: 'user',
      content: currentUserInput
    })
  }

  return messages
}
