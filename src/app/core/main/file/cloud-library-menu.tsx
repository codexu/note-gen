'use client'

import { confirm } from '@tauri-apps/plugin-dialog'
import { Cloud, Database, DatabaseZap, Download, EllipsisVertical, FolderDot, LoaderCircle, PackageOpen, Upload } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ResponsiveActionMenu } from '@/components/responsive-action-menu'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import useCloudLibraryStore from '@/stores/cloud-library'
import useVectorStore from '@/stores/vector'
import { cn } from '@/lib/utils'
import { getSyncConfiguration } from './file-tree-action-policy'

export function CloudLibraryMenu({ className }: { className?: string }) {
  const t = useTranslations('article.file.cloudLibrary')
  const tSync = useTranslations('settings.sync')
  const router = useRouter()
  const {
    loadFileTree,
    loadRemoteSyncFiles,
    markFileRemote,
    initVectorIndexedFiles,
    syncStaticAssets,
    initSyncStaticAssets,
    setSyncStaticAssets,
    showCloudFiles,
    initShowCloudFiles,
    setShowCloudFiles,
    showAssetsFolders,
    initShowAssetsFolders,
    setShowAssetsFolders,
  } = useArticleStore()
  const { processAllDocuments, isProcessing, isAutoVectorEnabled, setAutoVectorEnabled } = useVectorStore()
  const {
    operation,
    pullAllFiles,
    uploadAllFiles,
    uploadKnowledgeBase,
    downloadKnowledgeBase,
  } = useCloudLibraryStore()
  const busy = operation !== null || isProcessing

  useEffect(() => {
    void initSyncStaticAssets()
    void initShowCloudFiles()
    void initShowAssetsFolders()
  }, [initShowAssetsFolders, initShowCloudFiles, initSyncStaticAssets])

  async function ensureSyncConfigured() {
    const sync = await getSyncConfiguration()
    if (sync.configured) return true

    toast({
      description: sync.reason === 'missing-repository'
        ? tSync('repositoryRequired')
        : tSync('status.unconfigured'),
      variant: 'destructive',
    })
    router.push('/mobile/setting/pages/sync')
    return false
  }

  async function handlePullAll() {
    if (!await ensureSyncConfigured()) return
    try {
      const result = await pullAllFiles(undefined, { includeStaticAssets: true })
      await loadFileTree()
      toast({
        title: t('pullComplete'),
        description: t('pullResult', {
          downloaded: result.downloaded,
          skipped: result.skipped,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
      })
    } catch (error) {
      toast({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function handleUploadAll() {
    if (!await ensureSyncConfigured()) return
    const accepted = await confirm(t(syncStaticAssets ? 'uploadFilesWithAssetsWarning' : 'uploadFilesWarning'), {
      title: t('uploadFiles'),
      kind: 'warning',
    })
    if (!accepted) return

    try {
      const result = await uploadAllFiles(progress => {
        if (progress.phase === 'uploaded' && progress.path && progress.sha) {
          markFileRemote(progress.path, progress.sha)
        }
      }, { includeStaticAssets: syncStaticAssets })
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
      toast({
        title: t('uploadFilesComplete'),
        description: t('uploadFilesResult', {
          uploaded: result.uploaded,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
      })
    } catch (error) {
      toast({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function handleUploadKnowledgeBase() {
    if (!await ensureSyncConfigured()) return
    const accepted = await confirm(t('uploadPrivacyWarning'), {
      title: t('uploadKnowledgeBase'),
      kind: 'warning',
    })
    if (!accepted) return

    try {
      const manifest = await uploadKnowledgeBase()
      toast({
        title: t('uploadComplete'),
        description: t('knowledgeResult', {
          documents: manifest.documentCount,
          vectors: manifest.vectorCount,
        }),
      })
    } catch (error) {
      toast({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  async function handleDownloadKnowledgeBase() {
    if (!await ensureSyncConfigured()) return
    const accepted = await confirm(t('downloadOverwriteWarning'), {
      title: t('downloadKnowledgeBase'),
      kind: 'warning',
    })
    if (!accepted) return

    try {
      const result = await downloadKnowledgeBase()
      await initVectorIndexedFiles()
      toast({
        title: t('downloadComplete'),
        description: result.missingSourceFiles.length > 0
          ? t('missingSources', { count: result.missingSourceFiles.length })
          : t('knowledgeResult', {
              documents: result.manifest.documentCount,
              vectors: result.manifest.vectorCount,
            }),
      })
    } catch (error) {
      toast({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      })
    }
  }

  return (
    <ResponsiveActionMenu
      title={t('title')}
      desktopAlign="start"
      desktopClassName="w-72"
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('relative focus-visible:border-transparent focus-visible:ring-0', className)}
          disabled={busy}
          aria-label={t('title')}
          title={t('title')}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <EllipsisVertical className="size-4" />}
        </Button>
      }
      items={[
        {
          key: 'show-assets-folders',
          label: t('showAssetsFolders'),
          icon: <FolderDot />,
          keepOpen: true,
          onSelect: () => setShowAssetsFolders(!showAssetsFolders),
          selected: showAssetsFolders,
        },
        {
          key: 'show-remote',
          label: t('showRemoteFiles'),
          icon: <Cloud />,
          keepOpen: true,
          onSelect: () => setShowCloudFiles(!showCloudFiles),
          end: (
            <Switch
              className="ml-auto"
              checked={showCloudFiles}
              onClick={event => event.stopPropagation()}
              onCheckedChange={checked => void setShowCloudFiles(checked)}
              aria-label={t('showRemoteFiles')}
            />
          ),
        },
        {
          key: 'static-assets',
          label: t('syncStaticAssets'),
          icon: <PackageOpen />,
          keepOpen: true,
          onSelect: () => setSyncStaticAssets(!syncStaticAssets),
          end: (
            <Switch
              className="ml-auto"
              checked={syncStaticAssets}
              onClick={event => event.stopPropagation()}
              onCheckedChange={checked => void setSyncStaticAssets(checked)}
              aria-label={t('syncStaticAssets')}
            />
          ),
        },
        { key: 'upload-files', label: t('uploadFiles'), icon: <Upload />, onSelect: handleUploadAll, disabled: busy },
        { key: 'download-files', label: t('downloadFiles'), icon: <Download />, onSelect: handlePullAll, disabled: busy },
        {
          key: 'auto-vector',
          label: t('autoUpdate'),
          icon: <DatabaseZap />,
          separatorBefore: true,
          keepOpen: true,
          onSelect: () => setAutoVectorEnabled(!isAutoVectorEnabled),
          end: (
            <Switch
              className="ml-auto"
              checked={isAutoVectorEnabled}
              onClick={event => event.stopPropagation()}
              onCheckedChange={checked => void setAutoVectorEnabled(checked)}
              aria-label={t('autoUpdate')}
            />
          ),
        },
        { key: 'recalculate', label: t('recalculate'), icon: <Database />, onSelect: processAllDocuments, disabled: busy },
        { key: 'upload-kb', label: t('uploadKnowledgeBase'), icon: <Upload />, onSelect: handleUploadKnowledgeBase, disabled: busy },
        { key: 'download-kb', label: t('downloadKnowledgeBase'), icon: <Download />, onSelect: handleDownloadKnowledgeBase, disabled: busy },
      ]}
    />
  )
}
