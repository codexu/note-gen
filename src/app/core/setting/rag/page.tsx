'use client'

import { SettingType } from '../components/setting-base'
import { Drama } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ModelSetting } from './model-setting'
import { Settings } from './settings'
import { SettingSection } from '../components/setting-base'

export default function PromptSetting() {
  const t = useTranslations('settings.rag')
  return <SettingType id="rag" title={t('title')} desc={t('desc')} icon={<Drama />}>
    <SettingSection title={t('modelSectionTitle')} desc={t('modelSectionDesc')}>
      <ModelSetting />
    </SettingSection>
    <Settings />
  </SettingType>
}
