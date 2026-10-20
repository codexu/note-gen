'use client'

import { ArrowDownNarrowWide, LayoutGrid } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type {
  RecordSortMode,
  RecordViewMode,
} from '@/lib/record-display-preferences'
import useSettingStore from '@/stores/setting'

const viewOptions: RecordViewMode[] = ['list', 'compact', 'cards']
const sortOptions: RecordSortMode[] = ['newest', 'oldest', 'type']

export function DisplaySettings() {
  const t = useTranslations('settings.record.display')
  const {
    recordViewMode,
    recordSortMode,
    setRecordViewMode,
    setRecordSortMode,
  } = useSettingStore()

  return (
    <ItemGroup>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <LayoutGrid />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('view.title')}</ItemTitle>
          <ItemDescription>{t('view.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            value={recordViewMode}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('view.title')}
            onValueChange={(value) => {
              if (value) void setRecordViewMode(value as RecordViewMode)
            }}
          >
            {viewOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`view.options.${option}`)}
              >
                {t(`view.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <ArrowDownNarrowWide />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('sort.title')}</ItemTitle>
          <ItemDescription>{t('sort.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            value={recordSortMode}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('sort.title')}
            onValueChange={(value) => {
              if (value) void setRecordSortMode(value as RecordSortMode)
            }}
          >
            {sortOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`sort.options.${option}`)}
              >
                {t(`sort.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
