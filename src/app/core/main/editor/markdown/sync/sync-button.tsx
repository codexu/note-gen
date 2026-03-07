'use client'

import { ArrowUpCircle, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useSyncStore from '@/stores/sync'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import emitter from '@/lib/emitter'

export function SyncButton() {
  const { activeFilePath } = useArticleStore()
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [showError, setShowError] = useState(false)
  const [lastPushTime, setLastPushTime] = useState<Date | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  // 监听推送开始事件
  useEffect(() => {
    const handlePushStarted = (event: { path: string }) => {
      if (activeFilePath && event.path === activeFilePath) {
        setIsLoading(true)
      }
    }
    emitter.on('sync-push-started', handlePushStarted as any)
    return () => {
      emitter.off('sync-push-started', handlePushStarted as any)
    }
  }, [activeFilePath])

  // 监听推送完成事件
  useEffect(() => {
    const handlePushCompleted = (event: { path: string; success: boolean }) => {
      if (activeFilePath && event.path === activeFilePath) {
        setIsLoading(false)
        if (event.success) {
          // 显示成功状态
          setShowError(false)
          setShowSuccess(true)
          setLastPushTime(new Date())
          // 5秒后恢复
          if (successTimerRef.current) {
            clearTimeout(successTimerRef.current)
          }
          successTimerRef.current = setTimeout(() => {
            setShowSuccess(false)
          }, 5000)
        } else {
          // 显示失败状态
          setShowSuccess(false)
          setShowError(true)
          // 5秒后恢复
          if (errorTimerRef.current) {
            clearTimeout(errorTimerRef.current)
          }
          errorTimerRef.current = setTimeout(() => {
            setShowError(false)
          }, 5000)
        }
      }
    }
    emitter.on('sync-push-completed', handlePushCompleted as any)
    return () => {
      emitter.off('sync-push-completed', handlePushCompleted as any)
      if (successTimerRef.current) {
        clearTimeout(successTimerRef.current)
      }
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current)
      }
    }
  }, [activeFilePath])

  // Generate AI commit message
  const generateCommitMessage = useCallback(async (content: string): Promise<string> => {
    try {
      const { fetchAi } = await import('@/lib/ai/chat')
      const prompt = `请为以下文档内容生成一个简洁的 Git 提交信息（不超过 50 个字符）：

${content.slice(0, 1000)}${content.length > 1000 ? '...' : ''}

直接返回提交信息，不需要任何解释或格式。`
      const message = await fetchAi(prompt, 'commitModel')
      return message.trim().slice(0, 50) || `Update ${activeFilePath}`
    } catch {
      return `Update ${activeFilePath}`
    }
  }, [activeFilePath])

  // Push to remote
  const handlePush = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    setIsLoading(true)
    try {
      const store = await Store.load('store.json')
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as 'gitee' | 'github' | 'gitlab' | 'gitea' | 's3' | 'webdav'
      // S3 和 WebDAV 不需要 repo
      const repo = (provider === 's3' || provider === 'webdav') ? '' : await getSyncRepoName(provider)

      // 始终从磁盘读取最新内容
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(activeFilePath)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

      const commitMessage = await generateCommitMessage(content)

      let success = false

      switch (provider) {
        case 's3': {
          const s3Module = await import('@/lib/sync/s3') as any
          const s3Config = await store.get<any>('s3SyncConfig')
          if (!s3Config) {
            throw new Error('S3 配置未找到')
          }
          // S3 上传文件
          const result = await s3Module.s3Upload(s3Config, activeFilePath, content)
          if (result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateS3FileEtag(activeFilePath, result.etag)
            success = true
          }
          break
        }
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          const fileInfo = await githubModule.getFiles({ path: activeFilePath, repo })
          await githubModule.uploadFile({
            ext: activeFilePath.split('.').pop() || 'md',
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          success = true
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const fileInfo = await giteeModule.getFiles({ path: activeFilePath, repo })
          await giteeModule.uploadFile({
            ext: activeFilePath.split('.').pop() || 'md',
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          success = true
          break
        }
        case 'gitlab': {
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          const fileInfo = await gitlabModule.getFiles({ path: activeFilePath, repo })
          await gitlabModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          success = true
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          const fileInfo = await giteaModule.getFiles({ path: activeFilePath, repo })
          await giteaModule.uploadFile({
            file: content,
            filename: activeFilePath.split('/').pop() || activeFilePath,
            sha: fileInfo?.sha,
            message: commitMessage,
            repo,
            path: activeFilePath
          })
          success = true
          break
        }
        case 'webdav': {
          const webdavModule = await import('@/lib/sync/webdav') as any
          const webdavConfig = await store.get<any>('webdavSyncConfig')
          if (!webdavConfig) {
            throw new Error('WebDAV 配置未找到')
          }
          const result = await webdavModule.webdavUpload(webdavConfig, activeFilePath, content)
          if (result) {
            // 更新 ETag 记录
            useSyncStore.getState().updateWebDAVFileEtag(activeFilePath, result.etag)
            success = true
          }
          break
        }
      }

      if (success) {
        emitter.emit('sync-push-completed', { path: activeFilePath, success: true })
      } else {
        throw new Error('File may not exist on remote')
      }
    } catch (error) {
      console.error('Push failed:', error)
      setIsLoading(false)
      emitter.emit('sync-push-completed', { path: activeFilePath, success: false })
    }
  }, [activeFilePath, isLoading, generateCommitMessage])

  // 如果没有配置同步，不显示按钮
  if (!isConfigured || !activeFilePath) return null

  // 格式化时间
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* 上传中显示文字 */}
      {isLoading && (
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          上传中
        </span>
      )}

      {/* 成功推送状态 */}
      {showSuccess && !isLoading && (
        <span className="text-xs text-green-500 flex items-center gap-1 animate-pulse">
          <CheckCircle size={12} />
          {lastPushTime && formatTime(lastPushTime)}
        </span>
      )}

      {/* 失败推送状态 */}
      {showError && !isLoading && (
        <span className="text-xs text-red-500 flex items-center gap-1">
          <XCircle size={12} />
          上传失败
        </span>
      )}

      {/* 同步按钮 */}
      {!showSuccess && !showError && !isLoading && (
        <button
          onClick={handlePush}
          disabled={isLoading}
          className={cn(
            'p-0.5 rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted'
          )}
          title={isLoading ? '上传中...' : '点击推送'}
        >
          <ArrowUpCircle size={14} />
        </button>
      )}
    </div>
  )
}

export default SyncButton
