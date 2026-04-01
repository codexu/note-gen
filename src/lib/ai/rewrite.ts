import { getAISettings, prepareMessages, createOpenAIClient, handleAIError, validateAIService } from './utils';
import { createAiStreamContentProcessor, sanitizeAiRewriteOutput } from './sanitize';

const REWRITE_OUTPUT_RULE = 'Never output any thinking, reasoning, analysis, or <think> tags. Output only the final rewritten text.'

/**
 * 润色文本
 * @param text 要润色的文本
 * @returns 润色后的文本
 */
export async function fetchAiPolish(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 精简文本
 * @param text 要精简的文本
 * @returns 精简后的文本
 */
export async function fetchAiConcise(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 拓展文本
 * @param text 要拓展的文本
 * @returns 拓展后的文本
 */
export async function fetchAiExpand(text: string): Promise<string> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const completion = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
    })

    return sanitizeAiRewriteOutput(completion.choices[0]?.message?.content || '')
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式润色文本
 * @param text 要润色的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiPolishStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const polishPrompt = `Polish the following text. Output ONLY the polished text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(polishPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
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

/**
 * 流式精简文本
 * @param text 要精简的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiConciseStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const concisePrompt = `Make the following text more concise. Output ONLY the concise text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(concisePrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
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

/**
 * 流式拓展文本
 * @param text 要拓展的文本
 * @param onChunk 流式回调函数
 * @param abortSignal 中止信号
 */
export async function fetchAiExpandStream(
  text: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal,
  onThinkingUpdate?: (thinking: string) => void,
): Promise<void> {
  try {
    const aiConfig = await getAISettings('primaryModel')

    if (!aiConfig || await validateAIService(aiConfig.baseURL) === null) {
      throw new Error('AI service not configured')
    }

    const expandPrompt = `Expand the following text with more details. Output ONLY the expanded text, no explanations, no original text.
${REWRITE_OUTPUT_RULE}

Input:
${text}

Output:`

    const { messages } = await prepareMessages(expandPrompt)
    const openai = await createOpenAIClient(aiConfig)

    const processor = createAiStreamContentProcessor()
    let accumulatedThinking = ''
    const stream = await openai.chat.completions.create({
      model: aiConfig.model || '',
      messages,
      temperature: 0.7,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
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
