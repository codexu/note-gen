'use client'

import { Editor } from '@tiptap/react'
import { ArrowDownCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import useArticleStore from '@/stores/article'
import useSettingStore from '@/stores/setting'
import { compareFileVersions, pullRemoteFile, saveLocalFile, getRemoteFileInfo, setLocalRecordedSha } from '@/lib/sync/auto-sync'
import { updateFileSyncTime } from '@/lib/sync/conflict-resolution'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import emitter from '@/lib/emitter'
import { toast } from '@/hooks/use-toast'
import { ConflictDialog } from './conflict-dialog'

interface PullButtonProps {
  editor: Editor
}

// 拉取状态
type PullStatus = 'idle' | 'checking' | 'update-available' | 'pulling' | 'conflict' | 'error'

export function PullButton({ editor }: PullButtonProps) {
  const { activeFilePath } = useArticleStore()
  const { autoPullOnSwitch } = useSettingStore()
  const [hasUpdate, setHasUpdate] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [pullStatus, setPullStatus] = useState<PullStatus>('idle')
  const [showConflictDialog, setShowConflictDialog] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInputTimeRef = useRef<number>(Date.now())

  // 编辑器状态检测
  const [isEditorFocused, setIsEditorFocused] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)

  // 用于防抖和竞态处理
  const pendingFileRef = useRef<string | null>(null)
  const pullTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 远程内容缓存（用于显示更新提示）
  const remoteContentRef = useRef<string | null>(null)

  const IDLE_PULL_INTERVAL = 30 * 1000 // 30 秒
  const IDLE_THRESHOLD = 10 * 1000 // 用户停止输入 10 秒后开始计时

  // 检测编辑器状态
  useEffect(() => {
    if (!editor) return

    const handleFocus = () => setIsEditorFocused(true)
    const handleBlur = () => setIsEditorFocused(false)
    const handleSelectionUpdate = () => {
      const selection = editor.state.selection
      const from = selection.from
      const to = selection.to
      setHasSelection(from !== to)
    }

    editor.on('focus', handleFocus)
    editor.on('blur', handleBlur)
    editor.on('selectionUpdate', handleSelectionUpdate)

    // 初始化状态
    setIsEditorFocused(editor.isFocused)
    const selection = editor.state.selection
    setHasSelection(selection.from !== selection.to)

    return () => {
      editor.off('focus', handleFocus)
      editor.off('blur', handleBlur)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  // 检查用户是否正在活跃编辑
  const isUserActive = isEditorFocused || hasSelection
  const timeSinceInput = Date.now() - lastInputTimeRef.current

  // 执行实际的拉取操作
  const executePull = useCallback(async (remoteContent: string) => {
    if (!activeFilePath) return

    setIsLoading(true)
    try {
      await saveLocalFile(activeFilePath, remoteContent)
      // 使用 contentType: 'markdown' 让 @tiptap/markdown 扩展解析 Markdown
      editor.commands.setContent(remoteContent, { contentType: 'markdown' })
      // 更新同步时间，避免重复检测
      await updateFileSyncTime(activeFilePath)
      // 更新本地记录的远程 SHA，避免重复提示有更新
      const remoteInfo = await getRemoteFileInfo(activeFilePath)
      if (remoteInfo.sha) {
        await setLocalRecordedSha(activeFilePath, remoteInfo.sha)
      }
      // 触发事件，让推送队列重置计时器
      emitter.emit('sync-pulled', { path: activeFilePath })
      // 清除远程内容缓存
      remoteContentRef.current = null
      setPullStatus('idle')
      setHasUpdate(false)
    } catch (error) {
      console.error('Pull failed:', error)
      setPullStatus('error')
      toast({
        title: '拉取失败',
        description: error instanceof Error ? error.message : '请检查网络连接后重试',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, editor])

  // Auto pull from remote (called by interval)
  const checkForUpdates = useCallback(async () => {
    if (!activeFilePath || isLoading) {
      return
    }

    // 如果用户正在编辑（停止输入不到 10 秒），延迟拉取
    if (timeSinceInput < IDLE_THRESHOLD) {
      setPullStatus('idle')
      return
    }

    try {
      setPullStatus('checking')
      const result = await compareFileVersions(activeFilePath)

      if (result.action === 'conflict') {
        setPullStatus('conflict')
        return
      }

      if (result.action === 'pull') {
        // 缓存远程内容
        try {
          const content = await pullRemoteFile(activeFilePath)
          remoteContentRef.current = content
          // 检测到更新，但不自动拉取，只显示状态
          setPullStatus('update-available')
          setHasUpdate(true)
          return
        } catch {
          // 如果拉取失败，标记为错误
          setPullStatus('error')
          toast({
            title: '获取远程更新失败',
            description: '请检查网络连接后重试',
            variant: 'destructive',
          })
          return
        }
      }

      // 没有更新
      setPullStatus('idle')
      setHasUpdate(false)
      remoteContentRef.current = null
    } catch (error) {
      console.error('Auto pull check failed:', error)
      setPullStatus('error')
      // 静默处理自动检查的错误，不弹 toast 打扰用户
    }
  }, [activeFilePath, isLoading, isUserActive, timeSinceInput])

  // 处理冲突 - 打开对比对话框
  const handleConflict = useCallback(() => {
    setShowConflictDialog(true)
  }, [])

  // 冲突解决后的回调
  const handleConflictResolved = useCallback(() => {
    setPullStatus('idle')
    setHasUpdate(false)
    remoteContentRef.current = null
  }, [])

  // Check for updates and auto pull when file changes
  useEffect(() => {
    if (!activeFilePath || !isConfigured) return

    // 清理之前的定时器
    if (pullTimeoutRef.current) {
      clearTimeout(pullTimeoutRef.current)
      pullTimeoutRef.current = null
    }

    // 文件切换时，重置最后输入时间，让首次检测可以立即执行
    lastInputTimeRef.current = 0

    // 文件切换时也使用新的检测逻辑，不自动拉取
    const checkOnSwitch = async () => {
      // 竞态检查：如果当前正在处理的文件不是这个了，忽略
      if (pendingFileRef.current !== null && pendingFileRef.current !== activeFilePath) {
        return
      }

      pendingFileRef.current = activeFilePath

      // 清除之前的缓存
      remoteContentRef.current = null

      try {
        // 文件切换时总是检测（用户主动打开的文件，检测更新不会打扰用户）
        // 只有定时器检测才需要考虑用户是否在编辑
        const result = await compareFileVersions(activeFilePath)

        // 再次检查是否还是当前文件（可能已经切换走了）
        if (pendingFileRef.current !== activeFilePath) {
          return
        }

        if (result.action === 'conflict') {
          // 有冲突时，根据 autoPullOnSwitch 配置决定是否自动拉取
          // 先显示检查中状态
          setPullStatus('checking')
          setIsLoading(true)

          if (autoPullOnSwitch) {
            // 禁用编辑器
            editor.setEditable(false)
            const content = await pullRemoteFile(activeFilePath)

            if (pendingFileRef.current !== activeFilePath) {
              setIsLoading(false)
              editor.setEditable(true)
              return
            }

            await saveLocalFile(activeFilePath, content)
            editor.commands.setContent(content, { contentType: 'markdown' })
            // 恢复编辑器
            editor.setEditable(true)
            setIsLoading(false)
          } else {
            // 不自动拉取，只显示冲突状态
            setPullStatus('conflict')
            setIsLoading(false)
          }
        } else if (result.action === 'pull') {
          // 切换文件时检测到更新，根据 autoPullOnSwitch 配置决定是否自动拉取
          // 先显示检查中状态
          setPullStatus('checking')
          setIsLoading(true)

          if (autoPullOnSwitch) {
            // 禁用编辑器
            editor.setEditable(false)
            const content = await pullRemoteFile(activeFilePath)

            // 拉取后再次检查是否还是当前文件
            if (pendingFileRef.current !== activeFilePath) {
              setIsLoading(false)
              editor.setEditable(true)
              return
            }

            await saveLocalFile(activeFilePath, content)

            editor.commands.setContent(content, { contentType: 'markdown' })
            await updateFileSyncTime(activeFilePath)
            emitter.emit('sync-pulled', { path: activeFilePath })
            // 恢复编辑器
            editor.setEditable(true)
            setIsLoading(false)
            setHasUpdate(false)
          } else {
            // 不自动拉取，只提示有更新，但先显示 loading 状态
            try {
              const content = await pullRemoteFile(activeFilePath)
              remoteContentRef.current = content
              setPullStatus('update-available')
              setHasUpdate(true)
              setIsLoading(false)
            } catch {
              setPullStatus('error')
              setIsLoading(false)
            }
          }
        } else {
          setPullStatus('idle')
          setHasUpdate(false)
        }
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
    pullTimeoutRef.current = setTimeout(checkOnSwitch, 500)

    return () => {
      if (pullTimeoutRef.current) {
        clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = null
      }
    }
  }, [activeFilePath, isConfigured, editor, isUserActive, autoPullOnSwitch])

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

  // Set up auto-pull interval (now only checks, doesn't auto-pull)
  useEffect(() => {
    if (!isConfigured || !activeFilePath) return

    const checkForUpdatesPeriodically = () => {
      // 使用 ref 中的最新值
      const now = Date.now()
      const timeSinceInput = now - lastInputTimeRef.current
      // 用户停止输入超过阈值时才检查
      if (timeSinceInput >= IDLE_THRESHOLD) {
        checkForUpdates()
      }
    }

    intervalRef.current = setInterval(checkForUpdatesPeriodically, IDLE_PULL_INTERVAL)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isConfigured, activeFilePath, checkForUpdates])

  // Pull from remote (manual) - 使用缓存的远程内容
  const handlePull = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    // 如果有缓存的远程内容，直接使用
    if (remoteContentRef.current) {
      await executePull(remoteContentRef.current)
      return
    }

    // 如果没有缓存，重新拉取
    setIsLoading(true)
    try {
      const content = await pullRemoteFile(activeFilePath)
      await executePull(content)
    } catch (error) {
      console.error('Pull failed:', error)
    }
  }, [activeFilePath, isLoading, executePull])

  // 如果没有配置同步，不显示
  if (!isConfigured || !activeFilePath) return null

  return (
    <>
      <div className="flex items-center gap-1">
        {/* 拉取中状态 */}
        {isLoading ? (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            拉取中...
          </span>
        ) : pullStatus === 'conflict' ? (
          /* 冲突状态 - 提示用户处理 */
          <button
            onClick={handleConflict}
            className="p-0.5 rounded transition-colors hover:bg-red-500/10 text-red-500 flex items-center gap-1"
            title="处理冲突"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">有冲突</span>
          </button>
        ) : hasUpdate ? (
          /* 有更新可以拉取 */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-amber-500/10 text-amber-500 flex items-center gap-1"
            title="拉取更新"
          >
            <ArrowDownCircle size={14} />
            <span className="text-xs">有更新</span>
          </button>
        ) : pullStatus === 'checking' ? (
          /* 检查中状态 */
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            检查中
          </span>
        ) : (
          /* 无需拉取时也显示可点击的按钮，让用户可以手动拉取 */
          <button
            onClick={handlePull}
            className="p-0.5 rounded transition-colors hover:bg-accent text-muted-foreground flex items-center gap-1"
            title="手动拉取远程文件"
          >
            <ArrowDownCircle size={14} />
          </button>
        )}
      </div>

      {/* 冲突对比对话框 */}
      <ConflictDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        activeFilePath={activeFilePath}
        editor={editor}
        onResolved={handleConflictResolved}
      />
    </>
  )
}

export default PullButton
