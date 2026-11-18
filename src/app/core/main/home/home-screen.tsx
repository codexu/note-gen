'use client'

// Fork（#31）：首頁。蓋在編輯器與右側欄上方、留著左側欄（不卸載工作區），⌘⇧H 切換。
// 版型 D：頂部列＋指令區、主欄、右欄；卡片由 home-cards.tsx 登記。
import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cardsForSlot, isCardVisible, type HomeSlot } from '@/lib/home/cards'
import useHomeStore from '@/stores/home'
import { useUiV3 } from '@/lib/fork-ui'
import { TodayProvider, useTodayTitle } from '../today/today-page'
import { PageHeader, PageSurface } from '../page-ui'
import { HOME_CARDS } from './home-cards'
import { HomeEditSheet } from './home-edit-sheet'
import { HandoffDialog, NeedsList } from './cards/needs-list'
import { TodayV3Screen } from '../today-v3/today-v3-screen'

function Slot({ slot, className }: { slot: HomeSlot; className?: string }) {
  const prefs = useHomeStore(state => state.prefs)
  const cards = cardsForSlot(HOME_CARDS, prefs, slot)
  if (!cards.length) return null
  return (
    <div className={className}>
      {cards.map(card => {
        const Render = card.slots[slot]!
        return <Fragment key={card.key}><Render /></Fragment>
      })}
    </div>
  )
}

function HomeHeader() {
  const t = useTranslations('home')
  const hide = useHomeStore(state => state.hide)
  const setEditing = useHomeStore(state => state.setEditing)
  const { title, subtitle } = useTodayTitle()
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      onBack={hide}
      backShortcut="⌘⇧H"
      actions={(
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => setEditing(true)}>
          <Settings2 className="size-4" aria-hidden />{t('edit')}
        </Button>
      )}
    >
      <Slot slot="header" className="flex flex-wrap items-center gap-3" />
    </PageHeader>
  )
}

export function HomeScreen() {
  const t = useTranslations('home')
  const visible = useHomeStore(state => state.visible)
  const loaded = useHomeStore(state => state.loaded)
  const hide = useHomeStore(state => state.hide)
  const setEditing = useHomeStore(state => state.setEditing)
  const prefs = useHomeStore(state => state.prefs)
  const isV3 = useUiV3()
  if (!loaded || !visible) return null
  // Fork（ALMNC-16.2）：新介面（v3）的首頁／今日入口顯示 v5「今天」主畫面；classic 維持原首頁
  if (isV3) return <TodayV3Screen />
  const empty = HOME_CARDS.every(card => !isCardVisible(prefs, card))

  return (
    <PageSurface label={t('title')}>
      <TodayProvider onNavigate={hide}>
        <HomeHeader />
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-5">
            <Slot slot="top" className="flex flex-col gap-3" />

            {empty && (
              <div className="grid place-items-center gap-3 rounded-xl border border-dashed py-16 text-center">
                <p className="text-sm text-muted-foreground">{t('empty')}</p>
                <Button variant="secondary" onClick={() => setEditing(true)}>{t('edit')}</Button>
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-4 @max-[900px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-4">
                <NeedsList cards={HOME_CARDS} />
                <Slot slot="main" className="flex min-w-0 flex-col gap-4" />
              </div>
              <Slot slot="side" className="flex min-w-0 flex-col gap-4" />
            </div>
          </div>
        </div>
      </TodayProvider>
      <HomeEditSheet />
      <HandoffDialog />
    </PageSurface>
  )
}
