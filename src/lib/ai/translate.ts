import { getAISettings, prepareMessages, createOpenAIClient, handleAIError, validateAIService } from './utils';
import { createAiStreamContentProcessor } from './sanitize';

/**
 * 翻译文本
 * @param text 要翻译的文本
 * @param targetLanguage 目标语言
 * @returns 翻译后的文本
 */
export async function fetchAiTranslate(text: string, targetLanguage: string): Promise<string> {
  try {
    // 项目当前没有 translateModel 设置项，优先兼容未来扩展，
    // 若不存在则回退到主对话模型。
    const aiConfig = await getAISettings('translateModel') || await getAISettings('primaryModel')

    if (await validateAIService(aiConfig?.baseURL) === null) {
      return ''
    }
    
    // 构建翻译提示词
    const translationPrompt = `Translate the following text to ${targetLanguage}. Maintain the original formatting, markdown syntax, and structure:`
    
    // 准备消息
    const { messages } = await prepareMessages(`${translationPrompt}\n\n${text}`)
    const openai = await createOpenAIClient(aiConfig)
    
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
    })
    
    return completion.choices[0]?.message?.content || ''
  } catch (error) {
    return handleAIError(error) || ''
  }
}

export async function fetchAiTranslateStream(
  text: string,
  targetLanguage: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('translateModel') || await getAISettings('primaryModel')

    if (await validateAIService(aiConfig?.baseURL) === null) {
      return
    }

    const translationPrompt = `Translate the following text to ${targetLanguage}. Maintain the original formatting, markdown syntax, and structure. Output ONLY the translated text.`
    const { messages } = await prepareMessages(`${translationPrompt}\n\n${text}`)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages,
      temperature: aiConfig?.temperature || 1,
      top_p: aiConfig?.topP || 1,
      stream: true,
    }, {
      signal: abortSignal,
    })

    let isFirst = true
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      const rawThinking = (delta as { reasoning_content?: string } | undefined)?.reasoning_content || ''
      const content = delta?.content || ''

      if (rawThinking) {
        accumulatedThinking += rawThinking
        onThinkingUpdate?.(accumulatedThinking)
      }

      if (content) {
        const processed = processor.push(content)
        if (processed.thinking) {
          accumulatedThinking += processed.thinking
          onThinkingUpdate?.(accumulatedThinking)
        }
        if (processed.content) {
          onChunk(processed.content, isFirst)
          isFirst = false
        }
      }
    }

    const remaining = processor.flush()
    if (remaining.thinking) {
      accumulatedThinking += remaining.thinking
      onThinkingUpdate?.(accumulatedThinking)
    }
    if (remaining.content) {
      onChunk(remaining.content, isFirst)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    throw error
  }
}
