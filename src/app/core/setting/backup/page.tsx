'use client'

import { ArchiveRestore } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SettingType } from '@/app/core/setting/components/setting-base'
import { BackupSettings } from './backup-settings'

export default function BackupPage() {
  const t = useTranslations('settings.backup')

  return (
    <SettingType id="backup" title={t('title')} desc={t('desc')} icon={<ArchiveRestore className="size-5" />}>
      <BackupSettings />
    </SettingType>
  )
}
