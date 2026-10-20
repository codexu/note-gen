'use client'

import { PanelBottom } from 'lucide-react'
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

export default function ShowMobileToolbar() {
  const t = useTranslations('settings.editor.mobileToolbar')
  const { showMobileEditorToolbar, setShowMobileEditorToolbar } = useSettingStore()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <PanelBottom />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={showMobileEditorToolbar}
          aria-label={t('title')}
          onCheckedChange={(show) => void setShowMobileEditorToolbar(show)}
        />
      </ItemActions>
    </Item>
  )
}
