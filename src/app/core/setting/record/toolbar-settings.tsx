'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Highlighter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { RecordToolbarDialog } from '../general/tool-settings/record-toolbar-dialog'

export function ToolbarSettings() {
  const t = useTranslations('settings.record.toolbar')
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <div className="space-y-4">
        <h3 className="text-lg font-semibold mb-4">{t('title')}</h3>

        <Item variant="outline">
          <ItemMedia variant="icon">
            <Highlighter className="size-4" />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t('recordToolbar.title')}</ItemTitle>
            <ItemDescription>{t('recordToolbar.desc')}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              {t('recordToolbar.button')}
            </Button>
          </ItemActions>
        </Item>
      </div>

      <RecordToolbarDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
