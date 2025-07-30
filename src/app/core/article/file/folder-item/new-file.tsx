import { ContextMenuItem } from "@/components/ui/context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { cloneDeep } from "lodash-es";
import { computedParentPath, getCurrentFolder } from "@/lib/path";

interface NewFileProps {
  item: DirTree;
}

export function NewFile({ item }: NewFileProps) {
  const t = useTranslations('article.file');
  const { 
    fileTree,
    setFileTree,
    collapsibleList,
    setCollapsibleList
  } = useArticleStore();

  const path = computedParentPath(item);

  function newFileHandler(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
    e.stopPropagation();
    
    // 创建临时文件节点，并将其设为编辑状态，与 newFile 保持一致
    const cacheTree = cloneDeep(fileTree);
    const currentFolder = getCurrentFolder(path, cacheTree);
    
    // 如果文件夹中已经有一个空名称的文件，不再创建新的
    if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
      return;
    }
    
    // 确保文件夹是展开状态
    if (!collapsibleList.includes(path)) {
      setCollapsibleList(path, true);
    }
    
    if (currentFolder) {
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: currentFolder,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      };
      currentFolder.children?.unshift(newFile);
      setFileTree(cacheTree);
    }
  }

  return (
    <ContextMenuItem 
      inset 
      disabled={!!item.sha && !item.isLocale} 
      onClick={newFileHandler}
    >
      {t('context.newFile')}
    </ContextMenuItem>
  );
}
