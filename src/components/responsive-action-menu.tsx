'use client'

import { Fragment, type ReactNode, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

export type ResponsiveActionMenuItem = {
  key: string
  label: ReactNode
  icon?: ReactNode
  end?: ReactNode
  onSelect: () => void | Promise<void>
  disabled?: boolean
  destructive?: boolean
  selected?: boolean
  separatorBefore?: boolean
  keepOpen?: boolean
}

interface ResponsiveActionMenuProps {
  title: string
  trigger: ReactNode
  items: ResponsiveActionMenuItem[]
  desktopAlign?: 'start' | 'center' | 'end'
  desktopClassName?: string
}

export function ResponsiveActionMenu({
  title,
  trigger,
  items,
  desktopAlign = 'end',
  desktopClassName,
}: ResponsiveActionMenuProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)

  if (!isMobile) {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align={desktopAlign} className={desktopClassName}>
          <DropdownMenuGroup>
            {items.map(item => (
              <Fragment key={item.key}>
                {item.separatorBefore ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  disabled={item.disabled}
                  variant={item.destructive ? 'destructive' : 'default'}
                  onSelect={event => {
                    if (item.keepOpen) event.preventDefault()
                    void item.onSelect()
                  }}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.end}
                  {item.selected ? <Check className="ml-auto" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {items.map(item => (
            <Fragment key={item.key}>
              {item.separatorBefore ? <Separator className="my-1" /> : null}
              <Button
                type="button"
                variant={item.destructive ? 'destructive' : 'ghost'}
                disabled={item.disabled || pendingKey !== null}
                aria-pressed={item.selected}
                className={cn(
                  'h-12 w-full justify-start px-3',
                  item.destructive && 'mt-2',
                )}
                onClick={async () => {
                  setPendingKey(item.key)
                  try {
                    await item.onSelect()
                    if (!item.keepOpen) setOpen(false)
                  } finally {
                    setPendingKey(null)
                  }
                }}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
                {item.end}
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
