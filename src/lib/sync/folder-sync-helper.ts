import { FolderSync, FolderSyncResult } from './folder-sync'
import { computedParentPath } from '@/lib/path'
import { DirTree } from '@/stores/article'
import { toast } from '@/hooks/use-toast'

let folderSyncInstance: FolderSync | null = null

function getFolderSync(): FolderSync {
  if (!folderSyncInstance) {
    folderSyncInstance = new FolderSync()
  }
  return folderSyncInstance
}

export async function syncFolderByItem(item: DirTree): Promise<FolderSyncResult> {
  const folderPath = computedParentPath(item)
  const sync = getFolderSync()
  return await sync.syncFolder(folderPath)
}

export function showFolderSyncToast(result: FolderSyncResult) {
  if (result.success) {
    toast({
      title: '文件夹同步成功',
      description: result.message
    })
  } else {
    toast({
      title: '文件夹同步失败',
      description: result.message,
      variant: 'destructive'
    })
  }
}
