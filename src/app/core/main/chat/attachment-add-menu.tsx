"use client"

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AttachmentAddMenuProps {
  mobile: boolean
  disabled?: boolean
  onSelectImages: () => void
  onSelectFiles: () => void
  onSelectFolders: () => void
}

const ACTIONS = ['image', 'file', 'folder'] as const

export function AttachmentAddMenu({
  mobile,
  disabled,
  onSelectImages,
  onSelectFiles,
  onSelectFolders,
}: AttachmentAddMenuProps) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('record.chat.input.addAttachment')

  const selectAction = (id: typeof ACTIONS[number]) => {
    setOpen(false)
    if (id === 'image') onSelectImages()
    if (id === 'file') onSelectFiles()
    if (id === 'folder') onSelectFolders()
  }

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground"
      disabled={disabled}
      aria-label={t('title')}
      title={t('title')}
    >
      <Plus data-icon="inline-start" />
    </Button>
  )

  if (mobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('title')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-4 pb-6">
            {ACTIONS.map((id) => (
              <Button key={id} type="button" variant="ghost" className="h-12 justify-start gap-3" onClick={() => selectAction(id)}>
                {t(`${id}.title`)}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-48">
        <DropdownMenuGroup>
          {ACTIONS.map((id) => (
            <DropdownMenuItem key={id} className="h-9 gap-2 px-2" onSelect={() => selectAction(id)}>
              {t(`${id}.title`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
