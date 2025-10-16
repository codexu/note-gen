'use client'

import { Switch } from '@/components/ui/switch'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { useMcpStore } from '@/stores/mcp'
import { useTranslations } from 'next-intl'

export function GlobalSettings() {
  const t = useTranslations('settings.mcp')
  const { enabled, setEnabled } = useMcpStore()
  
  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('enableTitle')}</ItemTitle>
        <ItemDescription>{t('enableDesc')}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </ItemActions>
    </Item>
  )
}
