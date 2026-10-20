'use client'

import { useTranslations } from 'next-intl'
import { SettingSection } from '../components/setting-base'

export function ToolSettings() {
  const t = useTranslations('settings.general')

  return <SettingSection title={t('tools.title')} desc={t('tools.desc')} />
}
