// Fork（almanac ALMNC-7）：新舊介面開關。
// 'v3' 套 v5 外觀與 V3 新頁面；'classic' 回到 P0 前的 fork 預設外觀並隱藏 V3 新頁面。
// 狀態存兩處：store.json（設定的正式來源，會跟著設定同步）與 localStorage（首屏前就能套用，
// 也讓同 origin 的其他視窗透過 storage 事件即時跟著切換）。
//
// 後續功能判斷開關：元件用 useUiV3()，非元件用 isUiV3()；樣式用 Tailwind 的 v3: variant。
import { create } from 'zustand'

export type UiMode = 'v3' | 'classic'

export const UI_MODE_KEY = 'almanacUiMode'
export const DEFAULT_UI_MODE: UiMode = 'v3'

export function normalizeUiMode(value: unknown): UiMode {
  return value === 'classic' ? 'classic' : DEFAULT_UI_MODE
}

/** 套到 <html data-ui>，並寫進 localStorage 給下次首屏與其他視窗 */
export function applyUiMode(mode: UiMode): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.ui = mode
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(UI_MODE_KEY, mode)
  } catch {
    // localStorage 不可用時只影響首屏，不影響功能
  }
}

/** 首屏前執行的腳本（放在 layout 的 beforeInteractive Script） */
export const UI_MODE_BOOT_SCRIPT = `try{var m=localStorage.getItem('${UI_MODE_KEY}');document.documentElement.dataset.ui=m==='classic'?'classic':'v3'}catch(e){document.documentElement.dataset.ui='v3'}`

interface UiModeStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<UiModeStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

interface UiModeState {
  mode: UiMode
  loaded: boolean
  /** 從 store.json 讀回（store.json 為準），並套用 */
  load: (storage?: UiModeStorage) => Promise<UiMode>
  setMode: (mode: UiMode, storage?: UiModeStorage) => Promise<void>
  /** 其他視窗改了開關時（storage 事件）只更新本視窗，不再寫回 */
  syncFromOtherWindow: (value: unknown) => void
}

/** 首屏腳本已把 localStorage 的值套到 <html data-ui>，store 從那裡起步，兩邊一開始就一致 */
function initialUiMode(): UiMode {
  return typeof document === 'undefined' ? DEFAULT_UI_MODE : normalizeUiMode(document.documentElement.dataset.ui)
}

export const useUiModeStore = create<UiModeState>((set) => ({
  mode: initialUiMode(),
  loaded: false,
  load: async (storage) => {
    const store = storage ?? await defaultStorage()
    const mode = normalizeUiMode(await store.get(UI_MODE_KEY))
    applyUiMode(mode)
    set({ mode, loaded: true })
    return mode
  },
  setMode: async (mode, storage) => {
    applyUiMode(mode)
    set({ mode, loaded: true })
    const store = storage ?? await defaultStorage()
    await store.set(UI_MODE_KEY, mode)
    await store.save()
  },
  syncFromOtherWindow: (value) => {
    const mode = normalizeUiMode(value)
    if (typeof document !== 'undefined') document.documentElement.dataset.ui = mode
    set({ mode })
  },
}))

export function isUiV3(): boolean {
  return useUiModeStore.getState().mode === 'v3'
}

export function useUiV3(): boolean {
  return useUiModeStore(state => state.mode === 'v3')
}
