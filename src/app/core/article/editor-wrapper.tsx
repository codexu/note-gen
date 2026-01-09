'use client'

import { useEffect, useState } from 'react'
import useArticleStore from '@/stores/article'
import { MdEditor } from './md-editor'
import { ImageEditor } from './image-editor'
import { EmptyState } from './empty-state'

export function EditorWrapper() {
  const { activeFilePath } = useArticleStore()
  const [fileType, setFileType] = useState<'markdown' | 'image' | 'unknown'>('unknown')

  useEffect(() => {
    if (!activeFilePath) {
      setFileType('unknown')
      return
    }

    const extension = activeFilePath.split('.').pop()?.toLowerCase()
    
    if (!extension) {
      setFileType('unknown')
      return
    }

    if (extension === 'md' || extension === 'txt' || extension === 'markdown') {
      setFileType('markdown')
    } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
      setFileType('image')
    } else {
      setFileType('unknown')
    }
  }, [activeFilePath])

  // 没有文件时显示空白状态页面
  if (!activeFilePath) {
    return <EmptyState />
  }

  // 图片文件
  if (fileType === 'image') {
    return <ImageEditor filePath={activeFilePath} />
  }

  // Markdown/文本文件
  if (fileType === 'markdown') {
    return <MdEditor />
  }

  // 其他未知类型文件也显示空白状态页面
  return <EmptyState />
}
