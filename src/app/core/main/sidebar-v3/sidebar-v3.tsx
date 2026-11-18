'use client'

// Fork（almanac ALMNC-20）：v5 側欄，方案 B「導覽＋檔案樹」。left-sidebar.tsx 在 v3 時直接回傳這個元件。
// 由上而下：品牌、搜尋（⌘K）、六個導覽、可收合的代理人區、可收合的 MyVault 檔案樹、規則。
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { CalendarCheck, CalendarDays, ChevronDown, Download, ListChecks, Library, MessagesSquare, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { listAgentSettings } from '@/db/agents'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useAnywhereStore } from '@/lib/anywhere/store'
import { useDecisions } from '@/lib/decide/use-decisions'
import { usePageVisibility } from '@/lib/fork-overlays/use-page-visibility'
import { useInboxPendingCount } from '@/lib/inbox/use-inbox-pending'
import { useKnowledgeOverlay } from '@/lib/sidebar-v3/knowledge'
import { useSidebarCollapse, type SidebarSection } from '@/lib/sidebar-v3/collapse'
import { buildAgentRows, buildNav, runningAgentCount, type AgentRow, type NavKey } from '@/lib/sidebar-v3/nav'
import type { AgentSettings } from '@/lib/agents/settings'
import { useWeekOverlay } from '@/lib/week/overlay'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import useHomeStore from '@/stores/home'
import { useSettingsDialogStore } from '@/stores/settings-dialog'
import useSettingStore from '@/stores/setting'
import useThreadsStore from '@/stores/threads'
import { FileSidebar } from '../file'
import { FileActions } from '../file/file-actions'
import { SIDEBAR_ROW, SIDEBAR_ROW_ACTIVE } from '../sidebar-row'

const ICONS: Record<NavKey, ComponentType<{ className?: string }>> = {
  today: CalendarCheck,
  decide: ListChecks,
  collect: Download,
  threads: MessagesSquare,
  knowledge: Library,
  plan: CalendarDays,
}

const OPEN: Record<NavKey, () => void> = {
  today: () => useHomeStore.getState().show(),
  decide: () => useDecideStore.getState().show(),
  collect: () => useCollectStore.getState().show(),
  threads: () => useThreadsStore.getState().show(),
  knowledge: () => useKnowledgeOverlay.getState().show(),
  plan: () => useWeekOverlay.getState().show(),
}

const ROW = 'flex h-7 w-full items-center gap-2 px-2 text-left text-[13px] text-muted-ink'
const LABEL = 'flex h-6 w-full items-center gap-1.5 px-2 text-[11px] font-semibold tracking-[0.08em] text-faint'

function useAgentRows(): AgentRow[] {
  const [agents, setAgents] = useState<AgentSettings[]>([])
  const tasks = useAgentTaskStore(state => state.tasks)
  const settingsOpen = useSettingsDialogStore(state => state.open)

  // 設定裡新增或改名代理人後（設定視窗關閉）重讀一次；瀏覽器預覽沒有資料庫時維持空清單。
  useEffect(() => {
    if (settingsOpen) return
    // 開發預覽用（不進 production）：瀏覽器沒有 Tauri 資料庫，截圖時從頁面塞 window.__almanacAgentsDemo = AgentSettings[]
    let active = true
    listAgentSettings().then(rows => { if (active) setAgents(rows) }).catch(() => undefined)
    return () => { active = false }
  }, [settingsOpen])

  // 開發預覽用（不進 production）：瀏覽器沒有 Tauri 資料庫，截圖時從頁面塞 window.__almanacAgentsDemo = AgentSettings[]
  const demo = process.env.NODE_ENV !== 'production'
    ? (window as unknown as { __almanacAgentsDemo?: AgentSettings[] }).__almanacAgentsDemo : undefined
  return useMemo(() => buildAgentRows(demo ?? agents, tasks), [demo, agents, tasks])
}

function openAgentSettings() {
  useSettingsDialogStore.getState().openSettings('general')
}

