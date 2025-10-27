import { ContextMenuItem } from "@/components/ui/context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { remove } from "@tauri-apps/plugin-fs";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { ask } from '@tauri-apps/plugin-dialog';
import useSettingStore from '@/stores/setting';

interface DeleteFolderProps {
  item: DirTree;
}

export function DeleteFolder({ item }: DeleteFolderProps) {
  const t = useTranslations('article.file');
  const { 
    activeFilePath,
    setActiveFilePath,
    fileTree,
    setFileTree
  } = useArticleStore();
  const { primaryBackupMethod } = useSettingStore();

  const path = computedParentPath(item);

  async function handleDeleteFolder(event: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    event.stopPropagation();
    
    try {
      // 获取工作区路径信息
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace');
      const workspace = await getWorkspacePath();
      
      // 确认删除操作
      const confirmed = await ask(t('context.confirmDelete', { name: item.name }), {
        title: item.name,
        kind: 'warning',
      });
      
      if (!confirmed) return;

      // 根据工作区类型确定正确的路径
      const pathOptions = await getFilePathOptions(path);
      
      if (workspace.isCustom) {
        await remove(pathOptions.path, { recursive: true });
      } else {
        await remove(pathOptions.path, { baseDir: pathOptions.baseDir, recursive: true });
      }

      // 如果删除的文件夹包含当前活动文件，清除活动文件路径
      if (activeFilePath && activeFilePath.startsWith(path)) {
        setActiveFilePath('');
      }

      // 从文件树中移除该文件夹
      const cacheTree = cloneDeep(fileTree);
      const currentFolder = getCurrentFolder(path, cacheTree);
      const parentFolder = currentFolder?.parent;

      if (parentFolder && parentFolder.children) {
        const index = parentFolder.children.findIndex(child => child.name === item.name);
        if (index !== -1) {
          parentFolder.children.splice(index, 1);
        }
      } else {
        const index = cacheTree.findIndex(child => child.name === item.name);
        if (index !== -1) {
          cacheTree.splice(index, 1);
        }
      }

      setFileTree(cacheTree);

      // 如果启用了同步，同步删除操作
      if (primaryBackupMethod === 'github') {
        const { deleteFile: deleteGithubFile } = await import('@/lib/sync/github');
        await deleteGithubFile({ path, sha: item.sha || '', repo: 'sync' as any });
      } else if (primaryBackupMethod === 'gitee') {
        const { deleteFile: deleteGiteeFile } = await import('@/lib/sync/gitee');
        await deleteGiteeFile({ path, sha: item.sha || '', repo: 'sync' as any });
      } else if (primaryBackupMethod === 'gitlab') {
        const { deleteFile: deleteGitlabFile } = await import('@/lib/sync/gitlab');
        await deleteGitlabFile({ path, sha: item.sha, repo: 'sync' as any });
      }

      toast({ title: t('context.deleteSuccess') });
    } catch (error) {
      console.error('Delete folder failed:', error);
      toast({ 
        title: t('context.deleteFailed'), 
        variant: 'destructive' 
      });
    }
  }

  return (
    <ContextMenuItem 
      inset 
      className="text-red-900" 
      onClick={handleDeleteFolder}
    >
      {t('context.delete')}
    </ContextMenuItem>
  );
}
