import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

const KEY = 'almanacAutoOrganize'

export const useOrganizeSettings = create<{
  enabled: boolean
  ready: boolean
  load: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
}>((set, get) => ({
  enabled: false,
  ready: false,
  load: async () => {
    if (get().ready) return
    const store = await Store.load('store.json')
    const enabled = await store.get(KEY) === true
    if (!get().ready) set({ enabled, ready: true })
  },
  setEnabled: async enabled => {
    const store = await Store.load('store.json')
    await store.set(KEY, enabled)
    await store.save()
    set({ enabled, ready: true })
  },
}))
