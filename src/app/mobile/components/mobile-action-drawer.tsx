'use client'

import { Fragment, ReactNode, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export type MobileActionDrawerItem = {
  key: string
  label: string
  icon?: ReactNode
  onSelect: () => void | Promise<void>
  disabled?: boolean
  destructive?: boolean
  selected?: boolean
  separatorBefore?: boolean
}

interface MobileActionDrawerProps {
  title: string
  trigger: ReactNode
  items: MobileActionDrawerItem[]
}

export function MobileActionDrawer({
  title,
  trigger,
  items,
}: MobileActionDrawerProps) {
  const [open, setOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {items.map((item) => (
            <Fragment key={item.key}>
              {item.separatorBefore ? <Separator className="my-1" /> : null}
              <Button
                type="button"
                variant={item.destructive ? 'destructive' : 'ghost'}
                disabled={item.disabled || pendingKey !== null}
                className={cn(
                  'h-12 w-full justify-start px-3',
                  item.destructive && 'mt-2',
                )}
                onClick={async () => {
                  setPendingKey(item.key)
                  try {
                    await item.onSelect()
                    setOpen(false)
                  } finally {
                    setPendingKey(null)
                  }
                }}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {pendingKey === item.key ? <Loader2 className="ml-auto animate-spin" aria-hidden="true" /> : null}
                {item.selected ? <Check className="ml-auto" aria-hidden="true" /> : null}
              </Button>
            </Fragment>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
