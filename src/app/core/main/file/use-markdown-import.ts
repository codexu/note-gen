'use client'

import { useCallback } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { appDataDir, join } from '@tauri-apps/api/path'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { getWorkspacePath } from '@/lib/workspace'
import { isMobileDevice } from '@/lib/check'
import useArticleStore from '@/stores/article'
import { useImportLock } from './import-lock'
import { importMarkdownDirectory } from './markdown-import'

type UseMarkdownImportOptions = {
  onImportSiYuanArchive?: (zipPath: string) => Promise<void>
}

export function useMarkdownImport(options: UseMarkdownImportOptions = {}) {
  const { onImportSiYuanArchive } = options
  const { isLocked, acquire, release } = useImportLock()
  const loadFileTree = useArticleStore(state => state.loadFileTree)
  const t = useTranslations('article.file.toolbar')

  const importMarkdownDirectoryFromDialog = useCallback(async () => {
    const selectedPath = await openDialog({
      directory: true,
      multiple: false,
      title: t('importMarkdown'),
    })

    if (!selectedPath || Array.isArray(selectedPath)) {
      return
    }

    const workspace = await getWorkspacePath()
    const targetDir = workspace.isCustom
      ? workspace.path
      : await join(await appDataDir(), 'article')
    const copiedCount = await importMarkdownDirectory(selectedPath, targetDir)

    await loadFileTree()
    toast({
      title: t('importSuccess'),
      description: t('importSuccessDesc', { count: copiedCount }),
    })
  }, [loadFileTree, t])

  const importMarkdown = useCallback(async () => {
    if (isMobileDevice()) {
      if (!acquire()) {
        return
      }

      try {
        await importMarkdownDirectoryFromDialog()
      } catch (error) {
        console.error('Import markdown error:', error)
        await loadFileTree().catch(() => {})
        toast({
          title: t('importError'),
          description: String(error),
          variant: 'destructive',
        })
      } finally {
        release()
      }
      return
    }

    const selectedPath = await openDialog({
      multiple: false,
      directory: false,
      title: t('importMarkdown'),
    })

    if (
      selectedPath
      && !Array.isArray(selectedPath)
      && selectedPath.toLowerCase().endsWith('.sy.zip')
    ) {
      if (!onImportSiYuanArchive) {
        toast({
          title: t('importSiYuanError'),
          description: t('importSiYuanInvalidArchive'),
          variant: 'destructive',
        })
        return
      }

      await onImportSiYuanArchive(selectedPath)
      return
    }

    if (!acquire()) {
      return
    }

    try {
      await importMarkdownDirectoryFromDialog()
    } catch (error) {
      console.error('Import markdown error:', error)
      await loadFileTree().catch(() => {})
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive',
      })
    } finally {
      release()
    }
  }, [
    acquire,
    importMarkdownDirectoryFromDialog,
    loadFileTree,
    onImportSiYuanArchive,
    release,
    t,
  ])

  return { isImporting: isLocked, importMarkdown }
}
