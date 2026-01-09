import OpenAI from 'openai';
import { Store } from "@tauri-apps/plugin-store";
import { getAISettings, prepareMessages, createOpenAIClient, handleAIError, getPromptContent } from './utils';

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
    
    // 准备消息（包含语言设置）
    const { messages } = await prepareMessages(descContent, true)
    
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
    
    // 获取语言设置
    const store = await Store.load('store.json')
    const chatLanguage = await store.get<string>('chatLanguage') || 'English'
    const languageInstruction = `IMPORTANT: You MUST respond in ${chatLanguage} language. Do NOT use any other language under any circumstances.`
    
    // 获取prompt内容
    let promptContent = await getPromptContent()
    if (promptContent) {
      promptContent += '\n\n' + languageInstruction
    } else {
      promptContent = languageInstruction
    }
    
    const openai = await createOpenAIClient(aiConfig)
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
    
    // 如果有系统提示，先添加
    if (promptContent) {
      messages.push({
        role: 'system',
        content: promptContent
      })
    }
    
    // 添加用户消息（包含图片）
    messages.push({
      role: 'user' as const,
      content: [
        {
          type: 'image_url',
          image_url: {
            url: base64
          }
        },
        {
          type: 'text',
          text: descContent
        }
      ]
    })
    
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
