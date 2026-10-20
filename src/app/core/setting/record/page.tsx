'use client'

import { useTranslations } from 'next-intl'
import { SettingSection, SettingType } from '../components/setting-base'
import { PenTool } from 'lucide-react'
import { DefaultModelsSettings } from '../components/default-models-settings'
import { ToolbarSettings } from './toolbar-settings'
import { DisplaySettings } from './display-settings'
import { SaveSettings } from './save-settings'
import { WebClipperSettings } from './web-clipper-settings'

export default function RecordSettingPage() {
  const t = useTranslations('settings.record')
  const webClipperT = useTranslations('settings.webClipper')

  return (
    <SettingType
      id="record"
      icon={<PenTool className="size-4 lg:size-6" />}
      title={t('title')}
      desc={t('desc')}
    >
      <div className="flex flex-col gap-6">
        <DefaultModelsSettings type="record" />
        <SettingSection title={t('display.title')} desc={t('display.desc')}>
          <DisplaySettings />
        </SettingSection>
        <SettingSection title={t('save.title')} desc={t('save.desc')}>
          <SaveSettings />
        </SettingSection>
        <SettingSection title={webClipperT('title')} desc={webClipperT('desc')}>
          <WebClipperSettings />
        </SettingSection>
        <ToolbarSettings />
      </div>
    </SettingType>
  )
}
