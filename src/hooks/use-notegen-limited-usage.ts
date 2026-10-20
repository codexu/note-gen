'use client'

import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { getNoteGenLimitedUsage, NOTEGEN_LIMITED_STORE } from '@/lib/ai/sponsored-model-limits'
import { getNoteGenModelPolicy, NOTEGEN_POLICY_CHANGED } from '@/lib/ai/notegen-model-policy'
import { useTranslations } from 'next-intl'

export function useNoteGenLimitedUsage() {
  const t = useTranslations('common.noteGenLimited')
  const [used, setUsed] = useState<number | undefined>()
  const [policy, setPolicy] = useState(getNoteGenModelPolicy)
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    const refresh = async () => {
      try {
        const count = await getNoteGenLimitedUsage()
        if (!disposed) {
          setUsed(count)
          setPolicy(getNoteGenModelPolicy())
        }
      } catch (error) {
        console.error('Failed to read NoteGen Limited usage:', error)
      }
    }
    void Store.load(NOTEGEN_LIMITED_STORE, { autoSave: false }).then(async store => {
      const stop = await store.onKeyChange('usage', () => void refresh())
      if (disposed) stop()
      else unlisten = stop
      await refresh()
    }).catch(error => console.error('Failed to subscribe to NoteGen Limited usage:', error))
    // Refresh across midnight and when returning to the application.
    const interval = window.setInterval(() => void refresh(), 30_000)
    window.addEventListener('focus', refresh)
    window.addEventListener(NOTEGEN_POLICY_CHANGED, refresh)
    return () => {
      disposed = true
      unlisten?.()
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(NOTEGEN_POLICY_CHANGED, refresh)
    }
  }, [])
  const limit = policy.limited.dailyRequestLimit
  const activeModelName = (used ?? 0) >= limit ? policy.free.displayName : policy.limited.displayName
  const detail = t('usage', { used: used ?? '…', limit })
  return { used, detail, limit, activeModelName, modelName: policy.limited.displayName, freeName: policy.free.displayName }
}
