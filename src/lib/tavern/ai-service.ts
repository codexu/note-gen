import { getAISettings, validateAIService, createOpenAIClient } from '@/lib/ai/utils'
import { AIMessage, ContextBuildResultV2 as ContextBuildResult } from './context-builder-v2'
import OpenAI from 'openai'

/**
 * Tavern AI 服务配置
 */
export interface TavernAIConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
  presencePenalty?: number
  frequencyPenalty?: number
  stopSequences?: string[]
  // Instruct 模式配置
  useTextCompletion?: boolean  // 使用 Text Completion API (用于本地模型)
}

/**
 * 流式 AI 响应
 */
export async function streamTavernResponse(
  messages: AIMessage[],
  onChunk: (content: string) => void,
  onThinking?: (thinking: string) => void,
  config?: TavernAIConfig,
  abortSignal?: AbortSignal
): Promise<string> {
  try {
    // 获取 AI 设置
    const aiConfig = await getAISettings()

    // 验证 AI 服务
    if (await validateAIService(aiConfig?.baseURL) === null) {
      throw new Error('AI 服务未配置或不可用')
    }

    // 创建 OpenAI 客户端
    const openai = await createOpenAIClient(aiConfig)

    // 转换消息格式
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name && { name: msg.name }),
    }))

    // 构建请求参数
    const requestParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
      model: aiConfig?.model || '',
      messages: openaiMessages,
      temperature: config?.temperature ?? aiConfig?.temperature ?? 1,
      top_p: config?.topP ?? aiConfig?.topP ?? 1,
      max_tokens: config?.maxTokens,
      presence_penalty: config?.presencePenalty,
      frequency_penalty: config?.frequencyPenalty,
      stop: config?.stopSequences,
      stream: true,
    }

    // 发起流式请求
    const stream = await openai.chat.completions.create(requestParams, {
      signal: abortSignal,
    }) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>

    let fullContent = ''
    let thinking = ''

    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break
      }

      const delta = chunk.choices[0]?.delta

      // 处理思考内容 (用于支持 reasoning 模型)
      const thinkingContent = (delta as any)?.reasoning_content || ''
      if (thinkingContent && onThinking) {
        thinking += thinkingContent
        onThinking(thinking)
      }

      // 处理普通内容
      const content = delta?.content || ''
      if (content) {
        fullContent += content
        onChunk(fullContent)
      }
    }

    return fullContent
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return ''
      }
      throw error
    }
    throw new Error('AI 请求失败')
  }
}

/**
 * 非流式 AI 响应
 */
export async function fetchTavernResponse(
  messages: AIMessage[],
  config?: TavernAIConfig
): Promise<string> {
  try {
    // 获取 AI 设置
    const aiConfig = await getAISettings()

    // 验证 AI 服务
    if (await validateAIService(aiConfig?.baseURL) === null) {
      throw new Error('AI 服务未配置或不可用')
    }

    // 创建 OpenAI 客户端
    const openai = await createOpenAIClient(aiConfig)

    // 转换消息格式
    const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.name && { name: msg.name }),
    }))

    // 发起请求
    const completion = await openai.chat.completions.create({
      model: aiConfig?.model || '',
      messages: openaiMessages,
      temperature: config?.temperature ?? aiConfig?.temperature ?? 1,
      top_p: config?.topP ?? aiConfig?.topP ?? 1,
      max_tokens: config?.maxTokens,
      presence_penalty: config?.presencePenalty,
      frequency_penalty: config?.frequencyPenalty,
      stop: config?.stopSequences,
    })

    return completion.choices[0]?.message?.content || ''
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('AI 请求失败')
  }
}

/**
 * 检查 AI 服务是否可用
 */
export async function checkAIServiceAvailable(): Promise<boolean> {
  try {
    const aiConfig = await getAISettings()
    return await validateAIService(aiConfig?.baseURL) !== null
  } catch {
    return false
  }
}

/**
 * 流式 Text Completion 响应
 * 适用于支持 completions API 的后端
 */
export async function streamTextCompletion(
  prompt: string,
  onChunk: (content: string) => void,
  config?: TavernAIConfig,
  abortSignal?: AbortSignal
): Promise<string> {
  try {
    const aiConfig = await getAISettings()

    if (await validateAIService(aiConfig?.baseURL) === null) {
      throw new Error('AI 服务未配置或不可用')
    }

    const openai = await createOpenAIClient(aiConfig)

    // 使用 completions API (text completion)
    const stream = await openai.completions.create({
      model: aiConfig?.model || '',
      prompt,
      temperature: config?.temperature ?? aiConfig?.temperature ?? 1,
      top_p: config?.topP ?? aiConfig?.topP ?? 1,
      max_tokens: config?.maxTokens,
      presence_penalty: config?.presencePenalty,
      frequency_penalty: config?.frequencyPenalty,
      stop: config?.stopSequences,
      stream: true,
    }, {
      signal: abortSignal,
    }) as unknown as AsyncIterable<OpenAI.Completions.Completion>

    let fullContent = ''

    for await (const chunk of stream) {
      if (abortSignal?.aborted) {
        break
      }

      const text = chunk.choices[0]?.text || ''
      if (text) {
        fullContent += text
        onChunk(fullContent)
      }
    }

    return fullContent
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return ''
      }
      throw error
    }
    throw new Error('AI 请求失败')
  }
}

/**
 * 智能流式响应 - 根据上下文结果自动选择响应方式
 */
export async function streamTavernResponseSmart(
  contextResult: ContextBuildResult,
  onChunk: (content: string) => void,
  onThinking?: (thinking: string) => void,
  config?: TavernAIConfig,
  abortSignal?: AbortSignal
): Promise<string> {
  // 使用标准 Chat Completion
  return streamTavernResponse(
    contextResult.messages,
    onChunk,
    onThinking,
    config,
    abortSignal
  )
}
