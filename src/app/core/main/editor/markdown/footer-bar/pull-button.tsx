'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { compareFileVersions, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import { toast } from '@/hooks/use-toast'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import { preprocessMathMarkdown } from '../math-serialize'
import { ask } from '@tauri-apps/plugin-dialog'

interface PullButtonProps {
  editor: Editor
}

export function PullButton({ editor }: PullButtonProps) {
  const { activeFilePath } = useArticleStore()
  const [hasUpdate, setHasUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  // Check for updates
  const checkForUpdates = useCallback(async () => {
    if (!activeFilePath) {
      setHasUpdate(false)
      return
    }

    try {
      const result = await compareFileVersions(activeFilePath)
      setHasUpdate(result.action === 'pull')
      return result
    } catch {
      setHasUpdate(false)
      return null
    }
  }, [activeFilePath])

  // Auto pull from remote (called by interval)
  const autoPull = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    try {
      const result = await compareFileVersions(activeFilePath)

      if (result.action === 'conflict') {
        // 有冲突，提示用户
        const shouldPull = await ask('远程文件与本地有冲突，是否使用远程版本覆盖本地？', {
          title: '冲突检测',
          kind: 'warning',
        })

        if (shouldPull) {
          setIsLoading(true)
          const content = await pullRemoteFile(activeFilePath)
          await saveLocalFile(activeFilePath, content)

          toast({
            title: '已使用远程版本',
            description: '冲突已解决，使用远程版本覆盖本地'
          })

          // Update editor content
          const processedContent = preprocessMathMarkdown(content)
          editor.commands.setContent(processedContent, { contentType: 'html' })
        }
        return
      }

      if (result.action === 'pull') {
        // 有更新，直接拉取
        setIsLoading(true)
        const content = await pullRemoteFile(activeFilePath)
        await saveLocalFile(activeFilePath, content)

        toast({
          title: '已自动拉取',
          description: '已从远程仓库拉取最新内容'
        })

        // Update editor content
        const processedContent = preprocessMathMarkdown(content)
        editor.commands.setContent(processedContent, { contentType: 'html' })

        // 更新同步时间，避免重复检测
        await updateFileSyncTime(activeFilePath)
      }

      // 同步后更新按钮状态
      setHasUpdate(false)
    } catch (error) {
      console.error('Auto pull failed:', error)
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

  // Set up auto-pull interval
  useEffect(() => {
    if (!isConfigured || !activeFilePath) return

    // 每 60 秒检测一次
    intervalRef.current = setInterval(() => {
      autoPull()
    }, 60000)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConfigured, activeFilePath, autoPull])

  // Pull from remote (manual)
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

      // Update editor content - use HTML content type for TipTap
      const processedContent = preprocessMathMarkdown(content)
      editor.commands.setContent(processedContent, { contentType: 'html' })

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

  // 如果没有配置同步，不显示
  if (!isConfigured || !activeFilePath) return null

  return (
    <button
      onClick={handlePull}
      disabled={isLoading || !hasUpdate}
      className={cn(
        'p-0.5 rounded transition-colors',
        hasUpdate && !isLoading
          ? 'hover:bg-amber-500/10 text-amber-500'
          : 'opacity-30 cursor-not-allowed'
      )}
      title={hasUpdate ? '拉取更新' : '无需拉取'}
    >
      <ArrowDownCircle size={14} className={cn(isLoading && 'animate-spin')} />
    </button>
  )
}

export default PullButton
