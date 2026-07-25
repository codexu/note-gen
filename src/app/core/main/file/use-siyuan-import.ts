'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { appDataDir, join } from '@tauri-apps/api/path'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { getWritingAssetsDirName } from '@/lib/writing-assets-path'
import type { SyImportProgress, SyImportResult } from '@/lib/import/siyuan'
import { getWorkspacePath } from '@/lib/workspace'
import { isMobileDevice } from '@/lib/check'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { useImportLock } from './import-lock'

async function getImportTargetDir(): Promise<string> {
  const workspace = await getWorkspacePath()
  return workspace.isCustom
    ? workspace.path
    : join(await appDataDir(), 'article')
}

export function useSiYuanImport() {
  const { isLocked, acquire, release } = useImportLock()
  const unlistenRef = useRef<(() => void) | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [progress, setProgress] = useState<SyImportProgress | null>(null)
  const [report, setReport] = useState<SyImportResult | null>(null)
  const loadFileTree = useArticleStore(state => state.loadFileTree)
  const t = useTranslations('article.file.toolbar')

  useEffect(() => {
    return () => {
      unlistenRef.current?.()
      unlistenRef.current = null
    }
  }, [])

  const cancelImport = useCallback(async () => {
    try {
      await invoke<boolean>('cancel_siyuan_import')
    } catch (error) {
      console.error('Failed to cancel SiYuan import:', error)
    }
  }, [])

  const importSiYuan = useCallback(async (zipPathOverride?: string | null) => {
    if (isMobileDevice()) {
      return
    }

    if (!acquire()) {
      return
    }

    setDialogOpen(true)
    setProgress(null)
    setReport(null)

    try {
      let zipPath = zipPathOverride ?? null
      if (!zipPath) {
        zipPath = await openDialog({
          multiple: false,
          title: t('importSiYuanZip'),
          filters: [{ name: 'SiYuan (.sy.zip)', extensions: ['zip'] }],
        }) ?? null
      }

      if (!zipPath || Array.isArray(zipPath)) {
        setDialogOpen(false)
        return
      }
      if (!zipPath.toLowerCase().endsWith('.sy.zip')) {
        throw new Error(t('importSiYuanInvalidArchive'))
      }

      unlistenRef.current?.()
      unlistenRef.current = await listen<SyImportProgress>('siyuan-import-progress', event => {
        setProgress(event.payload)
      })

      const targetDir = await getImportTargetDir()
      const assetsDirName = getWritingAssetsDirName(useSettingStore.getState().assetsPath)
      const result = await invoke<SyImportResult>('import_siyuan_archive', {
        zipPath,
        targetDir,
        assetsDirName,
      })

      setReport(result)

      try {
        await loadFileTree()
      } catch (treeError) {
        console.error('Failed to refresh file tree after SiYuan import:', treeError)
        toast({
          title: t('importSiYuanTreeRefreshError'),
          description: String(treeError),
          variant: 'destructive',
        })
      }

      if (result.failedCount > 0 || result.degradedCount > 0 || result.unsupportedCount > 0) {
        toast({
          title: t('importSiYuanPartialSuccess'),
          description: t('importSiYuanPartialSuccessDesc', {
            success: result.successCount,
            failed: result.failedCount,
            degraded: result.degradedCount,
            unsupported: result.unsupportedCount,
          }),
          variant: result.successCount === 0 ? 'destructive' : 'default',
        })
      } else {
        toast({
          title: t('importSiYuanSuccess'),
          description: t('importSiYuanSuccessDesc', {
            notebooks: result.notebookCount,
            documents: result.totalDocuments,
            assets: result.assetCount,
          }),
        })
      }
    } catch (error) {
      const message = String(error)
      if (message.includes('Import cancelled')) {
        setDialogOpen(false)
        toast({
          title: t('importSiYuanCancelled'),
          description: t('importSiYuanCancelledDesc'),
        })
        return
      }

      console.error('Import SiYuan error:', error)
      setDialogOpen(false)
      toast({
        title: t('importSiYuanError'),
        description: message,
        variant: 'destructive',
      })
    } finally {
      unlistenRef.current?.()
      unlistenRef.current = null
      release()
    }
  }, [acquire, loadFileTree, release, t])

  return {
    isImporting: isLocked,
    importSiYuan,
    cancelImport,
    dialogOpen,
    setDialogOpen,
    progress,
    report,
  }
}
