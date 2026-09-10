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
  sidebarSearchFocusRequest: number
  requestSidebarSearchFocus: () => Promise<void>
  toggleLeftSidebar: () => Promise<void>
  centerPanelVisible: boolean
  toggleCenterPanel: () => Promise<void>
  showCenterPanel: () => Promise<void>
  rightSidebarVisible: boolean
  toggleRightSidebar: () => Promise<void>
  leftSidebarTab: string
  setLeftSidebarTab: (tab: string) => Promise<void>
  initSidebarState: () => Promise<void>
}

export const BUILT_IN_LEFT_SIDEBAR_TABS = ['files', 'notes', 'canvases'] as const
export type BuiltInLeftSidebarTab = typeof BUILT_IN_LEFT_SIDEBAR_TABS[number]

const builtInLeftSidebarTabs = new Set<string>(BUILT_IN_LEFT_SIDEBAR_TABS)
const PLUGIN_ID_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SAFE_PLUGIN_VIEW_ID_PATTERN = /^[^\u0000-\u001f\u007f]{3,220}$/

export function isBuiltInLeftSidebarTab(tab: string): tab is BuiltInLeftSidebarTab {
  return builtInLeftSidebarTabs.has(tab)
}

function normalizeLeftSidebarTab(value: unknown): string {
  if (typeof value !== 'string') return 'files'
  if (isBuiltInLeftSidebarTab(value)) return value
  const separator = value.indexOf(':')
  if (separator < 0) return 'files'
  const pluginId = value.slice(0, separator)
  const viewId = value.slice(separator + 1)
  return pluginId.length <= 160
    && PLUGIN_ID_PATTERN.test(pluginId)
    && SAFE_PLUGIN_VIEW_ID_PATTERN.test(viewId)
    ? value
    : 'files'
}

// 从 localStorage 获取初始状态
const getInitialState = () => {
  if (typeof window === 'undefined') return { left: true, center: true, right: true, tab: 'files' }
  
  const leftState = localStorage.getItem('leftSidebarVisible')
  const centerState = localStorage.getItem('centerPanelVisible')
  const rightState = localStorage.getItem('rightSidebarVisible')
  const leftTab = localStorage.getItem('leftSidebarTab')
  const normalizedLeftTab = normalizeLeftSidebarTab(leftTab)
  if (leftTab !== null && leftTab !== normalizedLeftTab) {
    localStorage.setItem('leftSidebarTab', normalizedLeftTab)
  }
  
  return {
    left: leftState !== null ? leftState === 'true' : true,
    center: centerState !== null ? centerState === 'true' : true,
    right: rightState !== null ? rightState === 'true' : true,
    tab: normalizedLeftTab,
  }
}

const initialState = getInitialState()

export const useSidebarStore = create<SidebarState>((set, get) => ({
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
  leftSidebarVisible: initialState.left,
  sidebarSearchFocusRequest: 0,
  requestSidebarSearchFocus: async () => {
    set((state) => ({
      leftSidebarVisible: true,
      sidebarSearchFocusRequest: state.sidebarSearchFocusRequest + 1,
    }))
    localStorage.setItem('leftSidebarVisible', 'true')
    const store = await Store.load('store.json')
    await store.set('leftSidebarVisible', true)
    await store.save()
  },
  toggleLeftSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    
    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    // 如果要关闭左侧面板，需要确保关闭后不会变成"仅左"状态（这是不可能的，因为关闭左侧）
    // 但要确保不会变成无面板状态
    if (leftSidebarVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }
    
    // 如果要打开左侧面板，总是允许
    const newState = !leftSidebarVisible
    set({ leftSidebarVisible: newState })
    localStorage.setItem('leftSidebarVisible', String(newState))
    const store = await Store.load('store.json')
    await store.set('leftSidebarVisible', newState)
    await store.save()
  },
  centerPanelVisible: initialState.center,
  showCenterPanel: async () => {
    if (get().centerPanelVisible) {
      return
    }

    set({ centerPanelVisible: true })
    localStorage.setItem('centerPanelVisible', 'true')
    const store = await Store.load('store.json')
    await store.set('centerPanelVisible', true)
    await store.save()
  },
  toggleCenterPanel: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    
    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    // 如果要关闭中间面板，需要确保关闭后不会变成"仅左"状态
    if (centerPanelVisible && visibleCount === 2 && leftSidebarVisible && !rightSidebarVisible) {
      return // 不允许关闭，否则会变成"仅左"状态
    }
    
    // 如果要关闭中间面板，也要确保不会变成无面板状态
    if (centerPanelVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }
    
    // 如果要打开中间面板，总是允许
    const newState = !centerPanelVisible
    set({ centerPanelVisible: newState })
    localStorage.setItem('centerPanelVisible', String(newState))
    const store = await Store.load('store.json')
    await store.set('centerPanelVisible', newState)
    await store.save()
  },
  rightSidebarVisible: initialState.right,
  toggleRightSidebar: async () => {
    const { leftSidebarVisible, centerPanelVisible, rightSidebarVisible } = get()
    
    // 计算当前可见的面板数量
    const visibleCount = [leftSidebarVisible, centerPanelVisible, rightSidebarVisible].filter(Boolean).length
    
    // 如果要关闭右侧面板，需要确保关闭后不会变成"仅左"状态
    if (rightSidebarVisible && visibleCount === 2 && leftSidebarVisible && !centerPanelVisible) {
      return // 不允许关闭，否则会变成"仅左"状态
    }
    
    // 如果要关闭右侧面板，也要确保不会变成无面板状态
    if (rightSidebarVisible && visibleCount === 1) {
      return // 不允许关闭最后一个面板
    }
    
    // 如果要打开右侧面板，总是允许
    const newState = !rightSidebarVisible
    set({ rightSidebarVisible: newState })
    localStorage.setItem('rightSidebarVisible', String(newState))
    const store = await Store.load('store.json')
    await store.set('rightSidebarVisible', newState)
    await store.save()
  },
  leftSidebarTab: initialState.tab,
  setLeftSidebarTab: async (tab: string) => {
    const normalizedTab = normalizeLeftSidebarTab(tab)
    set({ leftSidebarTab: normalizedTab })
    localStorage.setItem('leftSidebarTab', normalizedTab)
    const store = await Store.load('store.json')
    await store.set('leftSidebarTab', normalizedTab)
    await store.save()
  },
  initSidebarState: async () => {
    const store = await Store.load('store.json')
    const leftState = await store.get<boolean>('leftSidebarVisible')
    const centerState = await store.get<boolean>('centerPanelVisible')
    const rightState = await store.get<boolean>('rightSidebarVisible')
    const storedLeftTab = await store.get<unknown>('leftSidebarTab')
    
    if (leftState !== null && leftState !== undefined) {
      set({ leftSidebarVisible: leftState })
      localStorage.setItem('leftSidebarVisible', String(leftState))
    }
    if (centerState !== null && centerState !== undefined) {
      set({ centerPanelVisible: centerState })
      localStorage.setItem('centerPanelVisible', String(centerState))
    }
    if (rightState !== null && rightState !== undefined) {
      set({ rightSidebarVisible: rightState })
      localStorage.setItem('rightSidebarVisible', String(rightState))
    }
    if (storedLeftTab !== null && storedLeftTab !== undefined) {
      const leftTab = normalizeLeftSidebarTab(storedLeftTab)
      set({ leftSidebarTab: leftTab })
      localStorage.setItem('leftSidebarTab', leftTab)
      if (storedLeftTab !== leftTab) {
        await store.set('leftSidebarTab', leftTab)
        await store.save()
      }
    }
  },
}))
