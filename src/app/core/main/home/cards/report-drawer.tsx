'use client'

// Fork（#35）：完整知識報告與「建立基準」的右側抽屜（版型 D：審核、報告、摘要一律用右側抽屜）。
// 建立基準：整理主題清單 → 確認 → 顯示 token 估算 → 按開始。主題清單是 vault 筆記，Obsidian 也能改。
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Bot, Check, ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { toast } from '@/hooks/use-toast'
import { fetchAi } from '@/lib/ai/chat'
import { writeNote } from '@/lib/daily/note-io'
import { estimateReport, updateSuggestion, useKnowledgeReportStore } from '@/lib/knowledge-report'
import { computeKnowledgeSnapshot } from '@/lib/knowledge-report/sources'
import {
  addProposals,
  buildProposalMessages,
  parseProposals,
  renderTopicList,
  TOPIC_LIST_PATH,
  type Topic,
} from '@/lib/knowledge-report/topics'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useHomeStore from '@/stores/home'
import { LevelBadge, useLatestReport, useStartReport } from './report-card'

function openNote(path: string) {
  void useArticleStore.getState().setActiveFilePath(path)
  useKnowledgeReportStore.getState().closeDrawer()
  useHomeStore.getState().hide()
}

function linkName(path: string) {
  return path.split('/').pop()!.replace(/\.md$/i, '')
}

