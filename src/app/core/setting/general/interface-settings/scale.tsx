'use client'

import { useTranslations } from 'next-intl'
import { Item, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { ZoomIn } from 'lucide-react'
import { Slider } from "@/components/ui/slider"
import useSettingStore from '@/stores/setting'
import { useEffect } from 'react'

export function ScaleSettings() {
  const t = useTranslations('settings.general.interface')
  const { uiScale, setUiScale } = useSettingStore()

  // 初始化时应用缩放
  useEffect(() => {
    document.documentElement.style.fontSize = `${uiScale}%`
  }, [])

  const handleScaleChange = (value: number[]) => {
    setUiScale(value[0])
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon"><ZoomIn className="size-4" /></ItemMedia>
      <ItemContent>
        <ItemTitle>{t('scale.title')}</ItemTitle>
        <ItemDescription>{t('scale.desc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <div className="space-y-3 w-[180px]">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">75%</span>
            <span className="text-xs font-medium">{uiScale}%</span>
            <span className="text-xs text-muted-foreground">150%</span>
          </div>
          <Slider
            value={[uiScale]}
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
