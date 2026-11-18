'use client'

// Fork（almanac ALMNC-20）：整合進同一個導覽項的頁面之間的分頁切換（收集｜Inbox、知識底下的各頁）。
// 各頁仍是原本的全頁覆蓋層；切換只是開另一頁（互斥由 linkExclusiveOverlays 處理）。只在 v3 顯示。
import { useTranslations } from 'next-intl'
import { useUiV3 } from '@/lib/fork-ui'
import { useInboxPendingCount } from '@/lib/inbox/use-inbox-pending'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useInboxStore from '@/stores/inbox'
import usePromptLibraryStore from '@/stores/prompt-library'
import type { CollectTab } from '@/lib/sidebar-v3/nav'
import { useKnowledgeTabs } from './use-knowledge-tabs'

const TAB = 'inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-muted-ink outline-none transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ring/65'
const TAB_ACTIVE = 'bg-active font-[560] text-ink'

interface TabItem<K extends string> {
  key: K
  label: string
  badge?: number
  onSelect: () => void
}

function Tabs<K extends string>({ label, items, active }: { label: string, items: TabItem<K>[], active: K }) {
  return (
    <div role="tablist" aria-label={label} className="flex items-center gap-0.5">
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === active}
          onClick={item.key === active ? undefined : item.onSelect}
          className={cn(TAB, item.key === active && TAB_ACTIVE)}
        >
          {item.label}
          {item.badge ? <span className="font-mono text-[10.5px] font-normal text-faint">{item.badge}</span> : null}
        </button>
      ))}
    </div>
  )
}

/** 收集頁頁首：收集｜Inbox。 */
export function CollectTabs({ active }: { active: CollectTab }) {
  const t = useTranslations('sidebarV3.tabs')
  const isV3 = useUiV3()
  const inboxCount = useInboxPendingCount()
  if (!isV3) return null
  return (
    <Tabs
      label={t('collectGroup')}
      active={active}
      items={[
        { key: 'collect', label: t('collect'), onSelect: () => useCollectStore.getState().show() },
        { key: 'inbox', label: 'Inbox', badge: inboxCount, onSelect: () => useInboxStore.getState().show() },
      ]}
    />
  )
}

const BUILT_IN_LABELS: Record<string, string> = { timeline: 'Timeline', canvases: 'Canvas', noteTags: 'Tags', prompts: 'Prompts', outline: 'Outline' }

/** 知識頁頁首：時間線｜畫布｜標籤｜提示詞，加上大綱與外掛視圖。提示詞庫是自己的頁，切過去仍留在同一組分頁。 */
export function KnowledgeTabs({ active }: { active: string }) {
  const t = useTranslations('sidebarV3.tabs')
  const isV3 = useUiV3()
  const tabs = useKnowledgeTabs()
  if (!isV3) return null
  const show = useKnowledgeOverlay.getState().show
  return (
    <Tabs
      label={t('knowledgeGroup')}
      active={active}
      items={tabs.map(tab => ({
        key: tab.id,
        label: tab.title ?? BUILT_IN_LABELS[tab.id] ?? tab.id,
        onSelect: tab.id === 'prompts' ? () => usePromptLibraryStore.getState().show() : () => show(tab.id),
      }))}
    />
  )
}
