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
import { useI18n } from '@/hooks/useI18n'
import { useSyncConfirmStore } from '@/stores/sync-confirm'
import { hasNetworkConnection, getLocalFileMetadata } from '@/lib/sync/auto-sync'
import useArticleStore from '@/stores/article'
import { useTranslations } from 'next-intl'
import emitter from '@/lib/emitter'
import { useIsMobile } from '@/hooks/use-mobile'

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
let latestCommitInfo: {
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
  const t = useTranslations('article.footer.pull')
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate | null>(null)
  const [ignoredCommits, setIgnoredCommits] = useState<Set<string>>(new Set())
  const isMobile = useIsMobile()

  // 初始化 dayjs 插件
  dayjs.extend(relativeTime)

  // 文件切换时重置状态
  useEffect(() => {
    // 重置所有状态
    setPendingUpdate(null)
    setIgnoredCommits(new Set())
    setIsPulling(false)
    
    // 清空全局 commit 信息
    latestCommitInfo = null
  }, [activeFilePath])

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

    // 监听立即拉取事件
    const handleImmediatePull = async (event: any) => {
      const { filePath, isRemoteFile } = event as {
        filePath: string
        isRemoteFile: boolean
      }
      
      if (filePath === activeFilePath && isRemoteFile) {
        console.log('Immediate pull triggered for remote file:', filePath)
        
        try {
          // 使用 autoSyncIfNeeded 来执行同步
          const { autoSyncIfNeeded } = await import('@/lib/sync/auto-sync')
          const result = await autoSyncIfNeeded(filePath, {
            autoPull: true,
            showConfirm: false,
            enableConflictResolution: true
          })
          
          if (result) {
            // 更新编辑器内容
            const { setCurrentArticle, loadFileTree } = useArticleStore.getState()
            setCurrentArticle(result)
            
            // 刷新文件树以更新图标状态
            await loadFileTree()
            
            // 重置所有状态
            setIsPulling(false)
            useArticleStore.getState().setLoading(false)
            
            // 简单的完成提示
            console.log('立即拉取完成')
          }
        } catch (error) {
          console.error('Immediate pull failed:', error)
          setIsPulling(false)
          useArticleStore.getState().setLoading(false)
        }
      }
    }

    emitter.on('latest-commit-info', handleCommitInfo)
    emitter.on('immediate-pull-needed', handleImmediatePull)
    
    return () => {
      emitter.off('latest-commit-info', handleCommitInfo)
      emitter.off('immediate-pull-needed', handleImmediatePull)
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
      // 直接使用历史记录的 commit 信息，避免重复请求
      const localMeta = await getLocalFileMetadata(activeFilePath)
      
      // 如果本地文件不存在，立即开始自动拉取
      if (!localMeta.localSha) {
        if (commitInfo.sha) {
          // 立即设置拉取状态，不显示 pendingUpdate
          setIsPulling(true)
          
          // 对于第一次加载的文件，直接拉取而不显示确认对话框
          const autoPullFirstTime = async () => {
            try {
              // 使用 autoSyncIfNeeded 来执行同步
              const { autoSyncIfNeeded } = await import('@/lib/sync/auto-sync')
              const result = await autoSyncIfNeeded(activeFilePath, {
                autoPull: true,
                showConfirm: false,
                enableConflictResolution: true
              })
              
              if (result) {
                // 更新编辑器内容
                const { setCurrentArticle, loadFileTree } = useArticleStore.getState()
                setCurrentArticle(result)
                
                // 刷新文件树以更新图标状态
                await loadFileTree()
                
                // 简单的完成提示
                console.log('首次加载，自动拉取完成')
              }
            } catch (error) {
              console.error('Auto pull failed:', error)
            } finally {
              setIsPulling(false)
            }
          }
          
          // 立即执行拉取，不延迟
          autoPullFirstTime()
          
          return
        }
        return
      }
      
      // 如果远程文件不存在
      if (!commitInfo.sha) {
        setPendingUpdate(null)
        return
      }
      
      // 比较 SHA
      if (localMeta.localSha === commitInfo.sha) {
        setPendingUpdate(null)
        return
      }
      
      // 比较修改时间
      const localTime = localMeta.lastModified || 0
      const remoteTime = commitInfo.date.getTime()
      
      if (remoteTime > localTime) {
        setPendingUpdate({
          fileName: activeFilePath,
          reason: '远程文件较新，需要拉取更新',
          commitInfo
        })
      } else {
        setPendingUpdate(null)
      }
    } catch (error) {
      console.warn('Failed to check for updates:', error)
    }
  }

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
            const { setCurrentArticle, loadFileTree } = useArticleStore.getState()
            setCurrentArticle(result)
            
            // 刷新文件树以更新图标状态
            await loadFileTree()
            
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
              <Download className="!size-3" />
              <span className="text-xs">{t('pull')}</span>
              {!isMobile && pendingUpdate.commitInfo && (
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
