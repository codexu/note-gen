'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { MessageSquare } from 'lucide-react'
import { CondenseSettings } from './condense-settings'
import { PrimaryModelSettings } from './primary-model-settings'
import { ToolbarSettings } from './toolbar-settings'

export default function ChatSettingsPage() {
  const t = useTranslations('settings.chat')

  return (
    <SettingType
      id="chat"
      title={t('title')}
      desc={t('desc')}
      icon={<MessageSquare className="size-4 lg:size-6" />}
    >
      <div className="space-y-4">
        <PrimaryModelSettings />
        <ToolbarSettings />
        <CondenseSettings />
      </div>
    </SettingType>
  )
}
