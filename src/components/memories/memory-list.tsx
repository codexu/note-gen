'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { MemoryItem } from './memory-item'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import useMemoriesStore from '@/stores/memories'
import { Skeleton } from '@/components/ui/skeleton'

export function MemoryList() {
  const t = useTranslations('settings.memories')
  const { memories, loading, deleteMemory, loadMemories } = useMemoriesStore()

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const preferences = memories.filter(m => m.category === 'preference')
  const knowledge = memories.filter(m => m.category === 'knowledge')

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {t('empty')}
      </div>
    )
  }

  return (
    <Tabs defaultValue="all">
      <TabsList>
        <TabsTrigger value="all">
          {t('tabs.all')} ({memories.length})
        </TabsTrigger>
        <TabsTrigger value="preference">
          {t('tabs.preference')} ({preferences.length})
        </TabsTrigger>
        <TabsTrigger value="knowledge">
          {t('tabs.knowledge')} ({knowledge.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="all" className="space-y-2 mt-4">
        {memories.map(memory => (
          <MemoryItem
            key={memory.id}
            memory={memory}
            onDelete={() => deleteMemory(memory.id)}
          />
        ))}
      </TabsContent>

      <TabsContent value="preference" className="space-y-2 mt-4">
        {preferences.map(memory => (
          <MemoryItem
            key={memory.id}
            memory={memory}
            onDelete={() => deleteMemory(memory.id)}
          />
        ))}
      </TabsContent>

      <TabsContent value="knowledge" className="space-y-2 mt-4">
        {knowledge.map(memory => (
          <MemoryItem
            key={memory.id}
            memory={memory}
            onDelete={() => deleteMemory(memory.id)}
          />
        ))}
      </TabsContent>
    </Tabs>
  )
}
