import { PluginError, type PluginChatDraftOptions } from '@notegen/plugin-api'
import { z } from 'zod'
import { usePluginUiStore } from './ui-registry'
import { useSidebarStore } from '@/stores/sidebar'

const draftSchema = z.object({ text: z.string().max(20_000), mode: z.enum(['append', 'replace']).optional(), overwrite: z.boolean().optional() }).strict()
let composer: ((options: PluginChatDraftOptions) => void) | null = null
export function registerPluginChatComposer(handler: NonNullable<typeof composer>): () => void {
  composer = handler
  return () => { if (composer === handler) composer = null }
}
export async function setPluginChatDraft(options: PluginChatDraftOptions, guard: () => Promise<void>): Promise<void> {
  const result = draftSchema.safeParse(options)
  if (!result.success) throw new PluginError('InvalidPath', 'Invalid chat draft')
  await guard()
  const handler = composer
  if (!handler) throw new PluginError('UnavailableOnPlatform', 'No main-window chat composer is available')
  const sidebar = useSidebarStore.getState()
  if (!sidebar.rightSidebarVisible) await sidebar.toggleRightSidebar()
  await guard()
  if (composer !== handler) throw new PluginError('Cancelled', 'Chat composer changed')
  usePluginUiStore.getState().setActiveRightView(null)
  handler(result.data)
}
