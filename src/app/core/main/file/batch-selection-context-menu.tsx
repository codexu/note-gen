import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/enhanced-context-menu"
import { Kbd } from "@/components/ui/kbd"
import { toast } from "@/hooks/use-toast"
import useClipboardStore from "@/stores/clipboard"
import { Copy, File, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import type { FileSelectionEntry } from "./file-selection"
import {
  getDeletionEntries,
  toClipboardItems,
} from "./file-selection"
import useSettingStore from "@/stores/setting"
import useFileDeletionStore, { isFileDeletionPending } from "@/stores/file-deletion"
import { useFileDeletion } from "./use-file-deletion"
import { PluginFileMenuItems } from "@/components/plugins/plugin-file-menu-items"

interface BatchSelectionContextMenuProps {
  entries: FileSelectionEntry[]
  modKey: string
  deleteKey: string
}

export function BatchSelectionContextMenu({
  entries,
  modKey,
  deleteKey,
}: BatchSelectionContextMenuProps) {
  const t = useTranslations('article.file')
  const tRecordToolbar = useTranslations('record.mark.toolbar')
  const { setClipboardItems } = useClipboardStore()
  const workspacePath = useSettingStore(state => state.workspacePath)
  const pendingPaths = useFileDeletionStore(state => state.pendingPaths)
  const deleteEntries = useFileDeletion()
  const count = entries.length
  const allLocal = entries.every(entry => entry.isLocale)
  const deletionEntries = getDeletionEntries(entries)
  const selectionBusy = entries.some(entry => (
    entry.item.loading || entry.item.isEditing
    || (pendingPaths.length > 0 && isFileDeletionPending(entry.path, workspacePath))
  ))
  const clipboardItems = toClipboardItems(entries)

  function handleCopySelected() {
    setClipboardItems(clipboardItems, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  function handleCutSelected() {
    setClipboardItems(clipboardItems, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  return (
    <>
      {count > 1 && (
        <>
          <ContextMenuLabel menuType="file">
            {tRecordToolbar('selectedCount', { count })}
          </ContextMenuLabel>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem inset disabled={!allLocal || selectionBusy} onClick={handleCutSelected} menuType="file">
        <File className="mr-2 h-4 w-4" />
        {t('context.cut')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}X</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!allLocal || selectionBusy} onClick={handleCopySelected} menuType="file">
        <Copy className="mr-2 h-4 w-4" />
        {t('context.copy')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}C</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        inset
        disabled={deletionEntries.length === 0 || selectionBusy}
        className="text-destructive"
        onClick={() => void deleteEntries(deletionEntries)}
        menuType="file"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t('context.deleteSelected', { count: deletionEntries.length })}
        <ContextMenuShortcut menuType="file">
          <Kbd>{deleteKey}</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <PluginFileMenuItems
        context={{
          kind: entries.every(entry => entry.isDirectory) ? 'folder' : 'file',
          selectedPaths: entries.map(entry => entry.path),
        }}
      />
    </>
  )
}
