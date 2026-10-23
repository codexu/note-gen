import { ContextMenuItem, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu"
import { DirTree } from "@/stores/article"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { Kbd } from "@/components/ui/kbd"
import useSettingStore from '@/stores/setting'
import useFileDeletionStore, { isFileDeletionPending } from '@/stores/file-deletion'
import { toFileSelectionEntry } from '../file-selection'
import { useFileDeletion } from '../use-file-deletion'

interface DeleteFolderProps {
  item: DirTree
  shortcut?: string
}

export function DeleteFolder({ item, shortcut }: DeleteFolderProps) {
  const t = useTranslations('article.file')
  const deleteEntries = useFileDeletion()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const pendingPaths = useFileDeletionStore(state => state.pendingPaths)
  const entry = toFileSelectionEntry(item)
  const deletionPending = pendingPaths.length > 0 && isFileDeletionPending(entry.path, workspacePath)

  return (
    <ContextMenuItem
      inset
      disabled={item.name === '' || item.loading || item.isEditing || deletionPending}
      className="text-destructive"
      onClick={event => {
        event.stopPropagation()
        void deleteEntries([entry])
      }}
      menuType="file"
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {t('context.delete')}
      {shortcut && (
        <ContextMenuShortcut menuType="file">
          <Kbd>{shortcut}</Kbd>
        </ContextMenuShortcut>
      )}
    </ContextMenuItem>
  )
}
