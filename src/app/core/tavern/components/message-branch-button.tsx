'use client'

import { useState, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GitBranch, Plus, MessageSquare, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  createBranch,
  getMessageBranches,
  type BranchInfo,
} from '@/lib/tavern/bookmark-service'
import { useToast } from '@/hooks/use-toast'
import type { TavernMessage } from '@/db/tavern'

interface MessageBranchButtonProps {
  /** 当前聊天 ID */
  chatId: number
  /** 消息 ID */
  messageId: number
  /** 消息在数组中的索引 (mesId) */
  messageIndex: number
  /** 所有消息 */
  messages: TavernMessage[]
  /** 切换聊天回调 */
  onSwitchChat?: (chatId: number) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 紧凑模式 */
  compact?: boolean
}

/**
 * 消息分支按钮
 * 从指定消息创建对话分支
 */
export function MessageBranchButton({
  chatId,
  messageId,
  messageIndex,
  messages,
  onSwitchChat,
  disabled = false,
  compact = true,
}: MessageBranchButtonProps) {
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  // 加载此消息的分支列表
  const loadBranches = useCallback(async () => {
    if (!isOpen) return
    
    setLoading(true)
    try {
      const branchList = await getMessageBranches(messageId, messages)
      setBranches(branchList)
    } catch (error) {
      console.error('加载分支失败:', error)
    } finally {
      setLoading(false)
    }
  }, [messageId, messages, isOpen])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  // 创建分支
  const handleCreateBranch = useCallback(async () => {
    setCreating(true)
    try {
      const newChatId = await createBranch(chatId, messageIndex)
      toast({ title: '分支创建成功' })
      setIsOpen(false)
      
      // 切换到新分支
      onSwitchChat?.(newChatId)
    } catch (error) {
      console.error('创建分支失败:', error)
      toast({ title: '创建分支失败', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }, [chatId, messageIndex, onSwitchChat, toast])

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

  const hasBranches = branches.length > 0

  if (compact) {
    return (
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-6 w-6',
                  hasBranches && 'text-purple-600'
                )}
                disabled={disabled}
              >
                <GitBranch className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>创建分支{hasBranches ? ` (${branches.length})` : ''}</p>
          </TooltipContent>
        </Tooltip>

        <PopoverContent className="w-72 p-0" align="start">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4" />
                <span className="font-medium text-sm">消息分支</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1"
                onClick={handleCreateBranch}
                disabled={creating || disabled}
              >
                <Plus className="h-3 w-3" />
                新建
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              从此消息创建新的对话分支
            </p>
          </div>

          {hasBranches && (
            <ScrollArea className="max-h-[200px]">
              <div className="p-2 space-y-1">
                {branches.map((branch) => (
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
                ))}
              </div>
            </ScrollArea>
          )}

          {!hasBranches && !loading && (
            <div className="p-4 text-center text-muted-foreground text-sm">
              此消息暂无分支
            </div>
          )}
        </PopoverContent>
      </Popover>
    )
  }

  // 完整模式 - 直接显示创建按钮
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-7 gap-1',
        hasBranches && 'text-purple-600'
      )}
      onClick={handleCreateBranch}
      disabled={disabled || creating}
    >
      <GitBranch className="h-3 w-3" />
      <span>分支{hasBranches ? ` (${branches.length})` : ''}</span>
    </Button>
  )
}

export default MessageBranchButton
