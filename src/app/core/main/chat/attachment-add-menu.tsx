"use client"

import { useRef, useState } from 'react'
import { AtSign, File, Folder, Image, Plus, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface AttachmentAddMenuProps {
  mobile: boolean
  disabled?: boolean
  onSelectImages: () => void
  onSelectFiles: () => void
  onSelectFolders: () => void
  onSelectResources: () => void
  onSelectSkills: () => void
}

const ACTION_GROUPS = [
  { id: 'attachments', actions: [
    { id: 'image', icon: Image },
    { id: 'file', icon: File },
    { id: 'folder', icon: Folder },
  ] },
  { id: 'context', actions: [
    { id: 'resource', icon: AtSign, shortcut: '@' },
    { id: 'skill', icon: Sparkles, shortcut: '/' },
  ] },
] as const

type AddAction = typeof ACTION_GROUPS[number]['actions'][number]

export function AttachmentAddMenu({
  mobile,
  disabled,
  onSelectImages,
  onSelectFiles,
  onSelectFolders,
  onSelectResources,
  onSelectSkills,
}: AttachmentAddMenuProps) {
  const [open, setOpen] = useState(false)
  const pendingActionRef = useRef<(() => void) | null>(null)
  const t = useTranslations('record.chat.input.addAttachment')

  const selectAction = (id: AddAction['id']) => {
    const actions = {
      image: onSelectImages,
      file: onSelectFiles,
      folder: onSelectFolders,
      resource: onSelectResources,
      skill: onSelectSkills,
    }
    setOpen(false)
    if (id === 'resource' || id === 'skill') {
      pendingActionRef.current = actions[id]
    } else {
      // 文件选择继续在用户点击时触发，保留浏览器所需的用户手势。
      actions[id]()
    }
  }

  // 关闭菜单后再聚焦输入框，避免弹层的焦点恢复覆盖新的选择菜单。
  const handleCloseAutoFocus = (event: Event) => {
    const action = pendingActionRef.current
    if (!action) return
    event.preventDefault()
    pendingActionRef.current = null
    requestAnimationFrame(action)
  }

  const renderAction = (action: AddAction) => {
    const Icon = action.icon
    return (
      <>
        <Icon data-icon="inline-start" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
          <span className="truncate">{t(`${action.id}.title`)}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{t(`${action.id}.description`)}</span>
        </span>
        {'shortcut' in action && <Kbd>{action.shortcut}</Kbd>}
      </>
    )
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
        <DrawerContent onCloseAutoFocus={handleCloseAutoFocus}>
          <DrawerHeader>
            <DrawerTitle>{t('title')}</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {ACTION_GROUPS.map((group, index) => (
              <div key={group.id} role="group" aria-label={t(`groups.${group.id}`)}>
                {index > 0 && <Separator className="my-2" />}
                <p className="px-3 py-2 text-xs font-medium text-muted-foreground">{t(`groups.${group.id}`)}</p>
                {group.actions.map(action => (
                  <Button key={action.id} type="button" variant="ghost" className="h-auto min-h-14 w-full justify-start gap-3 px-3 py-2.5" onClick={() => selectAction(action.id)}>
                    {renderAction(action)}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-72 max-w-[calc(100vw-2rem)] p-1.5" onCloseAutoFocus={handleCloseAutoFocus}>
        {ACTION_GROUPS.map((group, index) => (
          <DropdownMenuGroup key={group.id}>
            {index > 0 && <DropdownMenuSeparator className="my-1.5" />}
            <DropdownMenuLabel className="px-2 py-1.5 text-xs text-muted-foreground">{t(`groups.${group.id}`)}</DropdownMenuLabel>
            {group.actions.map(action => (
              <DropdownMenuItem key={action.id} className="gap-3 px-2 py-2.5" onSelect={() => selectAction(action.id)}>
                {renderAction(action)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
