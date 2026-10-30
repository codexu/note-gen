import { useEffect } from 'react'

import emitter from '@/lib/emitter'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { useSelfHostedConflictStore } from '@/stores/self-hosted-conflicts'

export function useSelfHostedNoteConflicts(enabled = true) {
  const method = useSettingStore(state => state.primaryBackupMethod)
  const workspacePath = useSettingStore(state => state.workspacePath)
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const scope = useSelfHostedConflictStore(state => state.workspacePath)
  const conflicts = useSelfHostedConflictStore(state => state.conflicts)
  const refresh = useSelfHostedConflictStore(state => state.refresh)

  useEffect(() => {
    if (!enabled || !settingsReady) return
    const update = () => {
      void refresh().catch(error => console.warn('[self-hosted-sync] Unable to refresh note conflicts', error))
    }
    update()
    if (method !== 'selfHosted') return
    emitter.on('sync-engine-completed', update)
    emitter.on('self-hosted-conflicts-changed', update)
    return () => {
      emitter.off('sync-engine-completed', update)
      emitter.off('self-hosted-conflicts-changed', update)
    }
  }, [enabled, method, refresh, settingsReady, workspacePath])

  return { conflicts: method === 'selfHosted' && scope === workspacePath ? conflicts : [], refresh }
}
