import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import { useState } from "react";
import useArticleStore, { DirTree } from "@/stores/article";
import { syncFolderByItem, showFolderSyncToast } from "@/lib/sync/folder-sync-helper";

export default function SyncFolder({ item }: { item: DirTree }) {
  const t = useTranslations('article.file')
  const [isSyncing, setIsSyncing] = useState(false)

  const { loadFileTree } = useArticleStore()

  // 同步文件夹下的所有 Markdown 文件
  async function handleSyncFolder() {
    if (isSyncing) return;

    // 检查是否真的是目录（防止误将文件当作目录处理）
    if (!item.isDirectory) {
      toast({
        title: '不是目录',
        description: '只能同步目录',
        variant: 'destructive'
      });
      return;
    }

    setIsSyncing(true);
    toast({ title: t('context.syncFolderProgress') });

    console.log('[SyncFolder] 开始同步文件夹:', item)

    try {
      const result = await syncFolderByItem(item)
      console.log('[SyncFolder] 同步结果:', result)
      showFolderSyncToast(result)
    } catch (error) {
      console.error('[SyncFolder] 同步出错:', error)
      toast({
        title: t('context.syncFolderError'),
        description: String(error),
        variant: 'destructive'
      })
    }

    // 刷新文件树以更新同步状态
    loadFileTree();
    setIsSyncing(false);
  }

  return <ContextMenuItem inset disabled={isSyncing || !item.isLocale} onClick={handleSyncFolder} menuType="file">
    {isSyncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
    {t('context.syncFolder')}
  </ContextMenuItem>
}