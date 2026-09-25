'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Brain, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogTrigger as DialogTrigger,
} from '@/components/responsive-dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/components/ui/item'
import { ResponsiveSelect } from '@/components/responsive-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMobileSettingAction } from '@/app/core/setting/components/setting-base'
import type {
  MemoryKind,
  MemoryScopeType,
  MemoryStatus,
} from '@/db/memories'
import useMemoriesStore from '@/stores/memories'
import { MemoryForm } from './memory-form'
import { MemoryItem } from './memory-item'
import { MemoryStats } from './memory-stats'

type FilterValue<T extends string> = 'all' | T

export function MemoryList() {
  const t = useTranslations('settings.memories')
  const {
    memories,
    loading,
    policy,
    loadMemories,
    loadPolicy,
    loadStats,
    updatePolicy,
    approveMemory,
  } = useMemoriesStore()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<FilterValue<MemoryKind>>('all')
  const [scope, setScope] = useState<FilterValue<MemoryScopeType>>('all')
  const [status, setStatus] = useState<MemoryStatus>('active')
  const mobileAddAction = useMemo(() => ({
    label: t('addMemory'),
    icon: <Plus />,
    onClick: () => setOpen(true),
  }), [t])

  useMobileSettingAction(mobileAddAction)

  useEffect(() => {
    void Promise.all([loadMemories(), loadPolicy(), loadStats()])
  }, [loadMemories, loadPolicy, loadStats])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return memories.filter(memory =>
      memory.status === status
      && (kind === 'all' || memory.kind === kind)
      && (scope === 'all' || memory.scopeType === scope)
      && (!normalized || memory.content.toLocaleLowerCase().includes(normalized))
    )
  }, [kind, memories, query, scope, status])
  const statusCounts = useMemo(() => ({
    active: memories.filter(memory => memory.status === 'active').length,
    pending: memories.filter(memory => memory.status === 'pending').length,
    archived: memories.filter(memory => memory.status === 'archived').length,
  }), [memories])
  const hasMemoriesInStatus = statusCounts[status] > 0
  const hasActiveFilters = Boolean(query.trim())
    || kind !== 'all'
    || scope !== 'all'

  const pending = memories.filter(memory => memory.status === 'pending')
  const mobileMemories = memories.filter(memory => memory.status !== 'archived')
  const approveAllPending = async () => {
    await Promise.all(pending.map(memory => approveMemory(memory.id)))
    toast.success(t('approvedAll', { count: pending.length }))
  }

  return (
    <div className="flex min-w-0 flex-col gap-5 md:gap-6">
      <Item variant="outline">
        <ItemContent>
          <ItemTitle>{t('policy.generate')}</ItemTitle>
          <ItemDescription>{t('policy.generateDescription')}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Switch
            aria-label={t('policy.generate')}
            checked={policy?.generateMemories ?? true}
            onCheckedChange={checked => void updatePolicy({ generateMemories: checked })}
          />
        </ItemActions>
      </Item>

      <div className="hidden md:block"><MemoryStats /></div>

      <Dialog open={open} onOpenChange={setOpen}>
        <div className="flex flex-col gap-3 md:hidden">
          {pending.length > 0 && (
            <Button variant="outline" className="h-11 w-full" onClick={() => void approveAllPending()}>
              {t('actions.approveAll')}
            </Button>
          )}
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : mobileMemories.length > 0 ? (
            <ItemGroup className="gap-2">
              {mobileMemories.map(memory => <MemoryItem key={memory.id} memory={memory} />)}
            </ItemGroup>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon"><Brain /></EmptyMedia>
                <EmptyTitle>{t('empty')}</EmptyTitle>
                <EmptyDescription>{t('emptyHint')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>

        <Tabs value={status} onValueChange={value => setStatus(value as MemoryStatus)} className="hidden min-w-0 md:flex">
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between">
            <TabsList className="order-2 h-11 w-full md:order-none md:h-8 md:w-fit">
              {(['active', 'pending', 'archived'] as MemoryStatus[]).map(tab => (
                <TabsTrigger key={tab} value={tab} className="min-w-0">
                  {t(`statuses.${tab}`)}
                  <span className="text-xs text-muted-foreground md:hidden">{statusCounts[tab]}</span>
                  {tab === 'pending' && <span className="hidden md:inline">({pending.length})</span>}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="order-1 flex gap-2 md:order-none">
              {status === 'pending' && pending.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => void approveAllPending()}>
                  {t('actions.approveAll')}
                </Button>
              )}
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus data-icon="inline-start" />
                  {t('addMemory')}
                </Button>
              </DialogTrigger>
            </div>
          </div>

          <div className="mt-4 grid min-w-0 grid-cols-[minmax(220px,1fr)_repeat(2,auto)] gap-2">
            <InputGroup>
              <InputGroupAddon><Search /></InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('filters.search')}
              />
            </InputGroup>
            <ResponsiveSelect
              title={t('filters.allKinds')}
              value={kind}
              onValueChange={value => setKind(value as FilterValue<MemoryKind>)}
              options={[
                { value: 'all', label: t('filters.allKinds') },
                { value: 'preference', label: t('kinds.preference') },
                { value: 'fact', label: t('kinds.fact') },
                { value: 'experience', label: t('kinds.experience') },
                { value: 'decision', label: t('kinds.decision') },
              ]}
            />
            <ResponsiveSelect
              title={t('filters.allScopes')}
              value={scope}
              onValueChange={value => setScope(value as FilterValue<MemoryScopeType>)}
              options={[
                { value: 'all', label: t('filters.allScopes') },
                { value: 'global', label: t('scopes.global') },
                { value: 'workspace', label: t('scopes.workspace') },
              ]}
            />
          </div>

          {(['active', 'pending', 'archived'] as MemoryStatus[]).map(tab => (
            <TabsContent key={tab} value={tab} className="mt-4 min-w-0">
              {loading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : filtered.length > 0 ? (
                <ItemGroup className="gap-2">
                  {filtered.map(memory => <MemoryItem key={memory.id} memory={memory} />)}
                </ItemGroup>
              ) : (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><Brain /></EmptyMedia>
                    <EmptyTitle>
                      {hasMemoriesInStatus && hasActiveFilters ? t('noMatches') : t('empty')}
                    </EmptyTitle>
                    <EmptyDescription>
                      {hasMemoriesInStatus && hasActiveFilters ? t('noMatchesHint') : t('emptyHint')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </TabsContent>
          ))}
        </Tabs>

        <DialogContent className="overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('form.title')}</DialogTitle>
            <DialogDescription>{t('form.description')}</DialogDescription>
          </DialogHeader>
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-0">
            <MemoryForm onSuccess={() => setOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
