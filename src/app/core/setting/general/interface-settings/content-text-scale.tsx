'use client'
import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Type } from 'lucide-react'
import { Slider } from "@/components/ui/slider"
import useSettingStore from '@/stores/setting'

export function ContentTextScaleSettings() {
  const t = useTranslations('settings.general.interface')
  const { contentTextScale, setContentTextScale } = useSettingStore()

  const handleScaleChange = (value: number[]) => {
    setContentTextScale(value[0])
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><Type className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('contentTextScale.title')}</ItemTitle>
        <ItemDescription>{t('contentTextScale.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <div className="space-y-3 w-[180px]">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">75%</span>
            <span className="text-xs font-medium">{contentTextScale}%</span>
            <span className="text-xs text-muted-foreground">150%</span>
          </div>
          <Slider
            value={[contentTextScale]}
            onValueChange={handleScaleChange}
            min={75}
            max={150}
            step={1}
            className="w-full"
          />
        </div>
      </ItemActions>
    </Item>
  )
}