import { normalizeShortcut, shortcutFromKeyboardEvent } from '@/lib/editor-shortcut-utils'

function isMacPlatform() {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
}

export function normalizeGlobalShortcut(value: string) {
  return normalizeShortcut(value.replace(/\bSuper\b/g, 'Meta'))
    .split('+')
    .filter(Boolean)
    .map((key) => {
      if (key === 'Mod') return 'CommandOrControl'
      if (key === 'Ctrl') return 'Control'
      if (key === 'Meta') return 'Super'
      return key
    })
    .join('+')
}

export function globalShortcutIdentity(value: string) {
  const normalized = normalizeGlobalShortcut(value)
    .replace(/CommandOrControl/g, isMacPlatform() ? 'Super' : 'Control')
  return [...new Set(normalized.split('+').filter(Boolean))].sort().join('+')
}

export function globalShortcutFromKeyboardEvent(event: KeyboardEvent) {
  if (event.isComposing || ['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) {
    return ''
  }
  if (!event.altKey && !event.ctrlKey && !event.metaKey && !/^F\d{1,2}$/.test(event.code || event.key)) {
    return ''
  }

  // Global hotkeys use physical key codes, so Shift+1 and Option-modified
  // letters must not be recorded as the resulting text character.
  const key = event.code
    ? event.code.replace(/^Key([A-Z])$/, '$1').replace(/^Digit([0-9])$/, '$1')
    : event.key
  return normalizeGlobalShortcut(shortcutFromKeyboardEvent({
    key,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
  }))
}
