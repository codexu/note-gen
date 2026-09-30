import { Store } from '@tauri-apps/plugin-store'
import { noteGenDefaultModels } from '@/app/model-config'
import type { AiRequestConfig } from './tauri-client'
import { getNoteGenModelPolicy, loadNoteGenModelPolicy } from './notegen-model-policy'

export const NOTEGEN_LIMITED_MODEL = 'Limited'
export const NOTEGEN_FREE_MODEL = 'free'
export const NOTEGEN_LIMITED_STORE = 'sponsored-model-usage.json'
let reservationQueue: Promise<void> = Promise.resolve()

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
  const usage = await store.get<{ date: string; count: number }>('usage')
  return usage?.date === noteGenUsageDate() && Number.isInteger(usage.count) && usage.count >= 0
    ? Math.min(usage.count, getNoteGenModelPolicy().limited.dailyRequestLimit)
    : 0
}

/** Reserve each outgoing attempt atomically within this window, including agent rounds. */
export async function reserveSponsoredRequest(config: AiRequestConfig, body: unknown, signal?: AbortSignal): Promise<unknown> {
  try {
    if (new URL(config.baseUrl).hostname !== 'api.notegen.top') return body
  } catch {
    return body
  }
  if (!config.apiKey || config.apiKey !== noteGenDefaultModels[0].apiKey) return body
  if (!body || typeof body !== 'object' || !('model' in body) || typeof body.model !== 'string') return body
  const policy = await loadNoteGenModelPolicy()
  if (body.model === NOTEGEN_FREE_MODEL) return applyResolvedModel(body as Record<string, unknown>, policy.free.model)
  const model = body.model.split('/').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || ''
  if (body.model !== NOTEGEN_LIMITED_MODEL && body.model !== 'NoteGen Limited' && !model.startsWith('gpt6luna') && !model.startsWith('deepseekv4flash')) return body
  const requestBody = body
  const reservation = reservationQueue.then(async () => {
    signal?.throwIfAborted()
    const store = await Store.load(NOTEGEN_LIMITED_STORE, { autoSave: false })
    const date = noteGenUsageDate()
    const usage = await store.get<{ date: string; count: number }>('usage')
    const count = usage?.date === date && Number.isInteger(usage.count) && usage.count >= 0 ? usage.count : 0
    signal?.throwIfAborted()
    if (count >= policy.limited.dailyRequestLimit) {
      // Free requests do not consume the Limited allowance.
      return applyResolvedModel(requestBody as Record<string, unknown>, policy.free.model)
    }
    await store.set('usage', { date, count: count + 1 })
    await store.save()
    return applyResolvedModel(requestBody as Record<string, unknown>, policy.limited.model)
  })
  reservationQueue = reservation.then(() => {}, () => {})
  return reservation
}
