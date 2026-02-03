'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { MessageSquare } from 'lucide-react'
import { CondenseSettings } from './condense-settings'

export default function ConversationSettingsPage() {
  const t = useTranslations('settings.conversation')

  return (
    <SettingType
      id="conversation"
      title={t('title')}
      desc={t('desc')}
      icon={<MessageSquare className="size-4 lg:size-6" />}
    >
      <CondenseSettings />
    </SettingType>
  )
}
