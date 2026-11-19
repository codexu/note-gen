'use client'

import { useTranslations } from 'next-intl'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { useInitialSetupStore } from '@/stores/initial-setup'

export function ReopenSetup() {
  const t = useTranslations('initialSetup')
  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Compass /></ItemMedia>
      <ItemContent><ItemTitle>{t('reopen.title')}</ItemTitle><ItemDescription>{t('reopen.description')}</ItemDescription></ItemContent>
      <ItemActions>
        <Button type="button" variant="outline" onClick={() => void useInitialSetupStore.getState().open()}>
          {t('reopen.action')}
        </Button>
      </ItemActions>
    </Item>
  )
}
