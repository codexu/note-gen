'use client'

// Fork（#35）：知識報告卡（主題掌握度膠囊、立即產生／建立基準、優化建議進「需要你處理」）、
// 知識庫健康卡，以及在背景註冊執行器與排程的 ReportService。規格 personal/specs/11 §2.1a、§3.4–§3.5。
import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/hooks/use-toast'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import {
  activeReportTask,
  checkSchedule,
  registerReportRunner,
  requestReport,
  settleHandedSuggestions,
  updateSuggestion,
  useKnowledgeReportStore,
} from '@/lib/knowledge-report'
import {
  DEFAULT_REPORT_SETTINGS,
  listReports,
  loadReportSettings,
  saveReportSettings,
  setReportTexts,
  type ReportSettings,
} from '@/lib/knowledge-report/generate'
import { LEVELS, type MasteryLevel, type MetricKey } from '@/lib/knowledge-report/mastery'
import { latestReport, openSuggestions, topicsByChange, type ReportData } from '@/lib/knowledge-report/report'
import { getExcludeFolders, setExcludeFolders } from '@/lib/knowledge-report/sources'
import { cn } from '@/lib/utils'
import useHomeStore from '@/stores/home'
import useVaultIndexStore from '@/stores/vault-index'
import { ModelSelect } from '@/app/core/setting/components/model-select'
import type { NeedItem } from '../home-cards'

const METRICS: MetricKey[] = ['notes', 'structure', 'internalLinks', 'ownRatio', 'ownViews', 'revisedNotes', 'crossLinks', 'applied', 'spanDays']
const SCHEDULE_INTERVAL_MS = 30 * 60_000

/** 最新一期報告（從索引的 frontmatter 讀）。 */
export function useLatestReport(): { path: string; report: ReportData } | null {
  const notes = useVaultIndexStore(state => state.notes)
  return useMemo(() => latestReport(listReports(notes.values())), [notes])
}

export const LEVEL_STYLE: Record<MasteryLevel, string> = {
  contact: 'bg-muted text-muted-foreground',
  organized: 'bg-secondary text-secondary-foreground',
  internalized: 'bg-hover text-ink font-medium',
  integrated: 'bg-active text-ink font-medium',
}

export function LevelBadge({ level, prev }: { level: MasteryLevel; prev?: MasteryLevel | null }) {
  const t = useTranslations('knowledgeReport.levels')
  const delta = prev ? LEVELS.indexOf(level) - LEVELS.indexOf(prev) : 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs', LEVEL_STYLE[level])}>
      {t(level)}
      {delta > 0 && <ArrowUp className="size-3" aria-label={t('up')} />}
      {delta < 0 && <ArrowDown className="size-3" aria-label={t('down')} />}
    </span>
  )
}

/** 在背景：註冊文字與執行器、定期檢查是否到期、任務完成後結清建議。由 HomeService 掛一次。 */
export function ReportService() {
  const t = useTranslations('knowledgeReport')
  const status = useVaultIndexStore(state => state.status)
  const tasks = useAgentTaskStore(state => state.tasks)

  useEffect(() => {
    setReportTexts({
      report: {
        title: t('note.title', { period: '{period}' }),
        levels: Object.fromEntries(LEVELS.map(level => [level, t(`levels.${level}`)])) as Record<MasteryLevel, string>,
        headings: { topics: t('note.topics'), suggestions: t('note.suggestions'), stats: t('note.stats') },
        previous: t('note.previous', { level: '{level}' }),
        firstTime: t('note.firstTime'),
        scoreLine: t('note.scoreLine', { score: '{score}', notes: '{notes}' }),
        gapLabel: t('note.gapLabel'),
        topLevel: t('note.topLevel'),
        noComment: t('note.noComment'),
        noSuggestions: t('note.noSuggestions'),
        stats: { notes: t('stats.notes'), unlinked: t('stats.unlinked'), orphans: t('stats.orphans'), inbox: t('stats.inbox') },
        footer: t('note.footer'),
      },
      metrics: Object.fromEntries(METRICS.map(metric => [metric, t(`metrics.${metric}`)])) as Record<MetricKey, string>,
      or: t('note.or'),
      points: t('note.points', { points: '{points}' }),
      language: t('language'),
    })
  }, [t])

  useEffect(() => registerReportRunner(), [])

  useEffect(() => {
    if (status !== 'ready') return
    const titleFor = (period: string) => t('taskTitle', { period })
    const tick = () => { void checkSchedule(titleFor).catch(error => console.warn('[knowledge-report] schedule check failed:', error)) }
    // 索引好了先等一下，讓啟動時的其他工作先跑
    const first = window.setTimeout(tick, 15_000)
    const timer = window.setInterval(tick, SCHEDULE_INTERVAL_MS)
    return () => { window.clearTimeout(first); window.clearInterval(timer) }
  }, [status, t])

  useEffect(() => {
    void settleHandedSuggestions(tasks).catch(error => console.warn('[knowledge-report] settle failed:', error))
  }, [tasks])

  useEffect(() => {
    void loadReportSettings().then(settings => useKnowledgeReportStore.getState().setSettings(settings))
  }, [])

  return null
}

