'use client'

import { ArrowUpCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Store } from '@tauri-apps/plugin-store'
import { compareFileVersions } from '@/lib/sync/auto-sync'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { toast } from '@/hooks/use-toast'

type SyncStatus = 'synced' | 'pull_needed' | 'push_needed' | 'unknown' | 'error'

export function SyncButton() {
  const { activeFilePath, currentArticle } = useArticleStore()
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('unknown')
  const [isLoading, setIsLoading] = useState(false)

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
      const content = currentArticle

      // Generate commit message using AI
      const commitMessage = await generateCommitMessage(content)

      let success = false

      switch (provider) {
        case 'github': {
          const githubModule = await import('@/lib/sync/github') as any
          const sha = await githubModule.getFileSha({ path: activeFilePath, repo })
          if (sha) {
            await githubModule.updateFile({ path: activeFilePath, repo, content, message: commitMessage, sha })
            success = true
          }
          break
        }
        case 'gitee': {
          const giteeModule = await import('@/lib/sync/gitee') as any
          const sha = await giteeModule.getFileSha({ path: activeFilePath, repo })
          if (sha) {
            await giteeModule.updateFile({ path: activeFilePath, repo, content, message: commitMessage, sha })
            success = true
          }
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
        description: '无法推送到远程仓库，文件可能不存在于远程',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, currentArticle, isLoading, checkSyncStatus, generateCommitMessage])

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
      {/* Status indicator / Sync button */}
      <button
        onClick={handlePush}
        disabled={isLoading || syncStatus !== 'push_needed'}
        className={cn(
          'flex items-center gap-0.5 px-1.5 rounded transition-colors',
          syncStatus === 'push_needed'
            ? 'hover:bg-blue-500/10 text-blue-500'
            : 'opacity-50 cursor-not-allowed'
        )}
        title={syncStatus === 'push_needed' ? '点击推送到远程' : getStatusText()}
      >
        <RefreshCw size={10} className={cn(isLoading && 'animate-spin', getStatusColor())} />
        <span className="text-[10px]">{getStatusText()}</span>
      </button>

      {/* Push arrow button */}
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
    </div>
  )
}

export default SyncButton
