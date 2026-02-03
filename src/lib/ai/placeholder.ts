import OpenAI from 'openai';
import { prepareMessages } from './utils';
import useSettingStore from '@/stores/setting';

export interface QuickPrompt {
  id: string
  text: string
}

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

/**
 * 获取灵感模型配置
 * @returns 灵感模型配置，如果未配置则返回 null
 */
async function getInspirationModelConfig() {
  const settingStore = useSettingStore.getState()
  const inspirationModelId = settingStore.inspirationModel

  // 如果没有配置灵感模型，返回 null
  if (!inspirationModelId) {
    return null
  }

  // 从 AI 模型列表中查找配置的灵感模型
  const aiModelList = settingStore.aiModelList
  for (const config of aiModelList) {
    if (config.models) {
      const model = config.models.find(m => m.id === inspirationModelId || `${config.key}-${m.id}` === inspirationModelId)
      if (model) {
        return config
      }
    }
  }

  // 如果没找到，返回 null
  return null
}

/**
 * 生成4条灵感提示词
 * @param text 上下文内容
 * @returns 灵感提示词数组，失败返回空数组
 */
export async function fetchAiQuickPrompts(text: string): Promise<QuickPrompt[]> {
  try {
    const config = await getInspirationModelConfig()
    const chatModel = config?.models?.find(m => m.modelType === 'chat')

    if (!config || !chatModel) {
      console.error('No valid chat model found for inspiration')
      return []
    }

    // 构建生成4条提示词的 prompt
    const prompt = `
You are a note-taking software with an intelligent assistant. Generate 4 different quick prompt suggestions based on the following content.

Requirements:
1. Each prompt should be short and actionable (under 15 characters)
2. Each prompt must be different and serve various purposes
3. Prompts should be in Chinese unless the content is clearly in English
4. Return ONLY a JSON array of strings, no other text
5. Do not include any special characters or punctuation in the prompts

Format: ["prompt1", "prompt2", "prompt3", "prompt4"]

Content to analyze:
${text || 'No content provided, generate general note-taking prompts'}`

    const { messages } = await prepareMessages(prompt, true)

    const openai = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })

    const completion = await openai.chat.completions.create({
      model: chatModel.model || '',
      messages: messages,
      temperature: 0.8, // 使用较高的温度以获得更多样化的结果
      top_p: chatModel.topP || 1,
    })

    const result = completion.choices[0]?.message?.content || ''

    // 尝试解析 JSON 结果
    try {
      // 清理可能的 markdown 代码块标记
      const cleanResult = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const prompts = JSON.parse(cleanResult)

      if (Array.isArray(prompts) && prompts.length >= 4) {
        return prompts.slice(0, 4).map((text, index) => ({
          id: `ai-prompt-${index}`,
          text: String(text).trim()
        }))
      }

      // 如果解析的数组不足4条，返回能解析的部分
      if (Array.isArray(prompts)) {
        return prompts.map((text, index) => ({
          id: `ai-prompt-${index}`,
          text: String(text).trim()
        }))
      }
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError)
    }

    // 如果 JSON 解析失败，尝试按行分割
    const lines = result.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('[') && !line.startsWith(']'))

    if (lines.length >= 4) {
      return lines.slice(0, 4).map((text, index) => ({
        id: `ai-prompt-${index}`,
        text: text.replace(/^["']|["']$/g, '').trim()
      }))
    }

    return []
  } catch (error) {
    console.error('Error in fetchAiQuickPrompts:', error)
    return []
  }
}

/**
 * 生成单个灵感提示词（用于 placeholder）
 * @param text 上下文内容
 * @returns 提示词文本，失败返回空字符串
 */
export async function fetchAiSinglePrompt(text: string): Promise<string> {
  try {
    const config = await getInspirationModelConfig()
    const chatModel = config?.models?.find(m => m.modelType === 'chat')

    if (!config || !chatModel) {
      console.error('No valid chat model found for inspiration')
      return ''
    }

    const prompt = `
Generate ONE very short and actionable prompt suggestion (under 15 characters) based on the following content.
Return ONLY the prompt text, nothing else.
Do not include any special characters or punctuation.

Content: ${text || 'No content provided'}`

    const { messages } = await prepareMessages(prompt, true)

    const openai = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    })

    const completion = await openai.chat.completions.create({
      model: chatModel.model || '',
      messages: messages,
      temperature: 0.8,
      top_p: chatModel.topP || 1,
    })

    const result = completion.choices[0]?.message?.content || ''
    return result.trim()
  } catch (error) {
    console.error('Error in fetchAiSinglePrompt:', error)
    return ''
  }
}
