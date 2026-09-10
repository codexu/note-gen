import { create } from 'zustand'

export type SettingSection =
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
  openSettings: (section?: SettingSection) => void
  closeSettings: () => void
  setActiveSection: (section: SettingSection) => void
}

export const useSettingsDialogStore = create<SettingsDialogState>((set) => ({
  open: false,
  activeSection: 'about',
  openSettings: (section) => set((state) => ({
    open: true,
    activeSection: section ?? state.activeSection,
  })),
  closeSettings: () => set({ open: false }),
  setActiveSection: (activeSection) => set({ activeSection }),
}))
