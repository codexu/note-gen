import type { AiConfig, ModelConfig } from '@/app/core/setting/config'

export const MINIMAX_MODELS = ['MiniMax-M3.1-Flash', 'MiniMax-M3'] as const
export const MINIMAX_FLASH_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const OPENROUTER_MINIMAX_MODELS = ['minimax/minimax-m3.1-flash:free', 'minimax/minimax-m3'] as const

// Match the endpoint, not a template label that may survive a custom URL edit.
export function getMiniMaxRoute(baseURL?: string): 'direct' | 'openrouter' | undefined {
  try {
    const url = new URL(baseURL || '')
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return undefined
    const path = url.pathname.replace(/\/$/, '')
    if (['api.minimax.io', 'api.minimax.cn', 'api.minimaxi.com'].includes(url.hostname) && path === '/v1') return 'direct'
    if (url.hostname === 'openrouter.ai' && path === '/api/v1') return 'openrouter'
  } catch {
    // Custom or incomplete URLs retain their existing behavior.
  }
  return undefined
}

// https://platform.minimax.io/docs/api-reference/text-openai-api
// Only new templates are seeded; persisted model IDs are never migrated.
export function withMiniMaxModels<T extends AiConfig>(template: T): T {
  if (getMiniMaxRoute(template.baseURL) !== 'direct') return template
  const models: ModelConfig[] = MINIMAX_MODELS.map((model) => ({
    id: `${template.key}-${model}`,
    model,
    modelType: 'chat',
    enableStream: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 524_288,
    tokenLimitParam: 'max_tokens',
    inputModalities: ['text', 'image', 'video'],
    thinking: model === MINIMAX_MODELS[0] ? ['adaptive'] : ['adaptive', 'disabled'],
  }))
  return { ...template, models: [...models, ...(template.models || []).filter(model => !/^(?:minimax-(?:m\d|0\d|text|vl)|abab)/i.test(model.model))] }
}

// OpenRouter IDs are verified against https://openrouter.ai/api/v1/models.
// Keep gateway metadata as returned by the gateway; never substitute direct prices.
export function filterMiniMaxChoices<T extends { id: string }>(models: T[], baseURL?: string): T[] {
  const route = getMiniMaxRoute(baseURL)
  if (!route) return models
  const current: readonly string[] = route === 'direct' ? MINIMAX_MODELS : OPENROUTER_MINIMAX_MODELS
  const textId = route === 'direct' ? /^(?:minimax-(?:m\d|0\d|text|vl)|abab)/i : /^minimax\/(?:minimax-(?:m\d|0\d|text|vl)|abab)/i
  const miniMax = current.flatMap(id => models.filter(model => model.id === id))
  return [...miniMax, ...models.filter(model => !textId.test(model.id))]
}

export function miniMaxModelChoices(baseURL?: string) {
  return getMiniMaxRoute(baseURL) === 'direct'
    ? MINIMAX_MODELS.map(id => ({ id, object: 'model', created: 0, owned_by: 'minimax' }))
    : []
}
