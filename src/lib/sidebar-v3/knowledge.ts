// Fork（almanac ALMNC-20）：「知識」頁的開關與目前分頁。做法同週計畫：全頁覆蓋層，只在 v3 開得起來，
// 與其他覆蓋層互斥由 home-service 的 linkExclusiveOverlays 處理。
import { create } from 'zustand'
import { isUiV3 } from '@/lib/fork-ui'
import type { KnowledgeTab } from './nav'

interface KnowledgeOverlay {
  visible: boolean
  tab: Exclude<KnowledgeTab, 'prompts'>
  show: (tab?: Exclude<KnowledgeTab, 'prompts'>) => void
  hide: () => void
}

export const useKnowledgeOverlay = create<KnowledgeOverlay>((set) => ({
  visible: false,
  tab: 'timeline',
  show: (tab) => { if (isUiV3()) set(state => ({ visible: true, tab: tab ?? state.tab })) },
  hide: () => set({ visible: false }),
}))
