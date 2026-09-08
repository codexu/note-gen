'use client'

import { useEffect } from 'react'
import { closeDeveloperTools, openDeveloperTools, supportsNativeDeveloperTools } from '@/lib/developer-tools'
import { clearRuntimeLogs } from '@/lib/diagnostics/runtime-log-buffer'
import useSettingStore from '@/stores/setting'

const TEXT_INPUT_TYPES = new Set([
  'email',
  'number',
  'password',
  'search',
  'tel',
  'text',
  'url',
])
const EDITOR_TEXT_SURFACE_SELECTOR = '.ProseMirror, .cm-content'

function shouldAllowNativeTextContextMenu(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  if (!element) return false

  const input = element.closest('input')
  if (input instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(input.type)) return true

  if (element.closest('textarea') instanceof HTMLTextAreaElement) return true
  if (element instanceof HTMLElement && element.isContentEditable) return true

  const editorRoot = element.closest(EDITOR_TEXT_SURFACE_SELECTOR)
  if (!editorRoot) return false

  const nonEditableAncestor = element.closest('[contenteditable="false"]')
  return !nonEditableAncestor || nonEditableAncestor === editorRoot
}

export function DeveloperModeController() {
  const developerMode = useSettingStore(state => state.developerMode)

  useEffect(() => {
    const nativeDeveloperToolsSupported = supportsNativeDeveloperTools()
    const handleKeyDown = (event: KeyboardEvent) => {
      const isDeveloperShortcut = event.key === 'F12'
        || (event.key.toLowerCase() === 'i' && (event.metaKey || event.ctrlKey) && event.shiftKey)
      if (!isDeveloperShortcut) return

      event.preventDefault()
      if (developerMode && nativeDeveloperToolsSupported) void openDeveloperTools()
    }

    const handleContextMenu = (event: MouseEvent) => {
      // Keep the WebView's native editing menu for text controls. It preserves
      // the browser's real selection/clipboard pipeline while the global guard
      // still hides the general developer context menu elsewhere in the app.
      if (nativeDeveloperToolsSupported && shouldAllowNativeTextContextMenu(event.target)) return
      if (!developerMode || !nativeDeveloperToolsSupported) event.preventDefault()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('contextmenu', handleContextMenu)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [developerMode])

  useEffect(() => {
    if (developerMode) return
    clearRuntimeLogs()
    if (supportsNativeDeveloperTools()) void closeDeveloperTools().catch(() => undefined)
  }, [developerMode])

  return null
}
