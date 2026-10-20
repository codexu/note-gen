import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { useTranslations } from "next-intl";
import { Trash2, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import useArticleStore, { DirTree } from "@/stores/article";
import { computedParentPath } from "@/lib/path";
import { collectMarkdownFiles } from "@/lib/files";
import { calculateFolderVectors } from "@/lib/folder-vector";

interface FolderVectorMenuProps {
  item: DirTree;
}

export function FolderVectorMenu({ item }: FolderVectorMenuProps) {
  const t = useTranslations('article.file');
  const { loadFileTree, checkFileVectorIndexed, clearFileVector, setVectorCalcStatus } = useArticleStore();
  const path = computedParentPath(item);

  const [isCalculating, setIsCalculating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // 批量计算文件夹中的向量
  async function handleBatchCalculate() {
    if (isCalculating) return;

    // 检查是否真的是目录（防止误将文件当作目录处理）
    if (!item.isDirectory) {
      toast({
        title: '不是目录',
        description: '只能对目录进行批量向量计算',
        variant: 'destructive'
      });
      return;
    }

    setIsCalculating(true);
    setVectorCalcStatus(path, 'calculating');

    try {
      const markdownFiles = await collectMarkdownFiles(path);

      if (markdownFiles.length === 0) {
        toast({
          title: t('context.noMarkdownFiles'),
          variant: 'destructive'
        });
        setIsCalculating(false);
        setVectorCalcStatus(path, 'idle');
        return;
      }

      const result = await calculateFolderVectors({
        folderPath: path,
        // processMarkdownFile 会用内容哈希跳过未变化文件；这里检查全部文件，
        // 避免已有索引的文件在外部修改后一直保留旧内容。
        mode: 'recalculate',
        checkFileVectorIndexed,
        setVectorCalcStatus,
      });

      if (!result.embeddingModelAvailable) {
        toast({
          title: '向量处理',
          description: '未配置嵌入模型或模型不可用，请在AI设置中配置嵌入模型',
          variant: 'destructive'
        });
        setVectorCalcStatus(path, 'idle');
        return;
      }

      const successCount = result.success + result.skipped;
      const failedCount = result.failed;

      if (failedCount === 0) {
        toast({
          title: t('context.batchCalcSuccess', { count: successCount }),
        });
      } else {
        toast({
          title: t('context.batchCalcPartial', { success: successCount, failed: failedCount }),
          variant: failedCount === result.total ? 'destructive' : 'default'
        });
      }

      // 刷新向量索引状态 - 检查所有文件的向量状态
      for (const file of markdownFiles) {
        await checkFileVectorIndexed(file.path);
      }

      // 设置文件夹为完成状态
      setVectorCalcStatus(path, 'completed');
      loadFileTree();
    } catch (error) {
      console.error('批量计算向量失败:', error);
      toast({
        title: t('context.batchCalcFailed'),
        variant: 'destructive'
      });
      setVectorCalcStatus(path, 'idle');
    } finally {
      setIsCalculating(false);
    }
  }

  // 批量删除文件夹中的向量
  async function handleBatchDelete() {
    if (isDeleting) return;

    try {
      const markdownFiles = await collectMarkdownFiles(path);

      if (markdownFiles.length === 0) {
        toast({
          title: t('context.noMarkdownFiles'),
          variant: 'destructive'
        });
        return;
      }

      const { ask } = await import('@tauri-apps/plugin-dialog');
      const confirmed = await ask(
        t('context.confirmDeleteVectors', { count: markdownFiles.length }),
        {
          title: t('context.deleteVectors'),
          kind: 'warning',
        }
      );

      if (!confirmed) return;

      setIsDeleting(true);

      let successCount = 0;
      let failedCount = 0;

      for (const file of markdownFiles) {
        try {
          await clearFileVector(file.path);
          successCount++;
        } catch (error) {
          console.error(`删除文件 ${file.name} 向量失败:`, error);
          failedCount++;
        }
      }

      if (failedCount === 0) {
        toast({
          title: t('context.batchDeleteSuccess', { count: successCount }),
        });
      } else {
        toast({
          title: t('context.batchDeletePartial', { success: successCount, failed: failedCount }),
          variant: failedCount === markdownFiles.length ? 'destructive' : 'default'
        });
      }

      loadFileTree();
    } catch (error) {
      console.error('批量删除向量失败:', error);
      toast({
        title: t('context.batchDeleteFailed'),
        variant: 'destructive'
      });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <ContextMenuItem
        inset
        disabled={isCalculating}
        onClick={handleBatchCalculate}
        menuType="file"
      >
        {isCalculating ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {t('context.calculateVectors')}
      </ContextMenuItem>

      <ContextMenuItem
        inset
        disabled={isDeleting}
        className="text-red-600"
        onClick={handleBatchDelete}
        menuType="file"
      >
        {isDeleting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="mr-2 h-4 w-4" />
        )}
        {t('context.deleteVectors')}
      </ContextMenuItem>
    </>
  );
}
