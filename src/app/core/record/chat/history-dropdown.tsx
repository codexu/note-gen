'use client'

import { useState, useMemo } from 'react'
import { ChevronDown, Search, Pin, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Conversation } from '@/db/conversations'
import { useTranslations } from 'next-intl'

interface HistoryDropdownProps {
  conversations: Conversation[]
  currentConversationId: number | null
  onSwitch: (id: number) => void
  onDelete: (id: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

// 格式化相对时间
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`

  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function HistoryDropdown({
  conversations,
  currentConversationId,
  onSwitch,
  onDelete,
  open,
  onOpenChange
}: HistoryDropdownProps) {
  const t = useTranslations('record.chat.empty')
  const [searchQuery, setSearchQuery] = useState('')

  // 过滤并排序会话（排除当前会话）
  const filteredConversations = useMemo(() => {
    return conversations
      .filter(c => c.id !== currentConversationId)
      .filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        // 置顶的排在前面
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        // 然后按更新时间排序
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, currentConversationId, searchQuery])

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full px-4 py-3 rounded-lg border bg-background hover:border-primary/50 transition-colors justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('viewMore')}</span>
            <span className="text-xs text-muted-foreground">
              ({filteredConversations.length})
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-[340px] max-h-[400px] overflow-y-auto"
      >
        {/* 搜索框 */}
        <div className="px-2 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        <DropdownMenuSeparator />

        {/* 会话列表 */}
        {filteredConversations.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {searchQuery ? t('noMatchingConversations') : t('noConversationHistory')}
          </div>
        ) : (
          <div className="max-h-[300px] overflow-y-auto">
            {filteredConversations.map(conv => (
              <DropdownMenuItem
                key={conv.id}
                className="cursor-pointer group"
              >
                <div
                  className="flex-1 min-w-0"
                  onClick={() => onSwitch(conv.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {conv.isPinned && (
                        <Pin className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm truncate group-hover:text-primary transition-colors">
                        {conv.title}
                      </span>
                    </div>
                    <div className="shrink-0 ml-2 flex items-center">
                      {/* 时间戳 - 悬停时隐藏 */}
                      <span className="text-xs text-muted-foreground group-hover:hidden">
                        {formatRelativeTime(conv.updatedAt)}
                      </span>
                      {/* 删除按钮 - 悬停时显示 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(conv.id)
                        }}
                        className="hidden group-hover:flex items-center justify-center w-6 h-6 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                        title={t('deleteConversation')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {conv.messageCount > 0 && (
                    <div className="text-xs text-muted-foreground mt-0.5 ml-5">
                      {conv.messageCount} {t('messages')}
                    </div>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
