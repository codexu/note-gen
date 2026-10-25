import type { Editor } from '@tiptap/react'
import { create } from 'zustand'

interface OutlineEditor {
  editor: Editor
  documentKey: string
}

interface EditorOutlineState {
  active: OutlineEditor | null
  register: (entry: OutlineEditor) => () => void
}

// Window-local, transient state. Never persist an editor instance or let an old
// pane's cleanup unregister the newly focused pane.
export const useEditorOutlineStore = create<EditorOutlineState>((set, get) => ({
  active: null,
  register: (entry) => {
    set({ active: entry })
    return () => {
      if (get().active === entry) set({ active: null })
    }
  },
}))
