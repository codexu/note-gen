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
import emitter from '@/lib/emitter'

interface PullButtonProps {
  editor: Editor
}

export function PullButton({ editor }: PullButtonProps) {
  const { activeFilePath } = useArticleStore()
  const [hasUpdate, setHasUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInputTimeRef = useRef<number>(Date.now())

  const IDLE_PULL_INTERVAL = 30 * 1000 // 30 秒
  const IDLE_THRESHOLD = 10 * 1000 // 用户停止输入 10 秒后开始计时

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

          // Update editor content - 使用 contentType: 'markdown' 让扩展解析
          const processedContent = preprocessMathMarkdown(content)
          editor.commands.setContent(processedContent, { contentType: 'markdown' })
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

        // 使用 contentType: 'markdown' 让 @tiptap/markdown 扩展解析 Markdown
        const processedContent = preprocessMathMarkdown(content)
        editor.commands.setContent(processedContent, { contentType: 'markdown' })

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

  // 监听用户输入事件，重置计时器
  useEffect(() => {
    const handleInput = () => {
      lastInputTimeRef.current = Date.now()
    }
    emitter.on('editor-input', handleInput)
    return () => {
      emitter.off('editor-input', handleInput)
    }
  }, [])

  // Set up auto-pull interval
  useEffect(() => {
    if (!isConfigured || !activeFilePath) return

    const checkAndPull = () => {
      const now = Date.now()
      const timeSinceInput = now - lastInputTimeRef.current
      // 用户停止输入超过 10 秒才执行拉取
      if (timeSinceInput >= IDLE_THRESHOLD) {
        autoPull()
      }
    }

    intervalRef.current = setInterval(checkAndPull, IDLE_PULL_INTERVAL)

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

      // Update editor content - 使用 contentType: 'markdown' 让扩展解析
      const processedContent = preprocessMathMarkdown(content)
      editor.commands.setContent(processedContent, { contentType: 'markdown' })

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
