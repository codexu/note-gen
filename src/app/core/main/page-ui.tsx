'use client'

// Fork（UI 一致性）：首頁、Inbox 頁等「蓋在工作區上」的頁面共用的外框、頁首、計數與空狀態。
// 頁面外框的位置與圓角由 page.tsx 量左側欄面板與工作區面板後寫進 --page-*，
// 所以不論面板是平貼（預設）還是卡片（自訂 CSS），頁面都跟工作區對齊。
import { useLayoutEffect, useRef, type ComponentType, type ReactNode } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useUiV3 } from '@/lib/fork-ui'

/** 卡片標題（首頁各卡片共用）。 */
export const CARD_TITLE = 'text-[15px] font-semibold'

/** 首頁各卡片的外框。 */
export const CARD = 'rounded-xl bg-background p-4'

export function PageSurface({ label, children, className, onDismiss }: {
  label: string
  children: ReactNode
  className?: string
  onDismiss?: () => void
}) {
  const surface = useRef<HTMLDivElement>(null)
  const focusOnOpen = Boolean(onDismiss)

  useLayoutEffect(() => {
    const node = surface.current
    const opener = document.activeElement
    if (!focusOnOpen || !node) return
    if (!node.contains(opener)) node.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      if (opener instanceof HTMLElement && opener.isConnected && (active === document.body || node.contains(active))) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [focusOnOpen])

  return (
    <div
      ref={surface}
      role="region"
      aria-label={label}
      tabIndex={onDismiss ? -1 : undefined}
      onKeyDown={onDismiss && (event => {
        // A Radix dialog/menu can portal out of this DOM subtree.
        if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing
          || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      })}
      className={cn(
        'absolute top-(--page-top) right-(--page-right) bottom-(--page-bottom) left-(--page-left) z-30 flex flex-col overflow-hidden rounded-(--page-radius) bg-card',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** 頁首：左邊標題（可帶副標），中間放頁面自己的控制，右邊是頁面動作，最右固定「回到工作區」。 */
export function PageHeader({ title, subtitle, children, actions, onBack, backShortcut }: {
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  onBack: () => void
  /** 有快捷鍵可以回到工作區時才顯示。 */
  backShortcut?: string
}) {
  const t = useTranslations('home')
  // Fork（ALMNC-22）：新介面不放「回到工作區」，改用側欄檔案樹與 ⌘⇧H
  const isV3 = useUiV3()
  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b px-5 py-2">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {children}
      <div className="ml-auto flex items-center gap-1">
        {actions}
        {!isV3 && (
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={onBack} title={t('backToWorkspace')}>
            <PanelsTopLeft className="size-4" aria-hidden />
            {t('backToWorkspace')}
            {backShortcut && <kbd className="rounded border px-1 text-xs">{backShortcut}</kbd>}
          </Button>
        )}
      </div>
    </header>
  )
}

/** 計數：一律用小圓底的數字，不用括號或句子。 */
export function Count({ value, className, label }: { value: number, className?: string, label?: string }) {
  return (
    <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-medium tabular-nums text-muted-foreground', className)} aria-label={label}>
      {value > 999 ? '999+' : value}
    </span>
  )
}

/** 空狀態：淡色圖示＋一句說明，可以帶一個動作。 */
export function EmptyState({ icon: Icon, text, action, compact }: {
  icon: ComponentType<{ className?: string }>
  text: ReactNode
  action?: ReactNode
  /** 卡片裡用的矮版。 */
  compact?: boolean
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-3 text-center text-sm text-muted-foreground', compact ? 'py-4' : 'py-8')}>
      <Icon className="size-5 opacity-60" aria-hidden />
      <p>{text}</p>
      {action}
    </div>
  )
}
