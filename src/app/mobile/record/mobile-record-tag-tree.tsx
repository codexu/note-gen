'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, TagIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { insertTag, type Tag } from '@/db/tags'
import { buildRecordTagTree, type RecordTagNode } from '@/lib/record-tag-tree'
import { toast } from '@/hooks/use-toast'

interface MobileRecordTagTreeProps {
  tags: Tag[]
  selectedId?: number
  onSelect: (node: RecordTagNode) => void | Promise<void>
  disabledId?: number
  onCreateChild?: (path: string) => void
}

export function MobileRecordTagTree({ tags, selectedId, onSelect, disabledId, onCreateChild }: MobileRecordTagTreeProps) {
  const t = useTranslations()
  const tree = useMemo(() => buildRecordTagTree(tags), [tags])
  const selectedPath = tags.find(tag => tag.id === selectedId)?.name
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!selectedPath) return
    const parts = selectedPath.split('/')
    setExpanded(current => new Set([...current, ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]))
  }, [selectedPath])

  function renderNode(node: RecordTagNode): ReactNode {
    const open = expanded.has(node.path)
    const selected = selectedId !== undefined && node.tag?.id === selectedId
    return <li key={node.path}>
      <Collapsible open={open} onOpenChange={value => setExpanded(current => {
        const next = new Set(current)
        if (value) next.add(node.path); else next.delete(node.path)
        return next
      })}>
        <div className="flex min-w-0 items-center gap-1">
          {node.children.length ? <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label={t(`record.tagging.${open ? 'collapseTag' : 'expandTag'}`, { name: node.label })}>
              {open ? <ChevronDown /> : <ChevronRight />}
            </Button>
          </CollapsibleTrigger> : <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground" aria-hidden="true"><TagIcon className="size-4" /></span>}
          <Button variant="ghost" className="h-11 min-w-0 flex-1 justify-start px-2" disabled={busy || (disabledId !== undefined && node.tag?.id === disabledId)}
            aria-pressed={selected} title={node.path}
            onClick={async () => {
              setBusy(true)
              try { await onSelect(node) } finally { setBusy(false) }
            }}>
            <span className="min-w-0 flex-1 truncate text-start">{node.label}</span>
            {selected ? <Check aria-hidden="true" /> : null}
          </Button>
          {onCreateChild ? <Button variant="ghost" size="icon" className="shrink-0" aria-label={t('record.mark.tag.newChildTagPlaceholder', { name: node.path })}
            onClick={() => onCreateChild(node.path)}><Plus /></Button> : null}
        </div>
        {node.children.length ? <CollapsibleContent>
          <ul className="ms-4 flex min-w-0 flex-col border-s ps-2">{node.children.map(renderNode)}</ul>
        </CollapsibleContent> : null}
      </Collapsible>
    </li>
  }

  return <nav aria-label={t('record.tagging.browseTags')} className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-4">
    <ul className="flex min-w-0 flex-col">{tree.map(renderNode)}</ul>
  </nav>
}

export function MobileRecordTagSelect({ tags, value, onValueChange, onTagsChanged, title, disabled, id }: {
  tags: Tag[]
  value: number
  onValueChange: (value: number) => void
  onTagsChanged: () => Promise<void>
  title: string
  disabled?: boolean
  id?: string
}) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)
  const selected = tags.find(tag => tag.id === value)

  async function select(node: RecordTagNode) {
    try {
      let tagId = node.tag?.id
      if (!tagId) {
        const result = await insertTag({ name: node.path })
        tagId = Number(result.lastInsertId)
        if (!tagId) throw new Error(t('record.tagging.savedRefreshFailed'))
        await onTagsChanged()
      }
      onValueChange(tagId)
      setOpen(false)
    } catch (error) {
      toast({ title: t('common.error'), description: String(error), variant: 'destructive' })
    }
  }

  return <>
    <Button id={id} type="button" variant="outline" disabled={disabled} className="h-11 w-full justify-between px-3 font-normal"
      onClick={() => setOpen(true)}>
      <span className="truncate">{selected?.name ?? title}</span><ChevronDown aria-hidden="true" />
    </Button>
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader><DrawerTitle>{title}</DrawerTitle></DrawerHeader>
        <MobileRecordTagTree tags={tags} selectedId={value} onSelect={select} />
      </DrawerContent>
    </Drawer>
  </>
}
