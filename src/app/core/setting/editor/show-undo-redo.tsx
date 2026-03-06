'use client'

import { Switch } from "@/components/ui/switch"
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useTranslations } from 'next-intl'
import useSettingStore from '@/stores/setting'

export default function ShowUndoRedo() {
  const t = useTranslations('settings.editor')
  const { showEditorUndoRedo, setShowEditorUndoRedo } = useSettingStore()

  return <Item variant="outline">
    <ItemContent>
      <ItemTitle>{t('showUndoRedo')}</ItemTitle>
      <ItemDescription>{t('showUndoRedoDesc')}</ItemDescription>
    </ItemContent>
    <ItemActions>
      <Switch
        checked={showEditorUndoRedo}
        onCheckedChange={setShowEditorUndoRedo}
      />
    </ItemActions>
  </Item>
}
