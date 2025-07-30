import { ContextMenuItem } from "@/components/ui/context-menu";
import { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { appDataDir } from '@tauri-apps/api/path';
import { openPath } from "@tauri-apps/plugin-opener";

interface ViewDirectoryProps {
  item: DirTree;
}

export function ViewDirectory({ item }: ViewDirectoryProps) {
  const t = useTranslations('article.file');
  const path = computedParentPath(item);

  async function handleShowFileManager() {
    // 获取工作区路径信息
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace');
    const workspace = await getWorkspacePath();
    
    // 根据工作区类型确定正确的路径
    if (workspace.isCustom) {
      // 自定义工作区 - 直接使用工作区路径
      const pathOptions = await getFilePathOptions(path);
      openPath(pathOptions.path);
    } else {
      // 默认工作区 - 使用 AppData 目录
      const appDir = await appDataDir();
      openPath(`${appDir}/article/${path}`);
    }
  }

  return (
    <ContextMenuItem inset onClick={handleShowFileManager}>
      {t('context.viewDirectory')}
    </ContextMenuItem>
  );
}
