'use client'

// Fork（#32）：Agent 任務卡。主欄顯示背景任務四組狀態與最近對話；
// 「需要你處理」放待審草稿、沒做完的任務，以及最近有新內容卻還沒摘要的對話。
import { useLocale, useTranslations } from 'next-intl'
import { useMemo } from 'react'
import { Bot, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { agentTaskCenter, useAgentTaskStore } from '@/lib/agent-tasks'
import { openConversationSummary } from '@/lib/conversation-summary'
import { conversationKey, summarizedConversations } from '@/lib/conversation-summary/model'
import type { Conversation } from '@/db/conversations'
import useVaultIndexStore from '@/stores/vault-index'
import type { AgentTaskStatus } from '@/lib/agent-tasks/types'
import { cn } from '@/lib/utils'
import { useUiV3 } from '@/lib/fork-ui'
import useChatStore from '@/stores/chat'
import useHomeStore from '@/stores/home'
import { useSidebarStore } from '@/stores/sidebar'
import type { NeedItem } from '../home-cards'
import { openTasks } from './needs-list'
import { EmptyState } from '../../page-ui'

const STATUS_TONE: Record<AgentTaskStatus, string> = {
  awaiting_review: 'text-ink',
  queued: 'text-ink',
  running: 'text-ink',
  interrupted: 'text-destructive',
  failed: 'text-destructive',
  completed: 'text-ink',
  cancelled: 'text-muted-foreground',
}

/** 對話識別 → 摘要最後修改時間（從索引裡 type: 對話摘要 的筆記讀）。 */
function useSummarized() {
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => summarizedConversations(notes.values()), [notes, revision])
}

/** 摘要比對話舊（之後又聊了）也算還沒摘要；留一分鐘緩衝給存檔時間差。 */
function needsSummary(conversation: Conversation, summarized: Map<string, number>) {
  const at = summarized.get(conversationKey(conversation))
  return at === undefined || at < conversation.updatedAt - 60_000
}

const RECENT_DAYS = 3
const MIN_MESSAGES = 4

export function useTaskNeeds(): NeedItem[] {
  const t = useTranslations('home.needs')
  const tasks = useAgentTaskStore(state => state.tasks)
  const conversations = useChatStore(state => state.conversations)
  const summarized = useSummarized()
  const isV3 = useUiV3()
  const out: NeedItem[] = []
  for (const task of tasks) {
    // 新介面：草稿已逐條列在「等你定」，整個任務的待審列不再重複
    if (task.status === 'awaiting_review') {
      if (isV3) continue
      const pending = task.drafts.filter(draft => draft.state === 'pending').length
      out.push({ key: `task:${task.id}`, label: t('review'), tone: 'primary', text: task.title, meta: t('drafts', { count: pending }), action: t('reviewAction'), onAction: () => openTasks(task.id) })
    } else if (task.status === 'interrupted' || task.status === 'failed') {
      out.push({ key: `task:${task.id}`, label: t('unfinished'), tone: 'destructive', text: task.title, meta: task.error, action: t('resume'), onAction: () => void agentTaskCenter.resume(task.id) })
    }
  }
  const since = Date.now() - RECENT_DAYS * 86_400_000
  for (const conversation of conversations) {
    if (conversation.updatedAt < since || conversation.messageCount < MIN_MESSAGES || !needsSummary(conversation, summarized)) continue
    out.push({
      key: `conversation:${conversation.id}`,
      label: t('unsummarized'),
      tone: 'muted',
      text: conversation.title,
      meta: t('messages', { count: conversation.messageCount }),
      action: t('summarize'),
      onAction: () => openConversationSummary(conversation.id),
    })
  }
  return out
}

function isToday(ms: number | undefined) {
  if (!ms) return false
  return new Date(ms).toDateString() === new Date().toDateString()
}

export function TasksSection() {
  const t = useTranslations('home.tasks')
  const locale = useLocale()
  const tStatus = useTranslations('agentTasks.status')
  const tasks = useAgentTaskStore(state => state.tasks)
  const conversations = useChatStore(state => state.conversations)
  const summarized = useSummarized()
  const hide = useHomeStore(state => state.hide)
  // 進行中＋今天完成的；等你回應與沒做完的已經在「需要你處理」
  const shown = tasks
    .filter(task => task.status === 'running' || task.status === 'queued' || ((task.status === 'completed' || task.status === 'cancelled') && isToday(task.finishedAt)))
    .slice(0, 6)
  const recent = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5)

  async function openConversation(id: number) {
    await useChatStore.getState().switchConversation(id)
    if (!useSidebarStore.getState().rightSidebarVisible) await useSidebarStore.getState().toggleRightSidebar()
    hide()
  }

  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="home-tasks">
      <header className="mb-2 flex items-center gap-2">
        <h2 id="home-tasks" className="text-[15px] font-semibold">{t('title')}</h2>
        <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => openTasks()}>{t('viewAll')}</Button>
      </header>
      {shown.length === 0
        ? <EmptyState compact icon={Bot} text={t('empty')} />
        : (
          <ul className="grid gap-0.5">
            {shown.map(task => (
              <li key={task.id} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-accent">
                <span className={cn('w-16 shrink-0 text-xs', STATUS_TONE[task.status])}>{tStatus(task.status)}</span>
                <button type="button" className="min-w-0 flex-1 truncate text-left" title={task.title} onClick={() => openTasks()}>{task.title}</button>
                {task.tokens > 0 && <span className="text-xs tabular-nums text-muted-foreground">{task.tokens.toLocaleString(locale)} tokens</span>}
                {(task.status === 'running' || task.status === 'queued') && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void agentTaskCenter.cancel(task.id)}>{t('cancel')}</Button>
                )}
              </li>
            ))}
          </ul>
        )}

      <h3 className="mt-3 mb-1 border-t pt-3 text-xs font-semibold text-muted-foreground">{t('conversations')}</h3>
      {recent.length === 0
        ? <EmptyState compact icon={MessageSquare} text={t('noConversations')} />
        : (
          <ul className="grid gap-0.5">
            {recent.map(conversation => (
              <li key={conversation.id} className="flex items-center gap-1">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent" onClick={() => void openConversation(conversation.id)}>
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={conversation.title}>{conversation.title}</span>
                  <span className="text-xs text-muted-foreground">{new Date(conversation.updatedAt).toLocaleDateString(locale)}</span>
                </button>
                {needsSummary(conversation, summarized)
                  ? <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" onClick={() => openConversationSummary(conversation.id)}>{t('summarize')}</Button>
                  : <span className="px-2 text-xs text-ink">{t('summarized')}</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

