'use client'

import { useEffect } from 'react'
import { useUiModeStore, useUiV3 } from '@/lib/fork-ui'
import { offerTodaySlots } from '@/lib/timeslots/service'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'

export function SlotService() {
  const v3 = useUiV3()
  const ready = useSettingsHydrationStore(state => state.status === 'ready')
  const uiReady = useUiModeStore(state => state.loaded)
  const workspace = useSettingStore(state => state.workspacePath)

  useEffect(() => {
    if (!v3 || !ready || !uiReady) return
    const check = () => void offerTodaySlots()
    check()
    window.addEventListener('focus', check)
    const timer = window.setInterval(check, 5 * 60_000)
    return () => {
      window.removeEventListener('focus', check)
      window.clearInterval(timer)
    }
  }, [v3, ready, uiReady, workspace])

  return null
}
