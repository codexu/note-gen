import { create } from 'zustand'

export type BuiltinSettingSection =
  | 'about'
  | 'general'
  | 'record'
  | 'editor'
  | 'canvas'
  | 'sync'
  | 'backup'
  | 'imageHosting'
  | 'ai'
  | 'webSearch'
  | 'rag'
  | 'mcp'
  | 'skills'
  | 'plugins'
  | 'prompt'
  | 'memories'
  | 'template'
  | 'file'
  | 'shortcuts'
  | 'imageMethod'
  | 'audio'

export type PluginSettingSection = `plugin:${string}`
export type SettingSection = BuiltinSettingSection | PluginSettingSection

export function isPluginSettingSection(section: string): section is PluginSettingSection {
  return section.startsWith('plugin:') && section.length > 'plugin:'.length
}

export const settingSections: SettingSection[] = [
  'about',
  'general',
  'record',
  'editor',
  'canvas',
  'shortcuts',
  'imageMethod',
  'audio',
  'ai',
  'webSearch',
  'rag',
  'memories',
  'prompt',
  'mcp',
  'skills',
  'plugins',
  'template',
  'sync',
  'backup',
  'imageHosting',
  'file',
]

interface SettingsDialogState {
  open: boolean
  activeSection: SettingSection
  pluginDiscoveryRequest: { query: string } | null
  openPluginDiscovery: (query: string) => void
  clearPluginDiscoveryRequest: () => void
  openSettings: (section?: SettingSection) => void
  closeSettings: () => void
  setActiveSection: (section: SettingSection) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'about',
  pluginDiscoveryRequest: null,
  openPluginDiscovery: (query) => set({
    open: true,
    activeSection: 'plugins',
    pluginDiscoveryRequest: { query },
  }),
  clearPluginDiscoveryRequest: () => set({ pluginDiscoveryRequest: null }),
  openSettings: (section) => set((state) => ({
    open: true,
    activeSection: section ?? state.activeSection,
  })),
  closeSettings: () => set({ open: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}))
