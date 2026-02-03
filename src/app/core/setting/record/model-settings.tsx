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
import { PenTool } from 'lucide-react'
import { ModelSelect } from '../components/model-select'

export function ModelSettings() {
  const t = useTranslations('settings.record.model')

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-4">{t('title')}</h3>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <PenTool className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('markDesc.title')}</ItemTitle>
          <ItemDescription>{t('markDesc.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ModelSelect modelKey="markDesc" />
        </ItemActions>
      </Item>
    </div>
  )
}
