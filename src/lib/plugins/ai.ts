import { PluginError, type PluginAiRequest, type PluginAiStreamEvent, type PluginDisposable } from '@notegen/plugin-api'
import { z } from 'zod'
import { getAISettings, createOpenAIClient, getChatTokenLimitParams } from '@/lib/ai/utils'

const requestSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/), prompt: z.string().min(1).max(20_000), system: z.string().max(10_000).optional(), maxOutputTokens: z.number().int().min(1).max(4096).optional() }).strict()
const active = new Map<string, { owner: AbortSignal; controller: AbortController }>()
const listeners = new Map<string, Set<(event: PluginAiStreamEvent) => void | Promise<void>>>()
export function onPluginAiStream(pluginId: string, listener: (event: PluginAiStreamEvent) => void | Promise<void>): PluginDisposable {
  const items = listeners.get(pluginId) ?? new Set()
  items.add(listener); listeners.set(pluginId, items)
  return { dispose: () => { items.delete(listener); if (!items.size) listeners.delete(pluginId) } }
}
export function cancelPluginAi(pluginId: string, requestId: string, owner: AbortSignal): void {
  const request = active.get(`${pluginId}:${requestId}`)
  if (request?.owner === owner) request.controller.abort()
}
export async function generatePluginAi(pluginId: string, input: PluginAiRequest, owner: AbortSignal, guard: () => Promise<void>): Promise<{ text: string }> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) throw new PluginError('InvalidPath', 'Invalid AI request')
  const key = `${pluginId}:${parsed.data.requestId}`
  if ([...active.keys()].some(id => id.startsWith(`${pluginId}:`)) || active.size >= 4) throw new PluginError('QuotaExceeded', 'Only one AI request per plugin and four overall may run at once')
  const controller = new AbortController()
  active.set(key, { owner, controller })
  const abort = () => controller.abort()
  owner.addEventListener('abort', abort)
  if (owner.aborted) abort()
  const timeout = setTimeout(abort, 30_000)
  try {
    await guard()
    if (controller.signal.aborted) throw new PluginError('Cancelled', 'AI request cancelled')
    const config = await getAISettings('primaryModel')
    if (!config?.model || !config.baseURL) throw new PluginError('NotFound', 'Configure a primary AI model in NoteGen first')
    const client = await createOpenAIClient(config)
    await guard()
    const stream = await client.chat.completions.create({
      model: config.model,
      messages: [
        ...(parsed.data.system ? [{ role: 'system' as const, content: parsed.data.system }] : []),
        { role: 'user', content: parsed.data.prompt },
      ],
      stream: true,
      ...getChatTokenLimitParams({ ...config, maxTokens: Math.min(parsed.data.maxOutputTokens ?? 1024, config.maxTokens && config.maxTokens > 0 ? config.maxTokens : 4096) }),
    }, { signal: controller.signal })
    let text = '', lastSent = 0
    for await (const chunk of stream) {
      if (controller.signal.aborted) throw new PluginError('Cancelled', 'AI request cancelled')
      text += chunk.choices[0]?.delta?.content ?? ''
      if (text.length > 128 * 1024) throw new PluginError('QuotaExceeded', 'AI response exceeds its size limit')
      if (Date.now() - lastSent >= 150) {
        await guard()
        lastSent = Date.now()
        const event = { requestId: parsed.data.requestId, text }
        for (const listener of listeners.get(pluginId) ?? []) void Promise.resolve().then(() => listener(event)).catch(() => undefined)
      }
    }
    await guard()
    return { text }
  } catch (error) {
    if (controller.signal.aborted) throw new PluginError('Cancelled', 'AI request cancelled or timed out')
    if (error instanceof PluginError) throw error
    throw new PluginError('RuntimeFailure', 'AI generation failed; check the configured model in NoteGen')
  } finally {
    controller.abort()
    clearTimeout(timeout)
    owner.removeEventListener('abort', abort)
    active.delete(key)
  }
}
