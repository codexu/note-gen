import type OpenAI from 'openai'
import { convertImageToBase64 } from '@/lib/ai/utils'

const MAX_RECENT_TOOL_RESULT_CHARS = 12000
const MAX_OLD_TOOL_RESULT_CHARS = 2000
const MAX_HISTORY_MESSAGES = 60

function isToolMessage(message: OpenAI.Chat.ChatCompletionMessageParam) {
  return message.role === 'tool'
}

function compactToolMessage(
  message: OpenAI.Chat.ChatCompletionMessageParam,
  maxChars: number
): OpenAI.Chat.ChatCompletionMessageParam {
  if (!isToolMessage(message)) {
    return message
  }

  const content = typeof message.content === 'string' ? message.content : ''
  if (content.length <= maxChars) {
    return message
  }

  return {
    ...message,
    content: [
      content.slice(0, Math.floor(maxChars * 0.7)),
      '',
      `[tool result pruned: source=${message.tool_call_id}; ${content.length - maxChars} characters omitted]`,
      '',
      content.slice(-Math.ceil(maxChars * 0.3)),
    ].join('\n'),
  }
}

export class AgentContextManager {
  prepareMessages(
    messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const userIndexes = messages
      .map((message, index) => message.role === 'user' ? index : -1)
      .filter(index => index >= 0)
    const recentTurnStart = userIndexes.at(-2) ?? 0
    const compacted = messages.map((message, index) =>
      compactToolMessage(
        message,
        index >= recentTurnStart
          ? MAX_RECENT_TOOL_RESULT_CHARS
          : MAX_OLD_TOOL_RESULT_CHARS
      )
    )

    if (compacted.length <= MAX_HISTORY_MESSAGES) {
      return compacted
    }

    const head = compacted.slice(0, 3)
    const tail = compacted.slice(-(MAX_HISTORY_MESSAGES - 3))
    const omitted = compacted.length - head.length - tail.length

    return [
      ...head,
      {
        role: 'system',
        content: `[Earlier conversation compacted: ${omitted} messages omitted. Continue from the preserved recent context.]`,
      },
      ...tail,
    ]
  }

  async buildCurrentUserMessage(
    text: string,
    imageUrls?: string[]
  ): Promise<OpenAI.Chat.ChatCompletionMessageParam> {
    if (!imageUrls || imageUrls.length === 0) {
      return {
        role: 'user',
        content: text,
      }
    }

    const content: Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    > = []

    for (const imageUrl of imageUrls) {
      const base64Image = await convertImageToBase64(imageUrl)
      if (base64Image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: base64Image,
          },
        })
      }
    }

    content.push({
      type: 'text',
      text,
    })

    return {
      role: 'user',
      content,
    }
  }
}
