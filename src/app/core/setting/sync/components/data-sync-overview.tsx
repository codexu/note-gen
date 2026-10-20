'use client'

import { Database, MessageSquare, Settings2, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { Switch } from '@/components/ui/switch'

interface DataSyncOverviewProps {
  mobile?: boolean
  autoRecordSyncEnabled: boolean
  autoSettingsSyncEnabled: boolean
  autoConversationSyncEnabled: boolean
  excludeSensitiveConfig: boolean
  onRecordSyncChange: (checked: boolean) => void
  onSettingsSyncChange: (checked: boolean) => void
  onConversationSyncChange: (checked: boolean) => void
  onSensitiveConfigChange: (checked: boolean) => void
}

export function DataSyncOverview({
  mobile = false,
  autoRecordSyncEnabled,
  autoSettingsSyncEnabled,
  autoConversationSyncEnabled,
  excludeSensitiveConfig,
  onRecordSyncChange,
  onSettingsSyncChange,
  onConversationSyncChange,
  onSensitiveConfigChange,
}: DataSyncOverviewProps) {
  const t = useTranslations()

  const items = (
    <ItemGroup className="gap-2">
      <Item variant="outline" size="sm" className="mobile-setting-inline-item">
        <ItemMedia variant="icon"><Database /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('settings.sync.autoRecordSync')}</ItemTitle>
          <ItemDescription>{t('settings.sync.autoRecordSyncDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="mobile-setting-inline-action">
          <Switch
            checked={autoRecordSyncEnabled}
            onCheckedChange={onRecordSyncChange}
            aria-label={t('settings.sync.autoRecordSync')}
          />
        </ItemActions>
      </Item>

      <Item variant="outline" size="sm" className="mobile-setting-inline-item">
        <ItemMedia variant="icon"><Settings2 /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('settings.sync.autoSettingsSync')}</ItemTitle>
          <ItemDescription>{t('settings.sync.autoSettingsSyncDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="mobile-setting-inline-action">
          <Switch
            checked={autoSettingsSyncEnabled}
            onCheckedChange={onSettingsSyncChange}
            aria-label={t('settings.sync.autoSettingsSync')}
          />
        </ItemActions>
      </Item>

      <Item variant="outline" size="sm" className="mobile-setting-inline-item">
        <ItemMedia variant="icon"><MessageSquare /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('settings.sync.autoConversationSync')}</ItemTitle>
          <ItemDescription>{t('settings.sync.autoConversationSyncDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="mobile-setting-inline-action">
          <Switch
            checked={autoConversationSyncEnabled}
            onCheckedChange={onConversationSyncChange}
            aria-label={t('settings.sync.autoConversationSync')}
          />
        </ItemActions>
      </Item>

      <Item
        variant={excludeSensitiveConfig ? 'muted' : 'warning'}
        size="sm"
        className="mobile-setting-inline-item"
      >
        <ItemMedia variant="icon"><ShieldCheck /></ItemMedia>
        <ItemContent>
          <ItemTitle>{t('settings.sync.autoDataSyncPrivacyTitle')}</ItemTitle>
          <ItemDescription>{t('settings.sync.autoDataSyncPrivacyDesc')}</ItemDescription>
        </ItemContent>
        <ItemActions className="mobile-setting-inline-action">
          <Switch
            checked={excludeSensitiveConfig}
            onCheckedChange={onSensitiveConfigChange}
            aria-label={t('settings.sync.autoDataSyncPrivacyTitle')}
          />
        </ItemActions>
      </Item>
    </ItemGroup>
  )

  if (mobile) {
    return (
      <section className="flex flex-col gap-3">
        <header className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">{t('settings.sync.recordConfigSettings')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.sync.recordConfigSettingsDesc')}</p>
        </header>
        {items}
      </section>
    )
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{t('settings.sync.recordConfigSettings')}</CardTitle>
        <CardDescription>{t('settings.sync.recordConfigSettingsDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items}
      </CardContent>
    </Card>
  )
}
