'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import useMemoriesStore from '@/stores/memories'

export function MemoryStats() {
  const t = useTranslations('settings.memories')
  const { stats, loadStats } = useMemoriesStore()

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  if (!stats) return null

  const items = [
    ['total', stats.total],
    ['active', stats.preferences + stats.memories],
    ['pending', stats.pending],
    ['archived', stats.archived],
  ] as const

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([key, value]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle>{t(`stats.${key}`)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
