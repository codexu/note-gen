'use client'

import { Code2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { EditorViewMode } from '@/lib/editor-layout-styles'
import useSettingStore from '@/stores/setting'

const viewModeOptions: EditorViewMode[] = ['visual', 'source']

export default function EditorMode() {
  const t = useTranslations('settings.editor.mode')
  const { editorViewMode, setEditorViewMode } = useSettingStore()

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Code2 />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          value={editorViewMode}
          className="w-full sm:w-auto"
          aria-label={t('title')}
          onValueChange={(value) => {
            if (value) void setEditorViewMode(value as EditorViewMode)
          }}
        >
          {viewModeOptions.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className="flex-1 sm:flex-none"
              aria-label={t(`options.${option}`)}
            >
              {t(`options.${option}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </ItemActions>
    </Item>
  )
}
