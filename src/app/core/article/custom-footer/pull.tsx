'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Download } from 'lucide-react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import useArticleStore from '@/stores/article'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import { hasNetworkConnection } from '@/lib/sync/auto-sync'
import { compareFileVersions } from '@/lib/sync/auto-sync'
import { useI18n } from '@/hooks/useI18n'
import emitter from '@/lib/emitter'

interface PendingUpdate {
  fileName: string
  reason: string
  commitInfo?: {
    sha: string
    message: string
    author: string
    date: Date
    additions?: number
    deletions?: number
  }
}

// 全局存储最新的 commit 信息，避免重复获取
const latestCommitInfo: {
  sha: string
  message: string
  author: string
  date: Date
  additions?: number
  deletions?: number
} | null = null

export default function PullButton() {
  const { activeFilePath, setIsPulling } = useArticleStore()
  const { currentLocale } = useI18n()
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null)
  const [ignoredCommits, setIgnoredCommits] = useState<Set<string>>(new Set())

  // 初始化 dayjs 插件
  dayjs.extend(relativeTime)

  // 监听历史记录组件的 commit 信息
  useEffect(() => {
    const handleCommitInfo = (event: any) => {
      const commitInfo = event as {
        sha: string
        message: string
        author: string
        date: Date
        additions?: number
        deletions?: number
      }
      
      // 更新全局 commit 信息
      Object.assign(latestCommitInfo || {}, commitInfo)
      
      // 检查是否需要显示 Pull 按钮
      if (activeFilePath && !ignoredCommits.has(commitInfo.sha)) {
        // 检查是否有远程更新
        checkForUpdatesWithCommitInfo(commitInfo)
      }
    }

    emitter.on('latest-commit-info', handleCommitInfo)
    return () => {
      emitter.off('latest-commit-info', handleCommitInfo)
    }
  }, [activeFilePath, ignoredCommits])

  // 使用历史记录组件的 commit 信息检查更新
  const checkForUpdatesWithCommitInfo = async (commitInfo: {
    sha: string
    message: string
    author: string
    date: Date
    additions?: number
    deletions?: number
  }) => {
    if (!activeFilePath || !await hasNetworkConnection()) {
      return
    }

    try {
      const syncResult = await compareFileVersions(activeFilePath)
      
      if (syncResult.shouldUpdate && syncResult.action === 'pull') {
        setPendingUpdate({
          fileName: activeFilePath,
          reason: syncResult.reason || '',
          commitInfo
        })
      } else {
        setPendingUpdate(null)
      }
    } catch (error) {
      console.warn('Failed to check for updates:', error)
    }
  }

  // 定期检查更新（仅在没有 commit 信息时）
  useEffect(() => {
    if (!activeFilePath || latestCommitInfo) return

    const interval = setInterval(() => {
      if (!latestCommitInfo) {
        // 仅在没有 commit 信息时才检查更新
        console.log('No commit info available, checking updates...')
      }
    }, 30000)
    
    return () => clearInterval(interval)
  }, [activeFilePath, latestCommitInfo])

  const handlePull = () => {
    if (!pendingUpdate) return

    const { showConfirmDialog } = useSyncConfirmStore.getState()
    showConfirmDialog({
      fileName: pendingUpdate.fileName,
      commitInfo: pendingUpdate.commitInfo,
      onConfirm: async () => {
        try {
          setIsPulling(true)
          
          // 使用 autoSyncIfNeeded 来执行同步
          const { autoSyncIfNeeded } = await import('@/lib/sync/auto-sync')
          const result = await autoSyncIfNeeded(pendingUpdate.fileName, {
            autoPull: true,
            showConfirm: false,
            enableConflictResolution: true
          })
          
          if (result) {
            // 更新编辑器内容
            const { setCurrentArticle } = useArticleStore.getState()
            setCurrentArticle(result)
            
            setPendingUpdate(null)
            
            // 简单的完成提示
            console.log('拉取完成')
          }
        } catch (error) {
          console.error('Pull failed:', error)
        } finally {
          setIsPulling(false)
        }
      },
      onCancel: () => {
        // 取消时不做任何操作
      },
      onIgnore: () => {
        // 忽略此提交
        if (pendingUpdate.commitInfo) {
          const newIgnoredCommits = new Set(ignoredCommits)
          newIgnoredCommits.add(pendingUpdate.commitInfo.sha)
          setIgnoredCommits(newIgnoredCommits)
        }
        
        setPendingUpdate(null)
      }
    })
  }

  if (!activeFilePath) {
    return null
  }

  // 如果有待更新，显示拉取按钮
  if (pendingUpdate) {
    const getLocale = () => {
      // 根据当前语言设置 dayjs locale
      switch (currentLocale) {
        case 'zh': return 'zh-cn'
        case 'ja': return 'ja'
        case 'pt-BR': return 'pt-br'
        default: return 'en'
      }
    }

    const formatTime = (date: Date) => {
      return dayjs(date).locale(getLocale()).fromNow()
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handlePull}
              className="text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              <Download className="h-4 w-4" />
              <span className="ml-1 text-xs">拉取</span>
              {pendingUpdate.commitInfo && (
                <span className="ml-1 text-xs text-green-600">
                  ({formatTime(pendingUpdate.commitInfo.date)})
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1">
              <p>点击拉取远程更新</p>
              {pendingUpdate.commitInfo && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {pendingUpdate.commitInfo.message.slice(0, 60)}
                    {pendingUpdate.commitInfo.message.length > 60 ? '...' : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {pendingUpdate.commitInfo.author} • {formatTime(pendingUpdate.commitInfo.date)}
                  </p>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // 如果没有更新，不显示组件
  return null
}
