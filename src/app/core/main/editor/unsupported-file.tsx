'use client'

import { isMobileDevice } from '@/lib/check'

import { useEffect, useState } from 'react'
import { File, FolderOpen, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { appDataDir } from '@tauri-apps/api/path'
import { getFilePathOptions, getWorkspacePath } from '@/lib/workspace'

interface FileMetadata {
  size: number
  modifiedAt: number | null
  createdAt: number | null
}

interface UnsupportedFileProps {
  filePath: string
}

export function UnsupportedFile({ filePath }: UnsupportedFileProps) {
  const t = useTranslations('article.unsupportedFile')
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [fullPath, setFullPath] = useState('')

  const fileName = filePath.split('/').pop() || filePath

  // 获取完整文件路径
  useEffect(() => {
    const fetchFullPath = async () => {
      try {
        const workspace = await getWorkspacePath()
        if (workspace.isCustom) {
          setFullPath(workspace.path + '/' + filePath)
        } else {
          const appDir = await appDataDir()
          setFullPath(appDir + '/article/' + filePath)
        }
      } catch (error) {
        console.error('Failed to get full path:', error)
      }
    }
    fetchFullPath()
  }, [filePath])

  // 获取文件元信息
  useEffect(() => {
    let cancelled = false

    const fetchMetadata = async () => {
      setLoading(true)
      setMetadata(null)

      try {
        const { exists, stat } = await import('@tauri-apps/plugin-fs')
        const pathOptions = await getFilePathOptions(filePath)
        const fileExists = pathOptions.baseDir
          ? await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
          : await exists(pathOptions.path)

        // 同步列表中可能暂时存在尚未下载的远程路径。它不是本地文件，
        // 因此没有可读取的元数据，也不应作为错误上报。
        if (!fileExists || cancelled) {
          return
        }

        const fileStat = pathOptions.baseDir
          ? await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
          : await stat(pathOptions.path)

        if (cancelled) return

        setMetadata({
          size: fileStat.size,
          modifiedAt: fileStat.mtime?.getTime() || null,
          createdAt: fileStat.birthtime?.getTime() || null
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const isMissingPath = message.includes('No such file or directory')
          || message.toLowerCase().includes('not found')

        if (!cancelled && !isMissingPath) {
          console.error('Failed to get file metadata:', error)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchMetadata()

    return () => {
      cancelled = true
    }
  }, [filePath])

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 格式化时间
  const formatDate = (timestamp: number | null): string => {
    if (!timestamp) return '-'
    return new Date(timestamp).toLocaleString()
  }

  // 用外部程序打开
  const handleOpenExternal = async () => {
    try {
      const workspace = await getWorkspacePath()

      if (workspace.isCustom) {
        // 自定义工作区：使用绝对路径
        const pathOptions = await getFilePathOptions(filePath)
        await openPath(pathOptions.path)
      } else {
        // 默认工作区：使用 AppData 目录
        const appDir = await appDataDir()
        const { join } = await import('@tauri-apps/api/path')
        await openPath(await join(appDir, 'article', filePath))
      }
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }

  // 在文件管理器中定位文件
  const handleOpenDirectory = async () => {
    try {
      const workspace = await getWorkspacePath()
      const isMobile = isMobileDevice()
      const targetPath = isMobile ? filePath.split('/').slice(0, -1).join('/') : filePath
      const openInFileManager = isMobile ? openPath : revealItemInDir

      if (workspace.isCustom) {
        const pathOptions = await getFilePathOptions(targetPath)
        await openInFileManager(pathOptions.path)
      } else {
        const appDir = await appDataDir()
        const { join } = await import('@tauri-apps/api/path')
        await openInFileManager(await join(appDir, 'article', targetPath))
      }
    } catch (error) {
      console.error('Failed to open directory:', error)
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full bg-background p-8">
      <div className="max-w-lg w-full space-y-6">
        {/* 文件名和图标 */}
        <div className="flex items-center gap-3">
          <File className="w-8 h-8 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{fileName}</h2>
            <p
  className="text-sm text-muted-foreground truncate cursor-pointer hover:text-primary transition-colors"
  title={fullPath || filePath}
  onClick={async () => {
    await navigator.clipboard.writeText(fullPath || filePath)
    toast({ title: t('pathCopied') || '路径已复制' })
  }}
>
  {fullPath || filePath}
</p>
          </div>
        </div>

        {/* 元信息 */}
        <div className="bg-card rounded-lg border p-4 space-y-3">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('fileSize')}</span>
            <span className="text-sm font-medium">
              {loading ? '...' : (metadata ? formatFileSize(metadata.size) : '-')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('modifiedTime')}</span>
            <span className="text-sm font-medium">
              {loading ? '...' : formatDate(metadata?.modifiedAt || null)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">{t('createdTime')}</span>
            <span className="text-sm font-medium">
              {loading ? '...' : formatDate(metadata?.createdAt || null)}
            </span>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3">
          <button
            onClick={handleOpenExternal}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {t('openExternal')}
          </button>
          <button
            onClick={handleOpenDirectory}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg border bg-card hover:bg-accent transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            {t('openDirectory')}
          </button>
        </div>
      </div>
    </div>
  )
}
