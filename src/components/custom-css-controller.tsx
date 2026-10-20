'use client'

import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Store } from '@tauri-apps/plugin-store'
import useSettingStore, { CUSTOM_CSS_CHANGED_EVENT } from '@/stores/setting'

const STYLE_ID = 'notegen-custom-css'

export function CustomCssController() {
  const customCss = useSettingStore(state => state.customCss)

  useEffect(() => {
    let disposed = false
    let changed = false
    const unsubscribe = useSettingStore.subscribe((state, previous) => {
      if (state.customCss !== previous.customCss) changed = true
    })

    void Store.load('store.json')
      .then(store => store.get<unknown>('customCss'))
      .then(saved => {
        if (!disposed && !changed && typeof saved === 'string') {
          useSettingStore.setState({ customCss: saved })
        }
      })
      .catch(() => undefined)

    const unlistenPromise = listen<string>(CUSTOM_CSS_CHANGED_EVENT, event => {
      if (disposed || typeof event.payload !== 'string') return
      if (useSettingStore.getState().customCss !== event.payload) {
        useSettingStore.setState({ customCss: event.payload })
      }
    }).catch(() => undefined)

    return () => {
      disposed = true
      unsubscribe()
      void unlistenPromise.then(unlisten => unlisten?.())
    }
  }, [])

  useEffect(() => {
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!customCss) {
      style?.remove()
      return
    }
    if (!style) {
      style = document.createElement('style')
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    style.textContent = customCss
    if (document.head.lastElementChild !== style) document.head.appendChild(style)
    const observer = new MutationObserver(() => {
      if (style?.isConnected && document.head.lastElementChild !== style) {
        document.head.appendChild(style)
      }
    })
    observer.observe(document.head, { childList: true })
    return () => observer.disconnect()
  }, [customCss])

  return null
}
