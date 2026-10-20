'use client'

import { ChartNoAxesColumnIncreasing } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'
import useSettingStore from '@/stores/setting'

export default function ShowEditorStats() {
  const t = useTranslations('settings.editor.stats')
  const { showEditorStats, setShowEditorStats } = useSettingStore()
  const [saving, setSaving] = useState(false)

  async function updateSetting(show: boolean) {
    setSaving(true)
    try {
      await setShowEditorStats(show)
    } catch {
      toast.error(t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <ChartNoAxesColumnIncreasing />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{t('title')}</ItemTitle>
        <ItemDescription>{t('desc')}</ItemDescription>
      </ItemContent>
      <ItemActions className="mobile-setting-inline-action">
        <Switch
          checked={showEditorStats}
          disabled={saving}
          aria-label={t('title')}
          onCheckedChange={(show) => void updateSetting(show)}
        />
      </ItemActions>
    </Item>
  )
}
