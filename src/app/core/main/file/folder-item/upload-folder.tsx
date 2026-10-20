import { useState } from 'react'
import { FolderUp, LoaderCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ContextMenuItem } from '@/components/ui/enhanced-context-menu'
import { toast } from '@/hooks/use-toast'
import { uploadLocalLibraryFolder } from '@/lib/sync/remote-library'
import useArticleStore, { DirTree } from '@/stores/article'
import { MobileMenuItem } from '../mobile-action-menu'
import { computedParentPath } from '@/lib/path'
import { getSyncConfiguration } from '../file-tree-action-policy'
import { useSettingsDialogStore } from '@/stores/settings-dialog'

export function UploadFolder({ item, mobile = false }: { item: DirTree; mobile?: boolean }) {
  const t = useTranslations('article.file.context')
  const [isUploading, setIsUploading] = useState(false)
  const { loadFileTree, loadRemoteSyncFiles, markFileRemote, setEntryLoading, setEntrySyncError } = useArticleStore()

  async function handleUploadFolder() {
    if (isUploading || !item.isLocale || !item.isDirectory) return
    const sync = await getSyncConfiguration()
    if (!sync.configured) {
      toast({
        title: sync.reason === 'missing-repository' ? t('syncRepoRequired') : t('syncNotConfigured'),
        description: t('configureSync'),
      })
      useSettingsDialogStore.getState().openSettings('sync')
      return
    }

    const folderPath = computedParentPath(item)
    setIsUploading(true)
    setEntryLoading(folderPath, true)
    setEntrySyncError(folderPath)
    const progressToast = toast({
      title: t('uploadFolderProgress'),
      description: item.name,
      duration: Infinity,
    })
    try {
      const result = await uploadLocalLibraryFolder(folderPath, progress => {
        if (progress.phase === 'uploaded' && progress.path && progress.sha) {
          markFileRemote(progress.path, progress.sha)
        }
        if (progress.path) {
          progressToast.update({
            title: t('uploadFolderProgress'),
            description: `${progress.current}/${progress.total} · ${progress.path}`,
            duration: Infinity,
          })
        }
      })
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
      progressToast.update({
        title: t('uploadFolderSuccess'),
        description: t('uploadFolderResult', {
          uploaded: result.uploaded,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        duration: 5000,
      })
    } catch (error) {
      setEntrySyncError(folderPath, error instanceof Error ? error.message : String(error))
      progressToast.update({
        title: t('uploadFolderError'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    } finally {
      setEntryLoading(folderPath, false)
      setIsUploading(false)
    }
  }

  if (mobile) {
    return (
      <MobileMenuItem disabled={isUploading || !item.isLocale} onClick={() => void handleUploadFolder()}>
        {t('uploadFolder')}
      </MobileMenuItem>
    )
  }

  return (
    <ContextMenuItem
      inset
      disabled={isUploading || !item.isLocale}
      onClick={() => void handleUploadFolder()}
      menuType="file"
    >
      {isUploading
        ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        : <FolderUp className="mr-2 h-4 w-4" />}
      {t('uploadFolder')}
    </ContextMenuItem>
  )
}
