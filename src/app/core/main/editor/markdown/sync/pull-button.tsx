'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import useArticleStore from '@/stores/article'
import { compareFileVersions, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
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

  // 用于防抖和竞态处理
  const pendingFileRef = useRef<string | null>(null)
  const pullTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const IDLE_PULL_INTERVAL = 30 * 1000 // 30 秒
  const IDLE_THRESHOLD = 10 * 1000 // 用户停止输入 10 秒后开始计时

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

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

          // Update editor content - 使用 contentType: 'markdown' 让扩展解析
          editor.commands.setContent(content, { contentType: 'markdown' })
        }
        return
      }

      if (result.action === 'pull') {
        // 有更新，直接拉取
        setIsLoading(true)
        const content = await pullRemoteFile(activeFilePath)
        await saveLocalFile(activeFilePath, content)

        // 使用 contentType: 'markdown' 让 @tiptap/markdown 扩展解析 Markdown
        editor.commands.setContent(content, { contentType: 'markdown' })

        // 更新同步时间，避免重复检测
        await updateFileSyncTime(activeFilePath)

        // 触发事件，让推送队列重置计时器
        emitter.emit('sync-pulled', { path: activeFilePath })
      }

      // 同步后更新按钮状态
      setHasUpdate(false)
    } catch (error) {
      console.error('Auto pull failed:', error)
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, editor, isLoading])

  // Check for updates and auto pull when file changes
  useEffect(() => {
    if (!activeFilePath || !isConfigured) return

    // 清理之前的定时器
    if (pullTimeoutRef.current) {
      clearTimeout(pullTimeoutRef.current)
      pullTimeoutRef.current = null
    }

    const checkAndPullOnSwitch = async () => {
      // 竞态检查：如果当前正在处理的文件不是这个了，忽略
      if (pendingFileRef.current !== null && pendingFileRef.current !== activeFilePath) {
        return
      }

      pendingFileRef.current = activeFilePath

      try {
        const result = await compareFileVersions(activeFilePath)

        // 再次检查是否还是当前文件（可能已经切换走了）
        if (pendingFileRef.current !== activeFilePath) {
          return
        }

        if (result.action === 'conflict') {
          const shouldPull = await ask('远程文件与本地有冲突，是否使用远程版本覆盖本地？', {
            title: '冲突检测',
            kind: 'warning',
          })

          if (shouldPull && pendingFileRef.current === activeFilePath) {
            setIsLoading(true)
            const content = await pullRemoteFile(activeFilePath)
            await saveLocalFile(activeFilePath, content)

            editor.commands.setContent(content, { contentType: 'markdown' })
            setIsLoading(false)
          }
        } else if (result.action === 'pull') {
          // 切换文件时发现远程有更新，立即拉取
          setIsLoading(true)
          const content = await pullRemoteFile(activeFilePath)

          // 拉取后再次检查是否还是当前文件
          if (pendingFileRef.current !== activeFilePath) {
            setIsLoading(false)
            return
          }

          await saveLocalFile(activeFilePath, content)

          editor.commands.setContent(content, { contentType: 'markdown' })
          await updateFileSyncTime(activeFilePath)
          emitter.emit('sync-pulled', { path: activeFilePath })
          setIsLoading(false)
        }

        setHasUpdate(result.action === 'pull')
      } catch {
        setHasUpdate(false)
      } finally {
        // 只有当这是最后一个请求时才清除标记
        if (pendingFileRef.current === activeFilePath) {
          pendingFileRef.current = null
        }
      }
    }

    // 防抖：延迟 500ms 执行，等待用户停止切换
    pullTimeoutRef.current = setTimeout(checkAndPullOnSwitch, 500)

    return () => {
      if (pullTimeoutRef.current) {
        clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = null
      }
    }
  }, [activeFilePath, isConfigured, editor])

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

      // Update editor content - 使用 contentType: 'markdown' 让扩展解析
      editor.commands.setContent(content, { contentType: 'markdown' })

      setHasUpdate(false)
    } catch (error) {
      console.error('Pull failed:', error)
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, editor, isLoading])

  // 如果没有配置同步，不显示
  if (!isConfigured || !activeFilePath) return null

  return (
    <div className="flex items-center gap-1">
      {/* 拉取中状态 */}
      {isLoading ? (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          拉取中...
        </span>
      ) : hasUpdate ? (
        /* 有更新可以拉取 */
        <button
          onClick={handlePull}
          className="p-0.5 rounded transition-colors hover:bg-amber-500/10 text-amber-500"
          title="拉取更新"
        >
          <ArrowDownCircle size={14} />
        </button>
      ) : (
        /* 无需拉取 */
        <span className="p-0.5 opacity-30 cursor-not-allowed" title="无需拉取">
          <ArrowDownCircle size={14} />
        </span>
      )}
    </div>
  )
}

export default PullButton
