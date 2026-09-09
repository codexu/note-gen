import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import type OpenAI from 'openai';
import { AiConfig } from "@/app/core/setting/config";
import { readFile } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";
import { createTauriOpenAIClient, normalizeReasoningEffort, type OpenAICompatibleClient } from "./tauri-client";
import {
  AGENT_CORE_PROMPT_VERSION,
  isManagedAgentSystemPrompt,
} from './system-prompt';
import { loadWebSearchSettings } from '@/lib/web-search/settings';
import { isBuiltInOpenAIProvider, isMainlandChinaAppStore } from './storefront-policy';

/**
 * 获取当前的prompt内容
 */
export async function getPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const currentPromptId = await store.get<string>('currentPromptId')
  let promptContent = ''
  
  if (currentPromptId) {
    const promptList = await store.get<Array<{id: string, content: string}>>('promptList')
    if (promptList) {
      const currentPrompt = promptList.find(prompt => prompt.id === currentPromptId)
      if (currentPrompt && currentPrompt.content) {
        promptContent = currentPrompt.content
      }
    }
  }
  
  return promptContent
}

/**
 * 获取 Agent 系统提示词
 */
export async function getSystemPromptContent(): Promise<string> {
  const store = await Store.load('store.json')
  const extension = await store.get<string>('agentSystemPromptExtension')
  if (typeof extension === 'string') {
    return extension.trim()
  }

  const legacySystemPrompt = await store.get<string>('systemPrompt')
  const migratedExtension = typeof legacySystemPrompt === 'string'
    && !isManagedAgentSystemPrompt(legacySystemPrompt)
    ? legacySystemPrompt.trim()
    : ''

  await store.set('agentSystemPromptExtension', migratedExtension)
  await store.set('agentCorePromptVersion', AGENT_CORE_PROMPT_VERSION)
  await store.save()
  return migratedExtension
}

/**
 * 获取AI设置
 */
export async function getAISettings(modelType?: string): Promise<AiConfig | undefined> {
  const store = await Store.load('store.json')
  const modelId = await store.get(modelType || 'primaryModel')

  return typeof modelId === 'string'
    ? getAISettingsByModelId(modelId, store)
    : undefined
}

/**
 * Resolve a concrete model without reading the mutable primaryModel setting.
 * Agent turns use this to keep every model call in one run on the same model.
 */
export async function getAISettingsByModelId(
  modelId: string,
  loadedStore?: Store
): Promise<AiConfig | undefined> {
  const store = loadedStore ?? await Store.load('store.json')
  const aiConfigs = await store.get<AiConfig[]>('aiModelList')

  if (!modelId || !aiConfigs) {
    return undefined
  }
  const webSearchSettings = await loadWebSearchSettings(store, { aiConfigs, modelId })
  const hideBuiltInOpenAI = await isMainlandChinaAppStore()

  // 在新的数据结构中，需要找到包含指定模型ID的配置
  for (const config of aiConfigs) {
    if (hideBuiltInOpenAI && isBuiltInOpenAIProvider(config)) {
      continue
    }

    // 检查新的 models 数组结构
    if (config.models && config.models.length > 0) {
      // 首先尝试直接匹配模型ID
      let targetModel = config.models.find(model => model.id === modelId)

      // 如果没找到，尝试匹配组合键格式 ${config.key}-${model.id}
      if (!targetModel && typeof modelId === 'string' && modelId.includes('-')) {
        const expectedPrefix = `${config.key}-`
        if (modelId.startsWith(expectedPrefix)) {
          const originalModelId = modelId.substring(expectedPrefix.length)
          targetModel = config.models.find(model => model.id === originalModelId)
        }
      }

      if (targetModel) {
        const result = {
          ...config,
          model: targetModel.model,
          modelType: targetModel.modelType,
          temperature: targetModel.temperature,
          topP: targetModel.topP,
          voice: targetModel.voice,
          enableStream: targetModel.enableStream,
          maxTokens: targetModel.maxTokens,
          contextWindow: targetModel.contextWindow,
          tokenLimitParam: targetModel.tokenLimitParam,
          reasoningEffort: undefined,
          enableWebSearch: webSearchSettings.nativeEnabled
            || webSearchSettings.thirdPartyEnabled
            || webSearchSettings.basicEnabled,
          enableNativeWebSearch: webSearchSettings.nativeEnabled,
          enableThirdPartyWebSearch: webSearchSettings.thirdPartyEnabled,
          enableBasicWebSearch: webSearchSettings.basicEnabled,
          webSearchProvider: webSearchSettings.provider,
          webSearchApiKey: webSearchSettings.provider === 'auto'
            ? undefined
            : webSearchSettings.apiKeys[webSearchSettings.provider],
          webSearchApiKeys: webSearchSettings.apiKeys,
          webSearchProviderOrder: webSearchSettings.providerOrder,
        }
        return result
      }
    } else {
      // 向后兼容：处理旧的单模型结构
      if (config.key === modelId) {
        return {
          ...config,
          reasoningEffort: undefined,
          enableWebSearch: webSearchSettings.nativeEnabled
            || webSearchSettings.thirdPartyEnabled
            || webSearchSettings.basicEnabled,
          enableNativeWebSearch: webSearchSettings.nativeEnabled,
          enableThirdPartyWebSearch: webSearchSettings.thirdPartyEnabled,
          enableBasicWebSearch: webSearchSettings.basicEnabled,
          webSearchProvider: webSearchSettings.provider,
          webSearchApiKey: webSearchSettings.provider === 'auto'
            ? undefined
            : webSearchSettings.apiKeys[webSearchSettings.provider],
          webSearchApiKeys: webSearchSettings.apiKeys,
          webSearchProviderOrder: webSearchSettings.providerOrder,
        }
      }
    }
  }

  return undefined
}

