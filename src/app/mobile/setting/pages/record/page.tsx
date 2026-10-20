'use client'

import { useTranslations } from 'next-intl'
import { DefaultModelsSettings } from '@/app/core/setting/components/default-models-settings'
import { SaveSettings } from '@/app/core/setting/record/save-settings'
import {
  SettingSection,
  SettingType,
} from '@/app/core/setting/components/setting-base'

export default function RecordSettingsPage() {
  const t = useTranslations('settings.record')

  return (
    <SettingType id="record" title={t('title')} desc={t('desc')}>
      <DefaultModelsSettings type="record" />
      <SettingSection title={t('save.title')} desc={t('save.desc')}>
        <SaveSettings />
      </SettingSection>
    </SettingType>
  )
}
