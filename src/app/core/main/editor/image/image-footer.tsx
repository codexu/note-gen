'use client'

import { useEffect, useState } from 'react'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { stat } from '@tauri-apps/plugin-fs'
import { cn } from '@/lib/utils'
import { FileImage, HardDrive, Ruler } from 'lucide-react'
import { StatusBarItem } from '../../status-bar-order'

interface ImageFooterProps {
  filePath: string
  imageWidth?: number
  imageHeight?: number
  embedded?: boolean
}

export function ImageFooter({ filePath, imageWidth, imageHeight, embedded = false }: ImageFooterProps) {
  const [fileSize, setFileSize] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')

  useEffect(() => {
    loadFileInfo()
  }, [filePath])

  async function loadFileInfo() {
    if (!filePath) return

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(filePath)
      
      let fileStat
      if (workspace.isCustom) {
        fileStat = await stat(pathOptions.path)
      } else {
        fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      // 格式化文件大小
      const sizeInBytes = fileStat.size
      let formattedSize = ''
      if (sizeInBytes < 1024) {
        formattedSize = `${sizeInBytes} B`
      } else if (sizeInBytes < 1024 * 1024) {
        formattedSize = `${(sizeInBytes / 1024).toFixed(2)} KB`
      } else {
        formattedSize = `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
      }
      
      setFileSize(formattedSize)
      setFileName(filePath.split('/').pop() || '')
    } catch (error) {
      console.error('Failed to load file info:', error)
    }
  }

  return (
    <div className={cn(
      'flex h-6 min-w-0 items-center gap-2 overflow-hidden bg-background',
      embedded ? 'contents' : 'w-full justify-between border-t border-border px-2 shadow-sm',
    )}>
      {embedded ? <StatusBarItem id="image:file" rank={20} className="gap-2 text-xs text-muted-foreground">
        <FileImage className="size-3" />
        <span className="truncate max-w-md" title={fileName}>{fileName}</span>
      </StatusBarItem> : <div className="flex items-center gap-2 text-xs text-muted-foreground"><FileImage className="size-3" /><span className="truncate max-w-md" title={fileName}>{fileName}</span></div>}
      {embedded ? <>
        {fileSize && <StatusBarItem id="image:size" rank={21} className="gap-1 text-xs text-muted-foreground"><HardDrive className="size-3" />{fileSize}</StatusBarItem>}
        {imageWidth && imageHeight && <StatusBarItem id="image:dimensions" rank={22} className="gap-1 text-xs text-muted-foreground"><Ruler className="size-3" />{imageWidth} × {imageHeight}</StatusBarItem>}
      </> : <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {fileSize && <span className="flex items-center gap-1"><HardDrive className="size-3" />{fileSize}</span>}
        {imageWidth && imageHeight && <span className="flex items-center gap-1"><Ruler className="size-3" />{imageWidth} × {imageHeight}</span>}
      </div>}
    </div>
  )
}
