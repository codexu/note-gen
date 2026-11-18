'use client'

// Fork（almanac ALMNC-10）：首頁「需要你處理」的延伸——等你定的項目直接列在清單最上面，逐條收下或不要。
// 項目來自 useDecisions（收集提案、任務中心草稿的投影），首頁只放最前面幾條，其餘到「等你定」頁。
// 因為草稿已逐條出現在這裡，tasks-card 的「待審草稿」整任務列在新介面不再重複出現。
import { useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDecisions } from '@/lib/decide/use-decisions'
import useDecideStore from '@/stores/decide'
import { KIND_ICON, useDecideActions } from './decide-parts'

export const HOME_DECIDE_LIMIT = 3

export function DecideNeeds() {
  const t = useTranslations('decide')
  const items = useDecisions()
  const show = useDecideStore(state => state.show)
  const { busy, accept, reject } = useDecideActions()
  if (items.length === 0) return null
  const shown = items.slice(0, HOME_DECIDE_LIMIT)
  return (
    <>
      {shown.map(item => {
        const Icon = KIND_ICON[item.kind]
        return (
          <li key={item.key} className="flex items-center gap-3 py-2.5" data-testid="decide-need">
            <span className="flex shrink-0 items-center gap-1 rounded-md bg-card px-1.5 py-0.5 text-xs text-ink"><Icon className="size-3" aria-hidden />{t('needsLabel')}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm" title={item.title}>{item.source === 'draft' ? item.summary || item.title : item.title}</div>
              <div className="truncate text-xs text-muted-foreground">{[t(`kind.${item.kind}`), item.when, t('from', { origin: item.origin })].filter(Boolean).join(' · ')}</div>
            </div>
            <Button size="sm" variant="secondary" disabled={busy === item.key} onClick={() => void accept(item)}>{t('accept')}</Button>
            <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" disabled={busy === item.key} onClick={() => void reject(item)} aria-label={t('reject')} title={t('reject')}><X className="size-3.5" aria-hidden /></Button>
          </li>
        )
      })}
      {items.length > shown.length && (
        <li className="py-2">
          <button type="button" onClick={show} className="cursor-pointer text-sm text-brand outline-none hover:underline focus-visible:ring-1 focus-visible:ring-ring/65">{t('viewAll', { count: items.length })}</button>
        </li>
      )}
    </>
  )
}
