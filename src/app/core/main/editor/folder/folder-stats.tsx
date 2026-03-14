'use client'

import { useState, useEffect, useCallback } from 'react'
import { Folder, Database, Clock, RefreshCw, Loader2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTranslations } from 'next-intl'
import useArticleStore from '@/stores/article'
import { getVectorDocumentsByFilename } from '@/db/vector'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

interface FolderStats {
  totalFiles: number
  indexedFiles: number
  totalVectors: number
  databaseSize: string
  lastUpdated: string | null
}

interface FolderStatsViewProps {
  folderPath: string
  folderFiles: string[]
}

export function FolderStatsView({ folderPath, folderFiles }: FolderStatsViewProps) {
  const t = useTranslations('article.file.folderView')
  const [stats, setStats] = useState<FolderStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)
  const [vectorFilesInitialized, setVectorFilesInitialized] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{
    total: number
    processed: number
    failed: number
    currentFile: string
  } | null>(null)

  const { vectorIndexedFiles, initVectorIndexedFiles } = useArticleStore()

  const folderName = folderPath.split('/').pop() || folderPath

  // Calculate folder statistics
  const calculateStats = useCallback(async () => {
    setLoadingStats(true)

    try {
      const totalFiles = folderFiles.length
      const indexedFiles = folderFiles.filter(file => vectorIndexedFiles.has(file)).length

      let totalVectors = 0
      for (const file of folderFiles) {
        if (vectorIndexedFiles.has(file)) {
          const docs = await getVectorDocumentsByFilename(file)
          totalVectors += docs.length
        }
      }

      const dbSizeBytes = totalVectors * 2048
      const dbSizeMB = (dbSizeBytes / (1024 * 1024)).toFixed(2)
      const databaseSize = dbSizeBytes < 1024 * 1024
        ? `${(dbSizeBytes / 1024).toFixed(2)} KB`
        : `${dbSizeMB} MB`

      const timestamps = Array.from(vectorIndexedFiles.values())
      const lastUpdated = timestamps.length > 0
        ? dayjs(Math.max(...timestamps)).fromNow()
        : null

      setStats({
        totalFiles,
        indexedFiles,
        totalVectors,
        databaseSize,
        lastUpdated
      })
    } catch (error) {
      console.error('Failed to calculate folder stats:', error)
    } finally {
      setLoadingStats(false)
    }
  }, [folderFiles, vectorIndexedFiles])

  // 确保 vectorIndexedFiles 被初始化
  useEffect(() => {
    const init = async () => {
      await initVectorIndexedFiles()
      setVectorFilesInitialized(true)
    }
    init()
  }, [initVectorIndexedFiles])

  // Initial stats calculation - 等待 vectorIndexedFiles 初始化完成
  useEffect(() => {
    if (vectorFilesInitialized) {
      calculateStats()
    }
  }, [calculateStats, vectorFilesInitialized])

  // Start batch recalculation
  const startRecalculation = useCallback(async () => {
    const filesToProcess = folderFiles
    if (filesToProcess.length === 0) return

    let processed = 0
    let failed = 0

    setBatchProgress({
      total: filesToProcess.length,
      processed: 0,
      failed: 0,
      currentFile: ''
    })

    const CONCURRENCY = 3
    const queue = [...filesToProcess]

    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY)

      try {
        await Promise.all(
          batch.map(async (filePath) => {
            try {
              const filename = filePath.split('/').pop() || filePath
              let content = ''

              const workspace = await getWorkspacePath()
              if (workspace.isCustom) {
                content = await readTextFile(filePath)
              } else {
                const { path, baseDir } = await getFilePathOptions(filePath)
                content = await readTextFile(path, { baseDir })
              }

              const { processMarkdownFile } = await import('@/lib/rag')
              await processMarkdownFile(filePath, content)

              processed++

              setBatchProgress(prev => prev ? {
                ...prev,
                processed,
                currentFile: filename
              } : null)
            } catch {
              failed++
              setBatchProgress(prev => prev ? {
                ...prev,
                failed,
                processed: processed + 1
              } : null)
            }
          })
        )
      } catch {
        // Silently handle batch errors
      }
    }

    // Refresh vector indexed files list for calculateStats to get latest data
    await useArticleStore.getState().initVectorIndexedFiles()
    await calculateStats()
    setBatchProgress(null)
  }, [folderFiles, calculateStats])

  if (loadingStats && !stats) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center bg-background gap-6 p-8">
      {/* Folder Icon and Name */}
      <div className="flex flex-col items-center gap-3">
        <Folder className="w-20 h-20 text-muted-foreground" />
        <h2 className="text-2xl font-semibold tracking-tight">{folderName}</h2>
      </div>

      {/* Stats Display */}
      {stats && (
        <div className="flex flex-col gap-3 w-full max-w-md">
          {/* Indexed Files Count */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <FileText className="w-4 h-4" />
              {t('indexed')}
            </span>
            <span className="font-medium">
              {stats.indexedFiles} / {stats.totalFiles}
            </span>
          </div>

          {/* Total Vectors */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              {t('vectorCount')}
            </span>
            <span className="font-medium">{stats.totalVectors}</span>
          </div>

          {/* Database Size */}
          <div className="flex items-center justify-between text-sm py-2 border-b">
            <span className="text-muted-foreground flex items-center gap-2">
              <Database className="w-4 h-4" />
              {t('databaseSize')}
            </span>
            <span className="font-medium">{stats.databaseSize}</span>
          </div>

          {/* Last Updated */}
          <div className="flex items-center justify-between text-sm py-2">
            <span className="text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {t('lastCalculated')}
            </span>
            <span className="font-medium">
              {stats.lastUpdated || t('never')}
            </span>
          </div>
        </div>
      )}

      {/* Progress Bar during batch processing */}
      {batchProgress && (
        <div className="w-full max-w-md space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('calculating')}</span>
            <span>{batchProgress.processed} / {batchProgress.total}</span>
          </div>
          <Progress value={(batchProgress.processed / batchProgress.total) * 100} className="h-2" />
          {batchProgress.failed > 0 && (
            <p className="text-xs text-destructive">
              {t('failed')}: {batchProgress.failed}
            </p>
          )}
        </div>
      )}

      {/* Recalculate Button */}
      <Button
        variant="outline"
        onClick={startRecalculation}
        disabled={!!batchProgress || !stats || stats.totalFiles === 0}
        className="gap-2"
      >
        <RefreshCw className={`w-4 h-4 ${batchProgress ? 'animate-spin' : ''}`} />
        {t('recalculateVectors')}
      </Button>
    </div>
  )
}
