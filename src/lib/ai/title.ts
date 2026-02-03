import { fetchAi } from '@/lib/ai/chat'
import OpenAI from 'openai'

/**
 * 生成会话标题
 * @param userMessage 用户第一条消息
 * @param aiModel 使用的 AI 模型
 * @returns 生成的标题
 */
export async function generateConversationTitle(
  userMessage: string,
  aiModel: string
): Promise<string> {
  // 如果消息很短（< 15 字符），直接截取
  if (userMessage.length < 15) {
    return userMessage.slice(0, 10)
  }

  const prompt = `请根据以下用户消息，生成一个简洁的对话标题。

要求：
1. 标题长度控制在 10 个中文字符左右
2. 概括消息的核心主题或问题
3. 使用自然、简洁的语言
4. 不要使用标点符号

用户消息：
${userMessage}

请直接返回标题，不要有其他内容。`

  try {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt }
    ]
    const response = await fetchAi('', aiModel, messages)
    const title = response?.trim() || ''
    return title.slice(0, 15) // 限制最大长度
  } catch {
    // 失败时回退：截取前 10 个字符
    return userMessage.slice(0, 10)
  }
}