export async function getEditorAISettings(): Promise<AiConfig | undefined> {
  return await getAISettings('editorModel') || await getAISettings('primaryModel')
}

export function getChatTokenLimitParams(
  config?: Pick<AiConfig, 'maxTokens' | 'tokenLimitParam'>
): { max_completion_tokens?: number; max_tokens?: number } {
  if (!config?.maxTokens || config.maxTokens < 1) return {}

  return config.tokenLimitParam === 'max_tokens'
    ? { max_tokens: config.maxTokens }
    : { max_completion_tokens: config.maxTokens }
}

/**
 * 检查AI服务配置是否有效
 */
export async function validateAIService(baseURL: string | undefined): Promise<string | null> {
  if (!baseURL) {
    toast({
      title: 'AI 错误',
      description: '请先设置 AI 地址',
      variant: 'destructive',
    })
    return null
  }
  return baseURL
}

/**
 * 将图片 URL 转换为 base64 格式
 */
export async function convertImageToBase64(imageUrl: string): Promise<string | null> {
  try {
    // 如果已经是 base64 格式，直接返回
    if (imageUrl.startsWith('data:image')) {
      return imageUrl
    }

    // 从 convertFileSrc 生成的 URL 中提取文件路径
    let filePath = imageUrl

    try {
      const url = new URL(imageUrl)
      filePath = decodeURIComponent(url.pathname)
      if (platform() === 'windows' && filePath.startsWith('/')) {
        filePath = filePath.substring(1)
      }
    } catch {
      filePath = imageUrl
    }

    // 读取文件
    const fileData = await readFile(filePath)

    // 转换为 base64
    const base64 = btoa(
      new Uint8Array(fileData).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )

    // 根据文件扩展名确定 MIME 类型
    let mimeType = 'image/png'
    if (filePath.toLowerCase().endsWith('.jpg') || filePath.toLowerCase().endsWith('.jpeg')) {
      mimeType = 'image/jpeg'
    } else if (filePath.toLowerCase().endsWith('.gif')) {
      mimeType = 'image/gif'
    } else if (filePath.toLowerCase().endsWith('.webp')) {
      mimeType = 'image/webp'
    }

    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.error('Failed to convert image to base64:', error)
    return null
  }
}

/**
 * 处理AI请求错误
 */
export function handleAIError(error: any, showToast = true): string | null {
  const errorMessage = error instanceof Error ? error.message : '未知错误'
  // 检查是否是取消请求的错误，如果是则静默处理
  if (error.message === 'Request was aborted.') {
    // 静默处理取消请求，不显示任何消息
    return null
  }
  
  if (showToast) {
    toast({
      description: errorMessage || 'AI错误',
      variant: 'destructive',
    })
  }
  
  return `请求失败: ${errorMessage}`
}

/**
 * 为不同AI类型准备消息
 * @param text 用户输入文本（如果提供了 baseMessages，此参数将作为最后一条用户消息）
 * @param baseMessages 基础消息数组（如对话历史），如果提供，将合并到返回结果中
 */
