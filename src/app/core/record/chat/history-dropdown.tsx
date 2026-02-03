'use client'

import { useState, useMemo } from 'react'
import { ChevronDown, Search, Trash2 } from 'lucide-react'
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
  excludeConversationIds?: number[]
  onSwitch: (id: number) => void
  onDelete: (id: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function HistoryDropdown({
  conversations,
  currentConversationId,
  excludeConversationIds = [],
  onSwitch,
  onDelete,
  open,
  onOpenChange
}: HistoryDropdownProps) {
  const t = useTranslations('record.chat.empty')
  const [searchQuery, setSearchQuery] = useState('')

  // 过滤并排序会话（排除当前会话、已显示会话和空会话）
  const filteredConversations = useMemo(() => {
    return conversations
      .filter(c => c.id !== currentConversationId && !excludeConversationIds.includes(c.id) && c.messageCount > 0)
      .filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        // 置顶的排在前面
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        // 然后按更新时间排序
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, currentConversationId, excludeConversationIds, searchQuery])

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="px-1 hover:bg-transparent cursor-pointer justify-start"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">{t('viewMore')}</span>
            <span className="text-xs text-muted-foreground">
              ({filteredConversations.length})
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
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
                      <span className="text-sm truncate group-hover:text-primary transition-colors">
                        {conv.title}
                      </span>
                    </div>
                    <div className="shrink-0 ml-auto flex items-center gap-2">
                      {/* 删除按钮 - 悬停时显示 */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(conv.id)
                        }}
                        className="flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out hover:text-destructive hover:bg-destructive/10 active:scale-95"
                        title={t('deleteConversation')}
                      >
                        <Trash2 className="w-3.5 h-3.5 transition-transform duration-150 group-hover/button:scale-110" />
                      </button>
                    </div>
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
