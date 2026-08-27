import {
  getEditorAISettings,
  validateAIService,
  createOpenAIClient,
  handleAIError,
  withEditorFastAiRequestOptions,
} from './utils';

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

export type EditorAiGenerationAction = 'section' | 'summary' | 'custom'

export interface EditorAiGenerationRequest {
  action: EditorAiGenerationAction
  fullText: string
  textBeforeCursor: string
  textAfterCursor: string
  instruction?: string
}

const FULL_NOTE_CONTEXT_LIMIT = 6000
const CURSOR_CONTEXT_LIMIT = 2400

function limitContext(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }

  const edgeLength = Math.floor(limit / 2)
  return `${text.slice(0, edgeLength)}\n\n...[content omitted]...\n\n${text.slice(-edgeLength)}`
}

function cleanupEditorAiGeneration(text: string): string {
  return text
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i, '$1')
    .trim()
}

export function sanitizeEditorAiGenerationOutput(text: string): string {
  return cleanupEditorAiGeneration(text)
}

function buildEditorAiGenerationPrompt(request: EditorAiGenerationRequest): string {
  const fullText = request.fullText.trim()
  const textBeforeCursor = request.textBeforeCursor.trim()
  const textAfterCursor = request.textAfterCursor.trim()

  const context = `Full note:
${fullText ? limitContext(fullText, FULL_NOTE_CONTEXT_LIMIT) : '(empty)'}

Text before cursor:
${textBeforeCursor ? limitContext(textBeforeCursor, CURSOR_CONTEXT_LIMIT) : '(empty)'}

Text after cursor:
${textAfterCursor ? limitContext(textAfterCursor, CURSOR_CONTEXT_LIMIT) : '(empty)'}`

  const sharedRules = `You are an AI writing assistant inside a Markdown note editor.
Return ONLY the Markdown content that should be inserted at the cursor.
Use the same primary language as the note or the user's instruction.
Do not include explanations, greetings, labels, or surrounding code fences.
Do not repeat existing note content unless it is necessary for coherence.`

  if (request.action === 'section') {
    return `${sharedRules}

Task:
Generate one coherent new section/chapter for the note.
Requirements:
- Include an appropriate Markdown heading for the new section.
- Infer the heading level from the surrounding note.
- Build on the current note context and avoid duplicating existing sections.
- Keep the result focused and ready to insert.

${context}`
  }

  if (request.action === 'summary') {
    return `${sharedRules}

Task:
Summarize the current note.
Requirements:
- Include a short Markdown heading equivalent to "Summary" in the note language.
- Capture the key points, conclusions, and action-relevant details.
- Prefer concise bullets when the note contains multiple ideas.

${context}`
  }

  return `${sharedRules}

Task:
Follow the user's custom instruction using the note context when relevant.

User instruction:
${request.instruction?.trim() || ''}

${context}`
}

/**
 * 快速生成代码/文本补全
 * 专门用于内联补全，使用更少的上下文和更快的响应
 */
export async function fetchCompletion(context: string, abortSignal?: AbortSignal): Promise<string> {
  try {
    const aiConfig = await getEditorAISettings()

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

    const completion = await openai.chat.completions.create(withEditorFastAiRequestOptions({
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
    }, aiConfig), {
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
    const aiConfig = await getEditorAISettings()

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

    const stream = await openai.chat.completions.create(withEditorFastAiRequestOptions({
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
    }, aiConfig), {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
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

/**
 * 基于当前笔记上下文生成可插入的 Markdown 内容。
 */
export async function fetchEditorAiGenerationStream(
  request: EditorAiGenerationRequest,
  onChunk: (chunk: string, isFirst: boolean) => void,
  abortSignal?: AbortSignal
): Promise<void> {
  try {
    const aiConfig = await getEditorAISettings()

    if (await validateAIService(aiConfig?.baseURL) === null) return

    const openai = await createOpenAIClient(aiConfig)
    const maxTokensByAction: Record<EditorAiGenerationAction, number> = {
      section: 900,
      summary: 700,
      custom: 1000,
    }

    const stream = await openai.chat.completions.create(withEditorFastAiRequestOptions({
      model: aiConfig?.model || '',
      messages: [
        {
          role: 'user',
          content: buildEditorAiGenerationPrompt(request),
        }
      ],
      temperature: request.action === 'summary' ? 0.4 : 0.7,
      max_tokens: maxTokensByAction[request.action],
      top_p: 0.95,
      stream: true,
    }, aiConfig), {
      signal: abortSignal
    })

    let isFirst = true
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) {
        onChunk(content, isFirst)
        isFirst = false
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return
    }
    throw error
  }
}
