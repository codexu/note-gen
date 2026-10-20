'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'

export function useStoredImageConfig<T extends object>(
  key: string,
  defaultValue: T,
) {
  const [config, setConfig] = useState<T>(defaultValue)
  const [loaded, setLoaded] = useState(false)
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    async function load() {
      const store = await Store.load('store.json')
      const saved = await store.get<Partial<T>>(key)
      setConfig(saved ? { ...defaultValue, ...saved } : defaultValue)
      setLoaded(true)
    }

    void load()
  }, [defaultValue, key])

  const updateConfig = useCallback(async (nextConfig: T) => {
    setConfig(nextConfig)
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        const store = await Store.load('store.json')
        await store.set(key, nextConfig)
        await store.save()
      })
    await saveQueue.current
  }, [key])

  return {
    config,
    loaded,
    updateConfig,
  }
}
