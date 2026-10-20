"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus, FolderPlus, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"
import { useState } from "react"
import useArticleStore from "@/stores/article"
import { debounce } from "lodash-es"
import { FileMoreMenu } from './file-more-menu'
import { useMarkdownImport } from './use-markdown-import'
import { DocumentToMarkdownDialog } from './document-to-markdown-dialog'

export function FileActions() {
  const { newFolder, newFile, loadFileTree, loadRemoteSyncFiles, fileTreeLoading } = useArticleStore()
  const t = useTranslations('article.file.toolbar')
  const { isImporting, importMarkdown, importNotionZip, convertDocumentsToMarkdown } = useMarkdownImport()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [convertDialogOpen, setConvertDialogOpen] = useState(false)

  const debounceNewFile = debounce(newFile, 200)
  const debounceNewFolder = debounce(newFolder, 200)

  async function handleRefresh() {
    if (isRefreshing) return

    setIsRefreshing(true)
    try {
      await loadFileTree({ skipRemoteSync: true })
      await loadRemoteSyncFiles()
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <TooltipButton
          icon={<FilePlus className="h-4 w-4" />}
          tooltipText={t('newArticle')}
          onClick={debounceNewFile}
          side="bottom"
        />
        <TooltipButton
          icon={<FolderPlus className="h-4 w-4" />}
          tooltipText={t('newFolder')}
          onClick={debounceNewFolder}
          side="bottom"
        />
        <TooltipButton
          icon={<RefreshCw className={`h-4 w-4 ${fileTreeLoading || isRefreshing ? 'animate-spin' : ''}`} />}
          tooltipText={t('refresh')}
          onClick={() => void handleRefresh()}
          disabled={fileTreeLoading || isRefreshing}
          side="bottom"
        />
        <FileMoreMenu
          isImporting={isImporting}
          onImportMarkdown={() => void importMarkdown()}
          onConvertDocuments={() => setConvertDialogOpen(true)}
          onImportNotion={() => void importNotionZip()}
        />
      </div>
      <DocumentToMarkdownDialog
        open={convertDialogOpen}
        importing={isImporting}
        onOpenChange={setConvertDialogOpen}
        onSelect={() => void convertDocumentsToMarkdown()}
      />
    </>
  )
}
