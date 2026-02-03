import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

export interface ExtensionConfig {
  enabled: boolean
  settings: Record<string, unknown>
}

export interface ExtensionsState {
  // TavernHelper 扩展状态
  tavernHelper: ExtensionConfig
  
  // 操作方法
  setTavernHelperEnabled: (enabled: boolean) => Promise<void>
  updateTavernHelperSettings: (settings: Partial<ExtensionConfig['settings']>) => Promise<void>
  
  // 初始化
  initExtensionsState: () => Promise<void>
}

const DEFAULT_TAVERN_HELPER_CONFIG: ExtensionConfig = {
  enabled: false,
  settings: {
    logLevel: 'info',
    enableConsole: true,
    maxHistory: 1000,
  }
}

export const useExtensionsStore = create<ExtensionsState>((set, get) => ({
  tavernHelper: DEFAULT_TAVERN_HELPER_CONFIG,
  
  setTavernHelperEnabled: async (enabled: boolean) => {
    const { tavernHelper } = get()
    const newConfig = { ...tavernHelper, enabled }
    set({ tavernHelper: newConfig })
    
    // 持久化
    const store = await Store.load('store.json')
    await store.set('extension_tavernHelper', newConfig)
    await store.save()
  },
  
  updateTavernHelperSettings: async (settings: Partial<ExtensionConfig['settings']>) => {
    const { tavernHelper } = get()
    const newConfig = {
      ...tavernHelper,
      settings: { ...tavernHelper.settings, ...settings }
    }
    set({ tavernHelper: newConfig })
    
    // 持久化
    const store = await Store.load('store.json')
    await store.set('extension_tavernHelper', newConfig)
    await store.save()
  },
  
  initExtensionsState: async () => {
    const store = await Store.load('store.json')
    const tavernHelperConfig = await store.get<ExtensionConfig>('extension_tavernHelper')
    
    if (tavernHelperConfig) {
      set({ tavernHelper: { ...DEFAULT_TAVERN_HELPER_CONFIG, ...tavernHelperConfig } })
    }
  },
}))
