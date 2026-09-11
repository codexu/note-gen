import { create } from 'zustand'
import { validatePluginLanguageMessages, validatePluginResources, type PluginResources, type PluginFileIconRule } from '@notegen/plugin-api'
import type { AbstractIntlMessages } from 'next-intl'
import { readPluginResource } from './backend'
import type { InstalledPlugin } from './internal-types'
import { setPluginThemeBase } from '@/lib/theme-utils'
import { registerPluginLanguages, unregisterPluginLanguages, validateLanguageOverrides } from '@/i18n/config'

export interface RegisteredResources { plugin: InstalledPlugin; resources: PluginResources }
const THEME_KEY = 'plugin-theme'
let preferencesListening = false
function listenPreferences() {
  if (preferencesListening || typeof window === 'undefined') return
  preferencesListening = true
  window.addEventListener('storage', event => {
    if (event.key !== THEME_KEY && event.key !== null) return
    usePluginResources.setState({ selectedTheme: localStorage.getItem(THEME_KEY) ?? '' })
    applySelectedTheme()
  })
}
export const usePluginResources = create<{ entries: RegisteredResources[]; selectedTheme: string; revision: number }>(() => ({ entries: [], selectedTheme: '', revision: 0 }))
const runtimeIcons = new Map<string, { rules: readonly PluginFileIconRule[]; owner: AbortSignal }>()
export function setRuntimeFileIcons(pluginId: string, rules: readonly PluginFileIconRule[], owner: AbortSignal) {
  validatePluginResources({ fileIcons: rules })
  runtimeIcons.set(pluginId, { rules: structuredClone(rules), owner })
  iconCache.clear()
  usePluginResources.setState(state => ({ revision: state.revision + 1 }))
}
export function clearRuntimeFileIcons(pluginId: string, owner: AbortSignal) {
  if (runtimeIcons.get(pluginId)?.owner !== owner) return
  runtimeIcons.delete(pluginId)
  iconCache.clear()
  usePluginResources.setState(state => ({ revision: state.revision + 1 }))
}
const iconCache = new Map<string, PluginFileIconRule['icon'] | null>()

function applySelectedTheme() {
  const { entries, selectedTheme } = usePluginResources.getState()
  const theme = entries.flatMap(({ plugin, resources }) => (resources.themes ?? []).map(theme => ({ key: `${plugin.manifest.id}:${theme.id}`, theme }))).find(x => x.key === selectedTheme)?.theme
  setPluginThemeBase(theme ?? null)
}
export function selectPluginTheme(key: string) {
  localStorage.setItem(THEME_KEY, key)
  usePluginResources.setState({ selectedTheme: key })
  applySelectedTheme()
}
export async function preparePluginResources(plugin: InstalledPlugin) {
  const resources = plugin.manifest.resources
  if (!resources) return () => () => undefined
  validatePluginResources(resources)
  const languages: { locale: string; name: string; messages: AbstractIntlMessages }[] = []
  for (const language of resources.languages ?? []) {
    const bytes = await readPluginResource(plugin, language.messages)
    const messages: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    validatePluginLanguageMessages(messages)
    await validateLanguageOverrides(messages as AbstractIntlMessages)
    languages.push({ ...language, messages: messages as AbstractIntlMessages })
  }
  return () => {
    listenPreferences()
    registerPluginLanguages(plugin.manifest.id, languages)
    usePluginResources.setState(state => ({
      selectedTheme: localStorage.getItem(THEME_KEY) ?? '',
      entries: [...state.entries.filter(x => x.plugin.manifest.id !== plugin.manifest.id), { plugin, resources }].sort((a, b) => a.plugin.manifest.id.localeCompare(b.plugin.manifest.id)),
    }))
    iconCache.clear()
    applySelectedTheme()
    return () => {
      unregisterPluginLanguages(plugin.manifest.id)
      usePluginResources.setState(state => ({ entries: state.entries.filter(x => x.plugin !== plugin) }))
      iconCache.clear()
      applySelectedTheme()
    }
  }
}
export function resolvePluginFileIcon(path: string, kind: 'file' | 'folder') {
  const key = `${kind}:${path}`
  if (iconCache.has(key)) return iconCache.get(key) ?? null
  const extension = path.split('/').pop()?.split('.').slice(1).pop()?.toLowerCase()
  const icon = [...new Set([...runtimeIcons.keys(), ...usePluginResources.getState().entries.map(x => x.plugin.manifest.id)])].sort().flatMap(id => runtimeIcons.get(id)?.rules ?? usePluginResources.getState().entries.find(x => x.plugin.manifest.id === id)?.resources.fileIcons ?? []).find(rule => rule.kind === kind && (rule.path === undefined || rule.path === path) && (rule.extension === undefined || rule.extension === extension))?.icon ?? null
  if (iconCache.size >= 4096) iconCache.clear()
  iconCache.set(key, icon)
  return icon
}
export function resolvePluginPreview(path: string) {
  const extension = path.split('/').pop()?.split('.').slice(1).pop()?.toLowerCase()
  for (const entry of usePluginResources.getState().entries) {
    const preview = entry.resources.documentPreviews?.find(x => x.extensions.includes(extension ?? ''))
    if (preview) return { plugin: entry.plugin, preview }
  }
  return null
}
