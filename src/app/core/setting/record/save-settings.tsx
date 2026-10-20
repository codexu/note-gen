'use client'

import { FolderInput, MousePointerClick } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { ResponsiveSelect } from '@/components/responsive-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type {
  RecordCompletionBehavior,
  RecordSaveTargetMode,
} from '@/lib/record-save-preferences'
import useSettingStore from '@/stores/setting'
import useTagStore from '@/stores/tag'

const saveTargetOptions: RecordSaveTargetMode[] = ['current', 'last', 'fixed']
const completionOptions: RecordCompletionBehavior[] = ['stay', 'highlight', 'open']

export function SaveSettings() {
  const t = useTranslations('settings.record.save')
  const {
    recordSaveTargetMode,
    fixedRecordTagId,
    recordCompletionBehavior,
    setRecordSaveTargetMode,
    setFixedRecordTagId,
    setRecordCompletionBehavior,
  } = useSettingStore()
  const { currentTagId, tags, initTags, fetchTags } = useTagStore()

  useEffect(() => {
    void Promise.all([initTags(), fetchTags()])
  }, [fetchTags, initTags])

  useEffect(() => {
    if (
      recordSaveTargetMode !== 'fixed' ||
      tags.length === 0 ||
      tags.some((tag) => tag.id === fixedRecordTagId)
    ) {
      return
    }

    const fallbackTagId = tags.find((tag) => tag.id === currentTagId)?.id ?? tags[0].id
    void setFixedRecordTagId(fallbackTagId)
  }, [
    currentTagId,
    fixedRecordTagId,
    recordSaveTargetMode,
    setFixedRecordTagId,
    tags,
  ])

  const handleSaveTargetChange = async (value: string) => {
    const mode = value as RecordSaveTargetMode
    if (mode === 'fixed' && !tags.some((tag) => tag.id === fixedRecordTagId)) {
      const fallbackTagId = tags.find((tag) => tag.id === currentTagId)?.id ?? tags[0]?.id ?? null
      await setFixedRecordTagId(fallbackTagId)
    }
    await setRecordSaveTargetMode(mode)
  }

  return (
    <ItemGroup>
      <Item variant="outline">
        <ItemMedia variant="icon">
          <FolderInput />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('target.title')}</ItemTitle>
          <ItemDescription>{t('target.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full flex-col items-stretch sm:ml-auto sm:basis-auto sm:items-end">
          <ToggleGroup
            type="single"
            variant="outline"
            value={recordSaveTargetMode}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('target.title')}
            onValueChange={(value) => {
              if (value) void handleSaveTargetChange(value)
            }}
          >
            {saveTargetOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`target.options.${option}`)}
              >
                {t(`target.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {recordSaveTargetMode === 'fixed' ? (
            <ResponsiveSelect
              title={t('target.fixedLabel')}
              value={fixedRecordTagId ? String(fixedRecordTagId) : ''}
              onValueChange={(value) => void setFixedRecordTagId(Number(value))}
              className="w-full sm:w-52"
              placeholder={t('target.fixedPlaceholder')}
              options={tags.map(tag => ({
                value: String(tag.id),
                label: tag.name,
              }))}
            />
          ) : null}
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <MousePointerClick />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('completion.title')}</ItemTitle>
          <ItemDescription>{t('completion.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
          <ToggleGroup
            type="single"
            variant="outline"
            value={recordCompletionBehavior}
            className="w-full flex-wrap sm:w-auto"
            aria-label={t('completion.title')}
            onValueChange={(value) => {
              if (value) void setRecordCompletionBehavior(value as RecordCompletionBehavior)
            }}
          >
            {completionOptions.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-1 sm:flex-none"
                aria-label={t(`completion.options.${option}`)}
              >
                {t(`completion.options.${option}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </ItemActions>
      </Item>
    </ItemGroup>
  )
}
