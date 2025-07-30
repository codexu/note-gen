import { ContextMenuItem } from "@/components/ui/context-menu";
import { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import useClipboardStore from "@/stores/clipboard";
import { toast } from "@/hooks/use-toast";

interface CutFolderProps {
  item: DirTree;
}

export function CutFolder({ item }: CutFolderProps) {
  const t = useTranslations('article.file');
  const { setClipboardItem } = useClipboardStore();
  const path = computedParentPath(item);

  async function handleCutFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale
    }, 'cut');
    toast({ title: t('clipboard.cut') });
  }

  return (
    <ContextMenuItem 
      inset 
      disabled={!item.isLocale} 
      onClick={handleCutFolder}
    >
      {t('context.cut')}
    </ContextMenuItem>
  );
}
