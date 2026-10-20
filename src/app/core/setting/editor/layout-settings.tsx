'use client'

import { AlignCenterHorizontal, TextCursorInput } from 'lucide-react'
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
import type {
  EditorContentWidth,
  EditorLineHeight,
} from '@/lib/editor-layout-styles'
import useSettingStore from '@/stores/setting'

const contentWidthOptions: EditorContentWidth[] = ['narrow', 'standard', 'wide', 'full']
const lineHeightOptions: EditorLineHeight[] = ['compact', 'comfortable', 'relaxed']

export default function LayoutSettings({
  showContentWidth = true,
}: {
  showContentWidth?: boolean
}) {
  const t = useTranslations('settings.editor.layout')
  const {
    editorContentWidth,
    editorLineHeight,
    setEditorContentWidth,
    setEditorLineHeight,
  } = useSettingStore()

  return (
    <>
      {showContentWidth ? <Item variant="outline">
        <ItemMedia variant="icon">
          <AlignCenterHorizontal />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('contentWidth.title')}</ItemTitle>
          <ItemDescription>{t('contentWidth.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            value={editorContentWidth}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('contentWidth.title')}
            onValueChange={(value) => {
              if (value) void setEditorContentWidth(value as EditorContentWidth)
            }}
          >
            {contentWidthOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`contentWidth.options.${option}`)}
              >
                {t(`contentWidth.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ItemActions>
      </Item> : null}

      <Item variant="outline">
        <ItemMedia variant="icon">
          <TextCursorInput />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('lineHeight.title')}</ItemTitle>
          <ItemDescription>{t('lineHeight.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            value={editorLineHeight}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('lineHeight.title')}
            onValueChange={(value) => {
              if (value) void setEditorLineHeight(value as EditorLineHeight)
            }}
          >
            {lineHeightOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`lineHeight.options.${option}`)}
              >
                {t(`lineHeight.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ItemActions>
      </Item>
    </>
  )
}
