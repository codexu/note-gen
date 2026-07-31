'use client'

import { confirm } from '@tauri-apps/plugin-dialog'
import {
  ArrowDownAZ,
  Calendar,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock,
  Cloud,
  Database,
  DatabaseZap,
  Download,
  EllipsisVertical,
  Eye,
  FileArchive,
  FolderInput,
  LoaderCircle,
  PackageOpen,
  SortAsc,
  SortDesc,
  Upload,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/hooks/use-toast'
import useArticleStore from '@/stores/article'
import useCloudLibraryStore from '@/stores/cloud-library'
import useVectorStore from '@/stores/vector'
import { isSyncConfigured } from '@/lib/sync/sync-manager'

type FileMoreMenuProps = {
  isImporting: boolean
  onImportMarkdown: () => void
  onImportNotion: () => void
}

export function FileMoreMenu({ isImporting, onImportMarkdown, onImportNotion }: FileMoreMenuProps) {
  const t = useTranslations('article.file.cloudLibrary')
  const tToolbar = useTranslations('article.file.toolbar')
  const {
    loadFileTree,
    loadRemoteSyncFiles,
    markFileRemote,
    initVectorIndexedFiles,
    sortType,
    setSortType,
    sortDirection,
    setSortDirection,
    toggleAllFolders,
    collapsibleList,
    showCloudFiles,
    setShowCloudFiles,
    syncStaticAssets,
    setSyncStaticAssets,
    showKnowledgeBaseStatus,
    setShowKnowledgeBaseStatus,
    cancelVectorCalculation,
  } = useArticleStore()
  const {
    processAllDocuments,
    isProcessing,
    isAutoVectorEnabled,
    setAutoVectorEnabled,
  } = useVectorStore()
  const {
    operation,
    pullAllFiles,
    uploadAllFiles,
    uploadKnowledgeBase,
    downloadKnowledgeBase,
  } = useCloudLibraryStore()
  const [syncConfigured, setSyncConfigured] = useState(false)
  const busy = operation !== null || isProcessing || isImporting

  async function refreshSyncConfigured() {
    setSyncConfigured(await isSyncConfigured())
  }

  useEffect(() => {
    void refreshSyncConfigured()
  }, [])

  async function handleAutoVectorChange(enabled: boolean) {
    await setAutoVectorEnabled(enabled)
    if (!enabled) cancelVectorCalculation()
  }

  async function handleUploadFiles() {
    const accepted = await confirm(t(syncStaticAssets ? 'uploadFilesWithAssetsWarning' : 'uploadFilesWarning'), {
      title: t('uploadFiles'),
      kind: 'warning',
    })
    if (!accepted) return

    const progressToast = toast({
      title: t('operations.upload-files'),
      description: t('preparingFiles'),
      duration: Infinity,
    })

    try {
      const result = await uploadAllFiles(progress => {
        if (!progress.path) return
        if (progress.phase === 'uploaded' && progress.sha) {
          markFileRemote(progress.path, progress.sha)
        }
        progressToast.update({
          title: t('operations.upload-files'),
          description: `${progress.current}/${progress.total} · ${progress.path}`,
          duration: Infinity,
        })
      }, { includeStaticAssets: syncStaticAssets })
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
      progressToast.update({
        title: t('uploadFilesComplete'),
        description: t('uploadFilesResult', {
          uploaded: result.uploaded,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        duration: 5000,
      })
    } catch (error) {
      progressToast.update({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    }
  }

  async function handleDownloadFiles() {
    const progressToast = toast({
      title: t('operations.pull-files'),
      description: t('preparingFiles'),
      duration: Infinity,
    })

    try {
      const result = await pullAllFiles(progress => {
        if (!progress.path) return
        progressToast.update({
          title: t('operations.pull-files'),
          description: `${progress.current}/${progress.total} · ${progress.path}`,
          duration: Infinity,
        })
      }, { includeStaticAssets: true })
      await loadFileTree()
      progressToast.update({
        title: t('pullComplete'),
        description: t('pullResult', {
          downloaded: result.downloaded,
          skipped: result.skipped,
          failed: result.failed.length,
        }),
        variant: result.failed.length > 0 ? 'destructive' : 'default',
        duration: 5000,
      })
    } catch (error) {
      progressToast.update({
        title: t('operationFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
        duration: 5000,
      })
    }
  }

  async function handleUploadKnowledgeBase() {
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
      showError(error)
    }
  }

  async function handleDownloadKnowledgeBase() {
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
      showError(error)
    }
  }

  function showError(error: unknown) {
    toast({
      title: t('operationFailed'),
      description: error instanceof Error ? error.message : String(error),
      variant: 'destructive',
    })
  }

  return (
    <DropdownMenu onOpenChange={(open) => {
      if (open) void refreshSyncConfigured()
    }}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="focus-visible:border-transparent focus-visible:ring-0"
          disabled={busy}
          aria-label={t('more')}
          title={t('more')}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <EllipsisVertical className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('fileView')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {sortDirection === 'asc'
              ? <SortAsc className="mr-2 size-4" />
              : <SortDesc className="mr-2 size-4" />}
            {tToolbar('sort')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem onSelect={() => setSortType('name')} className={sortType === 'name' ? 'bg-accent' : ''}>
              <ArrowDownAZ className="mr-2 size-4" />
              {tToolbar('sortByName')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSortType('created')} className={sortType === 'created' ? 'bg-accent' : ''}>
              <Calendar className="mr-2 size-4" />
              {tToolbar('sortByCreated')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSortType('modified')} className={sortType === 'modified' ? 'bg-accent' : ''}>
              <Clock className="mr-2 size-4" />
              {tToolbar('sortByModified')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}>
              {sortDirection === 'asc' ? <SortDesc className="mr-2 size-4" /> : <SortAsc className="mr-2 size-4" />}
              {sortDirection === 'asc' ? tToolbar('sortDesc') : tToolbar('sortAsc')}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={toggleAllFolders}>
          {collapsibleList.length > 0
            ? <ChevronsDownUp className="mr-2 size-4" />
            : <ChevronsUpDown className="mr-2 size-4" />}
          {collapsibleList.length > 0 ? tToolbar('collapseAll') : tToolbar('expandAll')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            void setShowKnowledgeBaseStatus(!showKnowledgeBaseStatus)
          }}
        >
          <Eye className="mr-2 size-4" />
          <span>{t('showKnowledgeBaseStatus')}</span>
          <Switch
            className="ml-auto"
            checked={showKnowledgeBaseStatus}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => void setShowKnowledgeBaseStatus(checked)}
            aria-label={t('showKnowledgeBaseStatus')}
          />
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('files')}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            setShowCloudFiles(!showCloudFiles)
          }}
        >
          <Cloud className="mr-2 size-4" />
          <span>{t('showRemoteFiles')}</span>
          <Switch
            className="ml-auto"
            checked={showCloudFiles}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={setShowCloudFiles}
            aria-label={t('showRemoteFiles')}
          />
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            void setSyncStaticAssets(!syncStaticAssets)
          }}
        >
          <PackageOpen className="mr-2 size-4" />
          <span>{t('syncStaticAssets')}</span>
          <Switch
            className="ml-auto"
            checked={syncStaticAssets}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => void setSyncStaticAssets(checked)}
            aria-label={t('syncStaticAssets')}
          />
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!syncConfigured} onSelect={() => void handleUploadFiles()}>
          <Upload className="mr-2 size-4" />
          {t('uploadFiles')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!syncConfigured} onSelect={() => void handleDownloadFiles()}>
          <Download className="mr-2 size-4" />
          {t('downloadFiles')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('knowledgeBase')}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault()
            void handleAutoVectorChange(!isAutoVectorEnabled)
          }}
        >
          <DatabaseZap className="mr-2 size-4" />
          <span>{t('autoUpdate')}</span>
          <Switch
            className="ml-auto"
            checked={isAutoVectorEnabled}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => void handleAutoVectorChange(checked)}
            aria-label={t('autoUpdate')}
          />
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void processAllDocuments()}>
          <Database className="mr-2 size-4" />
          {t('recalculate')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!syncConfigured} onSelect={() => void handleUploadKnowledgeBase()}>
          <Upload className="mr-2 size-4" />
          {t('uploadKnowledgeBase')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!syncConfigured} onSelect={() => void handleDownloadKnowledgeBase()}>
          <Download className="mr-2 size-4" />
          {t('downloadKnowledgeBase')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onImportMarkdown}>
          <FolderInput className="mr-2 size-4" />
          {isImporting ? tToolbar('importing') : tToolbar('importMarkdown')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onImportNotion}>
          <FileArchive className="mr-2 size-4" />
          {isImporting ? tToolbar('importing') : tToolbar('importNotion')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
