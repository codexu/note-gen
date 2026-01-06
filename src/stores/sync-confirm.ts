import { create } from 'zustand'

interface SyncConfirmState {
  isOpen: boolean
  fileName: string
  commitInfo?: {
    sha: string
    message: string
    author: string
    date: Date
    additions?: number
    deletions?: number
  }
  onConfirm?: () => void
  onCancel?: () => void
  onIgnore?: () => void
  
  // Actions
  showConfirmDialog: (data: {
    fileName: string
    commitInfo?: {
      sha: string
      message: string
      author: string
      date: Date
      additions?: number
      deletions?: number
    }
    onConfirm: () => void
    onCancel: () => void
    onIgnore?: () => void
  }) => void
  hideConfirmDialog: () => void
}

export const useSyncConfirmStore = create<SyncConfirmState>((set) => ({
  isOpen: false,
  fileName: '',
  commitInfo: undefined,
  onConfirm: undefined,
  onCancel: undefined,
  onIgnore: undefined,

  showConfirmDialog: (data) => set({
    isOpen: true,
    fileName: data.fileName,
    commitInfo: data.commitInfo,
    onConfirm: data.onConfirm,
    onCancel: data.onCancel,
    onIgnore: data.onIgnore
  }),

  hideConfirmDialog: () => set({
    isOpen: false,
    fileName: '',
    commitInfo: undefined,
    onConfirm: undefined,
    onCancel: undefined,
    onIgnore: undefined
  })
}))
