'use client'

import { useTranslations } from 'next-intl'
import { ThemeSettings } from './theme'
import { LanguageSettings } from './language'

export function InterfaceSettings() {
  const t = useTranslations('settings.general.interface')

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-4">{t('title')}</h3>
      <ThemeSettings />
      <LanguageSettings />
    </div>
  )
}
