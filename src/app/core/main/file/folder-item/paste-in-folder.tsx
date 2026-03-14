import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import useArticleStore, { DirTree } from "@/stores/article";
import { useTranslations } from "next-intl";
import { computedParentPath } from "@/lib/path";
import useClipboardStore from "@/stores/clipboard";
import { FileSymlink } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import { pasteIntoFolder } from "./paste-into-folder";

interface PasteInFolderProps {
  item: DirTree;
  shortcut?: string;
}

export function PasteInFolder({ item, shortcut }: PasteInFolderProps) {
  const t = useTranslations('article.file');
  const { clipboardItem, clipboardOperation, setClipboardItem } = useClipboardStore();
  const { loadFileTree } = useArticleStore();
  const path = computedParentPath(item);

  async function handlePasteInFolder() {
    await pasteIntoFolder({
      clipboardItem,
      clipboardOperation,
      folderPath: path,
      emptyToastTitle: t('clipboard.empty'),
      pastedToastTitle: t('clipboard.pasted'),
      pasteFailedToastTitle: t('clipboard.pasteFailed'),
      loadFileTree,
      setClipboardItem,
    })
  }

  return (
    <ContextMenuItem
      inset
      disabled={!clipboardItem}
      onClick={handlePasteInFolder}
      menuType="file"
    >
      <FileSymlink className="mr-2 h-4 w-4" />
      {t('context.paste')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}
