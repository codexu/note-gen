import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { remove } from "@tauri-apps/plugin-fs";
import { toast } from "@/hooks/use-toast";
import { cloneDeep } from "lodash-es";
import { ask } from '@tauri-apps/plugin-dialog';
import useSettingStore from '@/stores/setting';
import { Trash2 } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"

interface DeleteFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function DeleteFolder({ item, shortcut }: DeleteFolderProps) {
  const t = useTranslations('article.file');
  const {
    fileTree,
    setFileTree,
    cleanTabsByDeletedFolder
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

      // 清理已被删除的文件夹对应的 tabs（包括自动选择其他 tab）
      await cleanTabsByDeletedFolder(path)

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

      // 删除向量数据库中该文件夹下所有文件的记录
      try {
        const { getAllMarkdownFiles } = await import('@/lib/files')
        const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
        const allFiles = await getAllMarkdownFiles()

        // 找出该文件夹下的所有 Markdown 文件
        const folderPrefix = path.endsWith('/') ? path : path + '/'
        const filesInFolder = allFiles.filter(file => file.relativePath.startsWith(folderPrefix))

        // 删除这些文件的向量数据
        for (const file of filesInFolder) {
          const filename = file.relativePath
          try {
            await deleteVectorDocumentsByFilename(filename)
          } catch (error) {
            console.error(`删除文件 ${filename} 的向量数据失败:`, error)
          }
        }
      } catch (error) {
        console.error('删除文件夹向量数据失败:', error)
      }

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
      menuType="file"
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {t('context.delete')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
