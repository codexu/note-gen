'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { TipTapEditor } from '@/app/core/main/editor/markdown/tiptap-editor'
import { Loader2 } from 'lucide-react'
import useArticleStore from '@/stores/article'
import emitter from '@/lib/emitter'

export function MobileEditor() {
  const {
    setCurrentArticle,
    setActiveFilePath,
    loadFileTree,
    currentArticle
  } = useArticleStore()

  const [isCreating, setIsCreating] = useState(false)
  const [initialContent, setInitialContent] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const contentInitializedRef = useRef(false)
  const expectedContentRef = useRef<string | null>(null)

  // 初始化：检查是否有当前打开的文件
  useEffect(() => {
    if (currentArticle && currentArticle.length > 0) {
      setInitialContent(currentArticle)
      setIsLoading(false)
      contentInitializedRef.current = true
    } else {
      // 没有打开的文件，直接显示空编辑器
      setInitialContent('')
      setIsLoading(false)
      contentInitializedRef.current = true
    }
  }, [currentArticle])

  // 处理内容变化
  const handleContentChange = useCallback((content: string) => {
    // 跳过空内容
    if (content.length === 0) return

    // 跳过初始化时的内容同步
    if (expectedContentRef.current !== null && content === expectedContentRef.current) {
      expectedContentRef.current = null
      return
    }

    if (!contentInitializedRef.current) {
      contentInitializedRef.current = true
    }

    // 如果正在创建文件，跳过（等待创建完成）
    if (isCreating) return

    // 如果还没有 filePath，创建文件
    if (!isCreating && !expectedContentRef.current && currentArticle === '') {
      setIsCreating(true)
      createUntitledFile(content)
    }
  }, [isCreating, currentArticle])

  // 创建 untitled 文件
  async function createUntitledFile(content: string) {
    try {
      const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
      const workspace = await import('@/lib/workspace').then(m => m.getWorkspacePath())
      const { getFilePathOptions } = await import('@/lib/workspace')

      let fileName = 'untitled.md'
      let counter = 1
      let path = fileName

      // 查找不存在的文件名
      while (true) {
        const pathOptions = await getFilePathOptions(fileName)
        let fileExists = false
        if (workspace.isCustom) {
          fileExists = await exists(pathOptions.path)
        } else {
          fileExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        if (!fileExists) break
        fileName = `untitled-${counter}.md`
        path = fileName
        counter++
      }

      // 写入文件
      const pathOptions = await getFilePathOptions(path)
      if (workspace.isCustom) {
        await writeTextFile(pathOptions.path, content)
      } else {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      }

      // 设置状态
      setInitialContent(content)
      expectedContentRef.current = content
      setCurrentArticle(content)
      setActiveFilePath(path)
      loadFileTree()
    } catch (error) {
      console.error('Create untitled file error:', error)
    } finally {
      setIsCreating(false)
    }
  }

  // 处理引用到聊天
  const handleQuoteToChat = useCallback(() => {
    emitter.emit('get-quote-from-editor')
  }, [])

  // 显示加载状态
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 relative w-full h-full flex flex-col">
      <TipTapEditor
        initialContent={initialContent || ''}
        onChange={handleContentChange}
        placeholder="开始写作..."
        onQuoteToChat={handleQuoteToChat}
      />
    </div>
  )
}

export default MobileEditor
