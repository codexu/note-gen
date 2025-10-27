import { ContextMenuItem } from "@/components/ui/context-menu";
import { RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { uploadFile as uploadGithubFile } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile } from '@/lib/sync/gitlab';
import { RepoNames } from '@/lib/sync/github.types';
import { useTranslations } from "next-intl";
import { useState } from "react";
import useArticleStore, { DirTree } from "@/stores/article";
import { computedParentPath } from "@/lib/path";
import { collectMarkdownFiles } from "@/lib/files";

export default function SyncFolder({ item }: { item: DirTree }) {
  const t = useTranslations('article.file')
  const [isSyncing, setIsSyncing] = useState(false)
  const path = computedParentPath(item)

  const { loadFileTree } = useArticleStore()

  // 同步文件夹下的所有 Markdown 文件
  async function handleSyncFolder() {
    if (isSyncing) return;
    
    setIsSyncing(true);
    toast({ title: t('context.syncFolderProgress') });
    
    const store = await Store.load('store.json');
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    // 获取当前文件夹下的所有 Markdown 文件
    const markdownFiles = await collectMarkdownFiles(path);
    
    if (markdownFiles.length === 0) {
      toast({
        title: t('context.syncFolderError'),
        description: '当前文件夹下没有 Markdown 文件',
        variant: 'destructive'
      });
      return;
    }
    
    let successCount = 0;
    
    // 批量同步文件
    for (const file of markdownFiles) {
      const workspace = await getWorkspacePath();
      const pathOptions = await getFilePathOptions(file.path);
      
      let content = '';
      if (workspace.isCustom) {
        content = await readTextFile(pathOptions.path);
      } else {
        content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir });
      }
      
      const base64Content = Buffer.from(content).toString('base64');
      // 根据主要备份方式选择上传函数
      let uploadResult;
      switch (primaryBackupMethod) {
        case 'github':
          uploadResult = await uploadGithubFile({
            ext: 'md',
            file: base64Content,
            filename: file.name,
            repo: RepoNames.sync,
            path: file.path.substring(0, file.path.lastIndexOf('/')) || undefined,
            message: `Sync folder: ${item.name}`
          });
          break;
        case 'gitee':
          uploadResult = await uploadGiteeFile({
            ext: 'md',
            file: base64Content,
            filename: file.name,
            repo: RepoNames.sync,
            path: file.path.substring(0, file.path.lastIndexOf('/')) || undefined,
            message: `Sync folder: ${item.name}`
          });
          break;
        case 'gitlab':
          uploadResult = await uploadGitlabFile({
            ext: 'md',
            file: base64Content,
            filename: file.name,
            repo: RepoNames.sync,
            path: file.path.substring(0, file.path.lastIndexOf('/')) || undefined,
            message: `Sync folder: ${item.name}`
          });
          break;
      }
      
      if (uploadResult) {
        successCount++;
      }
    }
    
    toast({
      title: t('context.syncFolderSuccess'),
      description: `成功同步 ${successCount} 个文件`,
      variant: 'default'
    });
    
    // 刷新文件树以更新同步状态
    loadFileTree();
    setIsSyncing(false);
  }

  return <ContextMenuItem inset disabled={isSyncing || !item.isLocale} onClick={handleSyncFolder}>
    {isSyncing ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
    {t('context.syncFolder')}
  </ContextMenuItem>
}