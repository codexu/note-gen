import { create } from 'zustand'

export interface ClipboardItem {
  path: string
  name: string
  isDirectory: boolean
  sha?: string
  isLocale?: boolean
}

type ClipboardOperation = 'copy' | 'cut' | 'none'

interface ClipboardState {
  clipboardItem: ClipboardItem | null
  clipboardItems: ClipboardItem[]
  clipboardOperation: ClipboardOperation
  setClipboardItem: (item: ClipboardItem | null, operation: ClipboardOperation) => void
  setClipboardItems: (items: ClipboardItem[], operation: ClipboardOperation) => void
}

const useClipboardStore = create<ClipboardState>((set) => ({
  clipboardItem: null,
  clipboardItems: [],
  clipboardOperation: 'none',
  setClipboardItem: (item, operation) => set({
    clipboardItem: item,
    clipboardItems: item ? [item] : [],
    clipboardOperation: operation
  }),
  setClipboardItems: (items, operation) => set({
    clipboardItem: items[0] || null,
    clipboardItems: items,
    clipboardOperation: items.length > 0 ? operation : 'none'
  }),
}))

export default useClipboardStore
