'use client'

// Fork（almanac ALMNC-14）：訊息下面的內嵌卡片。只在新介面（v3）顯示。
// 判斷都在 lib/threads/cards.ts 的 resolveThreadCard，這裡只畫。外觀依 redesign_v5：提案是虛線框、處理後變實線；開工卡是實線框。
import { useTranslations } from 'next-intl'
import { Check, CalendarClock, FileText, ListTodo, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUiV3 } from '@/lib/fork-ui'
import { resolveThreadCard, type CardAction, type KickoffCardView, type ProposalCardView, type ThreadCard } from '@/lib/threads/cards'
import { cn } from '@/lib/utils'
import useThreadsStore from '@/stores/threads'

const KIND_ICON = { note: FileText, task: ListTodo, event: CalendarClock } as const

function ProposalCard({ view, onAction }: { view: ProposalCardView, onAction: (action: CardAction) => void }) {
  const t = useTranslations('threads.cards')
  const Icon = KIND_ICON[view.kind]
  return (
    <div
      data-slot="thread-card"
      data-card="proposal"
      className={cn('rounded-md border bg-bg p-3 text-sm', view.tone === 'pending' ? 'border-dashed border-line' : 'border-line-soft')}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-sm bg-hover px-1.5 py-0.5 text-[11px] text-muted-ink">{t('proposal')}</span>
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-ink" />
        <span className={cn('min-w-0 flex-1 truncate font-medium text-ink', view.tone === 'muted' && 'text-faint line-through')}>{view.title}</span>
        {view.when && <span className="shrink-0 font-mono text-[11.5px] text-muted-ink">{view.when}</span>}
      </div>
      {view.detail && <p className="mt-1.5 text-[12.5px] text-muted-ink">{view.detail}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        {view.actions.includes('accept') && <Button size="sm" onClick={() => onAction('accept')}>{t('accept')}</Button>}
        {view.actions.includes('reject') && <Button size="sm" variant="outline" onClick={() => onAction('reject')}>{t('reject')}</Button>}
        {view.actions.length === 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-ink">
            {view.tone === 'done' && <Check aria-hidden className="size-3.5" />}{t(view.statusKey)}
          </span>
        )}
        {view.actions.length > 0 && <span className="ml-auto text-xs text-faint">{t('alsoInInbox')}</span>}
      </div>
    </div>
  )
}

function KickoffCard({ view, onAction }: { view: KickoffCardView, onAction: (action: CardAction) => void }) {
  const t = useTranslations('threads.cards')
  return (
    <div data-slot="thread-card" data-card="kickoff-result" className="rounded-md border border-line bg-bg p-3 text-sm">
      <div className="flex items-center gap-2">
        <ListTodo aria-hidden className="size-3.5 shrink-0 text-muted-ink" />
        <span className="text-xs text-muted-ink">{t('kickoff')}</span>
        <span className="ml-auto text-xs text-muted-ink">{t(view.stateKey)} · {view.done}/{view.total}</span>
      </div>
      <p className="mt-1 font-medium text-ink">{view.title}</p>
      <div className="mt-2 flex gap-[3px]" aria-hidden>
        {view.tasks.map(task => (
          <i key={task.n} className={cn('h-[5px] flex-1 rounded-[2px] bg-active', view.showTaskStatus && task.status === 'run' && 'bg-faint', view.showTaskStatus && task.status === 'done' && 'bg-invert')} />
        ))}
      </div>
      <ol className="mt-2 flex flex-col gap-1">
        {view.tasks.map(task => (
          <li key={task.n} className="flex items-center gap-2 text-[13px]">
            <span className="w-4 shrink-0 font-mono text-[11.5px] text-faint">{task.n}</span>
            <span className="min-w-0 flex-1 truncate text-ink">
              {task.text}
              {task.dependsOn && task.dependsOn.length > 0 && <span className="text-faint"> · {t('dependsOn', { list: task.dependsOn.join('、') })}</span>}
            </span>
            {task.owner && <span className="shrink-0 text-xs text-muted-ink">{task.owner}</span>}
            {view.showTaskStatus && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-ink">
                {task.status === 'run' ? <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> : task.status === 'done' ? <Check aria-hidden className="size-3" /> : null}
                {t(`task.${task.status}`)}
              </span>
            )}
          </li>
        ))}
      </ol>
      {view.acceptance.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-line-soft pt-2">
          {view.acceptance.map((item, index) => (
            <li key={index} className="flex items-center gap-2 text-[12.5px] text-muted-ink">
              <span className={cn('grid size-3.5 shrink-0 place-items-center rounded-[3px] border border-line', item.status === 'ok' && 'border-invert bg-invert text-invert-ink')}>
                {item.status === 'ok' && <Check aria-hidden className="size-2.5" />}
              </span>
              <span>{item.text}</span>
              {item.status === 'look' && <span className="text-danger">· {t('needsLook')}</span>}
            </li>
          ))}
        </ul>
      )}
      {view.actions.length > 0 && (
        <div className="mt-2.5 flex items-center gap-1.5">
          {view.actions.includes('start') && <Button size="sm" onClick={() => onAction('start')}>{t('start')}</Button>}
          {view.actions.includes('hold') && <Button size="sm" variant="outline" onClick={() => onAction('hold')}>{t('hold')}</Button>}
          {view.actions.includes('reopen') && <Button size="sm" variant="outline" onClick={() => onAction('reopen')}>{t('reopen')}</Button>}
          {view.actions.includes('start') && <span className="ml-auto text-xs text-faint">{t('maxParallel')}</span>}
        </div>
      )}
    </div>
  )
}

/** 掛在每則訊息下面：這則訊息沒有卡片、或不是新介面時什麼都不畫。 */
export function ThreadMessageCards({ chatId }: { chatId: number }) {
  const isV3 = useUiV3()
  const cards = useThreadsStore(state => state.cards[chatId])
  const act = useThreadsStore(state => state.actOnCard)
  if (!isV3 || !cards?.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2" data-slot="thread-cards">
      {cards.map((card: ThreadCard) => {
        const view = resolveThreadCard(card)
        const onAction = (action: CardAction) => void act(chatId, card.id, action)
        if (view.type === 'kickoff-result' && view.placeholder) return null
        return view.type === 'proposal'
          ? <ProposalCard key={card.id} view={view} onAction={onAction} />
          : <KickoffCard key={card.id} view={view} onAction={onAction} />
      })}
    </div>
  )
}
