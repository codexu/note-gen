import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import { useState } from "react";
import useArticleStore, { DirTree } from "@/stores/article";
import { computedParentPath } from "@/lib/path";
import { pullRemoteLibraryFolder } from "@/lib/sync/remote-library";
import { MobileMenuItem } from "../mobile-action-menu";
import { getSyncConfiguration } from "../file-tree-action-policy";
import { useSettingsDialogStore } from "@/stores/settings-dialog";

export default function DownloadFolder({ item, mobile = false }: { item: DirTree; mobile?: boolean }) {
  const t = useTranslations('article.file')
  const [isSyncing, setIsSyncing] = useState(false)

  const { loadFileTree, setEntryLoading, setEntrySyncError } = useArticleStore()

  // 下载远程文件夹下的全部文件类型
  async function handleSyncFolder() {
    if (isSyncing) return
    const sync = await getSyncConfiguration()
    if (!sync.configured) {
      toast({
        title: sync.reason === 'missing-repository'
          ? t('context.syncRepoRequired')
          : t('context.syncNotConfigured'),
        description: t('context.configureSync'),
      })
      useSettingsDialogStore.getState().openSettings('sync')
      return
    }

    // 检查是否真的是目录（防止误将文件当作目录处理）
    if (!item.isDirectory) {
      toast({
        title: '不是目录',
        description: '只能下载目录',
        variant: 'destructive'
      });
      return;
    }

    const folderPath = computedParentPath(item)
    let syncError: string | undefined
    setIsSyncing(true);
    setEntryLoading(folderPath, true)
    setEntrySyncError(folderPath)
    const progressToast = toast({
      title: t('context.syncFolderProgress'),
      description: item.name,
      duration: Infinity,
    })

    try {
      const result = await pullRemoteLibraryFolder(folderPath, progress => {
        if (!progress.path) return
        progressToast.update({
          title: t('context.syncFolderProgress'),
          description: `${progress.current}/${progress.total} · ${progress.path}`,
          duration: Infinity,
        })
      })
      progressToast.update({
        title: t('context.syncFolderSuccess'),
        description: t('cloudLibrary.pullResult', {
          downloaded: result.downloaded,
          skipped: result.skipped,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        duration: 5000,
      })
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error)
      progressToast.update({
        title: t('context.syncFolderError'),
        description: String(error),
        variant: 'destructive',
        duration: 5000,
      })
    } finally {
      // 刷新文件树以更新本地状态
      try {
        await loadFileTree()
        if (syncError) setEntrySyncError(folderPath, syncError)
      } finally {
        setEntryLoading(folderPath, false)
        setIsSyncing(false)
      }
    }
  }

  if (mobile) {
    return (
      <MobileMenuItem disabled={isSyncing} onClick={() => void handleSyncFolder()}>
        {t('context.syncFolder')}
      </MobileMenuItem>
    )
  }

  return <ContextMenuItem inset disabled={isSyncing} onClick={() => void handleSyncFolder()} menuType="file">
    {isSyncing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
    {t('context.syncFolder')}
  </ContextMenuItem>
}
