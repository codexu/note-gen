// Fork（almanac ALMNC-20）：「知識」頁的開關、目前分頁，以及分頁清單的組裝。
// 做法同週計畫：全頁覆蓋層，只在 v3 開得起來，與其他覆蓋層互斥由 home-service 的 linkExclusiveOverlays 處理。
import { create } from 'zustand'
import { isUiV3 } from '@/lib/fork-ui'
import { KNOWLEDGE_TABS } from './nav'

/** 內建分頁 id（prompts 是獨立的提示詞庫頁）、大綱 id；外掛視圖用 `<pluginId>:<viewId>`。 */
export const KNOWLEDGE_OUTLINE_TAB = 'outline'
export const KNOWLEDGE_PROMPTS_TAB = 'prompts'

export interface KnowledgeTabItem {
  id: string
  kind: 'builtin' | 'outline' | 'plugin'
  /** 內建與大綱用固定英文標籤（由畫面端決定）；外掛用外掛自己的標題。 */
  title?: string
}

export interface PluginTabSource {
  id: string
  title: string
}

/**
 * 知識頁的分頁：Timeline、Canvas、Tags、Prompts，加上
 * 設定把大綱放在左側欄時的 Outline，以及外掛註冊在左側欄的每個視圖（沒有外掛就沒有）。
 */
export function buildKnowledgeTabs(input: { outlineInSidebar: boolean, pluginTabs: readonly PluginTabSource[] }): KnowledgeTabItem[] {
  const tabs: KnowledgeTabItem[] = KNOWLEDGE_TABS.map(id => ({ id, kind: 'builtin' as const }))
  if (input.outlineInSidebar) tabs.push({ id: KNOWLEDGE_OUTLINE_TAB, kind: 'outline' })
  for (const plugin of input.pluginTabs) tabs.push({ id: plugin.id, kind: 'plugin', title: plugin.title })
  return tabs
}

/** 目前分頁已不存在（外掛被停用、大綱改放別處）時退回第一個分頁。 */
export function resolveKnowledgeTab(tab: string, tabs: readonly KnowledgeTabItem[]): string {
  return tabs.some(item => item.id === tab && item.id !== KNOWLEDGE_PROMPTS_TAB) ? tab : tabs[0].id
}

interface KnowledgeOverlay {
  visible: boolean
  tab: string
  show: (tab?: string) => void
  hide: () => void
}

export const useKnowledgeOverlay = create<KnowledgeOverlay>((set) => ({
  visible: false,
  tab: 'timeline',
  show: (tab) => { if (isUiV3()) set(state => ({ visible: true, tab: tab ?? state.tab })) },
  hide: () => set({ visible: false }),
}))
