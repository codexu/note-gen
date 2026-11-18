'use client'

// Fork（almanac ALMNC-10）：V3「等你定」頁。左邊是清單、右邊是選中那條的詳情與差異預覽，一次只給一個主要動作（收下），「不要」是次要。
// 清單是 lib/decide 從收集與任務中心投影出來的，和首頁「需要你處理」裡的等你定項目同一份；這一頁不存任何待決狀態。
// 外觀依 redesign_v5.html：單色、提案是虛線框。只在新介面（v3）出現。
import { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAgentTaskStore } from '@/lib/agent-tasks'
import { useUiV3 } from '@/lib/fork-ui'
import { refreshJournal } from '@/lib/decide/actions'
import type { DecideItem } from '@/lib/decide/project'
import { useDecisions } from '@/lib/decide/use-decisions'
import { cn } from '@/lib/utils'
import useCollectStore from '@/stores/collect'
import useDecideStore from '@/stores/decide'
import { OrganizeHistory } from '../organize/organize-history'
import { JobReviewPreview } from '../jobs/job-result'
import { Count, EmptyState, PageHeader, PageSurface } from '../page-ui'
import { DiffBlock, KIND_ICON, destinationText, useDecideActions } from './decide-parts'

function itemTitle(item: DecideItem) {
  return item.source === 'draft' ? item.summary || item.title : item.title
}

function Detail({ item }: { item: DecideItem }) {
  const t = useTranslations('decide')
  const jobT = useTranslations('jobs')
  const organizeT = useTranslations('organize')
  const { busy, accept, reject } = useDecideActions()
  const Icon = KIND_ICON[item.kind]
  const { diff } = item.preview
  return (
    <article className="max-w-[640px]" data-testid="decide-detail">
      <div className="flex items-center gap-2 font-mono text-[10.5px] text-faint">
        <span className="flex items-center gap-1.5"><Icon className="size-3" aria-hidden />{item.kind === 'job' ? jobT('result') : t(`kind.${item.kind}`)}</span>
        <span className="rounded border border-dashed border-faint px-1.5 py-px">{t('proposalTag')}</span>
        <span>{item.source === 'job' ? jobT('card') : t(`source.${item.source}`)}</span>
      </div>
      <h2 className="mt-2 text-xl leading-7 font-semibold tracking-[-0.01em] break-words">{itemTitle(item)}</h2>
      <p className="mt-1 text-[13.5px] leading-6 text-muted-foreground">
        {[item.when, t('from', { origin: item.origin })].filter(Boolean).join(' · ')}
      </p>
      {item.preview.type === 'job' ? (
        <div className="mt-3"><JobReviewPreview criterion={item.preview.criterion} result={item.preview.result} /></div>
      ) : (
        <p className="mt-3 text-[13.5px] leading-6 text-muted-foreground">{t('writesTo')}<span className="text-ink">{destinationText(t, item.preview)}</span></p>
      )}
      {item.organizeMerge && <p className="mt-3 text-sm">{organizeT('mergeEffect', item.organizeMerge)}</p>}
      {diff && <DiffBlock diff={diff} className="mt-3" />}
      {item.duplicates.length > 0 && <p className="mt-3 text-xs text-faint">{t('merged', { count: item.duplicates.length })}</p>}
      <div className="mt-5 flex items-center gap-1.5">
        <Button disabled={busy === item.key} onClick={() => void accept(item)}>{t('accept')}</Button>
        <Button variant="outline" disabled={busy === item.key} onClick={() => void reject(item)}>{t('reject')}</Button>
      </div>
    </article>
  )
}

function DecidePage() {
  const t = useTranslations('decide')
  const jobT = useTranslations('jobs')
  const hide = useDecideStore(state => state.hide)
  const selected = useDecideStore(state => state.selected)
  const select = useDecideStore(state => state.select)
  const items = useDecisions()
  const current = useMemo(() => items.find(item => item.key === selected) ?? items[0] ?? null, [items, selected])

  return (
    <PageSurface label={t('title')} onDismiss={hide}>
      <PageHeader title={t('title')} subtitle={t('subtitle')} onBack={hide}>
        <Count value={items.length} label={t('count', { count: items.length })} />
      </PageHeader>
      <OrganizeHistory />
      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center"><EmptyState icon={CheckCheck} text={t('empty')} /></div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[360px_minmax(0,1fr)] lg:overflow-hidden">
          <ul className="min-w-0 border-b border-line-soft p-2 lg:overflow-y-auto lg:border-r lg:border-b-0" aria-label={t('listLabel')}>
            {items.map(item => {
              const Icon = KIND_ICON[item.kind]
              const active = current?.key === item.key
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => select(item.key)}
                    aria-current={active || undefined}
                    data-testid="decide-row"
                    className={cn('flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65', active && 'bg-active')}
                  >
                    <Icon className="mt-1 size-3.5 shrink-0 text-faint" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13.5px] leading-5', active && 'font-semibold')}>{itemTitle(item)}</span>
                      <span className="block truncate text-xs leading-5 text-faint">{[item.kind === 'job' ? jobT('result') : t(`kind.${item.kind}`), item.when, t('from', { origin: item.origin })].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="min-w-0 px-8 py-6 lg:overflow-y-auto">{current && <Detail key={current.key} item={current} />}</div>
        </div>
      )}
    </PageSurface>
  )
}

/** 一直掛著：讀回保存的收集提案、讀今日日誌（預覽與去重用）；頁面只在新介面且打開時顯示。 */
export function DecideScreen() {
  const isV3 = useUiV3()
  const visible = useDecideStore(state => state.visible)
  const hydrate = useCollectStore(state => state.hydrate)
  const items = useCollectStore(state => state.items)
  const waiting = useMemo(() => items.reduce((n, item) => n + item.proposals.filter(p => p.status === 'wait').length, 0), [items])

  useEffect(() => {
    if (isV3) void hydrate()
  }, [isV3, hydrate])
  useEffect(() => {
    if (isV3) void refreshJournal()
  }, [isV3, visible, waiting])
  useEffect(() => {
    if (!isV3) return
    const timer = setInterval(() => void refreshJournal(), 60_000)
    return () => clearInterval(timer)
  }, [isV3])
  // 開發預覽用：瀏覽器沒有 Tauri，截圖時要從頁面塞示範資料進 store。
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    ;(window as unknown as Record<string, unknown>).__almanac = { collect: useCollectStore, decide: useDecideStore, tasks: useAgentTaskStore }
  }, [])

  return isV3 && visible ? <DecidePage /> : null
}
