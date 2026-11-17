import { Store } from '@tauri-apps/plugin-store'
import { getWikiMeta, setWikiMeta } from '@/db/wiki'
import type { WikiContext, WikiSettings } from '@/types/wiki'
import { getLegacyWikiContextId, getWikiContext } from './context'

const LAST_CONTEXTS = 'wikiLastContextsByWorkspace'
const SETTINGS_KEY = 'wikiSettingsByContext'
const migrations = new Map<string, Promise<void>>()

/** Recover the previous SQLite-backed Wiki once, then use Markdown as its source of truth. */
export async function ensureWikiContextMigration(): Promise<void> {
  const context = await getWikiContext()
  const pending = migrations.get(context.workspaceKey)
  if (pending) return pending
  const operation = (async () => {
    const store = await Store.load('store.json')
    const contexts = await store.get<Record<string, WikiContext>>(LAST_CONTEXTS) || {}
    const previous = contexts[context.workspaceKey]
    if (previous?.id === context.id && await getWikiMeta<boolean>(context.id, 'markdown-context-migrated')) return
    const legacyId = await getLegacyWikiContextId()
    const candidates = [...new Set([previous?.id, legacyId, context.id].filter((id): id is string => Boolean(id)))]
    const settings = await store.get<Record<string, Partial<WikiSettings>>>(SETTINGS_KEY) || {}
    const oldSettingsId = candidates.find(id => id !== context.id && settings[id])
    // Copy device-local preferences without dispatching settings-change events
    // while the runtime is already reconciling this same workspace.
    if (!settings[context.id] && oldSettingsId) {
      await store.set(SETTINGS_KEY, { ...settings, [context.id]: settings[oldSettingsId] })
      const generated = await store.get<Record<string, string[]>>('wikiGeneratedNotes') || {}
      if (generated[oldSettingsId]?.length && !generated[context.id]) {
        await store.set('wikiGeneratedNotes', { ...generated, [context.id]: generated[oldSettingsId] })
      }
      await store.save()
    }
    const { migrateWikiCacheToFiles } = await import('./files')
    for (const id of candidates) {
      if ((await getWikiContext()).id !== context.id) return
      await migrateWikiCacheToFiles(context, id)
    }
    if ((await getWikiContext()).id !== context.id) return
    const latest = await store.get<Record<string, WikiContext>>(LAST_CONTEXTS) || {}
    await store.set(LAST_CONTEXTS, { ...latest, [context.workspaceKey]: context })
    await store.save()
    await setWikiMeta(context.id, 'markdown-context-migrated', true)
  })()
  migrations.set(context.workspaceKey, operation)
  try { await operation } finally { migrations.delete(context.workspaceKey) }
}
