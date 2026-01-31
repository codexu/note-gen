'use client'

import { useEffect, useState } from 'react'
import useArticleStore, { findFolderInTree } from '@/stores/article'
import { MdEditor } from './md-editor'
import { ImageEditor } from './image-editor'
import { EmptyState } from './empty-state'
import { FolderView } from './folder-view'

export function EditorWrapper() {
  const { activeFilePath, fileTree } = useArticleStore()
  const [itemType, setItemType] = useState<'markdown' | 'image' | 'folder' | 'unknown'>('unknown')

  useEffect(() => {
    if (!activeFilePath) {
      setItemType('unknown')
      return
    }

    // 首先检查是否是文件夹
    const folder = findFolderInTree(activeFilePath, fileTree)
    if (folder) {
      setItemType('folder')
      return
    }

    // 检查文件扩展名
    const extension = activeFilePath.split('.').pop()?.toLowerCase()

    if (!extension) {
      setItemType('unknown')
      return
    }

    if (extension === 'md' || extension === 'txt' || extension === 'markdown') {
      setItemType('markdown')
    } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(extension)) {
      setItemType('image')
    } else {
      setItemType('unknown')
    }
  }, [activeFilePath, fileTree])

  // 没有文件时显示空白状态页面
  if (!activeFilePath) {
    return <EmptyState />
  }

  // 文件夹
  if (itemType === 'folder') {
    return <FolderView folderPath={activeFilePath} />
  }

  // 图片文件
  if (itemType === 'image') {
    return <ImageEditor filePath={activeFilePath} />
  }

  // Markdown/文本文件
  if (itemType === 'markdown') {
    return <MdEditor />
  }

  // 其他未知类型文件也显示空白状态页面
  return <EmptyState />
}
