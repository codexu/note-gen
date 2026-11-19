'use client'

import { BotMessageSquare } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SettingType } from '../components/setting-base'
import { AiSettings } from './ai-settings'

export default function AiPage({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslations('settings.ai')
  return (
    <SettingType id="ai" icon={<BotMessageSquare />} title={t('title')} desc={t('desc')}>
      <AiSettings mobile={mobile} />
    </SettingType>
  )
}