export async function prepareMessages(
  text: string,
  baseMessages?: OpenAI.Chat.ChatCompletionMessageParam[],
  options?: {
    conversationId?: number
    workspaceId?: string
    useMemory?: boolean
  }
): Promise<{
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  geminiText?: string
}> {
  // 获取当前 Prompt 模板
  let promptContent = await getPromptContent()

  const currentChatState = (await import('@/stores/chat')).default.getState()
  const shouldUseMemory = options?.useMemory
    ?? !currentChatState.isTemporaryConversation

  if (shouldUseMemory) {
    try {
      const { memoryContextService } = await import('@/lib/context/loader')
      // 确定用于检索记忆的查询文本
      let queryText = text || ''
      if (baseMessages && baseMessages.length > 0) {
        const lastUserMessage = [...baseMessages].reverse().find(message => message.role === 'user')
        if (lastUserMessage) {
          queryText = typeof lastUserMessage.content === 'string'
            ? lastUserMessage.content
            : queryText
        }
      }

      if (queryText) {
        const memoryContext = await memoryContextService.getMemoryContext({
          query: queryText,
          conversationId: options?.conversationId
            ?? currentChatState.currentConversationId
            ?? undefined,
          workspaceId: options?.workspaceId,
        })
        const memoryPrompt = memoryContextService.formatMemoryContext(memoryContext)
        if (memoryPrompt) {
          promptContent += '\n\n' + memoryPrompt
        }
      }
    } catch (error) {
      console.error('Failed to load memory context:', error)
    }
  }

  // 如果提供了基础消息数组，直接使用它
  if (baseMessages && baseMessages.length > 0) {
    // 检查是否已经有 system 消息
    const hasSystemMessage = baseMessages.some(msg => msg.role === 'system')

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []

    // 如果需要添加 system prompt 且当前没有 system 消息
    if (promptContent && !hasSystemMessage) {
      messages.push({
        role: 'system',
        content: promptContent
      })
    }

    // 添加所有基础消息
    messages.push(...baseMessages)

    // 添加系统提示词（如果有且原消息中没有）
    if (promptContent && hasSystemMessage) {
      // 如果已有 system 消息，合并内容
      const firstSystemIndex = messages.findIndex(msg => msg.role === 'system')
      if (firstSystemIndex !== -1) {
        const existingContent = typeof messages[firstSystemIndex].content === 'string'
          ? messages[firstSystemIndex].content
          : ''
        messages[firstSystemIndex] = {
          role: 'system',
          content: existingContent + '\n\n' + promptContent
        }
      }
    }

    return { messages, geminiText: undefined }
  }

  // 定义消息数组（旧逻辑，保持向后兼容）
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = []
  let geminiText: string | undefined

  if (promptContent) {
    messages.push({
      role: 'system',
      content: promptContent
    })
  }

  messages.push({
    role: 'user',
    content: text
  })

  return { messages, geminiText }
}

/**
 * 创建OpenAI客户端，适用于所有AI类型
 */
export async function createOpenAIClient(AiConfig?: AiConfig): Promise<OpenAICompatibleClient> {
  const store = await Store.load('store.json')

  if (AiConfig) {
    return createTauriOpenAIClient(AiConfig)
  }

  const baseURL = await store.get<string>('baseURL')
  const apiKey = await store.get<string>('apiKey')

  return createTauriOpenAIClient({
    key: 'runtime',
    title: 'Runtime',
    baseURL,
    apiKey,
  })
}

function getAIRequestErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isUnsupportedToolChoiceError(error: unknown): boolean {
  const message = getAIRequestErrorMessage(error)
  return /tool[_\s-]?choice/i.test(message)
    && /不支持|不存在|not\s+support|unsupported|unknown\s+(?:parameter|field)|invalid\s+(?:parameter|field)|does\s+not\s+exist\s+in\s+tools|not\s+found\s+in\s+tools|not\s+available/i.test(message)
}

function isRejectedSamplingParameterError(error: unknown, parameter: 'temperature' | 'top_p') {
  const message = getAIRequestErrorMessage(error)
  if (!new RegExp(parameter.replace('_', '[_\\s-]?'), 'i').test(message)) {
    return false
  }

  return /不支持|不允许|无效|固定|必须|取值|范围|not\s+support|unsupported|unknown\s+(?:parameter|field)|\binvalid\b|must\s+be|only\s+support|fixed\s+(?:value|to)|range/i.test(message)
}

type ReasoningAssistantToolCallMessage = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
  reasoning_content?: string
  reasoning_details?: unknown[]
}

/**
 * 思考模型在工具调用后的续请求中，需要原样回传本轮 reasoning_content。
 * 空正文使用空字符串，以兼容要求 assistant content 非 null 的 OpenAI 兼容接口。
 */
export function createAssistantToolCallMessage(
  content: string,
  toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[],
  reasoningContent?: string,
  reasoningDetails?: unknown[]
): ReasoningAssistantToolCallMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls,
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    ...(reasoningDetails?.length ? { reasoning_details: reasoningDetails } : {}),
  }
}

