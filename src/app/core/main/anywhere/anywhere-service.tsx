'use client'

// Fork（almanac ALMNC-9）：⌘K 命令面板 + 隨處對話面板的掛載點與快捷鍵。由 fork-services.tsx 掛一次。
// 只在新介面（v3）啟用；classic 時 ⌘K 仍由側欄搜尋接手（use-focus-search-shortcut.ts），也沒有隨處對話。
//   ⌘K     開／關命令面板（搜尋筆記與指令）。焦點在筆記編輯器時不攔截：那裡 ⌘K 是「插入連結」。
//   ⌘⇧A    開／關隨處對話面板（任何焦點都可用，編輯器裡也行）。
import { useEffect } from 'react'
import { useUiV3 } from '@/lib/fork-ui'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { isAnywhereChatShortcut, isEditorTarget, isPaletteShortcut } from '@/lib/anywhere/context'
import { AnywhereCommandPalette } from './command-palette'
import { AnywhereChatPanel } from './chat-panel'

export function AnywhereService() {
  const isUiV3 = useUiV3()

  useEffect(() => {
    if (!isUiV3) {
      useAnywhereStore.setState({ paletteOpen: false, chatOpen: false })
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (isAnywhereChatShortcut(event)) {
        event.preventDefault()
        useAnywhereStore.getState().toggleChat()
        return
      }
      if (isPaletteShortcut(event)) {
        // 面板開著時，焦點在面板輸入框（不是編輯器），照常關閉
        if (isEditorTarget(event.target)) return
        event.preventDefault()
        useAnywhereStore.getState().togglePalette()
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [isUiV3])

  if (!isUiV3) return null
  return (
    <>
      <AnywhereCommandPalette />
      <AnywhereChatPanel />
    </>
  )
}
