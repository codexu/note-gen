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
import { SettingSection } from '../components/setting-base'

export function ModelSettings() {
  const t = useTranslations('settings.record.model')

  return (
    <SettingSection title={t('title')}>
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
    </SettingSection>
  )
}
