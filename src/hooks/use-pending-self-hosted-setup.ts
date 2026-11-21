'use client'

import { useEffect, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'

const pendingSetupKey = 'selfHostedConnectionReviewProfileId'

export function usePendingSelfHostedSetup(enabled = true) {
  const [profileId, setProfileId] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let receivedChange = false
    let unlisten: (() => void) | undefined

    void Store.load('store.json').then(async store => {
      if (disposed) return
      const stop = await store.onKeyChange<string>(pendingSetupKey, value => {
        receivedChange = true
        if (!disposed) setProfileId(value ?? null)
      })
      if (disposed) {
        stop()
        return
      }
      unlisten = stop
      const value = await store.get<string>(pendingSetupKey)
      if (!disposed && !receivedChange) setProfileId(value ?? null)
    }).catch(error => console.warn('[self-hosted-sync] Unable to read pending setup', error))

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [enabled])

  return enabled ? profileId : null
}
