import {
  defaultEditorShortcuts,
  editorShortcutDefinitions,
  type EditorShortcut,
  type EditorShortcutCommandId,
} from '@/config/editor-shortcuts'

const MODIFIER_KEYS = new Set([
  'Alt',
  'Control',
  'Meta',
  'Shift',
])

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  Esc: 'Escape',
  Del: 'Delete',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Cmd: 'Mod',
  Command: 'Mod',
  CommandOrControl: 'Mod',
  Ctrl: 'Ctrl',
  Control: 'Ctrl',
  Option: 'Alt',
}

const MODIFIER_ORDER = ['Shift', 'Mod', 'Ctrl', 'Alt', 'Meta'] as const

type ModifierName = typeof MODIFIER_ORDER[number]

const BLOCKABLE_DEFAULT_SHORTCUT_IDS = new Set<string>([
  'undo',
  'redo',
  'setParagraph',
  'toggleHeading1',
  'toggleHeading2',
  'toggleHeading3',
  'toggleHeading4',
  'toggleHeading5',
  'toggleHeading6',
  'openSearch',
  'toggleBold',
  'toggleItalic',
  'toggleStrike',
  'toggleUnderline',
  'toggleInlineCode',
  'toggleHighlight',
  'toggleBlockquote',
  'toggleBulletList',
  'toggleOrderedList',
  'toggleTaskList',
  'toggleCodeBlock',
  'alignLeft',
  'alignCenter',
  'alignRight',
])

function isMacPlatform() {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
}

function normalizeKeyName(key: string) {
  const aliased = KEY_ALIASES[key] ?? key

  if (aliased.length === 1) {
    return aliased.toUpperCase()
  }

  if (/^F\d{1,2}$/i.test(aliased)) {
    return aliased.toUpperCase()
  }

  return aliased
}

export function normalizeShortcut(shortcut: string) {
  const parts = shortcut
    .split('+')
    .map((part) => normalizeKeyName(part.trim()))
    .filter(Boolean)

  const modifiers = new Set<ModifierName>()
  let key = ''

  for (const part of parts) {
    if (part === 'Shift' || part === 'Mod' || part === 'Ctrl' || part === 'Alt' || part === 'Meta') {
      modifiers.add(part)
    } else {
      key = part
    }
  }

  if (!key) {
    return ''
  }

  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join('+')
}

export function shortcutFromKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>) {
  if (MODIFIER_KEYS.has(event.key)) {
    return ''
  }

  const key = normalizeKeyName(event.key)
  const modifiers: ModifierName[] = []
  const isMac = isMacPlatform()

  if (event.shiftKey) {
    modifiers.push('Shift')
  }

  if ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) {
    modifiers.push('Mod')
  }

  if ((isMac && event.ctrlKey) || (!isMac && event.metaKey)) {
    modifiers.push(isMac ? 'Ctrl' : 'Meta')
  }

  if (event.altKey) {
    modifiers.push('Alt')
  }

  return normalizeShortcut([...modifiers, key].join('+'))
}

export function keyboardEventMatchesShortcut(event: KeyboardEvent, shortcut: string) {
  const normalizedShortcut = normalizeShortcut(shortcut)
  if (!normalizedShortcut) {
    return false
  }

  const parts = normalizedShortcut.split('+')
  const key = parts[parts.length - 1]
  const expectedModifiers = new Set(parts.slice(0, -1))
  const eventKey = normalizeKeyName(event.key)
  const isMac = isMacPlatform()
  const modPressed = isMac ? event.metaKey : event.ctrlKey
  const extraModPressed = isMac ? event.ctrlKey : event.metaKey

  return (
    eventKey === key &&
    event.shiftKey === expectedModifiers.has('Shift') &&
    event.altKey === expectedModifiers.has('Alt') &&
    modPressed === expectedModifiers.has('Mod') &&
    event.ctrlKey === (expectedModifiers.has('Ctrl') || (!isMac && expectedModifiers.has('Mod'))) &&
    event.metaKey === (expectedModifiers.has('Meta') || (isMac && expectedModifiers.has('Mod'))) &&
    !extraModPressed
  )
}

export function findMatchingEditorShortcut(event: KeyboardEvent, shortcuts: EditorShortcut[]) {
  return shortcuts.find((shortcut) => (
    Boolean(shortcut.value) &&
    keyboardEventMatchesShortcut(event, shortcut.value)
  ))
}

export function shouldBlockEditorDefaultShortcut(event: KeyboardEvent, shortcuts: EditorShortcut[]) {
  return editorShortcutDefinitions.some((definition) => {
    if (!BLOCKABLE_DEFAULT_SHORTCUT_IDS.has(definition.id)) {
      return false
    }

    const currentShortcut = shortcuts.find((shortcut) => shortcut.id === definition.id)?.value ?? ''
    const defaults = [
      definition.defaultShortcut,
      ...('alternateDefaultShortcuts' in definition ? definition.alternateDefaultShortcuts : []),
    ].filter(Boolean)

    if (defaults.length === 0) {
      return false
    }

    return defaults.some((defaultShortcut) => (
      keyboardEventMatchesShortcut(event, defaultShortcut) &&
      normalizeShortcut(currentShortcut) !== normalizeShortcut(defaultShortcut)
    ))
  })
}

export function getShortcutConflict(shortcuts: EditorShortcut[], id: EditorShortcutCommandId, value: string) {
  const normalizedValue = normalizeShortcut(value)
  if (!normalizedValue) {
    return null
  }

  return shortcuts.find((shortcut) => (
    shortcut.id !== id &&
    normalizeShortcut(shortcut.value) === normalizedValue
  )) ?? null
}

export function mergeEditorShortcuts(shortcuts: EditorShortcut[] | null | undefined) {
  if (!shortcuts?.length) {
    return defaultEditorShortcuts
  }

  return defaultEditorShortcuts.map((defaultShortcut) => {
    const storedShortcut = shortcuts.find((shortcut) => shortcut.id === defaultShortcut.id)
    return storedShortcut ?? defaultShortcut
  })
}

export function formatShortcutForDisplay(shortcut: string) {
  return normalizeShortcut(shortcut).split('+').filter(Boolean)
}
