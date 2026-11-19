'use client'

import { FileUp } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SettingType } from '../components/setting-base'
import { SyncSettings } from './sync-settings'

export default function SyncPage() {
  const t = useTranslations('settings.sync')
  return (
    <SettingType id="sync" icon={<FileUp />} title={t('title')} desc={t('desc')}>
      <SyncSettings />
    </SettingType>
  )
}
