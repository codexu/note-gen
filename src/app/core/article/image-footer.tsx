'use client'

import { useEffect, useState } from 'react'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { stat } from '@tauri-apps/plugin-fs'

interface ImageFooterProps {
  filePath: string
  imageWidth?: number
  imageHeight?: number
}

export function ImageFooter({ filePath, imageWidth, imageHeight }: ImageFooterProps) {
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
    <div className="h-6 w-full px-2 border-t shadow-sm items-center flex justify-between overflow-hidden bg-background">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate max-w-md" title={fileName}>{fileName}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {fileSize && <span>{fileSize}</span>}
        {fileSize && imageWidth && imageHeight && <span>•</span>}
        {imageWidth && imageHeight && (
          <span>{imageWidth} × {imageHeight}</span>
        )}
      </div>
    </div>
  )
}