function ReportView() {
  const t = useTranslations('knowledgeReport.drawer')
  const latest = useLatestReport()
  const setHandoff = useHomeStore(state => state.setHandoff)
  if (!latest) return <p className="text-sm text-muted-foreground">{t('empty')}</p>
  const { report, path } = latest
  const generated = report.generated ? new Date(report.generated).toLocaleString() : ''
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{t('meta', { path, generated, tokens: report.tokens.toLocaleString() })}</span>
        <Button size="sm" variant="ghost" onClick={() => openNote(path)}><ExternalLink className="size-3.5" />{t('openNote')}</Button>
      </div>
      <h3 className="mb-2 text-sm font-medium">{t('topics')}</h3>
      <div className="mb-6 divide-y rounded-md border">
        {report.topics.map(topic => (
          <div key={topic.name} className="p-3">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate font-medium">{topic.name}</span>
              <LevelBadge level={topic.level} prev={topic.prevLevel} />
              <span className="text-xs tabular-nums text-muted-foreground">{t('score', { score: topic.score, notes: topic.notes })}</span>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">{topic.gap ? t('gap', { gap: topic.gap }) : t('topLevel')}</div>
            {topic.comment && <p className="mt-1.5 text-sm">{topic.comment}</p>}
            {topic.evidence.map(item => (
              <button
                key={item.quote}
                type="button"
                className="mt-1 block w-full border-l-2 border-line pl-2 text-left text-xs italic text-muted-foreground hover:text-foreground"
                onClick={() => openNote(item.path)}
              >
                「{item.quote}」— [[{linkName(item.path)}]]
              </button>
            ))}
          </div>
        ))}
      </div>
      <h3 className="mb-2 text-sm font-medium">{t('suggestions')}</h3>
      {report.suggestions.length === 0 && <p className="text-sm text-muted-foreground">{t('noSuggestions')}</p>}
      <div className="space-y-2">
        {report.suggestions.map(item => {
          const closed = item.status === 'done' || item.status === 'dismissed'
          return (
            <div key={item.id} className="flex items-center gap-3 rounded-md border bg-card p-3 text-sm">
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-xs">{item.topic}</span>
              <span className={cn('min-w-0 flex-1', closed && 'text-muted-foreground line-through')}>{item.text}</span>
              {item.status === 'open' && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => {
                    // 先關抽屜，預填指令的對話框才不會被抽屜蓋住
                    useKnowledgeReportStore.getState().closeDrawer()
                    setHandoff({
                      title: item.text,
                      prompt: item.prompt,
                      kind: 'suggestion',
                      onStarted: taskId => { void updateSuggestion(path, item.id, { status: 'handed', task: taskId }) },
                    })
                  }}
                  >
                    <Bot className="size-3.5" />{t('handoff')}
                  </Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t('dismiss')} title={t('dismiss')} onClick={() => void updateSuggestion(path, item.id, { status: 'dismissed' })}>
                    <X className="size-3.5" />
                  </Button>
                </>
              )}
              {item.status === 'handed' && <span className="text-xs text-muted-foreground">{t('handed')}</span>}
              {item.status === 'done' && <Check className="size-4 text-ink" aria-label={t('done')} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface Row {
  topic: Topic
  checked: boolean
  source: string
  count: number | null
}

function BaselineView() {
  const t = useTranslations('knowledgeReport.baseline')
  const tr = useTranslations('knowledgeReport')
  const start = useStartReport()
  const closeDrawer = useKnowledgeReportStore(state => state.closeDrawer)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [uncovered, setUncovered] = useState<Awaited<ReturnType<typeof computeKnowledgeSnapshot>>['uncovered']>([])
  const [preamble, setPreamble] = useState('')
  const [busy, setBusy] = useState<'propose' | 'save' | null>(null)
  const [estimate, setEstimate] = useState<{ estimate: number; limit: number } | null>(null)
  const [error, setError] = useState('')

  const sourceOf = (topic: Topic, count?: number) => {
    if (topic.remark && topic.notes.length) return t('sourceAi', { reason: topic.remark })
    const parts = [...topic.tags.map(tag => `#${tag}`), ...topic.mocs.map(moc => `[[${moc}]]`), ...topic.folders]
    return parts.join('、') + (count !== undefined ? ` · ${t('notes', { count })}` : '')
  }

  useEffect(() => {
    let cancelled = false
    void computeKnowledgeSnapshot().then(snapshot => {
      if (cancelled) return
      const list = snapshot.sources.topicList
      const counts = new Map(snapshot.results.map(result => [result.topic.name, result.paths.length]))
      setPreamble(list?.preamble ?? '')
      setUncovered(snapshot.uncovered)
      setRows([
        ...(list?.topics ?? []).map(topic => ({ topic, checked: true, source: sourceOf(topic, counts.get(topic.name)), count: counts.get(topic.name) ?? null })),
        ...snapshot.candidates.slice(0, 12).map(topic => ({ topic, checked: true, source: sourceOf(topic, topic.noteCount), count: topic.noteCount })),
      ])
    }).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function propose() {
    if (!rows) return
    setBusy('propose')
    try {
      const raw = await fetchAi('', undefined, buildProposalMessages(uncovered, rows.map(row => row.topic.name), tr('language')))
      const proposals = parseProposals(raw, uncovered.map(note => note.path))
      const merged = addProposals({ preamble: '', topics: rows.map(row => row.topic) }, proposals).topics.slice(rows.length)
      setRows([...rows, ...merged.map(topic => ({ topic, checked: true, source: sourceOf(topic), count: topic.notes.length }))])
      if (merged.length === 0) toast({ title: t('noProposals') })
    } catch (caught) {
      toast({ title: t('proposeFailed'), description: caught instanceof Error ? caught.message : String(caught), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    if (!rows) return
    setBusy('save')
    try {
      const topics = rows.filter(row => row.checked).map(row => ({ ...row.topic, proposed: false }))
      await writeNote(TOPIC_LIST_PATH, renderTopicList({ preamble, topics }))
      // 等索引看到新的清單再估算
      await new Promise(resolve => setTimeout(resolve, 800))
      const result = await estimateReport()
      setEstimate({ estimate: result.estimate, limit: result.limit })
    } catch (caught) {
      toast({ title: t('saveFailed'), description: caught instanceof Error ? caught.message : String(caught), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!rows) return <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t('loading')}</p>
  const checked = rows.filter(row => row.checked).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-3 text-sm text-muted-foreground">{t('step1', { path: TOPIC_LIST_PATH })}</p>
      <div className="min-h-0 flex-1 divide-y overflow-y-auto rounded-md border">
        {rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t('noCandidates')}</p>}
        {rows.map((row, index) => (
          <label key={`${row.topic.name}-${index}`} className="flex cursor-pointer items-start gap-3 p-3">
            <Checkbox
              checked={row.checked}
              onCheckedChange={value => { setEstimate(null); setRows(rows.map((item, i) => (i === index ? { ...item, checked: value === true } : item))) }}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{row.topic.name}</div>
              <div className="truncate text-xs text-muted-foreground">{row.source}</div>
            </div>
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled={busy !== null || uncovered.length === 0} onClick={() => void propose()}>
          {busy === 'propose' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t('propose', { count: uncovered.length })}
        </Button>
        <Button size="sm" className="ml-auto" disabled={busy !== null || checked === 0} onClick={() => void save()}>
          {busy === 'save' && <Loader2 className="size-3.5 animate-spin" />}
          {t('save', { count: checked })}
        </Button>
      </div>
      {estimate && (
        <div className="mt-4 rounded-md border bg-muted/50 p-3 text-sm">
          <p>{t('estimate', { tokens: estimate.estimate.toLocaleString(), limit: estimate.limit.toLocaleString() })}</p>
          {estimate.estimate > estimate.limit && <p className="mt-1 text-xs text-destructive">{t('overLimit')}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeDrawer}>{t('later')}</Button>
            <Button size="sm" onClick={() => { void start(true); closeDrawer() }}>{t('start')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ReportDrawer() {
  const t = useTranslations('knowledgeReport.drawer')
  const drawer = useKnowledgeReportStore(state => state.drawer)
  const closeDrawer = useKnowledgeReportStore(state => state.closeDrawer)
  const latest = useLatestReport()
  return (
    <Sheet open={drawer !== null} onOpenChange={open => { if (!open) closeDrawer() }}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-5 data-[side=right]:w-[560px] data-[side=right]:sm:max-w-[560px]"
        // 存檔時新建「報告/」資料夾會讓檔案樹搶走焦點；只在點外面或按 Esc 時關閉
        onFocusOutside={event => event.preventDefault()}
      >
        <SheetHeader className="mb-3 p-0">
          <SheetTitle>{drawer === 'baseline' ? t('baselineTitle') : latest ? t('title', { period: latest.report.period }) : t('emptyTitle')}</SheetTitle>
          <SheetDescription>{drawer === 'baseline' ? t('baselineDescription') : t('description')}</SheetDescription>
        </SheetHeader>
        {drawer === 'baseline' ? <BaselineView /> : <ReportView />}
      </SheetContent>
    </Sheet>
  )
}
