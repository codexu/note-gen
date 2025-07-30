import { ContextMenuItem } from "@/components/ui/context-menu";
import { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import useClipboardStore from "@/stores/clipboard";
import { toast } from "@/hooks/use-toast";

interface CopyFolderProps {
  item: DirTree;
}

export function CopyFolder({ item }: CopyFolderProps) {
  const t = useTranslations('article.file');
  const { setClipboardItem } = useClipboardStore();
  const path = computedParentPath(item);

  async function handleCopyFolder() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: true,
      isLocale: item.isLocale
    }, 'copy');
    toast({ title: t('clipboard.copied') });
  }

  return (
    <ContextMenuItem inset onClick={handleCopyFolder}>
      {t('context.copy')}
    </ContextMenuItem>
  );
}
