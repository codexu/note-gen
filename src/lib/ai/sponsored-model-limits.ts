import { Store } from '@tauri-apps/plugin-store'
import { noteGenDefaultModels } from '@/app/model-config'
import type { AiRequestConfig } from './tauri-client'
import { loadNoteGenModelPolicy } from './notegen-model-policy'

export const NOTEGEN_LIMITED_MODEL = 'Limited'
export const NOTEGEN_FREE_MODEL = 'free'
export const NOTEGEN_LIMITED_STORE = 'sponsored-model-usage.json'
export const NOTEGEN_LIMITED_USAGE_KEY = 'tokenUsage'
let reservationQueue: Promise<void> = Promise.resolve()

interface TokenUsage {
  date: string
  tokens: number
}

function isSponsoredConfig(config: AiRequestConfig): boolean {
  try {
    return new URL(config.baseUrl).hostname === 'api.notegen.top'
      && !!config.apiKey && config.apiKey === noteGenDefaultModels[0].apiKey
  } catch {
    return false
  }
}

function isLimitedModel(model: string): boolean {
  const normalized = model.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  return model === NOTEGEN_LIMITED_MODEL || model === 'NoteGen Limited'
    || normalized.startsWith('gpt6luna') || normalized.startsWith('deepseekv4flash')
}

function tokensForDate(usage: TokenUsage | undefined, date: string): number {
  return usage?.date === date && Number.isSafeInteger(usage.tokens) && usage.tokens >= 0 ? usage.tokens : 0
}

function applyResolvedModel(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const resolved: Record<string, unknown> = { ...body, model }
  if (/qwen3|qwq/i.test(model)) {
    if (resolved.reasoning_effort === 'none') {
      delete resolved.reasoning_effort
      resolved.enable_thinking = false
    } else if (resolved.reasoning_effort == null && resolved.enable_thinking == null && resolved.thinking == null && resolved.reasoning == null) {
      resolved.enable_thinking = false
    }
  }
  return resolved
}

export function noteGenUsageDate(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export async function getNoteGenLimitedUsage(): Promise<number> {
  const store = await Store.load(NOTEGEN_LIMITED_STORE, { autoSave: false })
  const usage = await store.get<TokenUsage>(NOTEGEN_LIMITED_USAGE_KEY)
  return tokensForDate(usage, noteGenUsageDate())
}

/** Resolve the paid/free model using this device's observed token usage. */
export async function reserveSponsoredRequest(config: AiRequestConfig, body: unknown, signal?: AbortSignal): Promise<unknown> {
  if (!isSponsoredConfig(config)) return body
  if (!body || typeof body !== 'object' || !('model' in body) || typeof body.model !== 'string') return body
  const policy = await loadNoteGenModelPolicy()
  if (body.model === NOTEGEN_FREE_MODEL) return applyResolvedModel(body as Record<string, unknown>, policy.free.model)
  if (!isLimitedModel(body.model)) return body
  await reservationQueue
  signal?.throwIfAborted()
  const used = await getNoteGenLimitedUsage()
  signal?.throwIfAborted()
  const resolved = applyResolvedModel(body as Record<string, unknown>, used >= policy.limited.dailyTokenLimit ? policy.free.model : policy.limited.model)
  if (resolved.stream === true && isLimitedModel(String(resolved.model))) {
    resolved.stream_options = {
      ...(typeof resolved.stream_options === 'object' && resolved.stream_options !== null ? resolved.stream_options : {}),
      include_usage: true,
    }
  }
  return resolved
}

/** Count actual usage once per request, including cumulative streaming usage. */
export function createSponsoredUsageRecorder(config: AiRequestConfig, body: unknown): (response: unknown) => Promise<void> {
  if (!isSponsoredConfig(config) || !body || typeof body !== 'object'
    || !('model' in body) || typeof body.model !== 'string' || !isLimitedModel(body.model)) {
    return async () => {}
  }
  const date = noteGenUsageDate()
  let recorded = 0
  return response => {
    if (!response || typeof response !== 'object') return Promise.resolve()
    const payload = 'response' in response && response.response && typeof response.response === 'object'
      ? response.response : response
    if (!('usage' in payload) || !payload.usage || typeof payload.usage !== 'object') return Promise.resolve()
    const usage = payload.usage as Record<string, unknown>
    const input = usage.prompt_tokens ?? usage.input_tokens
    const output = usage.completion_tokens ?? usage.output_tokens
    const total = typeof usage.total_tokens === 'number' ? usage.total_tokens
      : typeof input === 'number' && typeof output === 'number' ? input + output : undefined
    // Cached/reasoning tokens are already included in the provider's total.
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total <= recorded) return Promise.resolve()
    const delta = total - recorded
    recorded = total
    const settlement = reservationQueue.then(async () => {
      // A request spanning midnight must not charge the following day's allowance.
      if (date !== noteGenUsageDate()) return
      const store = await Store.load(NOTEGEN_LIMITED_STORE, { autoSave: false })
      const current = await store.get<TokenUsage>(NOTEGEN_LIMITED_USAGE_KEY)
      await store.set(NOTEGEN_LIMITED_USAGE_KEY, { date, tokens: tokensForDate(current, date) + delta })
      await store.save()
    })
    reservationQueue = settlement.catch(error => console.error('Failed to save sponsored token usage:', error))
    return reservationQueue
  }
}
