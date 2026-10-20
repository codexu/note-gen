import type { FileTreeSyncStatus } from '@/app/core/main/file/file-tree-action-policy'

export type BrowserEntry = {
  name: string
  type: 'folder' | 'file'
  relativePath: string
  isLocale: boolean
  isLoading?: boolean
  sha?: string
  modifiedAt?: string
  size?: number
  fileCount?: number
  folderCount?: number
  syncStatus: FileTreeSyncStatus
}
