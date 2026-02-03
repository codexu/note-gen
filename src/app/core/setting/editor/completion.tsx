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
import { Zap } from 'lucide-react'
import { ModelSelect } from '../components/model-select'

export default function Completion() {
  const t = useTranslations('settings.editor.completion')

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Zap className="size-4" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('model.title')}</ItemTitle>
        <ItemDescription>{t('model.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <ModelSelect modelKey="completion" />
      </ItemActions>
    </Item>
  )
}
