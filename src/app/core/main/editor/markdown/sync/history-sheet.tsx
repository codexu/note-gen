'use client'

import { History, ExternalLink, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import { Editor } from '@tiptap/react'
import { Store } from '@tauri-apps/plugin-store'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { getFileCommits as getGithubFileCommits, getFiles as getGithubFiles, decodeBase64ToString } from '@/lib/sync/github'
import { getFileCommits as getGiteeFileCommits, getFiles as getGiteeFiles, decodeBase64ToString as decodeGiteeBase64 } from '@/lib/sync/gitee'
import { getFileCommits as getGitlabFileCommits, getFileContent as getGitlabFileContent } from '@/lib/sync/gitlab'
import { getFileCommits as getGiteaFileCommits, getFileContentFromCommit as getGiteaFileContentFromCommit, getGiteaApiBaseUrl } from '@/lib/sync/gitea'
import { saveLocalFile } from '@/lib/sync/auto-sync'
import { updateFileSyncTime, updateFileRestoreTime } from '@/lib/sync/conflict-resolution'
import { toast } from '@/hooks/use-toast'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface CommitInfo {
  sha: string
  fullSha?: string // 完整 SHA，用于恢复功能
  message: string
  author: string
  date: Date
  url: string
}

type SyncProvider = 'github' | 'gitee' | 'gitlab' | 'gitea'

interface HistorySheetProps {
  editor: Editor
}

export function HistorySheet({ editor }: HistorySheetProps) {
  const { activeFilePath } = useArticleStore()
  const [isOpen, setIsOpen] = useState(false)
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [restoringSha, setRestoringSha] = useState<string | null>(null)
  const [provider, setProvider] = useState<SyncProvider | null>(null)
  const [repoInfo, setRepoInfo] = useState<{ username?: string; projectId?: string; baseUrl?: string; repo?: string }>({})

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
          // GitLab 返回 { data } 对象，需要从中提取数组
          commits = (result && result.data) ? result.data : []
          break
        }
        case 'gitea': {
          const result = await getGiteaFileCommits({ path: activeFilePath, repo })
          // Gitea 返回 { data } 对象，需要从中提取数组
          commits = (result && result.data) ? result.data : []
          break
        }
      }

      const store = await Store.load('store.json')
      let githubUsername: string | undefined
      let giteeUsername: string | undefined
      let gitlabProjectId: string | undefined
      let giteaUsername: string | undefined
      let giteaBaseUrl: string | undefined

      switch (provider) {
        case 'github':
          githubUsername = await store.get('githubUsername')
          break
        case 'gitee':
          giteeUsername = await store.get('giteeUsername')
          break
        case 'gitlab':
          gitlabProjectId = await store.get<string>(`gitlab_${repo}_project_id`)
          break
        case 'gitea':
          giteaUsername = await store.get('giteaUsername')
          giteaBaseUrl = await getGiteaApiBaseUrl()
          break
      }

      const getCommitUrl = (sha: string): string => {
        switch (provider) {
          case 'github':
            return `https://github.com/${githubUsername}/${repo}/commit/${sha}`
          case 'gitee':
            return `https://gitee.com/${giteeUsername}/${repo}/commit/${sha}`
          case 'gitlab':
            return `https://gitlab.com/${gitlabProjectId?.split('/').pop()}/-/commit/${sha}`
          case 'gitea':
            return `${giteaBaseUrl?.replace('/api/v1', '')}/${giteaUsername}/${repo}/commit/${sha}`
          default:
            return ''
        }
      }

      const historyData = commits.slice(0, 10).map((commit: any) => {
        const sha = commit.sha || commit.id || ''
        return {
          sha: sha.slice(0, 7),
          fullSha: sha, // 保存完整 SHA，用于恢复功能
          message: commit.commit?.message || commit.message || 'No message',
          author: commit.commit?.author?.name || commit.author?.name || commit.author_name || 'Unknown',
          date: new Date(commit.commit?.author?.date || commit.created_at || commit.committed_date || Date.now()),
          url: getCommitUrl(sha)
        }
      })

      setHistory(historyData)
      setProvider(provider)
      setRepoInfo({
        username: provider === 'github' ? githubUsername : provider === 'gitee' ? giteeUsername : provider === 'gitea' ? giteaUsername : undefined,
        projectId: provider === 'gitlab' ? gitlabProjectId : undefined,
        baseUrl: provider === 'gitea' ? giteaBaseUrl : undefined,
        repo
      })
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

  // Restore file from specific commit
  const restoreVersion = useCallback(async (commitSha: string) => {
    if (!activeFilePath || restoringSha) return

    setRestoringSha(commitSha)
    try {
      const provider = await getProvider()
      if (!provider) return

      const repo = await getSyncRepoName(provider)
      let content = ''

      switch (provider) {
        case 'github': {
          const fileInfo = await getGithubFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            content = decodeBase64ToString(fileInfo.content)
          }
          break
        }
        case 'gitee': {
          const fileInfo = await getGiteeFiles({ path: activeFilePath, repo, ref: commitSha })
          if (fileInfo?.content) {
            // Gitee 也是 base64 编码
            content = decodeGiteeBase64(fileInfo.content)
          }
          break
        }
        case 'gitlab': {
          try {
            const fileInfo = await getGitlabFileContent({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo?.content) {
              // GitLab 返回的是 base64 编码内容，需要解码
              content = decodeBase64ToString(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] GitLab 获取内容失败:', e)
          }
          break
        }
        case 'gitea': {
          try {
            // 使用 getFileContentFromCommit 通过 Git tree API 获取特定 commit 的文件内容
            const fileInfo = await getGiteaFileContentFromCommit({ path: activeFilePath, ref: commitSha, repo })
            if (fileInfo && fileInfo.content) {
              // Gitea 返回的是 base64 编码内容，需要解码
              content = decodeGiteeBase64(fileInfo.content)
            }
          } catch (e) {
            console.error('[HistorySheet] Gitea 获取内容失败:', e)
          }
          break
        }
      }


      if (content) {
        // 保存到本地文件
        await saveLocalFile(activeFilePath, content)

        // 更新编辑器内容
        editor.commands.clearContent()
        editor.commands.setContent(content, { contentType: 'markdown' })

        // 更新同步时间和恢复时间
        await updateFileSyncTime(activeFilePath)
        await updateFileRestoreTime(activeFilePath)

        toast({
          title: '已恢复',
          description: '已从历史版本恢复文件'
        })

        setIsOpen(false)
      }
    } catch (error) {
      console.error('Failed to restore version:', error)
      toast({
        title: '恢复失败',
        description: '无法从历史版本恢复文件',
        variant: 'destructive'
      })
    } finally {
      setRestoringSha(null)
    }
  }, [activeFilePath, editor, getProvider, restoringSha])

  // Load history when sheet opens
  useEffect(() => {
    if (isOpen && activeFilePath) {
      loadHistory()
    }
  }, [isOpen, activeFilePath, loadHistory])

  if (!activeFilePath) return null

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            'p-0.5 rounded transition-colors hover:bg-[hsl(var(--muted))]',
            isOpen && 'bg-[hsl(var(--muted))]'
          )}
          title="历史记录"
        >
          <History size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-90 max-h-100 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold text-sm">提交历史</div>
          {activeFilePath && provider && repoInfo.repo && (
            <a
              href={(() => {
                switch (provider) {
                  case 'github': return `https://github.com/${repoInfo.username}/${repoInfo.repo}/blob/main/${activeFilePath}`
                  case 'gitee': return `https://gitee.com/${repoInfo.username}/${repoInfo.repo}/blob/master/${activeFilePath}`
                  case 'gitlab': return `https://gitlab.com/${repoInfo.projectId?.split('/').pop()}/-/blob/main/${activeFilePath}`
                  case 'gitea': return `${repoInfo.baseUrl?.replace('/api/v1', '')}/${repoInfo.username}/${repoInfo.repo}/src/branch/main/${activeFilePath}`
                  default: return '#'
                }
              })()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
              title="在仓库中打开"
            >
              <ExternalLink size={10} />
              <span className="truncate max-w-30">{activeFilePath.split('/').pop()}</span>
            </a>
          )}
        </div>
        <div className="flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              加载中...
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              暂无提交记录
            </div>
          ) : (
            <ul className="space-y-2">
              {history.map((commit, index) => (
                <li
                  key={commit.sha + index}
                  className="p-2 border rounded hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-1">
                    <a
                      href={commit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                    >
                      {commit.sha}
                      <ExternalLink size={10} />
                    </a>
                    <span className="text-xs text-muted-foreground">
                      {commit.date.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm truncate" title={commit.message}>
                    {commit.message}
                  </p>
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-xs text-muted-foreground">
                      {commit.author}
                    </p>
                    <button
                      onClick={() => restoreVersion(commit.fullSha || commit.sha)}
                      disabled={restoringSha === commit.sha}
                      className={cn(
                        'text-xs text-blue-500 hover:text-blue-600 inline-flex items-center gap-1',
                        restoringSha === commit.sha && 'opacity-50'
                      )}
                      title="恢复此版本"
                    >
                      <RotateCcw size={12} />
                      {restoringSha === commit.sha ? '恢复中...' : '恢复'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default HistorySheet
