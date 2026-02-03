'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { ChatToolbarDialog } from '../general/tool-settings/chat-toolbar-dialog'

export function ToolbarSettings() {
  const t = useTranslations('settings.chat.toolbar')
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Item variant="outline">
        <ItemMedia variant="icon"><Wrench className="size-4" /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('chatToolbar.title')}</ItemTitle>
          <ItemDescription>{t('chatToolbar.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            {t('chatToolbar.button')}
          </Button>
        </ItemActions>
      </Item>
      <ChatToolbarDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
