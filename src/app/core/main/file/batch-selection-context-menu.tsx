import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from "@/components/ui/enhanced-context-menu"
import { Kbd } from "@/components/ui/kbd"
import { toast } from "@/hooks/use-toast"
import useClipboardStore from "@/stores/clipboard"
import { Copy, File, RefreshCwOff, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import type { FileSelectionEntry } from "./file-selection"
import {
  getLocalDeletionEntries,
  getRemoteDeletionEntries,
  toClipboardItems,
} from "./file-selection"
import useSettingStore from "@/stores/setting"
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
  const primaryBackupMethod = useSettingStore(state => state.primaryBackupMethod)
  const count = entries.length
  const allLocal = entries.every(entry => entry.isLocale)
  const localDeletionCount = getLocalDeletionEntries(entries).length
  const remoteDeletionCount = getRemoteDeletionEntries(entries).length
  const clipboardItems = toClipboardItems(entries)

  function handleCopySelected() {
    setClipboardItems(clipboardItems, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  function handleCutSelected() {
    setClipboardItems(clipboardItems, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  function handleDeleteSelectedLocal() {
    window.dispatchEvent(new CustomEvent('filemanager-delete-selection'))
  }

  function handleDeleteSelectedRemote() {
    window.dispatchEvent(new CustomEvent('filemanager-delete-remote-selection'))
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
      <ContextMenuItem inset disabled={!allLocal} onClick={handleCutSelected} menuType="file">
        <File className="mr-2 h-4 w-4" />
        {t('context.cut')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}X</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem inset disabled={!allLocal} onClick={handleCopySelected} menuType="file">
        <Copy className="mr-2 h-4 w-4" />
        {t('context.copy')}
        <ContextMenuShortcut menuType="file">
          <Kbd>{modKey}C</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        inset
        disabled={localDeletionCount === 0}
        className="text-red-900"
        onClick={handleDeleteSelectedLocal}
        menuType="file"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        {t('context.deleteSelectedLocal', { count: localDeletionCount })}
        <ContextMenuShortcut menuType="file">
          <Kbd>{deleteKey}</Kbd>
        </ContextMenuShortcut>
      </ContextMenuItem>
      {primaryBackupMethod !== 'cloudFolder' ? (
        <ContextMenuItem
          inset
          disabled={remoteDeletionCount === 0}
          className="text-red-900"
          onClick={handleDeleteSelectedRemote}
          menuType="file"
        >
          <RefreshCwOff className="mr-2 h-4 w-4" />
          {t('context.deleteSelectedRemote', { count: remoteDeletionCount })}
        </ContextMenuItem>
      ) : null}
      <PluginFileMenuItems
        context={{
          kind: entries.every(entry => entry.isDirectory) ? 'folder' : 'file',
          selectedPaths: entries.map(entry => entry.path),
        }}
      />
    </>
  )
}
