'use client'

import { WrapText } from 'lucide-react'
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

export default function SourceWrap() {
  const t = useTranslations('settings.editor.sourceWrap')
  const { editorSourceWrap, setEditorSourceWrap } = useSettingStore()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <WrapText />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={editorSourceWrap}
          aria-label={t('title')}
          onCheckedChange={(wrap) => void setEditorSourceWrap(wrap)}
        />
      </ItemActions>
    </Item>
  )
}
