'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import { isUiV3, useUiV3 } from '@/lib/fork-ui'
import { mayRun } from '@/lib/organize/detect'
import { scanOrganizeVault } from '@/lib/organize/scan'
import { useOrganizeSettings } from '@/lib/organize/settings'
import useVaultIndexStore from '@/stores/vault-index'
import useSettingStore from '@/stores/setting'

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'input', 'focus'] as const

export function OrganizeService() {
  const t = useTranslations('organize')
  const v3 = useUiV3()
  const enabled = useOrganizeSettings(state => state.enabled)
  const load = useOrganizeSettings(state => state.load)
  const workspace = useSettingStore(state => state.workspacePath)

  useEffect(() => {
    if (v3) void load().catch(error => console.debug('[organize] settings unavailable', error))
  }, [v3, load])

  useEffect(() => {
    if (!v3 || !enabled) return
    let lastActivity = Date.now()
    let lastRun = -Infinity
    let running = false
    let stopped = false
    function recordActivity() { lastActivity = Date.now() }
    function onActivity(event: Event) {
      if (event.isTrusted) recordActivity()
    }
    emitter.on('editor-input', recordActivity)
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity, { capture: true, passive: true })
    const timer = window.setInterval(() => {
      const index = useVaultIndexStore.getState()
      const now = Date.now()
      if (running || index.status !== 'ready' || !mayRun(now, lastActivity, lastRun, index.notes.size)) return
      lastRun = now
      running = true
      const activityAtStart = lastActivity
      void scanOrganizeVault(now, () => !stopped && isUiV3() && lastActivity === activityAtStart
        && useOrganizeSettings.getState().enabled, t('title'), plan => t(plan.kind, { path: plan.path, detail: plan.detail }))
        .catch(error => console.debug('[organize] scan skipped', error))
        .finally(() => { running = false })
    }, 60_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
      emitter.off('editor-input', recordActivity)
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity, true)
    }
  }, [enabled, v3, workspace, t])
  return null
}
