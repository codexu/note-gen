'use client'

import { ArrowUpCircle, CheckCircle, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Store } from '@tauri-apps/plugin-store'
import { compareFileVersions } from '@/lib/sync/auto-sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getWorkspacePath, getFilePathOptions } from '@/lib/workspace'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { toast } from '@/hooks/use-toast'
import { isSyncConfigured } from '@/lib/sync/sync-manager'
import emitter from '@/lib/emitter'

type SyncStatus = 'synced' | 'push_needed' | 'unknown' | 'error' | 'syncing'

export function SyncButton() {
  const { activeFilePath } = useArticleStore()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('unknown')
  const [isLoading, setIsLoading] = useState(false)
  const [isConfigured, setIsConfigured] = useState(false)

  // Check if sync is configured
  useEffect(() => {
    isSyncConfigured().then(setIsConfigured)
  }, [])

  // Check sync status
  const checkSyncStatus = useCallback(async () => {
    if (!activeFilePath) {
      setSyncStatus('unknown')
      return
    }

    try {
      const result = await compareFileVersions(activeFilePath)
      if (result.action === 'pull') {
        // 有远程更新时不显示图标，避免干扰
        setSyncStatus('unknown')
      } else if (result.action === 'push') {
        setSyncStatus('push_needed')
      } else {
        setSyncStatus('synced')
      }
    } catch {
      setSyncStatus('error')
    }
  }, [activeFilePath])

  // Load status on mount and when active file changes
  useEffect(() => {
    if (activeFilePath) {
      checkSyncStatus()
    }
  }, [activeFilePath, checkSyncStatus])

  // 监听同步内容更新事件
  useEffect(() => {
    const handleSyncContentUpdated = () => {
      if (activeFilePath) {
        checkSyncStatus()
      }
    }
    emitter.on('sync-content-updated', handleSyncContentUpdated)
    return () => {
      emitter.off('sync-content-updated', handleSyncContentUpdated)
    }
  }, [activeFilePath, checkSyncStatus])

  // 监听文章保存事件
  useEffect(() => {
    const handleArticleSaved = (event: { path: string }) => {
      if (activeFilePath && event.path === activeFilePath) {
        checkSyncStatus()
      }
    }
    emitter.on('article-saved', handleArticleSaved as any)
    return () => {
      emitter.off('article-saved', handleArticleSaved as any)
    }
  }, [activeFilePath, checkSyncStatus])

  // 监听推送完成事件
  useEffect(() => {
    const handlePushCompleted = (event: { path: string; success: boolean }) => {
      if (activeFilePath && event.path === activeFilePath) {
        checkSyncStatus()
        setIsLoading(false)
        if (event.success) {
          toast({ title: '已推送' })
        }
      }
    }
    emitter.on('sync-push-completed', handlePushCompleted as any)
    return () => {
      emitter.off('sync-push-completed', handlePushCompleted as any)
    }
  }, [activeFilePath, checkSyncStatus])

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
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as 'gitee' | 'github' | 'gitlab' | 'gitea'
      const repo = await getSyncRepoName(provider)

      // 始终从磁盘读取最新内容
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(activeFilePath)
      const content = workspace.isCustom
        ? await readTextFile(pathOptions.path)
        : await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })

      const commitMessage = await generateCommitMessage(content)

      let success = false

      switch (provider) {
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
          await gitlabModule.updateFileContent({ path: activeFilePath, ref: 'main', repo, content, message: commitMessage })
          success = true
          break
        }
        case 'gitea': {
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.updateFileContent({ path: activeFilePath, ref: 'main', repo, content, message: commitMessage })
          success = true
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
      toast({
        title: '推送失败',
        description: '无法推送到远程仓库',
        variant: 'destructive'
      })
    }
  }, [activeFilePath, isLoading, generateCommitMessage])

  // 如果没有配置同步，不显示按钮
  if (!isConfigured || !activeFilePath) return null

  return (
    <div className="flex items-center gap-1.5">
      {/* 上传中显示文字 */}
      {isLoading && (
        <span className="text-xs text-blue-500 flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          上传中
        </span>
      )}

      {/* 同步按钮 */}
      <button
        onClick={handlePush}
        disabled={isLoading}
        className={cn(
          'p-0.5 rounded transition-colors flex items-center gap-1',
          isLoading
            ? 'opacity-50 cursor-wait'
            : syncStatus === 'synced'
              ? 'text-green-500 hover:bg-green-500/10'
              : 'text-blue-500 hover:bg-blue-500/10'
        )}
        title={isLoading ? '上传中...' : syncStatus === 'synced' ? '已同步' : '点击推送'}
      >
        {isLoading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : syncStatus === 'synced' ? (
          <CheckCircle size={14} />
        ) : (
          <ArrowUpCircle size={14} />
        )}
      </button>
    </div>
  )
}

export default SyncButton
