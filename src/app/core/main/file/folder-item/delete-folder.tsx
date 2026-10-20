import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { ask } from '@tauri-apps/plugin-dialog';
import { Trash2 } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import {
  clearFolderRemoteState,
  deleteRemoteFolder,
  hasRemoteFolderData,
} from "./delete-folder-utils";
import { moveEntryToSystemTrash } from '../system-trash'
import useSettingStore from '@/stores/setting'
import { prepareActiveEditorPathMutationDurably } from '@/lib/editor-deactivation'

interface DeleteFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function DeleteFolder({ item, shortcut }: DeleteFolderProps) {
  const t = useTranslations('article.file');
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)
  const {
    fileTree,
    setFileTree,
    cleanTabsByDeletedFolder,
    loadFileTree,
  } = useArticleStore();

  const path = computedParentPath(item);

  async function handleDeleteFolder(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.stopPropagation();
    
    try {
      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      });
      
      if (!confirmed) return;

      const activeFilePath = useArticleStore.getState().activeFilePath
      if (!await prepareActiveEditorPathMutationDurably(activeFilePath, [path])) return

      const trashed = await moveEntryToSystemTrash(path)
      const removedVectorEntries = new Map(
        Array.from(useArticleStore.getState().vectorIndexedFiles.entries())
          .filter(([vectorPath]) => vectorPath === path || vectorPath.startsWith(`${path}/`))
      )

      // 清理已被删除的文件夹对应的 tabs（包括自动选择其他 tab）
      await cleanTabsByDeletedFolder(path)
      if (removedVectorEntries.size > 0) {
        const nextVectorIndexedFiles = new Map(useArticleStore.getState().vectorIndexedFiles)
        removedVectorEntries.forEach((_, vectorPath) => nextVectorIndexedFiles.delete(vectorPath))
        useArticleStore.setState({ vectorIndexedFiles: nextVectorIndexedFiles })
      }
      await loadFileTree({ skipRemoteSync: true })

      toast({
        title: t('context.movedToTrash', { count: trashed ? 1 : 0 }),
      });
    } catch (error) {
      console.error('Delete folder failed:', error);
      toast({ 
        title: t('context.deleteFailed'), 
        variant: 'destructive' 
      });
    }
  }

  async function handleDeleteRemoteFolder(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.stopPropagation()
    const confirmed = await ask(t('context.confirmDeleteRemoteFolder', { name: item.name }), {
      title: item.name,
      kind: 'warning',
    })
    if (!confirmed) return

    try {
      const result = await deleteRemoteFolder(item, false)
      if (result.failedPaths.length > 0) {
        throw new Error(result.failedPaths.join(', '))
      }
      const cacheTree = cloneDeep(fileTree)
      clearFolderRemoteState(cacheTree, path)
      setFileTree(cacheTree)
      toast({ title: t('context.deleteRemoteSuccess') })
    } catch (error) {
      console.error('Delete remote folder failed:', error)
      toast({ title: t('context.deleteFailed'), variant: 'destructive' })
    }
  }

  return (
    <>
      <ContextMenuItem
        inset
        disabled={!item.isLocale}
        className="text-destructive"
        onClick={handleDeleteFolder}
        menuType="file"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t('context.deleteLocalFolder')}
        {shortcut && (
          <ContextMenuShortcut menuType="file">
            <Kbd>{shortcut}</Kbd>
          </ContextMenuShortcut>
        )}
      </ContextMenuItem>
      {primaryBackupMethod !== 'cloudFolder' ? (
        <ContextMenuItem
          inset
          disabled={!hasRemoteFolderData(item)}
          className="text-destructive"
          onClick={handleDeleteRemoteFolder}
          menuType="file"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('context.deleteRemoteFolder')}
        </ContextMenuItem>
      ) : null}
    </>
  );
}
