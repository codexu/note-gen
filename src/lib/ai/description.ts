import OpenAI from 'openai';
import { getAISettings, prepareMessages, createOpenAIClient, handleAIError } from './utils';

/**
 * 生成文本描述
 * @param text 文本内容
 * @returns 描述文本
 */
export async function fetchAiDesc(text: string) {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('markDescModel')
    
    const descContent = `Based on the screenshot content: ${text}, return a description. Keep it under 50 characters and avoid special characters.`
    
    // 准备消息
    const { messages } = await prepareMessages(descContent)
    
    const openai = await createOpenAIClient(aiConfig)
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    
    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}

/**
 * 通过图片生成描述
 * @param base64 图片的base64编码
 * @returns 描述文本
 */
export async function fetchAiDescByImage(base64: string) {
  try {
    // 获取AI设置
    const aiConfig = await getAISettings('imageMethodModel')

    const descContent = `Based on the screenshot content, return a description.`

    // 使用 prepareMessages 获取包含记忆上下文的消息
    const { messages: preparedMessages } = await prepareMessages(descContent)

    const openai = await createOpenAIClient(aiConfig)

    // 将最后一条用户消息转换为多模态格式（包含图片）
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    for (let i = 0; i < preparedMessages.length; i++) {
      const msg = preparedMessages[i]

      if (i === preparedMessages.length - 1 && msg.role === 'user') {
        // 最后一条消息：转换为多模态格式（图片 + 文本）
        const textContent = typeof msg.content === 'string' ? msg.content : descContent
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: base64
              }
            },
            {
              type: 'text',
              text: textContent
            }
          ]
        })
      } else {
        // 其他消息：保持原样
        messages.push(msg)
      }
    }

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })

    return completion.choices[0].message.content || ''
  } catch (error) {
    handleAIError(error, false)
    return null
  }
}
