'use client'

import { useTranslations } from 'next-intl'
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '@/components/ui/item'
import { BotMessageSquare } from 'lucide-react'
import { ModelSelect } from '../components/model-select'

export function PrimaryModelSettings() {
  const t = useTranslations('settings.chat.primaryModel')

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <BotMessageSquare className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('model.title')}</ItemTitle>
        <ItemDescription>{t('model.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ModelSelect modelKey="primaryModel" />
      </ItemActions>
    </Item>
  )
}
