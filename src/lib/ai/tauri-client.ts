import { Channel, invoke } from '@tauri-apps/api/core'
import type OpenAI from 'openai'
import type { ModelsPage } from 'openai/resources/models'
import { Store } from '@tauri-apps/plugin-store'
import type { AiConfig, ReasoningEffort } from '@/app/core/setting/config'

type JsonValue = Record<string, unknown>

export interface AiRequestConfig {
  baseUrl: string
  apiKey?: string
  customHeaders?: Record<string, string>
  proxy?: AiProxyConfig
}

export type AiProxyConfig =
  | { mode: 'direct' }
  | { mode: 'custom'; url: string }

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:'])

export const REASONING_EFFORTS: readonly ReasoningEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

// Only documented IDs on native endpoints are classified; gateways and aliases
// remain unknown. See the model pages linked below before extending this list.
export function getReasoningEfforts(aiConfig?: AiConfig): readonly ReasoningEffort[] | undefined {
  const model = aiConfig?.model?.trim().toLowerCase() || ''
  const hostname = getProviderHostname(aiConfig)
  const matches = (name: string) => model === name
    || (model.startsWith(`${name}-`) && /^\d{4}-\d{2}-\d{2}$/.test(model.slice(name.length + 1)))
  // https://developers.openai.com/api/docs/models/gpt-5.1
  // https://developers.openai.com/api/docs/models/gpt-5.2
  // https://developers.openai.com/api/docs/models/gpt-4.1
  if (hostname === 'api.openai.com') {
    if (matches('gpt-5.1')) return ['none', 'low', 'medium', 'high']
    if (matches('gpt-5.2')) return ['none', 'low', 'medium', 'high', 'xhigh']
    if (matches('gpt-4.1')) return []
  }
  // https://ai.google.dev/gemini-api/docs/openai
  if (hostname === 'generativelanguage.googleapis.com') {
    if (['gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(model)) {
      return ['none', 'minimal', 'low', 'medium', 'high']
    }
    if (['gemini-2.5-pro', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview'].includes(model)) {
      return ['minimal', 'low', 'medium', 'high']
    }
  }
  // Thinking switches, not discrete effort levels:
  // https://platform.kimi.ai/docs/api/models-overview.md
  // https://platform.minimaxi.com/docs/api-reference/text-chat-openai.md
  if (['api.moonshot.cn', 'api.moonshot.ai'].includes(hostname) && model === 'kimi-k2.6') return ['none']
  if (hostname === 'api.minimaxi.com') {
    if (model === 'minimax-m3') return ['none']
    if (['minimax-m2', 'minimax-m2.1', 'minimax-m2.5'].includes(model)) return []
  }
  return undefined
}

type ReasoningRequestFields = {
  reasoning_effort?: ReasoningEffort
  reasoning?: Record<string, unknown> & { effort: ReasoningEffort }
  thinking?: { type: 'disabled' }
  enable_thinking?: false
}

export function normalizeReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
    || value === 'max'
    ? value
    : undefined
}

function getProviderHostname(aiConfig?: AiConfig): string {
  try {
    return new URL(aiConfig?.baseURL || '').hostname.toLowerCase()
  } catch {
    return ''
  }
}

function isProvider(aiConfig: AiConfig | undefined, keys: string[], hostnames: string[]): boolean {
  const providerKey = (aiConfig?.templateKey || aiConfig?.key || '').toLowerCase()
  const hostname = getProviderHostname(aiConfig)
  return keys.includes(providerKey) || hostnames.some(domain => (
    hostname === domain || hostname.endsWith(`.${domain}`)
  ))
}

function isOpenRouterProvider(aiConfig?: AiConfig): boolean {
  return isProvider(aiConfig, ['openrouter'], ['openrouter.ai'])
}

function isDeepSeekProvider(aiConfig?: AiConfig): boolean {
  return isProvider(aiConfig, ['deepseek'], ['api.deepseek.com'])
}

function isMoonshotProvider(aiConfig?: AiConfig): boolean {
  return isProvider(aiConfig, ['kimi', 'moonshot'], ['api.moonshot.cn', 'api.moonshot.ai'])
}

function isMiniMaxProvider(aiConfig?: AiConfig): boolean {
  return isProvider(aiConfig, ['minimax'], ['api.minimaxi.com'])
}

function isZhipuProvider(aiConfig?: AiConfig): boolean {
  return isProvider(aiConfig, ['bigmodel', 'zhipu'], ['open.bigmodel.cn'])
}

function usesThinkingObjectForDisabledReasoning(aiConfig?: AiConfig): boolean {
  const model = aiConfig?.model?.trim().toLowerCase() || ''

  if (isDeepSeekProvider(aiConfig)) {
    return true
  }

  if (isMoonshotProvider(aiConfig) && /^kimi-k2\.6(?:$|[-_.])/.test(model)) {
    return true
  }

  if (isMiniMaxProvider(aiConfig) && /^minimax-m3(?:$|[-_.])/.test(model)) {
    return true
  }

  if (!isZhipuProvider(aiConfig)) {
    return false
  }

  return /^glm-4\.[5-9]v?(?:$|[-_.])/.test(model)
    || /^glm-5(?:$|[-v_])/.test(model)
    || /^glm-5\.1(?:$|[-_.])/.test(model)
}

function usesEnableThinkingForDisabledReasoning(aiConfig?: AiConfig): boolean {
  const model = aiConfig?.model?.toLowerCase() || ''
  const isKnownQwenProvider = isProvider(
    aiConfig,
    ['aliyun', 'bailian', 'qwen', 'siliconflow'],
    [
      'dashscope.aliyuncs.com',
      'dashscope-intl.aliyuncs.com',
      'api.siliconflow.cn',
      'api.siliconflow.com',
      'api.notegen.top',
    ]
  )

  return isKnownQwenProvider && (model.includes('qwen') || model.includes('qwq'))
}

/**
 * Reasoning controls differ across otherwise OpenAI-compatible providers.
 * Unknown custom endpoints receive the standard reasoning_effort field. An
 * explicitly selected value is never silently discarded: unsupported values
 * remain visible as provider errors, while an unset value preserves old requests.
 */
function applyReasoningEffort<T extends OpenAI.Chat.ChatCompletionCreateParams>(
  body: T,
  aiConfig?: AiConfig
): T {
  const effort = normalizeReasoningEffort(aiConfig?.reasoningEffort)
  if (!effort) {
    return body
  }

  let reasoningFields: ReasoningRequestFields
  if (isOpenRouterProvider(aiConfig)) {
    const existingReasoning = (body as unknown as Record<string, unknown>).reasoning
    reasoningFields = {
      reasoning: {
        ...(existingReasoning && typeof existingReasoning === 'object' && !Array.isArray(existingReasoning)
          ? existingReasoning as Record<string, unknown>
          : {}),
        effort,
      },
    }
  } else if (effort === 'none' && usesThinkingObjectForDisabledReasoning(aiConfig)) {
    reasoningFields = { thinking: { type: 'disabled' } }
  } else if (effort === 'none' && usesEnableThinkingForDisabledReasoning(aiConfig)) {
    reasoningFields = { enable_thinking: false }
  } else {
    reasoningFields = { reasoning_effort: effort }
  }

  return { ...body, ...reasoningFields } as T
}

export function isValidProxyURL(proxyURL: string | undefined): boolean {
  const value = proxyURL?.trim()
  if (!value) return false

  try {
    const normalizedValue = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`
    const url = new URL(normalizedValue)
    return !!url.hostname && SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

interface JsonRequestPayload {
  config: AiRequestConfig
  path: string
  method?: string
  body?: unknown
  requestId?: string
}

interface MultipartRequestPayload {
  config: AiRequestConfig
  path: string
  fields?: Record<string, string>
  fileFieldName: string
  file: {
    bytes: number[]
    fileName: string
    contentType?: string
  }
  requestId?: string
}

type StreamEvent<T> =
  | { type: 'chunk'; data: T }
  | { type: 'error'; data: string }
  | { type: 'done' }

class AbortError extends Error {
  constructor() {
    super('Request was aborted.')
    this.name = 'AbortError'
  }
}

class AsyncQueue<T> implements AsyncIterable<T>, AsyncIterator<T> {
  private values: T[] = []
  private waiters: Array<{ resolve: (value: IteratorResult<T>) => void; reject: (reason?: unknown) => void }> = []
  private completed = false
  private failure: Error | null = null

  push(value: T) {
    if (this.completed || this.failure) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close() {
    if (this.completed) return
    this.completed = true
    while (this.waiters.length) {
      const waiter = this.waiters.shift()
      waiter?.resolve({ value: undefined as T, done: true })
    }
  }

  fail(error: Error) {
    if (this.completed || this.failure) return
    this.failure = error
    while (this.waiters.length) {
      const waiter = this.waiters.shift()
      waiter?.reject(error)
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.failure) {
      throw this.failure
    }
    if (this.values.length) {
      const value = this.values.shift() as T
      return { value, done: false }
    }
    if (this.completed) {
      return { value: undefined as T, done: true }
    }
    return new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this
  }
}

function createRequestId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

export async function resolveAiRequestConfig(aiConfig?: AiConfig): Promise<AiRequestConfig> {
  const proxyMode = aiConfig?.proxyMode || 'inherit'
  let proxy: AiProxyConfig = { mode: 'direct' }

  if (proxyMode === 'inherit') {
    const store = await Store.load('store.json')
    const globalProxyURL = (await store.get<string>('proxy'))?.trim()
    if (globalProxyURL) {
      proxy = { mode: 'custom', url: globalProxyURL }
    }
  } else if (proxyMode === 'custom') {
    const customProxyURL = aiConfig?.proxyURL?.trim()
    if (!isValidProxyURL(customProxyURL)) {
      throw new Error('Invalid custom proxy URL.')
    }
    proxy = { mode: 'custom', url: customProxyURL as string }
  }

  return {
    baseUrl: aiConfig?.baseURL || '',
    apiKey: aiConfig?.apiKey,
    customHeaders: aiConfig?.customHeaders,
    proxy,
  }
}

function toAbortError(error: unknown) {
  if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Request was aborted.')) {
    return new AbortError()
  }
  if (error instanceof Error) return error
  return new Error(String(error))
}

async function cancelRequest(requestId: string) {
  try {
    await invoke('cancel_ai_request', { requestId })
  } catch {
    // ignore cancellation race
  }
}

function attachAbort(signal: AbortSignal | undefined, requestId: string) {
  if (!signal) return () => {}
  if (signal.aborted) {
    void cancelRequest(requestId)
    throw new AbortError()
  }

  const onAbort = () => {
    void cancelRequest(requestId)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

export async function invokeAiJson<T = JsonValue>(
  payload: Omit<JsonRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<T> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    return await invoke<T>('ai_json_request', {
      request: {
        ...payload,
        requestId,
      },
    })
  } catch (error) {
    throw toAbortError(error)
  } finally {
    detachAbort()
  }
}

export async function invokeAiBinary(
  payload: Omit<JsonRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    const response = await invoke<number[]>('ai_binary_request', {
      request: {
        ...payload,
        requestId,
      },
    })
    return Uint8Array.from(response).buffer
  } catch (error) {
    throw toAbortError(error)
  } finally {
    detachAbort()
  }
}

export async function invokeAiMultipart<T = JsonValue>(
  payload: Omit<MultipartRequestPayload, 'requestId'>,
  signal?: AbortSignal
): Promise<T> {
  const requestId = signal ? createRequestId() : undefined
  const detachAbort = requestId ? attachAbort(signal, requestId) : () => {}
  try {
    return await invoke<T>('ai_multipart_request', {
      request: {
        ...payload,
        requestId,
      },
    })
  } catch (error) {
    throw toAbortError(error)
  } finally {
    detachAbort()
  }
}

function createStreamingIterable<T>(
  request: {
    config: AiRequestConfig
    requestId: string
    body: unknown
  },
  signal?: AbortSignal
) {
  const queue = new AsyncQueue<T>()
  const detachAbort = attachAbort(signal, request.requestId)
  const channel = new Channel<StreamEvent<T>>((event) => {
    if (event.type === 'chunk') {
      queue.push(event.data)
      return
    }
    if (event.type === 'error') {
      queue.fail(new Error(event.data))
      return
    }
    queue.close()
  })

  void invoke('ai_chat_completion_stream', {
    request,
    onEvent: channel,
  }).then(() => {
    queue.close()
  }).catch((error) => {
    queue.fail(toAbortError(error))
  }).finally(() => {
    detachAbort()
  })

  return queue
}

type ChatCompletionCreate = {
  (body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming, options?: { signal?: AbortSignal }): Promise<OpenAI.Chat.ChatCompletion>
  (body: OpenAI.Chat.ChatCompletionCreateParamsStreaming, options?: { signal?: AbortSignal }): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>
}

export type OpenAICompatibleClient = {
  chat: {
    completions: {
      create: ChatCompletionCreate
    }
  }
  models: {
    list: (options?: { signal?: AbortSignal }) => Promise<ModelsPage>
  }
}

export async function createTauriOpenAIClient(aiConfig?: AiConfig): Promise<OpenAICompatibleClient> {
  const config = await resolveAiRequestConfig(aiConfig)

  return {
    chat: {
      completions: {
        create: (async (body, options) => {
          const requestBody = applyReasoningEffort(body, aiConfig)
          if ('stream' in body && body.stream) {
            return createStreamingIterable<OpenAI.Chat.Completions.ChatCompletionChunk>({
              config,
              requestId: createRequestId(),
              body: requestBody,
            }, options?.signal)
          }

          return invokeAiJson<OpenAI.Chat.ChatCompletion>({
            config,
            path: '/chat/completions',
            method: 'POST',
            body: requestBody,
          }, options?.signal)
        }) as ChatCompletionCreate,
      },
    },
    models: {
      list: async (options) =>
        invokeAiJson<ModelsPage>({
          config,
          path: '/models',
          method: 'GET',
        }, options?.signal),
    },
  }
}

export async function blobToBytes(blob: Blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}
