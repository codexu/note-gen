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
  centerPanelVisible: boolean
  toggleCenterPanel: () => Promise<void>
  showCenterPanel: () => Promise<void>
  rightSidebarVisible: boolean
  toggleRightSidebar: () => Promise<void>
  leftSidebarTab: 'files' | 'notes'
  setLeftSidebarTab: (tab: 'files' | 'notes') => Promise<void>
  initSidebarState: () => Promise<void>
}

// 从 localStorage 获取初始状态
const getInitialState = () => {
  if (typeof window === 'undefined') return { left: true, center: true, right: true }
  
  const leftState = localStorage.getItem('leftSidebarVisible')
  const centerState = localStorage.getItem('centerPanelVisible')
  const rightState = localStorage.getItem('rightSidebarVisible')
  
  return {
    left: leftState !== null ? leftState === 'true' : true,
    center: centerState !== null ? centerState === 'true' : true,
    right: rightState !== null ? rightState === 'true' : true,
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
  leftSidebarTab: 'files',
  setLeftSidebarTab: async (tab: 'files' | 'notes') => {
    set({ leftSidebarTab: tab })
    localStorage.setItem('leftSidebarTab', tab)
    const store = await Store.load('store.json')
    await store.set('leftSidebarTab', tab)
    await store.save()
  },
  initSidebarState: async () => {
    const store = await Store.load('store.json')
    const leftState = await store.get<boolean>('leftSidebarVisible')
    const centerState = await store.get<boolean>('centerPanelVisible')
    const rightState = await store.get<boolean>('rightSidebarVisible')
    const leftTab = await store.get<'files' | 'notes'>('leftSidebarTab')
    
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
    if (leftTab) {
      set({ leftSidebarTab: leftTab })
      localStorage.setItem('leftSidebarTab', leftTab)
    }
  },
}))
