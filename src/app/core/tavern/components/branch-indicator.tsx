'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GitBranch, ArrowLeft, MessageSquare, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getBookmarkInfo,
  getBranchesOfMainChat,
  type BookmarkMetadata,
  type BranchInfo,
} from '@/lib/tavern/bookmark-service'
import { getChatById } from '@/db/tavern'

interface BranchIndicatorProps {
  chatId: number | null
  onSwitchChat?: (chatId: number) => void
  compact?: boolean
}

/**
 * 分支指示器
 * 显示当前聊天是否是分支，以及可以切换到的其他分支
 */
export function BranchIndicator({
  chatId,
  onSwitchChat,
  compact = false,
}: BranchIndicatorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [bookmarkInfo, setBookmarkInfo] = useState<BookmarkMetadata | null>(null)
  const [mainChatName, setMainChatName] = useState<string | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [mainChatId, setMainChatIdState] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  // 加载分支信息
  const loadBranchInfo = useCallback(async () => {
    if (!chatId) {
      setBookmarkInfo(null)
      setMainChatName(null)
      setBranches([])
      setMainChatIdState(null)
      return
    }

    setLoading(true)
    try {
      const info = await getBookmarkInfo(chatId)
      setBookmarkInfo(info)

      if (info?.main_chat) {
        // 当前是分支，获取主聊天信息
        const mainChat = await getChatById(info.main_chat)
        setMainChatName(mainChat?.name || '主聊天')
        setMainChatIdState(info.main_chat)

        // 获取所有分支
        const allBranches = await getBranchesOfMainChat(info.main_chat)
        // 过滤掉当前分支
        setBranches(allBranches.filter(b => b.chatId !== chatId))
      } else {
        // 当前是主聊天，获取分支列表
        setMainChatName(null)
        setMainChatIdState(chatId)
        const allBranches = await getBranchesOfMainChat(chatId)
        setBranches(allBranches)
      }
    } catch (error) {
      console.error('加载分支信息失败:', error)
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    loadBranchInfo()
  }, [loadBranchInfo])

  // 格式化时间
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // 如果没有分支信息且不是分支，不显示
  if (!bookmarkInfo && branches.length === 0) {
    return null
  }

  const isBranch = !!bookmarkInfo?.main_chat

  // 紧凑模式
  if (compact) {
    return (
      <TooltipProvider>
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'h-8 gap-1 text-xs',
                    isBranch ? 'text-purple-600' : 'text-blue-600'
                  )}
                >
                  <GitBranch className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {isBranch ? '分支' : `${branches.length} 分支`}
                  </span>
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                {isBranch
                  ? `分支: ${bookmarkInfo?.checkpoint_name}`
                  : `${branches.length} 个分支`}
              </p>
            </TooltipContent>
          </Tooltip>

          <PopoverContent className="w-80 p-0" align="end">
            <div className="p-3 border-b">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                <span className="font-medium">
                  {isBranch ? '分支聊天' : '聊天分支'}
                </span>
              </div>
              {isBranch && (
                <p className="text-xs text-muted-foreground mt-1">
                  当前: {bookmarkInfo?.checkpoint_name}
                </p>
              )}
            </div>

            <ScrollArea className="max-h-[300px]">
              <div className="p-2 space-y-1">
                {/* 返回主聊天 */}
                {isBranch && mainChatId && onSwitchChat && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2 h-auto py-2"
                    onClick={() => {
                      onSwitchChat(mainChatId)
                      setIsOpen(false)
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 text-blue-600" />
                    <div className="flex-1 text-left">
                      <div className="font-medium text-sm">{mainChatName}</div>
                      <div className="text-xs text-muted-foreground">
                        返回主聊天
                      </div>
                    </div>
                  </Button>
                )}

                {/* 分支列表 */}
                {branches.length > 0 ? (
                  branches.map((branch) => (
                    <Button
                      key={branch.chatId}
                      variant="ghost"
                      className="w-full justify-start gap-2 h-auto py-2"
                      onClick={() => {
                        onSwitchChat?.(branch.chatId)
                        setIsOpen(false)
                      }}
                    >
                      <GitBranch className="h-4 w-4 text-purple-600" />
                      <div className="flex-1 text-left min-w-0">
                        <div className="font-medium text-sm truncate">
                          {branch.name}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {branch.messageCount} 条
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatTime(branch.createdAt)}
                          </span>
                        </div>
                      </div>
                    </Button>
                  ))
                ) : (
                  <div className="text-center text-muted-foreground py-4 text-sm">
                    暂无其他分支
                  </div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </TooltipProvider>
    )
  }

  // 完整模式
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
      <GitBranch className={cn(
        'h-4 w-4',
        isBranch ? 'text-purple-600' : 'text-blue-600'
      )} />
      <div className="flex-1 min-w-0">
        {isBranch ? (
          <>
            <span className="text-sm font-medium">分支模式</span>
            <span className="text-xs text-muted-foreground ml-2">
              {bookmarkInfo?.checkpoint_name}
            </span>
          </>
        ) : (
          <span className="text-sm">
            {branches.length} 个分支
          </span>
        )}
      </div>
      {isBranch && mainChatId && onSwitchChat && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7"
          onClick={() => onSwitchChat(mainChatId)}
        >
          <ArrowLeft className="h-3 w-3 mr-1" />
          返回主聊天
        </Button>
      )}
    </div>
  )
}

export default BranchIndicator
