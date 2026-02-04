'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import useMemoriesStore from '@/stores/memories'

export function MemoryStats() {
  const t = useTranslations('settings.memories')
  const { stats, loadStats, loading } = useMemoriesStore()

  useEffect(() => {
    loadStats()
  }, [loadStats])

  if (loading || !stats) {
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('stats.total')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.total}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('stats.preferences')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.preferences}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t('stats.memories')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.memories}</div>
        </CardContent>
      </Card>
    </div>
  )
}
