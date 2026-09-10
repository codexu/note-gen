import type { InstalledPlugin, PluginSettingValue } from './types'

export const pluginDisplayLocations = [
  'left-sidebar', 'right-sidebar', 'editor-tab', 'file/context',
  'editor/context', 'tab/context', 'editor/toolbar', 'editor/slash',
  'editor/selection', 'mobile/writing/overflow', 'status-bar',
] as const
export type PluginDisplayLocation = typeof pluginDisplayLocations[number]
type DeviceSettings = Record<string, Record<string, PluginSettingValue>>

// Host-owned keys cannot collide with namespaced plugin settings.
export const pluginDisplayKey = (location: PluginDisplayLocation) => `@host.display.${location}`
export function isPluginDisplayVisible(settings: DeviceSettings, pluginId: string, location: PluginDisplayLocation): boolean {
  return settings[pluginId]?.[pluginDisplayKey(location)] !== false
}
export function getPluginDisplayLocations(plugin: InstalledPlugin): PluginDisplayLocation[] {
  const contributes = plugin.manifest.contributes
  return pluginDisplayLocations.filter(location =>
    location === 'status-bar' ? Boolean(contributes.statusBar?.length)
      : (location === 'tab/context' && contributes.menus?.some(menu => menu.location === 'file/context'))
        || contributes.views?.some(view => view.location === location)
        || contributes.menus?.some(menu => menu.location === location))
}
