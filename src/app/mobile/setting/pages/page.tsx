'use client'

import { useTranslations } from 'next-intl'

import { SettingTab } from '../components/setting-tab'

export default function MobileSettingsIndexPage() {
  const tMe = useTranslations('mobile.me')

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{tMe('settings.description')}</p>
      <SettingTab />
    </div>
  )
}
