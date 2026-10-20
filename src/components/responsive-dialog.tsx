'use client'

import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

const ResponsiveDialogContext = createContext(false)

export function ResponsiveDialog({
  children,
  ...props
}: ComponentProps<typeof Dialog>) {
  const isMobile = useIsMobile()

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      {isMobile
        ? <Drawer {...props}>{children}</Drawer>
        : <Dialog {...props}>{children}</Dialog>}
    </ResponsiveDialogContext.Provider>
  )
}

export function ResponsiveDialogTrigger(props: ComponentProps<typeof DialogTrigger>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerTrigger {...props} /> : <DialogTrigger {...props} />
}

export function ResponsiveDialogClose(props: ComponentProps<typeof DialogClose>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerClose {...props} /> : <DialogClose {...props} />
}

export function ResponsiveDialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogContent> & { children?: ReactNode }) {
  const isMobile = useContext(ResponsiveDialogContext)
  if (isMobile) {
    const { showCloseButton: _showCloseButton, ...drawerProps } = props
    void _showCloseButton
    return (
      <DrawerContent
        className={cn(className, 'max-h-[92vh] !w-full !max-w-none')}
        {...drawerProps}
      >
        {children}
      </DrawerContent>
    )
  }
  return <DialogContent className={className} {...props}>{children}</DialogContent>
}

export function ResponsiveDialogHeader(props: ComponentProps<typeof DialogHeader>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerHeader {...props} /> : <DialogHeader {...props} />
}

export function ResponsiveDialogFooter(props: ComponentProps<typeof DialogFooter>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerFooter {...props} /> : <DialogFooter {...props} />
}

export function ResponsiveDialogTitle(props: ComponentProps<typeof DialogTitle>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerTitle {...props} /> : <DialogTitle {...props} />
}

export function ResponsiveDialogDescription(props: ComponentProps<typeof DialogDescription>) {
  const isMobile = useContext(ResponsiveDialogContext)
  return isMobile ? <DrawerDescription {...props} /> : <DialogDescription {...props} />
}
