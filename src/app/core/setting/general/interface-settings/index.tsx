'use client'
import { ThemeSettings } from './theme'
import { LanguageSettings } from './language'
import { ScaleSettings } from './scale'
import { ContentTextScaleSettings } from './content-text-scale'
import { FileManagerTextSizeSettings } from './file-manager-text-size'
import { RecordTextSizeSettings } from './record-text-size'
import { CustomThemeSettings } from './custom-theme'

export function InterfaceSettings() {

  return (
    <div className="space-y-4">
      <ThemeSettings />
      <LanguageSettings />
      <ScaleSettings />
      <ContentTextScaleSettings />
      <FileManagerTextSizeSettings />
      <RecordTextSizeSettings />
      <CustomThemeSettings />
    </div>
  )
}
