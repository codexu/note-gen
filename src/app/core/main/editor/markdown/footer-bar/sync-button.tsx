'use client'

import { ArrowUpCircle } from 'lucide-react'
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

type SyncStatus = 'synced' | 'pull_needed' | 'push_needed' | 'unknown' | 'error'

export function SyncButton() {
  const { activeFilePath, currentArticle } = useArticleStore()
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
        setSyncStatus('pull_needed')
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

  // 监听同步内容更新事件，拉取后重新检查状态
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

  // 监听文章保存事件，保存后重新检查同步状态
  useEffect(() => {
    const handleArticleSaved = (event: { path: string; content: string }) => {
      if (activeFilePath && event.path === activeFilePath) {
        checkSyncStatus()
      }
    }
    emitter.on('article-saved', handleArticleSaved as any)
    return () => {
      emitter.off('article-saved', handleArticleSaved as any)
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

      // 优先使用 store 中的当前内容（如果存在且与文件不同步）
      // 这样可以推送未保存到磁盘的最新内容
      let content = currentArticle

      // 如果 store 为空或太短，尝试从文件读取
      if (!content || content.length < 10) {
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(activeFilePath)
        if (workspace.isCustom) {
          content = await readTextFile(pathOptions.path)
        } else {
          content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      }

      // Generate commit message using AI
      const commitMessage = await generateCommitMessage(content)

      let success = false

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          const fileInfo = await githubModule.getFiles({ path: activeFilePath, repo })
          // uploadFile 同时支持创建和更新（有 sha 则更新，无则创建）
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
          // uploadFile 同时支持创建和更新
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
        toast({
          title: '推送成功',
          description: `提交信息: ${commitMessage}`
        })
        checkSyncStatus()
      } else {
        throw new Error('File may not exist on remote')
      }
    } catch (error) {
      console.error('Push failed:', error)
      toast({
        title: '推送失败',
        description: '无法推送到远程仓库',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, currentArticle, isLoading, checkSyncStatus, generateCommitMessage])

  const getStatusText = () => {
    switch (syncStatus) {
      case 'synced': return '已同步'
      case 'pull_needed': return '有更新'
      case 'push_needed': return '待推送'
      case 'error': return '同步错误'
      default: return '未同步'
    }
  }

  // 如果没有配置同步，不显示同步按钮
  if (!isConfigured || !activeFilePath) return null

  const canPush = syncStatus === 'push_needed' && !isLoading

  return (
    <button
      onClick={handlePush}
      disabled={!canPush}
      className={cn(
        'p-0.5 rounded transition-colors relative',
        canPush
          ? 'hover:bg-blue-500/10 text-blue-500'
          : 'opacity-40 cursor-not-allowed'
      )}
      title={canPush ? '推送到远程' : getStatusText()}
    >
      <ArrowUpCircle size={14} className={cn(isLoading && 'animate-spin')} />
    </button>
  )
}

export default SyncButton
