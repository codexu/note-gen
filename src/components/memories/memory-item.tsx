'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  Check,
  Ellipsis,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
} from '@/components/responsive-dialog'
import { ResponsiveActionMenu } from '@/components/responsive-action-menu'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { MemoryForm } from './memory-form'
import useMemoriesStore from '@/stores/memories'
import useSettingStore from '@/stores/setting'
import type { Memory } from '@/db/memories'

interface MemoryItemProps {
  memory: Memory
}

export function MemoryItem({ memory }: MemoryItemProps) {
  const t = useTranslations('settings.memories')
  const [editing, setEditing] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const {
    approveMemory,
    archiveMemory,
    restoreMemory,
    permanentlyDeleteMemory,
    updateMemory,
  } = useMemoriesStore()
  const { systemPrompt, setSystemPrompt } = useSettingStore()
  const guidanceLine = `- ${memory.content.trim()}`
  const isPromoted = systemPrompt
    .split('\n')
    .some(line => line.trim() === guidanceLine)
  const archive = async () => {
    await archiveMemory(memory.id)
    toast(t('archived'), {
      action: {
        label: t('actions.undo'),
        onClick: () => void restoreMemory(memory.id),
      },
    })
  }

  const promoteToGuidance = async () => {
    if (isPromoted) return
    const next = [systemPrompt.trim(), guidanceLine].filter(Boolean).join('\n')
    await setSystemPrompt(next)
    await updateMemory(memory.id, { applyMode: 'always' })
    toast.success(t('promoted'))
  }

  const removeFromGuidance = async () => {
    const next = systemPrompt
      .split('\n')
      .filter(line => line.trim() !== guidanceLine)
      .join('\n')
      .trim()
    await setSystemPrompt(next)
    await updateMemory(memory.id, { applyMode: 'relevant' })
    toast.success(t('demoted'))
  }

  return (
    <>
      <Item variant="outline" size="sm" className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center">
        <ItemContent className="min-w-0 gap-2 md:gap-1">
          <div className="order-2 flex flex-wrap gap-1.5 md:order-first">
            <Badge variant={memory.status === 'active' ? 'default' : 'secondary'} className="hidden md:inline-flex">
              {t(`statuses.${memory.status}`)}
            </Badge>
            {memory.status !== 'active' && (
              <Badge variant="secondary" className="md:hidden">{t(`statuses.${memory.status}`)}</Badge>
            )}
            <Badge variant="outline" className="hidden md:inline-flex">{t(`kinds.${memory.kind}`)}</Badge>
            <Badge variant="outline" className="hidden md:inline-flex">{t(`scopes.${memory.scopeType}`)}</Badge>
            {memory.applyMode === 'always' && (
              <Badge variant="secondary"><Pin />{t('always')}</Badge>
            )}
            {memory.sensitivity === 'suspected_sensitive' && (
              <Badge variant="destructive"><ShieldAlert />{t('sensitive.badge')}</Badge>
            )}
            {memory.indexingStatus !== 'ready' && (
              <Badge variant="outline" className="md:hidden">{t(`indexing.${memory.indexingStatus}`)}</Badge>
            )}
          </div>
          <ItemTitle className="order-1 line-clamp-none w-full whitespace-normal break-words md:order-none md:line-clamp-2 md:w-fit">{memory.content}</ItemTitle>
          <ItemDescription className="order-3 hidden md:block">
            {memory.lastRecallReason
              ? t('lastRecallReason', { reason: memory.lastRecallReason })
              : t('neverRecalled')}
            {' · '}
            {t('accessCount', { count: memory.accessCount })}
            {memory.indexingStatus !== 'ready' && ` · ${t(`indexing.${memory.indexingStatus}`)}`}
          </ItemDescription>
          {memory.status === 'pending' && (
            <Button
              variant="outline"
              className="order-4 mt-1 h-10 w-full md:hidden"
              onClick={() => void approveMemory(memory.id)}
            >
              <Check data-icon="inline-start" />
              {t('actions.approve')}
            </Button>
          )}
        </ItemContent>
        <ItemActions className="col-start-2 row-start-1 self-center justify-self-end">
          <ResponsiveActionMenu
            title={t('actions.more')}
            trigger={
              <Button variant="ghost" size="icon-sm" className="size-10 md:size-8" aria-label={t('actions.more')}>
                <Ellipsis />
              </Button>
            }
            desktopClassName="w-max min-w-48 whitespace-nowrap"
            items={[
              ...(memory.status === 'pending' ? [{
                key: 'approve',
                label: t('actions.approve'),
                icon: <Check />,
                onSelect: () => approveMemory(memory.id),
              }] : []),
              { key: 'edit', label: t('actions.edit'), icon: <Pencil />, onSelect: () => setEditing(true) },
              isPromoted
                ? { key: 'demote', label: t('actions.demote'), icon: <PinOff />, onSelect: removeFromGuidance }
                : { key: 'promote', label: t('actions.promote'), icon: <Pin />, onSelect: promoteToGuidance },
              memory.status === 'archived'
                ? { key: 'restore', label: t('actions.restore'), icon: <RotateCcw />, onSelect: () => restoreMemory(memory.id) }
                : { key: 'archive', label: t('actions.archive'), icon: <Trash2 />, onSelect: archive },
              ...(memory.status === 'archived' ? [{
                key: 'delete',
                label: t('actions.deletePermanently'),
                icon: <Trash2 />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setDeleteOpen(true),
              }] : []),
            ]}
          />
        </ItemActions>
      </Item>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>
          <div className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-0">
            <MemoryForm memory={memory} onSuccess={() => setEditing(false)} />
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deleteConfirm.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void permanentlyDeleteMemory(memory.id)}
            >
              {t('actions.deletePermanently')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
