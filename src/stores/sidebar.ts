import { Store } from '@tauri-apps/plugin-store'
import { create } from 'zustand'

export interface SidebarState {
  fileSidebarVisible: boolean
  toggleFileSidebar: () => Promise<void>
  showFileSidebar: () => Promise<void>
  noteSidebarVisible: boolean
  toggleNoteSidebar: () => Promise<void>
  showNoteSidebar: () => Promise<void>
  leftSidebarVisible: boolean
  toggleLeftSidebar: () => Promise<void>
  rightSidebarVisible: boolean
  toggleRightSidebar: () => Promise<void>
}

export const useSidebarStore = create<SidebarState>((set) => ({
  fileSidebarVisible: true,
  toggleFileSidebar: async () => {
    set((state) => ({
      fileSidebarVisible: !state.fileSidebarVisible
    }))
    const store = await Store.load('store.json')
    store.set('fileSidebarVisible', !store.get('fileSidebarVisible'))
  },
  showFileSidebar: async () => {
    set({ fileSidebarVisible: true })
    const store = await Store.load('store.json')
    store.set('fileSidebarVisible', true)
  },
  noteSidebarVisible: true,
  toggleNoteSidebar: async () => {
    set((state) => ({
      noteSidebarVisible: !state.noteSidebarVisible
    }))
    const store = await Store.load('store.json')
    store.set('noteSidebarVisible', !store.get('noteSidebarVisible'))
  },
  showNoteSidebar: async () => {
    set({ noteSidebarVisible: true })
    const store = await Store.load('store.json')
    store.set('noteSidebarVisible', true)
  },
  leftSidebarVisible: true,
  toggleLeftSidebar: async () => {
    set((state) => ({
      leftSidebarVisible: !state.leftSidebarVisible
    }))
    const store = await Store.load('store.json')
    store.set('leftSidebarVisible', !store.get('leftSidebarVisible'))
  },
  rightSidebarVisible: true,
  toggleRightSidebar: async () => {
    set((state) => ({
      rightSidebarVisible: !state.rightSidebarVisible
    }))
    const store = await Store.load('store.json')
    store.set('rightSidebarVisible', !store.get('rightSidebarVisible'))
  },
}))
