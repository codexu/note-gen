'use client'

import { useTranslations } from 'next-intl'
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
  ItemGroup,
} from '@/components/ui/item'
import { Bot, PenTool } from 'lucide-react'
import { ModelSelect } from './model-select'
import { SettingSection } from './setting-base'

interface DefaultModelsSettingsProps {
  type: 'editor' | 'record'
}

export function DefaultModelsSettings({ type }: DefaultModelsSettingsProps) {
  const t = useTranslations('settings')

  return (
    <SettingSection title={t('defaultModels.title')}>
      <ItemGroup>
        {/* Record - MarkDesc */}
        {type === 'record' && (
          <Item variant="outline">
            <ItemMedia variant="icon">
              <PenTool />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('record.model.markDesc.title')}</ItemTitle>
              <ItemDescription>{t('record.model.markDesc.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="markDesc" />
            </ItemActions>
          </Item>
        )}

        {/* Editor - use the app-wide primary model */}
        {type === 'editor' && (
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Bot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('defaultModels.followPrimary.title')}</ItemTitle>
              <ItemDescription>{t('defaultModels.followPrimary.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect
                modelKey="editor"
                emptyLabel={t('defaultModels.followPrimary.value')}
                clearTooltip={t('defaultModels.followPrimary.value')}
              />
            </ItemActions>
          </Item>
        )}
      </ItemGroup>
    </SettingSection>
  )
}
