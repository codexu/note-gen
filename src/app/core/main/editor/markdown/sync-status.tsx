'use client'

import { Editor } from '@tiptap/react'
import { ArrowUpCircle, ArrowDownCircle, History, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Store } from '@tauri-apps/plugin-store'
import { compareFileVersions, pullRemoteFile } from '@/lib/sync/auto-sync'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileCommits as getGiteaFileCommits } from '@/lib/sync/gitea'
import { toast } from '@/hooks/use-toast'

interface SyncStatusProps {
  editor: Editor
}

type SyncStatus = 'synced' | 'pull_needed' | 'push_needed' | 'unknown' | 'error'
type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface CommitInfo {
  sha: string
  message: string
  author: string
  date: Date
}

export function SyncStatus({ editor }: SyncStatusProps) {
  const { activeFilePath, currentArticle } = useArticleStore()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('unknown')
  const [isLoading, setIsLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [history, setHistory] = useState<CommitInfo[]>([])

  // Get the sync provider
  const getProvider = useCallback(async (): Promise<SyncProvider | null> => {
    try {
      const store = await Store.load('store.json')
      const provider = await store.get<string>('primaryBackupMethod') || 'github'
      return provider as SyncProvider
    } catch {
      return null
    }
  }, [])

  // Check sync status
  const checkSyncStatus = useCallback(async () => {
    if (!activeFilePath) {
      setSyncStatus('unknown')
      return
    }

    try {
      const provider = await getProvider()
      if (!provider) {
        setSyncStatus('unknown')
        return
      }

      const result = await compareFileVersions(activeFilePath)
      if (result.action === 'pull') {
        setSyncStatus('pull_needed')
      } else if (result.action === 'push') {
        setSyncStatus('push_needed')
      } else {
        setSyncStatus('synced')
      }
    } catch (error) {
      console.error('Failed to check sync status:', error)
      setSyncStatus('error')
    }
  }, [activeFilePath, getProvider])

  // Load history
  const loadHistory = useCallback(async () => {
    if (!activeFilePath) return

    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let commits: any[] = []

      switch (provider) {
        case 'github': {
          const result = await getGithubFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitee': {
          const result = await getGiteeFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitlab': {
          const result = await getGitlabFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
        case 'gitea': {
          const result = await getGiteaFileCommits({ path: activeFilePath, repo })
          commits = (Array.isArray(result) ? result : []) as any[]
          break
        }
      }

      const historyData = commits.slice(0, 10).map((commit: any) => ({
        sha: (commit.sha || commit.id || '').slice(0, 7),
        message: commit.commit?.message || commit.message || 'No message',
        author: commit.commit?.author?.name || commit.author?.name || commit.author_name || 'Unknown',
        date: new Date(commit.commit?.author?.date || commit.created_at || commit.committed_date || Date.now())
      }))

      setHistory(historyData)
    } catch (error) {
      console.error('Failed to load history:', error)
    }
  }, [activeFilePath, getProvider])

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

      checkSyncStatus()
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
  }, [activeFilePath, editor, isLoading, checkSyncStatus])

  // Push to remote
  const handlePush = useCallback(async () => {
    if (!activeFilePath || isLoading) return

    setIsLoading(true)
    try {
      const store = await Store.load('store.json')
      const provider = (await store.get<string>('primaryBackupMethod') || 'github') as 'gitee' | 'github' | 'gitlab' | 'gitea'
      const repo = await getSyncRepoName(provider)
      const content = currentArticle

      let success = false

      switch (provider) {
        case 'github': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const githubModule = await import('@/lib/sync/github') as any
          const sha = await githubModule.getFileSha({ path: activeFilePath, repo })
          if (sha) {
            await githubModule.updateFile({ path: activeFilePath, repo, content, message: `Update ${activeFilePath}`, sha })
            success = true
          }
          break
        }
        case 'gitee': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const giteeModule = await import('@/lib/sync/gitee') as any
          const sha = await giteeModule.getFileSha({ path: activeFilePath, repo })
          if (sha) {
            await giteeModule.updateFile({ path: activeFilePath, repo, content, message: `Update ${activeFilePath}`, sha })
            success = true
          }
          break
        }
        case 'gitlab': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const gitlabModule = await import('@/lib/sync/gitlab') as any
          await gitlabModule.updateFileContent({ path: activeFilePath, ref: 'main', repo, content, message: `Update ${activeFilePath}` })
          success = true
          break
        }
        case 'gitea': {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const giteaModule = await import('@/lib/sync/gitea') as any
          await giteaModule.updateFileContent({ path: activeFilePath, ref: 'main', repo, content, message: `Update ${activeFilePath}` })
          success = true
          break
        }
      }

      if (success) {
        toast({
          title: '推送成功',
          description: '已推送到远程仓库'
        })
        checkSyncStatus()
      } else {
        throw new Error('File may not exist on remote')
      }
    } catch (error) {
      console.error('Push failed:', error)
      toast({
        title: '推送失败',
        description: '无法推送到远程仓库，文件可能不存在于远程',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, currentArticle, isLoading, checkSyncStatus])

  // Refresh status
  const handleRefresh = useCallback(async () => {
    setIsLoading(true)
    await checkSyncStatus()
    await loadHistory()
    setIsLoading(false)
  }, [checkSyncStatus, loadHistory])

  // Load status on mount and when active file changes
  useEffect(() => {
    if (activeFilePath) {
      checkSyncStatus()
      loadHistory()
    }
  }, [activeFilePath, checkSyncStatus, loadHistory])

  const getStatusColor = () => {
    switch (syncStatus) {
      case 'synced': return 'text-green-500'
      case 'pull_needed': return 'text-amber-500'
      case 'push_needed': return 'text-blue-500'
      case 'error': return 'text-red-500'
      default: return 'text-muted-foreground'
    }
  }

  const getStatusText = () => {
    switch (syncStatus) {
      case 'synced': return '已同步'
      case 'pull_needed': return '有更新'
      case 'push_needed': return '待推送'
      case 'error': return '同步错误'
      default: return '未同步'
    }
  }

  if (!activeFilePath) return null

  return (
    <div className="relative flex items-center gap-0.5">
      {/* Status indicator */}
      <button
        onClick={handleRefresh}
        disabled={isLoading}
        className={cn(
          'flex items-center gap-0.5 px-1.5 rounded transition-colors',
          'hover:bg-muted',
          isLoading && 'opacity-50'
        )}
        title="点击刷新同步状态"
      >
        <RefreshCw size={10} className={cn(isLoading && 'animate-spin', getStatusColor())} />
        <span className="text-[10px]">{getStatusText()}</span>
      </button>

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handlePull}
          disabled={isLoading || syncStatus !== 'pull_needed'}
          className={cn(
            'p-0.5 rounded transition-colors',
            syncStatus === 'pull_needed'
              ? 'hover:bg-amber-500/10 text-amber-500'
              : 'opacity-30 cursor-not-allowed'
          )}
          title="拉取更新"
        >
          <ArrowDownCircle size={12} />
        </button>

        <button
          onClick={handlePush}
          disabled={isLoading || syncStatus !== 'push_needed'}
          className={cn(
            'p-0.5 rounded transition-colors',
            syncStatus === 'push_needed'
              ? 'hover:bg-blue-500/10 text-blue-500'
              : 'opacity-30 cursor-not-allowed'
          )}
          title="推送到远程"
        >
          <ArrowUpCircle size={12} />
        </button>

        <button
          onClick={() => {
            setShowHistory(!showHistory)
            if (!showHistory) loadHistory()
          }}
          className={cn(
            'p-0.5 rounded transition-colors hover:bg-muted',
            showHistory && 'bg-muted'
          )}
          title="历史记录"
        >
          <History size={12} />
        </button>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-background border border-border rounded-lg shadow-lg overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-border bg-muted/50">
            <span className="text-sm font-medium">提交历史</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {history.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                暂无提交记录
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {history.map((commit, index) => (
                  <li key={commit.sha + index} className="px-3 py-2 hover:bg-muted/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-muted-foreground">{commit.sha}</span>
                      <span className="text-xs text-muted-foreground">
                        {commit.date.toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm truncate mt-0.5" title={commit.message}>
                      {commit.message}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {commit.author}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default SyncStatus
