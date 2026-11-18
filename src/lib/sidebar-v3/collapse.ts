// Fork（almanac ALMNC-20）：側欄「代理人區」與「MyVault 檔案樹」的收合狀態。
// 同 fork-ui 的做法：store.json 是正式來源（會跟著設定同步），localStorage 讓首屏不閃。
import { create } from 'zustand'

export const SIDEBAR_AGENTS_COLLAPSED_KEY = 'almanacSidebarAgentsCollapsed'
export const SIDEBAR_VAULT_COLLAPSED_KEY = 'almanacSidebarVaultCollapsed'
/** 方案 B：代理人區預設收合成一行，檔案樹預設展開。 */
export const DEFAULT_AGENTS_COLLAPSED = true
export const DEFAULT_VAULT_COLLAPSED = false

export type SidebarSection = 'agents' | 'vault'

const KEYS: Record<SidebarSection, string> = {
  agents: SIDEBAR_AGENTS_COLLAPSED_KEY,
  vault: SIDEBAR_VAULT_COLLAPSED_KEY,
}
const DEFAULTS: Record<SidebarSection, boolean> = {
  agents: DEFAULT_AGENTS_COLLAPSED,
  vault: DEFAULT_VAULT_COLLAPSED,
}

export interface CollapseStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  save: () => Promise<void>
}

async function defaultStorage(): Promise<CollapseStorage> {
  const { Store } = await import('@tauri-apps/plugin-store')
  return Store.load('store.json')
}

export function normalizeCollapsed(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function readLocal(section: SidebarSection): boolean {
  try {
    if (typeof localStorage === 'undefined') return DEFAULTS[section]
    const raw = localStorage.getItem(KEYS[section])
    return raw === null ? DEFAULTS[section] : raw === 'true'
  } catch {
    return DEFAULTS[section]
  }
}

function writeLocal(section: SidebarSection, value: boolean) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEYS[section], String(value))
  } catch {
    // 存不了只影響首屏
  }
}

interface CollapseState {
  agents: boolean
  vault: boolean
  loaded: boolean
  load: (storage?: CollapseStorage) => Promise<void>
  toggle: (section: SidebarSection, storage?: CollapseStorage) => Promise<void>
}

export const useSidebarCollapse = create<CollapseState>((set, get) => ({
  agents: DEFAULT_AGENTS_COLLAPSED,
  vault: DEFAULT_VAULT_COLLAPSED,
  loaded: false,
  load: async (storage) => {
    // localStorage 先上（同步），store.json 有值就以它為準。
    set({ agents: readLocal('agents'), vault: readLocal('vault') })
    try {
      const store = storage ?? await defaultStorage()
      const agents = normalizeCollapsed(await store.get(KEYS.agents), get().agents)
      const vault = normalizeCollapsed(await store.get(KEYS.vault), get().vault)
      writeLocal('agents', agents)
      writeLocal('vault', vault)
      set({ agents, vault, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  toggle: async (section, storage) => {
    const next = !get()[section]
    writeLocal(section, next)
    set({ [section]: next } as Pick<CollapseState, SidebarSection>)
    try {
      const store = storage ?? await defaultStorage()
      await store.set(KEYS[section], next)
      await store.save()
    } catch {
      // 沒有 Tauri（瀏覽器預覽）時只存在 localStorage
    }
  },
}))
