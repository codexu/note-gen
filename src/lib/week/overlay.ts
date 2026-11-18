import { create } from 'zustand'
import { isUiV3 } from '@/lib/fork-ui'

interface WeekOverlay {
  visible: boolean
  show: () => void
  hide: () => void
}

export const useWeekOverlay = create<WeekOverlay>(set => ({
  visible: false,
  show: () => { if (isUiV3()) set({ visible: true }) },
  hide: () => set({ visible: false }),
}))
