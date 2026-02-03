'use client'

import { useTranslations } from 'next-intl'
import useChatStore from '@/stores/chat'
import { useMemo, useState } from 'react'
import { Settings, MessageSquare, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { isMobileDevice } from '@/lib/check'
import { HistoryDropdown } from './history-dropdown'

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

export default function ChatEmpty() {
  const t = useTranslations('record.chat.empty')
  const router = useRouter()
  const isMobile = isMobileDevice()

  const {
    conversations,
    currentConversationId,
    switchConversation,
    deleteConversation
  } = useChatStore()

  const [showHistoryDropdown, setShowHistoryDropdown] = useState(false)

  // 获取最近 3 条会话（排除当前会话）
  const recentConversations = useMemo(() => {
    return conversations
      .filter(c => c.id !== currentConversationId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
  }, [conversations, currentConversationId])

  // 是否有更多历史记录
  const hasMore = conversations.filter(c => c.id !== currentConversationId).length > 3

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
          <h2 className="text-xl font-semibold tracking-tight">
            {t('title')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t('subtitle')}
          </p>
        </div>

        {/* Recent Conversations */}
        {recentConversations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground px-1">{t('recentConversations')}</p>

            {recentConversations.map(conv => (
              <div
                key={conv.id}
                className="w-full px-4 py-3 rounded-lg border bg-background hover:border-primary/50 transition-colors text-left group"
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-2 flex-1 min-w-0"
                    onClick={() => handleSwitchConversation(conv.id)}
                  >
                    <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium truncate group-hover:text-primary transition-colors cursor-pointer">
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
                        handleDelete(conv.id)
                      }}
                      className="hidden group-hover:flex items-center justify-center w-6 h-6 rounded hover:bg-destructive/10 hover:text-destructive transition-colors"
                      title={t('deleteConversation')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {conv.messageCount > 0 && (
                  <div className="text-xs text-muted-foreground mt-0.5 ml-6">
                    {conv.messageCount} {t('messages')}
                  </div>
                )}
              </div>
            ))}

            {hasMore && (
              <HistoryDropdown
                conversations={conversations}
                currentConversationId={currentConversationId}
                onSwitch={handleSwitchConversation}
                onDelete={handleDelete}
                open={showHistoryDropdown}
                onOpenChange={setShowHistoryDropdown}
              />
            )}
          </div>
        )}

        {/* Settings Link */}
        <div className='flex w-full justify-center items-center'>
          <button
            onClick={() => {
              const settingPath = isMobile ? '/mobile/setting/pages/ai' : '/core/setting/ai'
              router.push(settingPath)
            }}
            className="flex items-center justify-center gap-2 rounded-lg text-muted-foreground hover:text-foreground transition-colors text-xs cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
            {t('configureModel')}
          </button>
        </div>
      </div>
    </div>
  )
}