function getCompatibleRequestFallback(
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  error: unknown
): OpenAI.Chat.ChatCompletionCreateParamsStreaming | null {
  const fallbackParams = { ...params }
  let changed = false

  if (params.tool_choice !== undefined && isUnsupportedToolChoiceError(error)) {
    delete fallbackParams.tool_choice
    changed = true
  }
  if (params.temperature !== undefined && isRejectedSamplingParameterError(error, 'temperature')) {
    delete fallbackParams.temperature
    changed = true
  }
  if (params.top_p !== undefined && isRejectedSamplingParameterError(error, 'top_p')) {
    delete fallbackParams.top_p
    changed = true
  }

  return changed ? fallbackParams : null
}

async function createCompatibleChatCompletionStream(
  client: OpenAICompatibleClient,
  initialParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  let params = initialParams

  while (true) {
    try {
      const stream = await client.chat.completions.create(params, options)
      return (async function* () {
        let receivedChunk = false

        try {
          for await (const chunk of stream) {
            receivedChunk = true
            yield chunk
          }
        } catch (error) {
          if (receivedChunk) {
            throw error
          }

          const fallbackParams = getCompatibleRequestFallback(params, error)
          if (!fallbackParams) {
            throw error
          }

          const fallbackStream = await createCompatibleChatCompletionStream(
            client,
            fallbackParams,
            options
          )
          for await (const chunk of fallbackStream) {
            yield chunk
          }
        }
      })()
    } catch (error) {
      const fallbackParams = getCompatibleRequestFallback(params, error)
      if (!fallbackParams) {
        throw error
      }
      params = fallbackParams
    }
  }
}

/**
 * OpenAI 兼容服务对可选参数的支持并不完全一致。服务端明确拒绝
 * tool_choice 或采样参数时，保留工具定义并仅省略被拒绝的字段重试。
 */
export async function createChatCompletionStreamWithToolChoiceFallback(
  client: OpenAICompatibleClient,
  params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
  options?: { signal?: AbortSignal }
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  return createCompatibleChatCompletionStream(client, params, options)
}

function supportsEnableThinkingSwitch(aiConfig?: AiConfig): boolean {
  const model = aiConfig?.model?.toLowerCase() || ''
  const baseURL = aiConfig?.baseURL?.toLowerCase() || ''

  if (!model) {
    return false
  }

  if (model.includes('qwen3') || model.includes('qwq')) {
    return true
  }

  const isQwenProvider =
    baseURL.includes('dashscope') ||
    baseURL.includes('aliyuncs') ||
    baseURL.includes('siliconflow') ||
    baseURL.includes('notegen')

  return isQwenProvider && model.includes('qwen')
}

function requiresDashScopeGlmToolStream(
  params: OpenAI.Chat.ChatCompletionCreateParams,
  aiConfig?: AiConfig
) {
  const model = aiConfig?.model?.toLowerCase() || ''
  const baseURL = aiConfig?.baseURL?.toLowerCase() || ''
  const isDashScope = baseURL.includes('dashscope') || baseURL.includes('aliyuncs')

  return isDashScope
    && model.startsWith('glm-')
    && params.stream === true
    && Array.isArray(params.tools)
    && params.tools.length > 0
}

export function withProviderCompatibleSampling<const T extends OpenAI.Chat.ChatCompletionCreateParams>(
  params: T,
  aiConfig?: AiConfig
): T {
  const model = aiConfig?.model?.toLowerCase() || ''
  if (!/kimi-k2\.(?:5|6)(?:$|[-/])/.test(model)) {
    return params
  }

  const compatibleParams = { ...params }
  delete compatibleParams.temperature
  delete compatibleParams.top_p
  return compatibleParams
}

export function withFastAiRequestOptions<const T extends OpenAI.Chat.ChatCompletionCreateParams>(
  params: T,
  aiConfig?: AiConfig
): T {
  const hasTaskTokenLimit = params.max_completion_tokens != null || params.max_tokens != null
  const tokenLimitParams = hasTaskTokenLimit ? {} : getChatTokenLimitParams(aiConfig)
  const compatibleParams = withProviderCompatibleSampling(params, aiConfig)

  return {
    ...tokenLimitParams,
    ...compatibleParams,
    ...(!normalizeReasoningEffort(aiConfig?.reasoningEffort) && supportsEnableThinkingSwitch(aiConfig) ? { enable_thinking: false } : {}),
    ...(requiresDashScopeGlmToolStream(compatibleParams, aiConfig) ? { tool_stream: true } : {}),
  } as T
}

export function withEditorFastAiRequestOptions<const T extends OpenAI.Chat.ChatCompletionCreateParams>(
  params: T,
  aiConfig?: AiConfig
): T {
  return withFastAiRequestOptions(params, aiConfig)
}
