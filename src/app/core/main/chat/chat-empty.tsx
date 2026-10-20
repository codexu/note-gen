'use client'

import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { useMemo } from 'react'
import { Trash2, FileEdit, FileText, Lightbulb, ArrowRight, MessageCircle, MessageSquareDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import emitter from '@/lib/emitter'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/en'
import 'dayjs/locale/ja'
import 'dayjs/locale/pt-br'
import 'dayjs/locale/de'
import useSettingStore from '@/stores/setting'

// 初始化 dayjs 插件
dayjs.extend(relativeTime)

// 格式化相对时间
function formatRelativeTime(timestamp: number, locale: string): string {
  let dayjsLocale = 'en'
  if (locale === '简体中文' || locale === 'zh') dayjsLocale = 'zh-cn'
  else if (locale === '日本語' || locale === 'ja') dayjsLocale = 'ja'
  else if (locale === 'Português' || locale === 'pt-BR') dayjsLocale = 'pt-br'
  else if (locale === 'Deutsch' || locale === 'de') dayjsLocale = 'de'
  return dayjs(timestamp).locale(dayjsLocale).fromNow()
}

export default function ChatEmpty() {
  const t = useTranslations('record.chat.empty')
  const { language } = useSettingStore()

  const {
    conversations,
    currentConversationId,
    switchConversation,
    deleteConversation,
    isTemporaryConversation,
  } = useChatStore()

  // 快速 prompt 模板 - 默认模板
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

  const handleSwitchConversation = async (id: number) => {
    await switchConversation(id)
  }

  const handleDelete = async (id: number) => {
    await deleteConversation(id)
  }

  if (isTemporaryConversation) {
    return (
      <Empty className="h-full rounded-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareDashed />
          </EmptyMedia>
          <EmptyTitle>{t('temporary.title')}</EmptyTitle>
          <EmptyDescription>{t('temporary.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden">
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

      <div className="relative max-w-[340px] w-full px-2 space-y-6">
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
            <button
              type="button"
              key={prompt.id}
              onClick={() => handleQuickPrompt(prompt.text)}
              className="group flex h-11 w-full cursor-pointer items-center rounded-lg border bg-primary-foreground px-4 text-left transition-colors hover:border-primary/50"
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-muted-foreground">{prompt.icon}</span>
                  <span className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                    {prompt.text}
                  </span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100" />
              </div>
            </button>
          ))}
        </div>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground px-1">{t('recentConversations')}</p>
            {recentConversations.map(conv => (
              <div
                key={conv.id}
                className="group flex min-h-11 w-full items-stretch rounded-lg px-1 text-left transition-colors md:min-h-5"
              >
                <button
                  type="button"
                  className="flex min-h-11 min-w-0 flex-1 items-center text-left md:min-h-5"
                  onClick={() => void handleSwitchConversation(conv.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs font-medium truncate group-hover:text-primary transition-colors pr-14">
                      {conv.title}
                    </span>
                  </div>
                </button>
                <div className="relative ml-auto flex shrink-0 items-center justify-end">
                    {/* 时间戳 - 悬停时隐藏 */}
                    <span className="absolute right-0 hidden whitespace-nowrap text-xs text-muted-foreground opacity-100 transition-opacity duration-200 ease-out md:inline md:group-hover:opacity-0">
                      {formatRelativeTime(conv.updatedAt, language)}
                    </span>
                    {/* 删除按钮 - 悬停时显示 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(conv.id)
                      }}
                      className="z-50 size-8 opacity-100 transition-all duration-200 ease-out hover:text-destructive md:size-6 md:opacity-0 md:group-hover:opacity-100"
                      aria-label={t('deleteConversation')}
                      title={t('deleteConversation')}
                    >
                      <Trash2 className="w-3 h-3 transition-transform duration-150 group-hover/button:scale-110" />
                    </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
