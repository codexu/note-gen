import { ContextMenuItem } from "@/components/ui/context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { cloneDeep } from "lodash-es";

interface RenameFolderProps {
  item: DirTree;
  onStartRename: () => void;
}

export function RenameFolder({ item, onStartRename }: RenameFolderProps) {
  const t = useTranslations('article.file');
  const { fileTree, setFileTree } = useArticleStore();
  const path = computedParentPath(item);

  function handleStartRename() {
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    const parentFolder = currentFolder?.parent;

    if (parentFolder && parentFolder.children) {
      const folderIndex = parentFolder?.children?.findIndex(folder => folder.name === item.name);
      if (folderIndex !== undefined && folderIndex !== -1) {
        parentFolder.children[folderIndex].isEditing = true;
      }
    } else {
      const folderIndex = cacheTree.findIndex(folder => folder.name === item.name);
      cacheTree[folderIndex].isEditing = true;
    }
    
    setFileTree(cacheTree);
    onStartRename();
  }

  return (
    <ContextMenuItem inset onClick={handleStartRename}>
      {t('context.rename')}
    </ContextMenuItem>
  );
}
