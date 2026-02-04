'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { Brain } from 'lucide-react'
import { MemoryList } from '@/components/memories/memory-list'

export default function MemoriesSettingsPage() {
  const t = useTranslations('settings.memories')

  return (
    <SettingType
      id="memories"
      title={t('title')}
      desc={t('desc')}
      icon={<Brain className="size-4 lg:size-6" />}
    >
      <MemoryList />
    </SettingType>
  )
}
