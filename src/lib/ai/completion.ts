import { getAISettings, validateAIService, createOpenAIClient, handleAIError } from './utils';

/**
 * 清理补全结果
 */
function cleanupCompletion(text: string): string {
  return text
    .trim()
    .replace(/^```[\s\S]*?```$/g, '')
    .replace(/^```\w*\s*/g, '')
    .replace(/\s*```$/g, '')
    .replace(/^[\s\n]+|[\s\n]+$/g, '')
    .replace(/^["'""жат]|["'""жат]$/g, '')
    .replace(/^续写[：:]\s*/i, '')
    .replace(/^补全[：:]\s*/i, '')
    .replace(/^Continuation[:\s]*/i, '')
    .trim()
}

/**
 * 快速生成代码/文本补全
 * 专门用于内联补全，使用更少的上下文和更快的响应
 */
export async function fetchCompletion(context: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    // 获取AI设置（使用快速补全模型）
    const aiConfig = await getAISettings('completionModel')

    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return ''

    const openai = await createOpenAIClient(aiConfig)

    // 构建简洁的补全 prompt
    const prompt = `Continue the following text naturally. Requirements:
- Return ONLY the continuation text (1 sentence)
- Use the same language as the context
- Do NOT use code blocks, markdown formatting, or special syntax
- Return plain text only

Context:
${context}

Continuation:`

    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: [
        {
          role: 'user',
          content: prompt,
        }
      ],
      temperature: 0.7,
      max_tokens: 80,
      top_p: 0.95,
    }, {
      signal: abortSignal
    })

    const result = completion.choices[0].message.content || ''
    return cleanupCompletion(result)
  } catch (error) {
    return handleAIError(error) || ''
  }
}

/**
 * 流式获取补全结果
 * 实时将生成的文本插入到编辑器中
 */
export async function fetchCompletionStream(
  context: string,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  try {
    // 获取AI设置（使用快速补全模型）
    const aiConfig = await getAISettings('completionModel')

    // 验证AI服务
    if (await validateAIService(aiConfig?.baseURL) === null) return

    const openai = await createOpenAIClient(aiConfig)

    // 构建简洁的补全 prompt
    const prompt = `Continue the following text naturally. Requirements:
- Return ONLY the continuation text (1 sentence)
- Use the same language as the context
- Do NOT use code blocks, markdown formatting, or special syntax
- Return plain text only

Context:
${context}

Continuation:`

    const stream = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: [
        {
          role: 'user',
          content: prompt,
        }
      ],
      temperature: 0.7,
      max_tokens: 80,
      top_p: 0.95,
      stream: true,
    }, {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      if (content) {
        const cleaned = cleanupCompletion(content)
        if (cleaned) {
          onChunk(cleaned, isFirst)
          isFirst = false
        }
      }
    }
  } catch (error) {
    // 对于 abort 请求，静默处理不抛出错误
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    // 其他错误重新抛出
    throw error
  }
}
