'use client'

import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { useMemo, useState } from 'react'
import { MessageSquare, Trash2, FileEdit, FileText, Lightbulb, ArrowRight, MessageCircle } from 'lucide-react'
import { HistoryDropdown } from './history-dropdown'
import { Button } from '@/components/ui/button'
import emitter from '@/lib/emitter'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import useSettingStore from '@/stores/setting'

// 初始化 dayjs 插件
dayjs.extend(relativeTime)

// 格式化相对时间
function formatRelativeTime(timestamp: number, locale: string): string {
  const dayjsLocale = locale === 'en' ? 'en' : 'zh-cn'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export default function ChatEmpty() {
  const t = useTranslations('record.chat.empty')
  const { language } = useSettingStore()

  const {
    conversations,
    currentConversationId,
    switchConversation,
    deleteConversation
  } = useChatStore()

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false)

  // 快速 prompt 模板
  const quickPrompts = useMemo(() => [
    { id: 1, icon: <FileEdit className="w-4 h-4" />, text: t('quickPrompts.writeNote') || '帮我写一篇笔记' },
    { id: 2, icon: <FileText className="w-4 h-4" />, text: t('quickPrompts.summarize') || '帮我总结这段内容' },
    { id: 3, icon: <Lightbulb className="w-4 h-4" />, text: t('quickPrompts.brainstorm') || '帮我头脑风暴一些想法' },
  ], [t])

  const handleQuickPrompt = (prompt: string) => {
    // 将文本插入到输入框
    emitter.emit('quick-prompt-insert', prompt)
  }

  // 获取最近 3 条会话（排除当前会话和空会话）
  const recentConversations = useMemo(() => {
    return conversations
      .filter(c => c.id !== currentConversationId && c.messageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
  }, [conversations, currentConversationId])

  // 是否有更多历史记录（排除空会话）
  const hasMore = conversations.filter(c => c.id !== currentConversationId && c.messageCount > 0).length > 3

  const handleSwitchConversation = async (id: number) => {
    await switchConversation(id)
  }

  const handleDelete = async (id: number) => {
    await deleteConversation(id)
    // 关闭下拉框
    setShowHistoryDropdown(false)
  }

  return (
    <div className="relative w-full flex-1 flex flex-col items-center justify-center h-full p-8 overflow-hidden">
      {/* Dashed background pattern - only visible when empty */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(to right, currentColor 1px, transparent 1px),
            linear-gradient(to bottom, currentColor 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          backgroundPosition: 'center center'
        }}
      />

      {/* Gradient fade overlay on edges */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            linear-gradient(to right, var(--background) 0%, transparent 15%, transparent 85%, var(--background) 100%),
            linear-gradient(to bottom, var(--background) 0%, transparent 15%, transparent 85%, var(--background) 100%)
          `
        }}
      />

      <div className="relative max-w-[340px] w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2">
            <MessageCircle className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">
              {t('title')}
            </h2>
          </div>
          <p className="text-muted-foreground text-sm">
            {t('subtitle')}
          </p>
        </div>

        {/* Quick Prompts */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground px-1">{t('quickPrompts.title') || '快速开始'}</p>
          {quickPrompts.map((prompt) => (
            <div
              key={prompt.id}
              onClick={() => handleQuickPrompt(prompt.text)}
              className="w-full px-4 h-10 rounded-lg border hover:border-primary/50 transition-colors text-left group cursor-pointer flex items-center"
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-muted-foreground">{prompt.icon}</span>
                  <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {prompt.text}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
          ))}
        </div>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground px-1">{t('recentConversations')}</p>

            {recentConversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => handleSwitchConversation(conv.id)}
                className="w-full px-4 h-10 rounded-lg border hover:border-primary/50 transition-colors text-left group cursor-pointer flex items-center"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors pr-14">
                      {conv.title}
                    </span>
                  </div>
                  <div className="shrink-0 ml-auto flex items-center justify-end relative">
                    {/* 时间戳 - 悬停时隐藏 */}
                    <span className="absolute right-0 text-xs text-muted-foreground opacity-100 group-hover:opacity-0 transition-opacity duration-200 ease-out whitespace-nowrap">
                      {formatRelativeTime(conv.updatedAt, language)}
                    </span>
                    {/* 删除按钮 - 悬停时显示 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(conv.id)
                      }}
                      className="opacity-0 group-hover:opacity-100 z-50 transition-all duration-200 ease-out hover:text-destructive h-6 w-6"
                      title={t('deleteConversation')}
                    >
                      <Trash2 className="w-3 h-3 transition-transform duration-150 group-hover/button:scale-110" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {hasMore && (
              <HistoryDropdown
                conversations={conversations}
                currentConversationId={currentConversationId}
                excludeConversationIds={recentConversations.map(c => c.id)}
                onSwitch={handleSwitchConversation}
                onDelete={handleDelete}
                open={showHistoryDropdown}
                onOpenChange={setShowHistoryDropdown}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
