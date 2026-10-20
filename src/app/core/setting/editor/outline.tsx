'use client'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ListTree, PanelLeft, PanelRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { OutlinePosition } from '@/lib/outline-preferences'
import { cn } from '@/lib/utils'
import useSettingStore from '@/stores/setting'


export default function Outline({ showPosition = true }: { showPosition?: boolean }) {
  const t = useTranslations('settings.editor')
  const {
    enableOutline,
    outlinePosition,
    setEnableOutline,
    setOutlinePosition,
  } = useSettingStore()

  return <>
    <Item variant="outline">
      <ItemMedia variant="icon">
        <ListTree />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('outlineEnable')}</ItemTitle>
        <ItemDescription>{t('outlineEnableDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={enableOutline}
          aria-label={t('outlineEnable')}
          onCheckedChange={(enabled) => void setEnableOutline(enabled)}
        />
      </ItemActions>
    </Item>
    {showPosition ? <Item
      variant="outline"
      aria-disabled={!enableOutline}
      className={cn(!enableOutline && 'opacity-60')}
    >
      <ItemMedia variant="icon">
        {outlinePosition === 'left' ? <PanelLeft /> : <PanelRight />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('outlinePosition')}</ItemTitle>
        <ItemDescription>{t('outlinePositionDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="basis-full sm:ml-auto sm:basis-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          value={outlinePosition}
          disabled={!enableOutline}
          className="w-full sm:w-auto"
          aria-label={t('outlinePosition')}
          onValueChange={(value) => {
            if (value) void setOutlinePosition(value as OutlinePosition)
          }}
        >
          <ToggleGroupItem value="left" className="flex-1 sm:flex-none">
            {t('outlinePositionOptions.left')}
          </ToggleGroupItem>
          <ToggleGroupItem value="right" className="flex-1 sm:flex-none">
            {t('outlinePositionOptions.right')}
          </ToggleGroupItem>
        </ToggleGroup>
      </ItemActions>
    </Item> : null}
  </>
}
