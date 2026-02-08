'use client'

import { History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getFileCommits as getGithubFileCommits } from '@/lib/sync/github'
import { getFileCommits as getGiteeFileCommits } from '@/lib/sync/gitee'
import { getFileCommits as getGitlabFileCommits } from '@/lib/sync/gitlab'
import { getFileCommits as getGiteaFileCommits } from '@/lib/sync/gitea'
import { toast } from '@/hooks/use-toast'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

interface CommitInfo {
  sha: string
  message: string
  author: string
  date: Date
}

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

export function HistorySheet() {
  const { activeFilePath } = useArticleStore()
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)

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

  // Load history
  const loadHistory = useCallback(async () => {
    if (!activeFilePath) return

    setIsLoading(true)
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
      toast({
        title: '加载失败',
        description: '无法加载提交历史',
        variant: 'destructive'
      })
    } finally {
      setIsLoading(false)
    }
  }, [activeFilePath, getProvider])

  // Load history when sheet opens
  useEffect(() => {
    if (isOpen && activeFilePath) {
      loadHistory()
    }
  }, [isOpen, activeFilePath, loadHistory])

  if (!activeFilePath) return null

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <button
          className={cn(
            'p-0.5 rounded transition-colors hover:bg-[hsl(var(--muted))]',
            isOpen && 'bg-[hsl(var(--muted))]'
          )}
          title="历史记录"
        >
          <History size={12} />
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[400px]">
        <SheetHeader>
          <SheetTitle>提交历史</SheetTitle>
        </SheetHeader>
        <div className="mt-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              加载中...
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              暂无提交记录
            </div>
          ) : (
            <ul className="space-y-3">
              {history.map((commit, index) => (
                <li
                  key={commit.sha + index}
                  className="p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-muted-foreground">
                      {commit.sha}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {commit.date.toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm truncate" title={commit.message}>
                    {commit.message}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {commit.author}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default HistorySheet
