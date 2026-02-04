'use client'

import { useTranslations } from 'next-intl'
import { SettingType } from '../components/setting-base'
import { Brain } from 'lucide-react'
import { MemoryStats } from '@/components/memories/memory-stats'
import { MemoryForm } from '@/components/memories/memory-form'
import { MemoryList } from '@/components/memories/memory-list'
import { Separator } from '@/components/ui/separator'

export default function MemoriesSettingsPage() {
  const t = useTranslations('settings.memories')

  return (
    <SettingType
      id="memories"
      title={t('title')}
      desc={t('desc')}
      icon={<Brain className="size-4 lg:size-6" />}
    >
      <div className="space-y-6">
        {/* Statistics */}
        <MemoryStats />

        <Separator />

        {/* Add new memory */}
        <div>
          <h3 className="text-lg font-medium mb-4">{t('form.title')}</h3>
          <MemoryForm />
        </div>

        <Separator />

        {/* Memory list */}
        <div>
          <h3 className="text-lg font-medium mb-4">{t('listTitle')}</h3>
          <MemoryList />
        </div>
      </div>
    </SettingType>
  )
}
