'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { compareFileVersions, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { toast } from '@/hooks/use-toast'

interface PullButtonProps {
  editor: Editor
}

export function PullButton({ editor }: PullButtonProps) {
  const { activeFilePath } = useArticleStore()
  const [hasUpdate, setHasUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Check for updates
  const checkForUpdates = useCallback(async () => {
    if (!activeFilePath) {
      setHasUpdate(false)
      return
    }

    try {
      const result = await compareFileVersions(activeFilePath)
      setHasUpdate(result.action === 'pull')
    } catch {
      setHasUpdate(false)
    }
  }, [activeFilePath])

  // Pull from remote
  const handlePull = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    setIsLoading(true)
    try {
      const content = await pullRemoteFile(activeFilePath)
      await saveLocalFile(activeFilePath, content)

      toast({
        title: '拉取成功',
        description: '已从远程仓库拉取最新内容'
      })

      // Update editor content
      editor.commands.setContent(content, { contentType: 'markdown' })

      setHasUpdate(false)
    } catch (error) {
      console.error('Pull failed:', error)
      toast({
        title: '拉取失败',
        description: '无法从远程仓库拉取文件',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, editor, isLoading])

  // Check for updates on mount and when active file changes
  useEffect(() => {
    if (activeFilePath) {
      checkForUpdates()
    }
  }, [activeFilePath, checkForUpdates])

  if (!activeFilePath) return null

  return (
    <button
      onClick={handlePull}
      disabled={isLoading || !hasUpdate}
      className={cn(
        'p-0.5 rounded transition-colors',
        hasUpdate
          ? 'hover:bg-amber-500/10 text-amber-500'
          : 'opacity-30 cursor-not-allowed'
      )}
      title={hasUpdate ? '拉取更新' : '无需拉取'}
    >
      <ArrowDownCircle size={12} className={cn(isLoading && 'animate-spin')} />
    </button>
  )
}

export default PullButton
