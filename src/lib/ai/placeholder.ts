import OpenAI from 'openai';
import { prepareMessages } from './utils';

/**
 * 生成输入框占位符建议
 * @param text 上下文内容
 * @returns 占位符文本，失败返回false
 */
export async function fetchAiPlaceholder(text: string): Promise<string | false> {
  try {
    // 动态导入 model-config 以获取默认模型配置
    const { noteGenDefaultModels } = await import('@/app/model-config')
    
    // 使用第一个默认模型配置（NoteGen Free）
    const defaultConfig = noteGenDefaultModels[0]
    const chatModel = defaultConfig.models?.find(m => m.modelType === 'chat')
    
    if (!defaultConfig || !chatModel) {
      console.error('No default chat model found in noteGenDefaultModels')
      return false
    }

    // 构建 placeholder 提示词
    const placeholderPrompt = `
      You are a note-taking software with an intelligent assistant. You can refer to the recorded content to take notes.
      IMPORTANT: Do not exceed 10 characters. Keep it extremely short.
      There is only one line left. Line breaks are strictly prohibited.
      Do not generate any special characters or punctuation.
      Leave it as plain text and no format is required.
      CRITICAL: Each response must be different and varied. Generate diverse suggestions each time, do not repeat previous patterns.
      Generate a very short question based on the following content:
      ${text}`

    // 准备消息
    const { messages } = await prepareMessages(placeholderPrompt, true)
    
    const openai = new OpenAI({
      baseURL: defaultConfig.baseURL,
      apiKey: defaultConfig.apiKey,
      dangerouslyAllowBrowser: true,
    })
      
    const completion = await openai.chat.completions.create({
      model: chatModel.model || '',
      messages: messages,
      temperature: chatModel.temperature || 1,
      top_p: chatModel.topP || 1,
    })

    const result = completion.choices[0]?.message?.content || ''

    // 去掉所有换行符和各种特殊符号，不包括空格
    return result.trim()
  } catch (error) {
    console.error('Error in fetchAiPlaceholder:', error)
    return false
  }
}
