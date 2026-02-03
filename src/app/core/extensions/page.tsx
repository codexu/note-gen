'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useExtensionsStore } from '@/stores/extensions'
import { TavernHelperCard } from './tavern-helper-card'

export default function ExtensionsPage() {
  const t = useTranslations('extensions')
  const { initExtensionsState } = useExtensionsStore()

  useEffect(() => {
    initExtensionsState()
  }, [initExtensionsState])

  return (
    <div className="h-full w-full overflow-auto bg-background">
      <div className="max-w-4xl mx-auto p-6">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('description')}</p>
        </div>

        {/* 扩展列表 */}
        <div className="space-y-4">
          <TavernHelperCard />
        </div>
      </div>
    </div>
  )
}
