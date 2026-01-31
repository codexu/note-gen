import { ContextMenuItem } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import { FolderPlus } from "lucide-react"

interface NewFolderProps {
  item: DirTree;
}

export function NewFolder({ item }: NewFolderProps) {
  const t = useTranslations('article.file');
  const { 
    collapsibleList,
    setCollapsibleList,
    newFolderInFolder
  } = useArticleStore();

  const path = computedParentPath(item);

  function newFolderHandler(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation();
    // 如果当前文件夹未展开，则先展开
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    newFolderInFolder(path);
  }

  return (
    <ContextMenuItem
      inset
      disabled={!!item.sha && !item.isLocale}
      onClick={newFolderHandler}
      menuType="file"
    >
      <FolderPlus className="mr-2 h-4 w-4" />
      {t('context.newFolder')}
    </ContextMenuItem>
  );
}
