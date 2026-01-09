'use client'

import { useTranslations } from 'next-intl'
import { ThemeSettings } from './theme'
import { LanguageSettings } from './language'
import { ScaleSettings } from './scale'
import { ContentTextScaleSettings } from './content-text-scale'
import { FileManagerTextSizeSettings } from './file-manager-text-size'
import { RecordTextSizeSettings } from './record-text-size'
import { CustomThemeSettings } from './custom-theme'
import { TraySettings } from './tray-settings'

export function InterfaceSettings() {
  const t = useTranslations('settings.general.interface')

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-4">{t('title')}</h3>
      <ThemeSettings />
      <LanguageSettings />
      <ScaleSettings />
      <ContentTextScaleSettings />
      <FileManagerTextSizeSettings />
      <RecordTextSizeSettings />
      <CustomThemeSettings />
      <TraySettings />
    </div>
  )
}
