import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Store } from "@tauri-apps/plugin-store";
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { uploadFile as uploadGithubFile, getFiles as getGithubFiles } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as getGiteeFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as getGitlabFiles } from '@/lib/sync/gitlab';
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
    let failedCount = 0;
    
    // 批量同步文件
    for (const file of markdownFiles) {
      try {
        const workspace = await getWorkspacePath();
        const pathOptions = await getFilePathOptions(file.path);
        
        let content = '';
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path);
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir });
        }
        
        const base64Content = Buffer.from(content).toString('base64');
        const filePath = file.path.substring(0, file.path.lastIndexOf('/')) || undefined;
        
        // 检查文件是否已存在，获取 SHA 值
        let existingSha: string | undefined = undefined;
        
        switch (primaryBackupMethod) {
          case 'github': {
            const existingFiles = await getGithubFiles({
              path: file.path,
              repo: RepoNames.sync
            });
            if (existingFiles && !Array.isArray(existingFiles)) {
              existingSha = existingFiles.sha;
            }
            break;
          }
          case 'gitee': {
            const existingFiles = await getGiteeFiles({
              path: file.path,
              repo: RepoNames.sync
            });
            if (existingFiles && !Array.isArray(existingFiles)) {
              existingSha = existingFiles.sha;
            }
            break;
          }
          case 'gitlab': {
            const existingFiles = await getGitlabFiles({
              path: file.path,
              repo: RepoNames.sync
            });
            if (existingFiles && !Array.isArray(existingFiles)) {
              existingSha = existingFiles.sha;
            }
            break;
          }
        }
        
        // 根据主要备份方式选择上传函数
        let uploadResult;
        switch (primaryBackupMethod) {
          case 'github':
            uploadResult = await uploadGithubFile({
              ext: 'md',
              file: base64Content,
              filename: file.name,
              repo: RepoNames.sync,
              path: filePath,
              sha: existingSha,
              message: existingSha ? `Update ${file.name} from folder: ${item.name}` : `Sync folder: ${item.name}`
            });
            break;
          case 'gitee':
            uploadResult = await uploadGiteeFile({
              ext: 'md',
              file: base64Content,
              filename: file.name,
              repo: RepoNames.sync,
              path: filePath,
              sha: existingSha,
              message: existingSha ? `Update ${file.name} from folder: ${item.name}` : `Sync folder: ${item.name}`
            });
            break;
          case 'gitlab':
            uploadResult = await uploadGitlabFile({
              ext: 'md',
              file: base64Content,
              filename: file.name,
              repo: RepoNames.sync,
              path: filePath,
              sha: existingSha,
              message: existingSha ? `Update ${file.name} from folder: ${item.name}` : `Sync folder: ${item.name}`
            });
            break;
        }
        
        if (uploadResult) {
          successCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        console.error(`同步文件 ${file.path} 失败:`, error);
        failedCount++;
      }
    }
    
    if (failedCount > 0) {
      toast({
        title: t('context.syncFolderSuccess'),
        description: `成功同步 ${successCount} 个文件，失败 ${failedCount} 个`,
        variant: failedCount === markdownFiles.length ? 'destructive' : 'default'
      });
    } else {
      toast({
        title: t('context.syncFolderSuccess'),
        description: `成功同步 ${successCount} 个文件`,
        variant: 'default'
      });
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