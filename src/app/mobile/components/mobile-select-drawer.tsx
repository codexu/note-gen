'use client'

import { ReactNode, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { cn } from '@/lib/utils'

export type MobileSelectDrawerOption = {
  value: string
  label: ReactNode
}

interface MobileSelectDrawerProps {
  title: string
  value: string
  options: MobileSelectDrawerOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
  placeholder?: ReactNode
}

export function MobileSelectDrawer({
  title,
  value,
  options,
  onValueChange,
  disabled,
  id,
  className,
  placeholder,
}: MobileSelectDrawerProps) {
  const [open, setOpen] = useState(false)
  const selectedOption = useMemo(
    () => options.find(option => option.value === value),
    [options, value],
  )

  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        disabled={disabled}
        className={cn('h-10 w-full justify-between px-3 font-normal', className)}
        onClick={() => setOpen(true)}
      >
        <span className={cn('truncate', !selectedOption && 'text-muted-foreground')}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" />
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            {options.map(option => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                className="h-12 w-full justify-start px-3"
                onClick={() => {
                  onValueChange(option.value)
                  setOpen(false)
                }}
              >
                <span className="truncate">{option.label}</span>
                {option.value === value ? <Check className="ml-auto" aria-hidden="true" /> : null}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
