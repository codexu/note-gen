'use client'

import { useEffect, useRef } from 'react'
import { pluginHost } from '@/lib/plugins/host'
import type { PluginHostSurface } from '@/lib/plugins/host'
import { usePluginStore } from '@/stores/plugins'

export function PluginHostBridge({
  ready,
  locale,
  surface = 'main',
}: {
  ready: boolean
  locale: string
  surface?: PluginHostSurface
}) {
  const localeRef = useRef(locale)
  localeRef.current = locale
  useEffect(() => { if (ready) pluginHost.setLocale(locale) }, [locale, ready])
  useEffect(() => {
    if (!ready) return
    let disposed = false
    let failed = false
    const start = () => {
      failed = false
      void pluginHost.initialize(localeRef.current, surface).catch((error) => {
        if (disposed) return
        failed = true
        usePluginStore.getState().addLog({
          pluginId: 'app.notegen.plugin-host',
          level: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    }
    const unsubscribe = usePluginStore.subscribe((state, previous) => {
      if (!disposed && failed && state.initialized && !previous.initialized) start()
    })
    start()
    return () => {
      disposed = true
      unsubscribe()
      pluginHost.stop()
    }
  }, [ready, surface])

  return null
}
