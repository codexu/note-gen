import { useEffect, useSyncExternalStore } from 'react'
import { PluginError } from '@notegen/plugin-api'
import { readPluginLocale } from '@/lib/plugins/backend'
import type { InstalledPlugin } from '@/lib/plugins/internal-types'
import { getManifestTranslationKeys } from '@/lib/plugins/manifest'

const messageCache = new Map<string, Record<string, string>>()
const loadingMessages = new Map<string, Promise<Record<string, string>>>()
const latestMessageKeys = new Map<string, string>()

let revision = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const snapshot = () => revision
function notifyMessagesChanged() {
  revision += 1
  listeners.forEach(listener => listener())
}

/** Load display metadata independently of runtime activation and refresh consumers. */
export function usePluginLocalization(plugins: InstalledPlugin[], locale: string) {
  useSyncExternalStore(subscribe, snapshot, () => 0)
  useEffect(() => {
    void Promise.allSettled(plugins.map(plugin => loadPluginMessages(plugin, locale)))
  }, [plugins, locale])
}

function normalizedLocale(locale: string): string {
  return locale === 'zh' ? 'zh-CN' : locale
}

function cacheKey(plugin: InstalledPlugin, locale: string): string {
  return `${plugin.manifest.id}:${plugin.activeVersion}:${plugin.contentHash}:${normalizedLocale(locale)}`
}

function latestKey(pluginId: string, locale: string): string {
  return `${pluginId}:${normalizedLocale(locale)}`
}

export async function loadPluginMessages(
  plugin: InstalledPlugin,
  locale: string,
): Promise<Record<string, string>> {
  const key = cacheKey(plugin, locale)
  // Select the requested package before awaiting I/O. An older, slower load
  // must not replace its successor, and rollback must select the cached version.
  const selection = latestKey(plugin.manifest.id, locale)
  const changed = latestMessageKeys.get(selection) !== key
  latestMessageKeys.set(selection, key)
  const cached = messageCache.get(key)
  if (cached) {
    if (changed) notifyMessagesChanged()
    return cached
  }
  const pending = loadingMessages.get(key)
  if (pending) return pending

  const loading = (async () => {
    const defaultLocale = plugin.manifest.defaultLocale
    if (!defaultLocale) return {}
    const localeName = normalizedLocale(locale)
    const identity = { version: plugin.activeVersion, contentHash: plugin.contentHash }
    const fallback = await readPluginLocale(plugin.manifest.id, defaultLocale, identity) ?? {}
    const localized = localeName === defaultLocale
      ? fallback
      : await readPluginLocale(plugin.manifest.id, localeName, identity) ?? {}
    const messages = { ...fallback, ...localized }
    const missing = getManifestTranslationKeys(plugin.manifest).filter((messageKey) => !messages[messageKey])
    if (missing.length > 0) {
      throw new PluginError('InvalidManifest', `Missing plugin translations: ${missing.join(', ')}`)
    }
    messageCache.set(key, messages)
    if (latestMessageKeys.get(selection) === key) notifyMessagesChanged()
    return messages
  })()
  loadingMessages.set(key, loading)
  try {
    return await loading
  } finally {
    loadingMessages.delete(key)
  }
}

export function getLoadedPluginMessages(
  pluginId: string,
  locale: string,
): Record<string, string> {
  const key = latestMessageKeys.get(latestKey(pluginId, locale))
  return key ? messageCache.get(key) ?? {} : {}
}
