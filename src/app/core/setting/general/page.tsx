'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { Settings } from 'lucide-react'
import { InterfaceSettings } from './interface-settings'

export default function GeneralSettingsPage() {
  const t = useTranslations('settings.general')

  return (
    <SettingType
      id="general"
      title={t('title')}
      desc={t('desc')}
      icon={<Settings className="size-4 lg:size-6" />}
    >
      <InterfaceSettings />
    </SettingType>
  )
}
