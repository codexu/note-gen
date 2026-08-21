"use client"

import { useState, useMemo } from 'react'
import { MessageSquareDashed, MessageSquarePlus, ChevronDown, Search, Trash2 } from "lucide-react"
import { TooltipButton } from "@/components/tooltip-button"
import useChatStore from "@/stores/chat"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import 'dayjs/locale/de'
import useSettingStore from '@/stores/setting'

dayjs.extend(relativeTime)

function formatRelativeTime(timestamp: number, locale: string): string {
  let dayjsLocale = 'en'
  if (locale === '简体中文' || locale === 'zh') dayjsLocale = 'zh-cn'
  else if (locale === '日本語' || locale === 'ja') dayjsLocale = 'ja'
  else if (locale === 'Português' || locale === 'pt-BR') dayjsLocale = 'pt-br'
  else if (locale === 'Deutsch' || locale === 'de') dayjsLocale = 'de'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export function ChatHeader() {
  const {
    startNewConversation,
    startTemporaryConversation,
    conversations,
    currentConversationId,
    isTemporaryConversation,
    switchConversation,
    deleteConversation,
    chats,
    loading,
  } = useChatStore()
  const { language } = useSettingStore()
  const t = useTranslations()
  const tEmpty = useTranslations('record.chat.empty')

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 没有消息或正在加载时禁用新对话按钮
  const hasCurrentMessages = isTemporaryConversation
    ? chats.length > 0
    : conversations.some(c => c.id === currentConversationId && c.messageCount > 0)
  const isDisabled = (!hasCurrentMessages && !isTemporaryConversation) || loading

  // 过滤并排序会话（排除空会话）
  const filteredConversations = useMemo(() => {
    return conversations
      .filter(c => c.messageCount > 0)
      .filter(c => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.updatedAt - a.updatedAt
      })
  }, [conversations, searchQuery])

  // 当前会话标题（如果有消息的话）
  const currentConversation = conversations.find(c => c.id === currentConversationId)
  const dropdownTitle = currentConversation && currentConversation.messageCount > 0
    ? currentConversation.title
    : tEmpty('conversationHistory')

  return (
    <header className="h-12 w-full flex items-center justify-between border-b px-4 gap-2">
      {/* 左侧：历史对话下拉 */}
      <div className="flex items-center gap-2">
        {isTemporaryConversation ? (
          <div className="flex items-center gap-2 px-2 text-sm font-medium text-muted-foreground">
            <MessageSquareDashed className="size-4" />
            <span>{t('record.chat.input.temporaryChat')}</span>
          </div>
        ) : (
          <DropdownMenu open={showHistoryDropdown} onOpenChange={setShowHistoryDropdown}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="px-2 hover:bg-transparent cursor-pointer justify-start gap-1.5"
              >
                <span className="text-sm font-medium truncate max-w-30">{dropdownTitle}</span>
                <span className="text-xs text-muted-foreground">
                  ({filteredConversations.length})
                </span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-75 max-h-100 overflow-y-auto"
            >
              <div className="px-2 py-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={tEmpty('searchPlaceholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              {filteredConversations.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  {searchQuery ? tEmpty('noMatchingConversations') : tEmpty('noConversationHistory')}
                </div>
              ) : (
                <div className="max-h-75 overflow-y-auto">
                  {filteredConversations.map(conv => (
                    <DropdownMenuItem
                      key={conv.id}
                      className="cursor-pointer group"
                    >
                      <div
                        className="flex-1 min-w-0"
                        onClick={() => switchConversation(conv.id)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm truncate group-hover:text-primary transition-colors">
                              {conv.title}
                            </span>
                          </div>
                          <div className="shrink-0 ml-auto flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(conv.updatedAt, language)}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                deleteConversation(conv.id)
                              }}
                              className="flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 transition-all duration-200 ease-out hover:text-destructive hover:bg-destructive/10 active:scale-95"
                              title={tEmpty('deleteConversation')}
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
        )}
      </div>

      {/* 右侧：临时会话与新建对话 */}
      <div className="flex items-center gap-1">
        <TooltipButton
          icon={<MessageSquareDashed />}
          tooltipText={t('record.chat.input.temporaryChat')}
          side="bottom"
          onClick={startTemporaryConversation}
          disabled={loading || isTemporaryConversation}
          variant={isTemporaryConversation ? 'secondary' : 'ghost'}
        />
        <TooltipButton
          icon={<MessageSquarePlus />}
          tooltipText={t('record.chat.input.newChat')}
          side="bottom"
          onClick={() => startNewConversation()}
          disabled={isDisabled}
        />
      </div>
    </header>
  )
}
