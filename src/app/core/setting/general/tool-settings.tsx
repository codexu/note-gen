'use client'

import { useTranslations } from 'next-intl'

export function ToolSettings() {
  const t = useTranslations('settings.general')

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('tools.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('tools.desc')}</p>
    </div>
  )
}