export function useStartReport() {
  const t = useTranslations('knowledgeReport')
  return async (force = false) => {
    try {
      const result = await requestReport(period => t('taskTitle', { period }), force)
      if (result.outcome === 'started') toast({ title: t('toast.started'), description: t('toast.estimate', { tokens: result.estimate.toLocaleString() }) })
      else if (result.outcome === 'busy') toast({ title: t('toast.busy') })
      else toast({ title: t('toast.needsConfirm'), description: t('toast.estimate', { tokens: result.estimate.toLocaleString() }) })
    } catch (error) {
      toast({ title: t('toast.failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    }
  }
}

/** 版型 D 頂部：主題掌握度膠囊與「立即產生」／「建立基準」。 */
export function ReportStrip() {
  const t = useTranslations('knowledgeReport.card')
  const latest = useLatestReport()
  const tasks = useAgentTaskStore(state => state.tasks)
  const planning = useKnowledgeReportStore(state => state.planning)
  const openDrawer = useKnowledgeReportStore(state => state.openDrawer)
  const start = useStartReport()
  const running = activeReportTask(tasks)
  const topics = latest ? topicsByChange(latest.report).slice(0, 8) : []

  return (
    <section className="flex flex-wrap items-center gap-2" aria-label={t('title')}>
      <span className="text-xs text-muted-foreground">{latest ? t('period', { period: latest.report.period }) : t('title')}</span>
      {topics.map(topic => (
        <button
          key={topic.name}
          type="button"
          className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs hover:bg-accent"
          onClick={() => openDrawer('report')}
        >
          <span>{topic.name}</span>
          <LevelBadge level={topic.level} prev={topic.prevLevel} />
        </button>
      ))}
      {!latest && <span className="text-xs text-muted-foreground">{t('empty')}</span>}
      <div className="ml-auto flex items-center gap-2">
        {latest && <Button size="sm" variant="ghost" onClick={() => openDrawer('report')}>{t('open')}</Button>}
        {running ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('generating', { tokens: running.tokens.toLocaleString() })}
          </span>
        ) : latest ? (
          <Button size="sm" variant="secondary" disabled={planning} onClick={() => void start()}>
            {planning ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t('generate')}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => openDrawer('baseline')}>{t('baseline')}</Button>
        )}
      </div>
    </section>
  )
}

/** 「需要你處理」：待確認的 token 估算、未處理的優化建議。 */
export function useReportNeeds(): NeedItem[] {
  const t = useTranslations('knowledgeReport')
  const latest = useLatestReport()
  const pending = useKnowledgeReportStore(state => state.pending)
  const settings = useKnowledgeReportStore(state => state.settings) ?? DEFAULT_REPORT_SETTINGS
  const setHandoff = useHomeStore(state => state.setHandoff)
  const start = useStartReport()
  const items: NeedItem[] = []
  if (pending) {
    items.push({
      key: `report:confirm:${pending.period}`,
      label: t('needs.report'),
      tone: 'primary',
      text: t('needs.confirm', { period: pending.period, tokens: pending.estimate.toLocaleString(), limit: pending.limit.toLocaleString() }),
      action: t('needs.confirmAction'),
      onAction: () => void start(true),
    })
  }
  if (latest && settings.remindSuggestions) {
    for (const item of openSuggestions(latest.report).slice(0, 3)) {
      items.push({
        key: `report:suggestion:${item.id}`,
        label: t('needs.suggestion'),
        tone: 'muted',
        text: item.text,
        meta: item.topic,
        action: t('needs.handoff'),
        onAction: () => setHandoff({
          title: item.text,
          prompt: item.prompt,
          kind: 'suggestion',
          onStarted: taskId => { void updateSuggestion(latest.path, item.id, { status: 'handed', task: taskId }) },
        }),
      })
    }
  }
  return items
}

/** token 上限：打字時不夾限（否則輸入 1 就跳成下限），離開欄位或按 Enter 才存。 */
function TokenLimitField({ value, label, onCommit }: { value: number; label: string; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const commit = () => {
    const next = Math.min(10_000_000, Math.max(1000, Math.round(Number(text.replace(/[,\s]/g, '')))))
    if (Number.isFinite(next) && next !== value) onCommit(next)
    else setText(String(value))
  }
  return (
    <Input
      inputMode="numeric"
      value={text}
      aria-label={label}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') commit() }}
      className="h-7 w-24 px-2 text-right text-xs tabular-nums"
    />
  )
}

/** 「編輯首頁」裡知識報告卡的設定。 */
export function ReportSettingsPanel() {
  const t = useTranslations('knowledgeReport.settings')
  const [settings, setSettings] = useState<ReportSettings>(DEFAULT_REPORT_SETTINGS)
  const [exclude, setExclude] = useState('')
  useEffect(() => {
    void loadReportSettings().then(setSettings)
    void getExcludeFolders().then(folders => setExclude(folders.join('\n')))
  }, [])
  const update = (patch: Partial<ReportSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    useKnowledgeReportStore.getState().setSettings(next)
    void saveReportSettings(next)
  }
  return (
    <div className="mt-1 space-y-2 rounded-md bg-muted/50 px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="flex-1">{t('frequency')}</span>
        <Select value={settings.frequency} onValueChange={value => update({ frequency: value as ReportSettings['frequency'] })}>
          <SelectTrigger className="h-7 w-28 text-xs" aria-label={t('frequency')}><SelectValue /></SelectTrigger>
          <SelectContent>
            {(['daily', 'weekly', 'monthly', 'off'] as const).map(value => <SelectItem key={value} value={value} className="text-xs">{t(`frequencies.${value}`)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1">{t('tokenLimit')}</span>
        <TokenLimitField value={settings.tokenLimit} label={t('tokenLimit')} onCommit={tokenLimit => update({ tokenLimit })} />
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1">{t('model')}</span>
        <div className="w-48"><ModelSelect modelKey="knowledgeReport" emptyLabel={t('defaultModel')} /></div>
      </div>
      <div className="flex items-center gap-2">
        <Switch checked={settings.remindSuggestions} onCheckedChange={remindSuggestions => update({ remindSuggestions })} aria-label={t('remind')} />
        <span className="flex-1">{t('remind')}</span>
      </div>
      <label className="block">
        <span className="mb-1 block">{t('exclude')}</span>
        <Textarea
          rows={3}
          value={exclude}
          placeholder={t('excludePlaceholder')}
          className="text-xs"
          onChange={event => setExclude(event.target.value)}
          onBlur={() => void setExcludeFolders(exclude.split('\n'))}
        />
      </label>
    </div>
  )
}

/** 右欄：知識庫健康（預設關），數字取自最新一期報告。 */
export function HealthCard() {
  const t = useTranslations('knowledgeReport')
  const latest = useLatestReport()
  const stats = latest?.report.stats
  const rows: Array<[string, number | undefined]> = [
    [t('stats.unlinked'), stats?.unlinked],
    [t('stats.orphans'), stats?.orphans],
    [t('stats.inbox'), stats?.inbox],
    [t('stats.notes'), stats?.notes],
  ]
  return (
    <section className="rounded-xl bg-background p-4" aria-labelledby="home-health">
      <h2 id="home-health" className="mb-1 text-[15px] font-semibold">{t('health.title')}</h2>
      {!stats ? (
        <p className="text-sm text-muted-foreground">{t('health.empty')}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{t('health.from', { period: latest!.report.period })}</p>
          <dl className="grid grid-cols-2 gap-2">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-lg bg-muted px-3 py-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