/** 可收合的區塊標題；收合狀態存在 store.json。 */
function SectionHeader({ section, collapsed, title, aside, actions }: {
  section: SidebarSection
  collapsed: boolean
  title: string
  aside?: ReactNode
  actions?: ReactNode
}) {
  const toggle = useSidebarCollapse(state => state.toggle)
  return (
    <div className="group/section relative flex items-center">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => void toggle(section)}
        className={cn(LABEL, 'min-w-0 flex-1 rounded-md outline-none hover:text-ink focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ink/60')}
      >
        <ChevronDown className={cn('size-3 shrink-0 transition-transform duration-100', collapsed && '-rotate-90')} aria-hidden />
        <span className="truncate">{title}</span>
        {aside}
      </button>
      {actions && (
        <div className="absolute inset-y-0 right-1 flex items-center bg-panel pl-1 opacity-0 transition-opacity duration-100 group-hover/section:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  )
}

function AgentSection() {
  const t = useTranslations('sidebarV3')
  const tRoles = useTranslations('agents.roles')
  const collapsed = useSidebarCollapse(state => state.agents)
  const rows = useAgentRows()
  const running = runningAgentCount(rows)
  return (
    <section aria-label={t('agents.title')} className="shrink-0">
      <SectionHeader
        section="agents"
        collapsed={collapsed}
        title={t('agents.title')}
        aside={collapsed && running > 0
          ? <span className="ml-auto font-normal tracking-normal text-muted-ink">{t('agents.running', { count: running })}</span>
          : undefined}
        actions={!collapsed && (
          <button type="button" title={t('agents.add')} aria-label={t('agents.add')} onClick={openAgentSettings} className="grid size-5 cursor-pointer place-items-center rounded text-faint outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ink/60">
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
      />
      {!collapsed && (
        <ul className="flex flex-col gap-px">
          {rows.map(row => (
            <li key={row.id}>
              <button type="button" onClick={openAgentSettings} className={cn(ROW, SIDEBAR_ROW, 'group/row')}>
                <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full bg-faint', row.running && 'bg-ink')} />
                <span className={cn('min-w-0 truncate', !row.enabled && 'opacity-60')}>{row.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-faint group-hover/row:hidden">{tRoles(row.role)}</span>
                <MoreHorizontal className="ml-auto hidden size-3.5 shrink-0 text-faint group-hover/row:inline-flex" aria-hidden />
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={openAgentSettings} className={cn(ROW, SIDEBAR_ROW)}>
              <Plus className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{rows.length === 0 ? t('agents.addFirst') : t('agents.add')}</span>
            </button>
          </li>
        </ul>
      )}
    </section>
  )
}

function VaultSection() {
  const t = useTranslations('sidebarV3')
  const collapsed = useSidebarCollapse(state => state.vault)
  return (
    <section aria-label={t('vault')} className={cn('flex min-h-0 flex-col', collapsed ? 'shrink-0' : 'flex-1')}>
      <SectionHeader section="vault" collapsed={collapsed} title={t('vault')} actions={!collapsed && <FileActions />} />
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-hidden [&_#article-sidebar]:bg-transparent">
          <FileSidebar />
        </div>
      )}
    </section>
  )
}

export function SidebarV3() {
  const t = useTranslations('sidebarV3')
  const load = useSidebarCollapse(state => state.load)
  const decideCount = useDecisions().length
  const collectPending = useInboxPendingCount()
  const visibility = usePageVisibility()
  const nav = buildNav({ decideCount, collectPending, visibility })

  useEffect(() => { void load() }, [load])
  // 開發預覽用（不進 production）：截圖時從頁面塞示範檔案樹，window.__almanacSidebar.article.setState({ fileTree })
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') (window as unknown as Record<string, unknown>).__almanacSidebar = { article: useArticleStore, setting: useSettingStore }
  }, [])

  return (
    <div className="flex h-full w-full flex-col gap-3 border-r border-line-soft bg-panel px-2 py-3" data-left-sidebar data-sidebar-v3>
      <div className="flex shrink-0 items-baseline gap-2 px-2 py-1">
        <b className="text-sm font-[620] tracking-[-0.01em]">NoteGen</b>
        <span className="font-mono text-[10.5px] text-faint">v3</span>
      </div>
      <button
        type="button"
        onClick={() => useAnywhereStore.getState().setPaletteOpen(true)}
        className="mx-0.5 flex h-[30px] shrink-0 cursor-pointer items-center gap-2 rounded-md border border-line-soft bg-bg pr-1.5 pl-2 text-left text-[12.5px] text-faint outline-none hover:border-line focus-visible:ring-1 focus-visible:ring-ink/60"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">{t('search')}</span>
        <kbd className="inline-flex h-[18px] items-center rounded bg-sunken px-[5px] font-mono text-[10.5px] text-muted-ink">⌘K</kbd>
      </button>
      <nav aria-label={t('navLabel')} className="flex shrink-0 flex-col gap-px">
        {nav.map(row => {
          const Icon = ICONS[row.key]
          return (
            <button
              key={row.key}
              type="button"
              onClick={OPEN[row.key]}
              aria-current={row.active ? 'page' : undefined}
              className={cn(ROW, SIDEBAR_ROW, row.active && SIDEBAR_ROW_ACTIVE)}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t(`nav.${row.key}`)}</span>
              {row.count > 0 && (
                <span className="font-mono text-[10.5px] font-normal text-faint" aria-label={t('count', { count: row.count })}>{row.count > 99 ? '99+' : row.count}</span>
              )}
            </button>
          )
        })}
      </nav>
      <AgentSection />
      <div className="mx-2 h-px shrink-0 bg-line-soft" role="separator" />
      <VaultSection />
      <div className="mt-auto shrink-0 border-t border-line-soft px-2 pt-2.5 pb-0.5 text-xs leading-[18px] text-muted-ink">
        <div className="pb-1 text-[11px] font-semibold tracking-[0.08em] text-faint">{t('rules.label')}</div>
        {t('rules.text')}
      </div>
    </div>
  )
}
