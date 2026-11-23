'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { useShallow } from 'zustand/react/shallow'
import {
  DEFAULT_OUTLINE_WIDTH,
  getFileOutlineOpenStoreKey,
  normalizeOutlineWidth,
  OUTLINE_WIDTH_STORE_KEY,
} from '@/lib/outline-preferences'
import useSettingStore, { useSettingsHydrationStore } from '@/stores/setting'
import { useSidebarStore } from '@/stores/sidebar'

let pendingPreferenceWrites = Promise.resolve()

function writePreference(key: string, value: boolean | number) {
  pendingPreferenceWrites = pendingPreferenceWrites.then(async () => {
    const store = await Store.load('store.json')
    await store.set(key, value)
    await store.save()
  }).catch(error => console.error('Failed to save the outline preference:', error))
  return pendingPreferenceWrites
}

async function readPreference<T>(key: string) {
  await pendingPreferenceWrites
  const store = await Store.load('store.json')
  return store.get<T>(key)
}

export function useDesktopEditorOutline(path: string, isActive: boolean, defaultSidebarTab: 'files' | 'notes' = 'files') {
  const { enableOutline, outlinePlacement, outlinePosition, workspacePath } = useSettingStore(useShallow(state => ({
    enableOutline: state.enableOutline,
    outlinePlacement: state.outlinePlacement,
    outlinePosition: state.outlinePosition,
    workspacePath: state.workspacePath,
  })))
  const settingsReady = useSettingsHydrationStore(state => state.status === 'ready')
  const sidebarOutlineOpen = useSidebarStore(state => state.leftSidebarVisible && state.leftSidebarTab === 'outline')
  const openKey = getFileOutlineOpenStoreKey(workspacePath, path)
  const [openPreference, setOpenPreference] = useState<{ key: string; value: boolean } | null>(null)
  const currentOpenPreference = useRef(openPreference)
  const openRevision = useRef(0)
  const [outlineWidth, setOutlineWidth] = useState(DEFAULT_OUTLINE_WIDTH)
  const widthLoaded = useRef(false)
  const widthRevision = useRef(0)

  useEffect(() => {
    if (!path) return

    let disposed = false
    const revision = openRevision.current
    void readPreference<boolean>(openKey).then(value => {
      if (disposed || openRevision.current !== revision) return

      const next = typeof value === 'boolean' ? { key: openKey, value } : null
      currentOpenPreference.current = next
      setOpenPreference(next)
    }).catch(error => console.error('Failed to load the outline preference:', error))
    return () => { disposed = true }
  }, [openKey, path])

  useEffect(() => {
    if (!isActive && widthLoaded.current) return

    let disposed = false
    const revision = widthRevision.current
    void readPreference(OUTLINE_WIDTH_STORE_KEY).then(value => {
      if (disposed || widthRevision.current !== revision) return

      widthLoaded.current = true
      setOutlineWidth(normalizeOutlineWidth(value))
    }).catch(error => console.error('Failed to load the outline width:', error))
    return () => { disposed = true }
  }, [isActive])

  const toggleOutline = useCallback(() => {
    if (!settingsReady) return

    if (outlinePlacement === 'sidebar') {
      const sidebar = useSidebarStore.getState()
      const isOpen = sidebar.leftSidebarVisible && sidebar.leftSidebarTab === 'outline'
      void sidebar.setLeftSidebarTab(isOpen ? defaultSidebarTab : 'outline')
      if (!sidebar.leftSidebarVisible) void sidebar.toggleLeftSidebar()
      return
    }

    const current = currentOpenPreference.current
    const next = { key: openKey, value: !(current?.key === openKey ? current.value : enableOutline) }
    openRevision.current += 1
    currentOpenPreference.current = next
    setOpenPreference(next)
    void writePreference(openKey, next.value)
  }, [defaultSidebarTab, enableOutline, openKey, outlinePlacement, settingsReady])

  const changeOutlineWidth = useCallback((width: number) => {
    widthRevision.current += 1
    setOutlineWidth(normalizeOutlineWidth(width))
  }, [])

  const commitOutlineWidth = useCallback((width: number) => {
    const normalized = normalizeOutlineWidth(width)
    changeOutlineWidth(normalized)
    return writePreference(OUTLINE_WIDTH_STORE_KEY, normalized)
  }, [changeOutlineWidth])

  const panelOpen = openPreference?.key === openKey ? openPreference.value : enableOutline
  const outlineOpen = settingsReady && (outlinePlacement === 'sidebar' ? sidebarOutlineOpen : panelOpen)

  return {
    outlineOpen,
    showPanel: outlinePlacement === 'editor' && outlineOpen,
    outlinePosition,
    outlineWidth,
    toggleOutline,
    changeOutlineWidth,
    commitOutlineWidth,
  }
}
