import { create } from 'zustand'
import emitter from '@/lib/emitter'

export function readingKey(workspacePath: string, path: string) {
  return JSON.stringify([workspacePath, path])
}

interface EditorReadingState {
  readOnlyFiles: Record<string, boolean>
  setReadOnly: (workspacePath: string, path: string, readOnly: boolean) => boolean
}

// Session-only preference shared by the file tree, tabs and document editors.
export const useEditorReadingStore = create<EditorReadingState>((set) => ({
  readOnlyFiles: {},
  setReadOnly: (workspacePath, path, readOnly) => {
    let ready = true
    emitter.emit('editor-reading-mode', {
      workspacePath, path, readOnly, phase: 'prepare',
      resolve: value => { ready = ready && value },
    })
    if (!ready) return false
    emitter.emit('editor-reading-mode', {
      workspacePath, path, readOnly, phase: 'apply', resolve: () => {},
    })
    set(state => {
      const readOnlyFiles = { ...state.readOnlyFiles }
      if (readOnly) readOnlyFiles[readingKey(workspacePath, path)] = true
      else delete readOnlyFiles[readingKey(workspacePath, path)]
      return { readOnlyFiles }
    })
    return true
  },
}))
