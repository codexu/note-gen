'use client'

import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

const ResponsivePopoverContext = createContext({
  isMobile: false,
  mobileTitle: '',
})

interface ResponsivePopoverProps extends ComponentProps<typeof Popover> {
  mobileTitle: string
}

export function ResponsivePopover({
  children,
  mobileTitle,
  ...props
}: ResponsivePopoverProps) {
  const isMobile = useIsMobile()

  return (
    <ResponsivePopoverContext.Provider value={{ isMobile, mobileTitle }}>
      {isMobile
        ? <Drawer {...props}>{children}</Drawer>
        : <Popover {...props}>{children}</Popover>}
    </ResponsivePopoverContext.Provider>
  )
}

export function ResponsivePopoverTrigger(props: ComponentProps<typeof PopoverTrigger>) {
  const { isMobile } = useContext(ResponsivePopoverContext)
  return isMobile ? <DrawerTrigger {...props} /> : <PopoverTrigger {...props} />
}

export function ResponsivePopoverContent({
  className,
  children,
  ...props
}: ComponentProps<typeof PopoverContent> & { children?: ReactNode }) {
  const { isMobile, mobileTitle } = useContext(ResponsivePopoverContext)

  if (isMobile) {
    const {
      align: _align,
      side: _side,
      sideOffset: _sideOffset,
      collisionPadding: _collisionPadding,
      onOpenAutoFocus: _onOpenAutoFocus,
      onCloseAutoFocus: _onCloseAutoFocus,
      ...drawerProps
    } = props
    void [
      _align,
      _side,
      _sideOffset,
      _collisionPadding,
      _onOpenAutoFocus,
      _onCloseAutoFocus,
    ]
    return (
      <DrawerContent className={cn(className, 'max-h-[85vh] !w-full !max-w-none')} {...drawerProps}>
        <DrawerHeader>
          <DrawerTitle>{mobileTitle}</DrawerTitle>
        </DrawerHeader>
        {children}
      </DrawerContent>
    )
  }

  return <PopoverContent className={className} {...props}>{children}</PopoverContent>
}
