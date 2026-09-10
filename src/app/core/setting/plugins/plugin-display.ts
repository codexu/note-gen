import { getLoadedPluginMessages } from '@/lib/plugins/localization'
import type {
  InstalledPlugin,
  PluginMarketEntry,
  PluginMarketRelease,
  PluginPermissionName,
  PluginPlatform,
  PluginViewContribution,
  PluginSettingValue,
} from '@/lib/plugins/types'
import { compareSemver, satisfiesSemverRange } from '@/lib/plugins/manifest'
import { PLUGIN_API_VERSION } from '@/lib/plugins/types'

export function normalizePluginLocale(locale: string): string {
  if (locale === 'zh') return 'zh-CN'
  return locale
}

export function getPluginMarketText(entry: PluginMarketEntry, locale: string): { name: string; description: string } {
  const normalized = locale.replaceAll('_', '-').toLowerCase()
  const language = normalized.split('-')[0]
  const translations = new Map(Object.entries(entry.localizations ?? {}).map(([key, text]) => [key.toLowerCase(), text]))
  // Prefer an exact translation, then the language, then Chinese/English defaults.
  const text = translations.get(normalized)
    ?? translations.get(language)
    ?? (language === 'zh' ? translations.get('zh-cn') : undefined)
    ?? translations.get('en')
  return { name: text?.name ?? entry.name, description: text?.description ?? entry.description }
}

export function resolvePluginText(
  pluginId: string,
  value: string | undefined,
  locale: string,
): string {
  if (!value) return ''
  const match = value.match(/^%(.+)%$/)
  if (!match) return value

  const key = match[1]
  return getLoadedPluginMessages(pluginId, normalizePluginLocale(locale))[key]
    ?? key.split('.').at(-1)
    ?? key
}

export function getInstalledPluginText(
  plugin: InstalledPlugin,
  locale: string,
  marketEntry?: PluginMarketEntry,
): { name: string; description: string } {
  const marketText = marketEntry ? getPluginMarketText(marketEntry, locale) : undefined
  const resolve = (value: string | undefined, fallback: string | undefined) => {
    if (value?.match(/^%(.+)%$/)) return resolvePluginText(plugin.manifest.id, value, locale)
    return fallback ?? value ?? ''
  }
  return {
    name: resolve(plugin.manifest.name, marketText?.name),
    description: resolve(plugin.manifest.description, marketText?.description),
  }
}

export function getLatestDesktopRelease(
  entry: PluginMarketEntry,
  appVersion?: string,
): PluginMarketRelease | undefined {
  return [...entry.releases]
    .filter((release) => (
      release.revoked === undefined
      && release.platforms.includes('desktop')
      && (!appVersion || compareSemver(appVersion, release.minAppVersion) >= 0)
      && satisfiesSemverRange(PLUGIN_API_VERSION, release.apiVersion)
    ))
    .sort((left, right) => compareSemver(right.version, left.version))[0]
}

export function hasNewerVersion(currentVersion: string, nextVersion: string | undefined): boolean {
  return Boolean(nextVersion && compareSemver(nextVersion, currentVersion) > 0)
}

export function formatPluginDate(value: string, locale: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function isWorkspacePathPermissionScope(scope: string): boolean {
  return scope === 'workspace-file'
    || scope === 'workspace-files'
    || scope === 'workspace-folder'
}

export function isNetworkOriginPermissionScope(scope: string): boolean {
  return scope === 'network-origins'
}

export function isSafePluginNetworkOrigin(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.origin === value.replace(/\/$/, '')
      && !url.username
      && !url.password
      && !url.pathname.replace(/\/$/, '')
      && !url.search
      && !url.hash
  } catch {
    return false
  }
}

export function normalizeRelativePluginPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '')
}

export function isSafeRelativePluginPath(value: string): boolean {
  const normalized = normalizeRelativePluginPath(value)
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return false
  return !normalized.split('/').some((segment) => segment === '..')
}

export function splitPluginPaths(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(normalizeRelativePluginPath)
    .filter(Boolean)
}

export const permissionOrder: PluginPermissionName[] = [
  'editor.read',
  'editor.write',
  'notes.read',
  'notes.list',
  'notes.create',
  'notes.open',
  'notes.write',
  'notes.delete',
  'notes.move',
  'attachments.read',
  'attachments.create',
  'network.fetch',
]

export const platformOrder: PluginPlatform[] = ['desktop', 'ios', 'android']

/** Workspace title overrides are declared as a string setting named <view id>.title. */
export function resolvePluginViewTitle(
  plugin: InstalledPlugin,
  view: PluginViewContribution,
  locale: string,
  settings?: Record<string, PluginSettingValue>,
): string {
  const key = `${view.id}.title`
  const declaration = plugin.manifest.contributes.settings?.find(setting => setting.key === key && setting.type === 'string' && setting.scope === 'workspace')
  const value = declaration ? settings?.[key] ?? declaration.default : undefined
  if (typeof value === 'string' && value.trim()) return value.trim()
  const match = view.title.match(/^%(.+)%$/)
  if (!match) return view.title
  const messages = getLoadedPluginMessages(plugin.manifest.id, normalizePluginLocale(locale))
  const nameKey = plugin.manifest.name.match(/^%(.+)%$/)?.[1]
  return messages[match[1]]
    ?? (nameKey ? messages[nameKey] : plugin.manifest.name)
    ?? plugin.manifest.id
}
