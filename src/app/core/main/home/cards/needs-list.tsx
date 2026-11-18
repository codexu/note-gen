'use client'

// Fork（#32）：版型 D 主欄最上方的「需要你處理」。項目由各張卡片的 useNeeds 提供，依卡片順序排列。
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/hooks/use-toast'
import { agentTaskCenter, useAgentTaskStore } from '@/lib/agent-tasks'
import { isCardVisible } from '@/lib/home/cards'
import { useUiV3 } from '@/lib/fork-ui'
import { useDecisions } from '@/lib/decide/use-decisions'
import { DecideNeeds } from '../../decide/decide-needs'
import { cn } from '@/lib/utils'
import useHomeStore from '@/stores/home'
import type { HomeCardDef, NeedItem } from '../home-cards'
import { CARD, CARD_TITLE, Count } from '../../page-ui'

const TONE: Record<NeedItem['tone'], string> = {
  primary: 'text-ink',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
}

function NeedsFrom({ card, onCount }: { card: HomeCardDef; onCount: (key: string, count: number) => void }) {
  const items = card.useNeeds!()
  useEffect(() => { onCount(card.key, items.length) }, [card.key, items.length, onCount])
  useEffect(() => () => onCount(card.key, 0), [card.key, onCount])
  return (
    <>
      {items.map(item => (
        <li key={item.key} className="flex items-center gap-3 py-2.5">
          {/* 分類字只佔自己的寬度，不再固定 w-20 */}
          <span className={cn('shrink-0 rounded-md bg-card px-1.5 py-0.5 text-xs', TONE[item.tone])}>{item.label}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm" title={item.text}>{item.text}</div>
            {item.meta && <div className="truncate text-xs text-muted-foreground" title={item.meta}>{item.meta}</div>}
          </div>
          <Button size="sm" variant="secondary" onClick={item.onAction}>{item.action}</Button>
        </li>
      ))}
    </>
  )
}

export function NeedsList({ cards }: { cards: HomeCardDef[] }) {
  const t = useTranslations('home.needs')
  const prefs = useHomeStore(state => state.prefs)
  const sources = prefs.order
    .map(key => cards.find(card => card.key === key))
    .filter((card): card is HomeCardDef => Boolean(card?.useNeeds && isCardVisible(prefs, card)))
  const [counts, setCounts] = useState<Record<string, number>>({})
  const onCount = useCallback((key: string, count: number) => {
    setCounts(current => (current[key] === count ? current : { ...current, [key]: count }))
  }, [])
  // Fork（ALMNC-10）：新介面多一塊「等你定」，列在最上面；舊介面維持原樣
  const isV3 = useUiV3()
  const decideCount = useDecisions().length
  const total = sources.reduce((sum, card) => sum + (counts[card.key] ?? 0), 0) + decideCount
  if (!sources.length && !isV3) return null

  return (
    <section aria-labelledby="home-needs" className={cn(CARD, total === 0 && 'hidden')}>
      <header className="mb-1 flex items-center gap-2">
        <h2 id="home-needs" className={CARD_TITLE}>{t('title')}</h2>
        <Count value={total} />
      </header>
      <ul className="divide-y">
        {isV3 && <DecideNeeds />}
        {sources.map(card => <NeedsFrom key={card.key} card={card} onCount={onCount} />)}
      </ul>
    </section>
  )
}

/** 「交給 Agent」：先讓使用者看一眼預填指令，按「開始」才建立背景任務。 */
export function HandoffDialog() {
  const t = useTranslations('home.handoff')
  const handoff = useHomeStore(state => state.handoff)
  const setHandoff = useHomeStore(state => state.setHandoff)
  const [prompt, setPrompt] = useState('')
  const [starting, setStarting] = useState(false)
  useEffect(() => { if (handoff) setPrompt(handoff.prompt) }, [handoff])

  async function start() {
    if (!handoff || !prompt.trim() || starting) return
    setStarting(true)
    try {
      const task = await agentTaskCenter.enqueue({ prompt: prompt.trim(), title: handoff.title, kind: handoff.kind })
      handoff.onStarted?.(task.id)
      setHandoff(null)
      toast({ title: t('started'), description: task.title })
    } catch (error) {
      toast({ title: t('failed'), description: error instanceof Error ? error.message : String(error), variant: 'destructive' })
    } finally {
      setStarting(false)
    }
  }

  return (
    <Dialog open={Boolean(handoff)} onOpenChange={open => { if (!open) setHandoff(null) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <Textarea value={prompt} onChange={event => setPrompt(event.target.value)} rows={5} aria-label={t('prompt')} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setHandoff(null)}>{t('cancel')}</Button>
          <Button onClick={() => void start()} disabled={!prompt.trim() || starting}>{t('start')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 打開任務抽屜（審核時直接進該任務）。 */
export function openTasks(reviewTaskId?: string) {
  useAgentTaskStore.getState().openSheet(reviewTaskId ?? null)
}

