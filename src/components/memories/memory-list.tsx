'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { MemoryItem } from './memory-item'
import { MemoryForm } from './memory-form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import useMemoriesStore from '@/stores/memories'
import { Skeleton } from '@/components/ui/skeleton'

type TabValue = 'all' | 'preference' | 'memory'

export function MemoryList() {
  const t = useTranslations('settings.memories')
  const { memories, loading, deleteMemory, loadMemories } = useMemoriesStore()
  const [activeTab, setActiveTab] = useState<TabValue>('all')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    loadMemories()
  }, [loadMemories])

  const preferences = memories.filter(m => m.category === 'preference')
  const memoryList = memories.filter(m => m.category === 'memory')

  if (loading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground mb-2">{t('empty')}</p>
        <p className="text-sm text-muted-foreground/70">{t('emptyHint')}</p>
      </div>
    )
  }

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
      <div className="flex items-center justify-between gap-4">
        <TabsList>
          <TabsTrigger value="all">
            {t('tabs.all')} ({memories.length})
          </TabsTrigger>
          <TabsTrigger value="preference">
            {t('tabs.preference')} ({preferences.length})
          </TabsTrigger>
          <TabsTrigger value="memory">
            {t('tabs.memory')} ({memoryList.length})
          </TabsTrigger>
        </TabsList>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="default" size="sm">
              <Plus className="size-4 mr-2" />
              {t('addMemory')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('form.title')}</DialogTitle>
              <DialogDescription>{t('form.contentPlaceholder')}</DialogDescription>
            </DialogHeader>
            <MemoryForm onSuccess={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <TabsContent value="all" className="mt-4">
        <div className="space-y-0.5">
          {memories.map(memory => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              onDelete={() => deleteMemory(memory.id)}
            />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="preference" className="mt-4">
        <div className="space-y-0.5">
          {preferences.map(memory => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              onDelete={() => deleteMemory(memory.id)}
            />
          ))}
        </div>
      </TabsContent>

      <TabsContent value="memory" className="mt-4">
        <div className="space-y-0.5">
          {memoryList.map(memory => (
            <MemoryItem
              key={memory.id}
              memory={memory}
              onDelete={() => deleteMemory(memory.id)}
            />
          ))}
        </div>
      </TabsContent>
    </Tabs>
  )
}
