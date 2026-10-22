import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { showWorkspaceItemInFileManager } from '@/lib/file-manager'
import { FolderOpen } from "lucide-react"

interface ViewDirectoryProps {
  item: DirTree;
}

export function ViewDirectory({ item }: ViewDirectoryProps) {
  const t = useTranslations('article.file');
  const path = computedParentPath(item);

  async function handleShowFileManager() {
    await showWorkspaceItemInFileManager(path)
  }

  return (
    <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
      <FolderOpen className="mr-2 h-4 w-4" />
      {t('context.viewDirectory')}
    </ContextMenuItem>
  );
}
