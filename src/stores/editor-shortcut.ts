import { create } from 'zustand'
import { Store } from '@tauri-apps/plugin-store'
import {
  defaultEditorShortcuts,
  type EditorShortcut,
  type EditorShortcutCommandId,
} from '@/config/editor-shortcuts'
import {
  getShortcutConflict,
  mergeEditorShortcuts,
  normalizeShortcut,
} from '@/lib/editor-shortcut-utils'

const STORE_KEY = 'editorShortcuts'

interface EditorShortcutState {
  shortcuts: EditorShortcut[]
  initEditorShortcuts: () => Promise<void>
  setEditorShortcut: (id: EditorShortcutCommandId, value: string) => Promise<boolean>
  resetEditorShortcut: (id: EditorShortcutCommandId) => Promise<void>
}

async function saveEditorShortcuts(shortcuts: EditorShortcut[]) {
  const store = await Store.load('store.json')
  await store.set(STORE_KEY, shortcuts)
  await store.save()
}

const useEditorShortcutStore = create<EditorShortcutState>((set, get) => ({
  shortcuts: defaultEditorShortcuts,

  initEditorShortcuts: async () => {
    const store = await Store.load('store.json')
    const storedShortcuts = await store.get<EditorShortcut[]>(STORE_KEY)
    const mergedShortcuts = mergeEditorShortcuts(storedShortcuts)

    if (!storedShortcuts?.length) {
      await store.set(STORE_KEY, mergedShortcuts)
      await store.save()
    }

    set({ shortcuts: mergedShortcuts })
  },

  setEditorShortcut: async (id, value) => {
    const normalizedValue = normalizeShortcut(value)
    const shortcuts = get().shortcuts

    if (getShortcutConflict(shortcuts, id, normalizedValue)) {
      return false
    }

    const nextShortcuts = shortcuts.map((shortcut) => (
      shortcut.id === id
        ? { ...shortcut, value: normalizedValue }
        : shortcut
    ))

    await saveEditorShortcuts(nextShortcuts)
    set({ shortcuts: nextShortcuts })
    return true
  },

  resetEditorShortcut: async (id) => {
    const defaultShortcut = defaultEditorShortcuts.find((shortcut) => shortcut.id === id)
    const nextShortcuts = get().shortcuts.map((shortcut) => (
      shortcut.id === id
        ? { ...shortcut, value: defaultShortcut?.value ?? '' }
        : shortcut
    ))

    await saveEditorShortcuts(nextShortcuts)
    set({ shortcuts: nextShortcuts })
  },
}))

export default useEditorShortcutStore
