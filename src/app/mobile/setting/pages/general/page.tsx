'use client'

import { useTranslations } from 'next-intl'
import { InterfaceSettings } from '@/app/core/setting/general/interface-settings'
import { AdvancedSettings } from '@/app/core/setting/general/advanced-settings'
import { SettingType } from '@/app/core/setting/components/setting-base'
import { ReopenSetup } from '@/components/initial-setup/reopen-setup'

export default function GeneralSettingsPage() {
  const t = useTranslations('settings.general')

  return (
    <SettingType id="general" title={t('title')} desc={t('desc')}>
      <ReopenSetup />
      <InterfaceSettings mobile />
      <AdvancedSettings showConfigFileActions={false} />
    </SettingType>
  )
}
