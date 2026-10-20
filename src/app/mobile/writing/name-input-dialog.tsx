'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCallback, useRef } from 'react'
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from '@/components/responsive-dialog'

interface NameInputDialogProps {
  open: boolean
  title: string
  placeholder?: string
  confirmText: string
  cancelText: string
  value: string
  loading?: boolean
  onChange: (value: string) => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

export function NameInputDialog({
  open,
  title,
  placeholder,
  confirmText,
  cancelText,
  value,
  loading = false,
  onChange,
  onConfirm,
  onOpenChange,
}: NameInputDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  const handleOpenAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
  }, [])

  const handleAnimationEnd = useCallback((event: React.AnimationEvent<HTMLDivElement>) => {
    if (!open || event.currentTarget.dataset.state !== 'open') return

    inputRef.current?.focus()
  }, [open])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        className="p-4 sm:max-w-sm"
        onOpenAutoFocus={handleOpenAutoFocus}
        onAnimationEnd={handleAnimationEnd}
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onConfirm()
            }
          }}
        />
        <ResponsiveDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {cancelText}
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={loading || !value.trim()}
          >
            {confirmText}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
