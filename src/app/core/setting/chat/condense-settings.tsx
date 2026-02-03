'use client'

import { useTranslations } from 'next-intl'
import {
  Item,
  ItemMedia,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { ModelSelect } from '../components/model-select'
import { FileText, Shield, AlignLeft, MessageSquare } from 'lucide-react'
import useSettingStore from '@/stores/setting'

export function CondenseSettings() {
  const t = useTranslations('settings.chat.condense')
  const {
    enableCondense,
    setEnableCondense,
    keepLatestCount,
    setKeepLatestCount,
    condenseMaxLength,
    setCondenseMaxLength,
  } = useSettingStore()

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-4">{t('title')}</h3>

      {/* 启用摘要 */}
      <Item variant="outline">
        <ItemMedia variant="icon">
          <MessageSquare className="size-4" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{t('enable.title')}</ItemTitle>
          <ItemDescription>{t('enable.desc')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            checked={enableCondense}
            onCheckedChange={setEnableCondense}
          />
        </ItemActions>
      </Item>

      {enableCondense && (
        <>
          {/* 摘要模型 */}
          <Item variant="outline">
            <ItemMedia variant="icon">
              <FileText className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('model.title')}</ItemTitle>
              <ItemDescription>{t('model.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ModelSelect modelKey="condense" />
            </ItemActions>
          </Item>

          {/* 保留最新条数 */}
          <Item variant="outline">
            <ItemMedia variant="icon">
              <Shield className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('keepLatest.title')}</ItemTitle>
              <ItemDescription>{t('keepLatest.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="space-y-3 w-[180px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">1</span>
                  <span className="text-xs font-medium">{keepLatestCount}</span>
                  <span className="text-xs text-muted-foreground">10</span>
                </div>
                <Slider
                  value={[keepLatestCount]}
                  onValueChange={(value) => setKeepLatestCount(value[0])}
                  min={1}
                  max={10}
                  step={1}
                  className="w-full"
                />
              </div>
            </ItemActions>
          </Item>

          {/* 摘要长度限制 */}
          <Item variant="outline">
            <ItemMedia variant="icon">
              <AlignLeft className="size-4" />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{t('maxLength.title')}</ItemTitle>
              <ItemDescription>{t('maxLength.desc')}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <div className="space-y-3 w-[180px]">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">50</span>
                  <span className="text-xs font-medium">{condenseMaxLength}</span>
                  <span className="text-xs text-muted-foreground">500</span>
                </div>
                <Slider
                  value={[condenseMaxLength]}
                  onValueChange={(value) => setCondenseMaxLength(value[0])}
                  min={50}
                  max={500}
                  step={10}
                  className="w-full"
                />
              </div>
            </ItemActions>
          </Item>
        </>
      )}
    </div>
  )
}
