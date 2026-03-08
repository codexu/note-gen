import { Store } from '@tauri-apps/plugin-store'
import { fetch, Proxy } from '@tauri-apps/plugin-http'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import { collectMarkdownFiles } from '@/lib/files'
import { RepoNames } from './github.types'

export interface FolderSyncResult {
  success: boolean
  totalFiles: number
  successCount: number
  failedCount: number
  message: string
  errors?: string[]
}

export class FolderSync {
  private platform: string = 'github'

  constructor() {
    this.init()
  }

  private async init() {
    const store = await Store.load('store.json')
    this.platform = await store.get<string>('primaryBackupMethod') || 'github'
  }

  async syncFolder(localFolderPath: string): Promise<FolderSyncResult> {
    // TODO: 实现
  }
}
