'use client'

import { Switch } from "@/components/ui/switch"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions, ItemMedia } from '@/components/ui/item'
import { Undo2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'

export default function ShowUndoRedo() {
  const t = useTranslations('settings.editor')
  const { showEditorUndoRedo, setShowEditorUndoRedo } = useSettingStore()

  return <Item variant="outline">
    <ItemMedia variant="icon">
      <Undo2 />
    </ItemMedia>
    <ItemContent>
      <ItemTitle>{t('showUndoRedo')}</ItemTitle>
      <ItemDescription>{t('showUndoRedoDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions className="mobile-setting-inline-action">
      <Switch
        checked={showEditorUndoRedo}
        aria-label={t('showUndoRedo')}
        onCheckedChange={(show) => void setShowEditorUndoRedo(show)}
      />
    </ItemActions>
  </Item>
}
