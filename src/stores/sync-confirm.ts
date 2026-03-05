import { create } from 'zustand'

interface SyncConfirmState {
  isOpen: boolean
  dialogType: 'pull' | 'conflict' | 'shaMismatch'  // 对话框类型：拉取确认 | 冲突解决 | SHA 不匹配
  fileName: string
  localContent?: string
  remoteContent?: string
  localSha?: string      // 本地记录的 SHA（SHA 不匹配时使用）
  remoteSha?: string    // 远程文件的 SHA（SHA 不匹配时使用）
  commitInfo?: {
    sha: string
    message: string
    author: string
    date: Date
    additions?: number
    deletions?: number
  }
  onConfirm?: () => void  // 确认（拉取/保留远程）
  onCancel?: () => void   // 取消
  onKeepLocal?: () => void // 保留本地（冲突时）
  onMerge?: () => void     // 合并（冲突时）
  onIgnore?: () => void    // 忽略

  // Actions
  showPullDialog: (data: {
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
    onCancel?: () => void
    onIgnore?: () => void
  }) => void

  showConflictDialog: (data: {
    fileName: string
    localContent: string
    remoteContent: string
    commitInfo?: {
      sha: string
      message: string
      author: string
      date: Date
    }
    onKeepLocal: () => void
    onKeepRemote: () => void
    onMerge?: () => void
    onCancel?: () => void
  }) => void

  // 显示 SHA 不匹配对话框
  showShaMismatchDialog: (data: {
    fileName: string
    localSha?: string
    remoteSha?: string
    onForceUpload: () => void  // 强制上传（不带 SHA）
    onCancel: () => void        // 取消
  }) => void

  hideConfirmDialog: () => void
}

export const useSyncConfirmStore = create<SyncConfirmState>((set) => ({
  isOpen: false,
  dialogType: 'pull',
  fileName: '',
  localContent: undefined,
  remoteContent: undefined,
  commitInfo: undefined,
  onConfirm: undefined,
  onCancel: undefined,
  onKeepLocal: undefined,
  onMerge: undefined,
  onIgnore: undefined,

  showPullDialog: (data) => set({
    isOpen: true,
    dialogType: 'pull',
    fileName: data.fileName,
    commitInfo: data.commitInfo,
    onConfirm: data.onConfirm,
    onCancel: data.onCancel,
    onIgnore: data.onIgnore
  }),

  showConflictDialog: (data) => set({
    isOpen: true,
    dialogType: 'conflict',
    fileName: data.fileName,
    localContent: data.localContent,
    remoteContent: data.remoteContent,
    commitInfo: data.commitInfo,
    onKeepLocal: data.onKeepLocal,
    onConfirm: data.onKeepRemote,  // onConfirm 用于保留远程
    onMerge: data.onMerge,
    onCancel: data.onCancel
  }),

  showShaMismatchDialog: (data) => set({
    isOpen: true,
    dialogType: 'shaMismatch',
    fileName: data.fileName,
    localSha: data.localSha,
    remoteSha: data.remoteSha,
    onConfirm: data.onForceUpload,  // onConfirm 用于强制上传
    onCancel: data.onCancel
  }),

  hideConfirmDialog: () => set({
    isOpen: false,
    dialogType: 'pull',
    fileName: '',
    localContent: undefined,
    remoteContent: undefined,
    localSha: undefined,
    remoteSha: undefined,
    commitInfo: undefined,
    onConfirm: undefined,
    onCancel: undefined,
    onKeepLocal: undefined,
    onMerge: undefined,
    onIgnore: undefined
  })
}))
