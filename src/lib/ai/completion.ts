import { getAISettings, validateAIService, createOpenAIClient, handleAIError } from './utils';

/**
 * 快速生成代码/文本补全
 * 专门用于内联补全，使用更少的上下文和更快的响应
 */
export async function fetchCompletion(context: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    // 获取AI设置（使用快速补全模型）
    const aiConfig = await getAISettings('completionModel')
    
    // 验证AI服务
    if (validateAIService(aiConfig?.baseURL) === null) return ''

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
      max_tokens: 80, // 减少到 80 tokens，加快响应速度
      top_p: 0.95,
    }, {
      signal: abortSignal
    })
    
    const result = completion.choices[0].message.content || ''
    
    // 清理结果：移除前后空格、换行符、引号、代码块标记和可能的标题
    return result
      .trim() // 移除前后空格和换行
      .replace(/^```[\s\S]*?```$/g, '') // 移除完整的代码块
      .replace(/^```\w*\s*/g, '') // 移除开始的代码块标记
      .replace(/\s*```$/g, '') // 移除结束的代码块标记
      .replace(/^[\s\n]+|[\s\n]+$/g, '') // 再次确保移除所有空白字符
      .replace(/^["'“”]|["'“”]$/g, '') // 移除首尾引号（包括中文引号）
      .replace(/^续写[：:]\s*/i, '') // 移除可能的标题
      .replace(/^补全[：:]\s*/i, '')
      .replace(/^Continuation[:\s]*/i, '') // 移除 Continuation: 标题
      .trim() // 最后再 trim 一次
  } catch (error) {
    return handleAIError(error) || ''
  }
}
