'use client'

import { ListOrdered } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'

export default function ShowSourceLineNumbers() {
  const t = useTranslations('settings.editor.sourceLineNumbers')
  const { showSourceLineNumbers, setShowSourceLineNumbers } = useSettingStore()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <ListOrdered />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={showSourceLineNumbers}
          aria-label={t('title')}
          onCheckedChange={(show) => void setShowSourceLineNumbers(show)}
        />
      </ItemActions>
    </Item>
  )
}
