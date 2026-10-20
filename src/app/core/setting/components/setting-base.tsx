'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

const MobileSettingLayoutContext = createContext(false)
export interface MobileSettingAction {
  label: string
  icon: ReactNode
  onClick: () => void
}

const MobileSettingActionContext = createContext<{
  action: MobileSettingAction | null
  setAction: (action: MobileSettingAction | null) => void
}>({ action: null, setAction: () => {} })

export function SettingLayoutProvider({
  mobile,
  children,
}: {
  mobile: boolean
  children: React.ReactNode
}) {
  const [action, setAction] = useState<MobileSettingAction | null>(null)

  return (
    <MobileSettingLayoutContext.Provider value={mobile}>
      <MobileSettingActionContext.Provider value={{ action, setAction }}>
        {children}
      </MobileSettingActionContext.Provider>
    </MobileSettingLayoutContext.Provider>
  )
}

export function useMobileSettingAction(action: MobileSettingAction | null) {
  const { setAction } = useContext(MobileSettingActionContext)

  useEffect(() => {
    setAction(action)
    return () => setAction(null)
  }, [action, setAction])
}

export function MobileSettingActionOutlet() {
  const { action } = useContext(MobileSettingActionContext)

  return (
    <div className="flex size-10 shrink-0 items-center justify-center">
      {action && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
        >
          {action.icon}
        </Button>
      )}
    </div>
  )
}

export function SettingType(
  {id, title, icon, desc, children}:
  { id: string, title: string, icon?: React.ReactNode, desc?: string, children?: React.ReactNode}
) {
  const mobile = useContext(MobileSettingLayoutContext)

  if (mobile) {
    return (
      <div id={id} data-setting-page className="flex min-w-0 flex-col gap-6">
        {desc && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        )}
        <div data-setting-sections className="flex min-w-0 flex-col gap-5">{children}</div>
      </div>
    )
  }

  return <div id={id} className="flex h-full min-h-0 flex-col">
    <header className="shrink-0 px-8 pt-8 pb-6 pr-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5">
        <h2 className="flex w-full items-center gap-2 text-xl font-semibold tracking-tight">
          {icon && <span className="text-muted-foreground">{icon}</span>}
          {title}
        </h2>
        {desc && <p className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{desc}</p>}
      </div>
    </header>
    <ScrollArea data-setting-scroll className="min-h-0 flex-1">
      <div className="px-8 pt-2 pb-8 pr-10">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {children}
        </div>
      </div>
    </ScrollArea>
  </div>
}

export function SettingSection({
  title,
  desc,
  actions,
  children,
}: {
  title: string
  desc?: string
  actions?: React.ReactNode
  children?: React.ReactNode
}) {
  const mobile = useContext(MobileSettingLayoutContext)

  return (
    <section
      data-mobile-setting-section={mobile || undefined}
      className="flex min-w-0 flex-col gap-3"
    >
      <header data-setting-section-header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">{title}</h3>
          {desc ? <p className="text-sm text-muted-foreground">{desc}</p> : null}
        </div>
        {actions ? <div data-setting-section-actions className="shrink-0">{actions}</div> : null}
      </header>
      {children ?? null}
    </section>
  )
}
