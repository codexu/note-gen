'use client'

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal } from 'lucide-react'
import type { PluginCommandArgument, PluginItemListBlock, PluginUiAction } from '@notegen/plugin-api'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { PluginIcon } from './plugin-icon'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/enhanced-context-menu'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type Item = PluginItemListBlock['items'][number]

function ItemRow({ item, block, pending, spacious, run }: {
  item: Item
  block: PluginItemListBlock
  pending: boolean
  spacious: boolean
  run: (command: string, argument: PluginCommandArgument) => Promise<void>
}) {
  const t = useTranslations('settings.plugins.ui')
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: pending || !block.reorderCommand || item.disabled })
  const dragFileRow = Boolean(block.reorderCommand) && item.checked === undefined
  const argument = { generation: block.generation, itemId: item.id }
  const confirmationGeneration = useRef(block.generation)
  const [confirmation, setConfirmation] = useState<PluginUiAction | null>(null)
  const invoke = (action: PluginUiAction) => run(action.command, { ...argument, ...(action.argument === undefined ? {} : { argument: action.argument }), actionId: action.id })
  const select = (action: PluginUiAction) => { if (action.confirmation) { confirmationGeneration.current = block.generation; setConfirmation(action) } else void invoke(action) }
  return <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('list-none', isDragging && 'opacity-40')}>
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!block.actions?.length}>
        <div ref={dragFileRow ? setActivatorNodeRef : undefined}
          {...(dragFileRow ? attributes : { tabIndex: 0 })} {...(dragFileRow ? listeners : {})}
          aria-label={dragFileRow ? `${block.reorderLabel}: ${item.label}` : undefined}
          className={cn('group relative flex min-h-8 min-w-0 items-center gap-2 rounded-md hover:bg-accent focus-within:bg-accent', spacious ? 'min-h-16 px-3 py-2.5' : 'px-1', dragFileRow && 'touch-none select-none')}>
          {block.reorderCommand && !dragFileRow ? <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners}
            aria-label={`${block.reorderLabel}: ${item.label}`} disabled={pending || item.disabled}
            className="flex size-7 shrink-0 touch-none cursor-grab items-center justify-center rounded-sm text-muted-foreground opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 active:cursor-grabbing disabled:pointer-events-none">
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button> : null}
          {item.checked !== undefined && block.toggleCommand ? <Checkbox checked={item.checked} aria-label={item.label} disabled={pending || item.disabled} onCheckedChange={checked => void run(block.toggleCommand!, { ...argument, checked: checked === true })} /> : null}
          <button type="button" disabled={pending || item.disabled || !block.openCommand} onClick={() => !isDragging && block.openCommand && void run(block.openCommand, argument)} title={item.label}
            className={cn('flex min-h-8 min-w-0 flex-1 gap-2 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', spacious ? 'items-start gap-3' : 'items-center pr-2')}>
            {item.icon ? <PluginIcon name={item.icon} className={cn('size-4 shrink-0 text-muted-foreground', spacious && 'mt-0.5')} /> : null}
            <span className={cn('min-w-0 flex-1', spacious && 'flex flex-col gap-1')}>
              <span className={cn('block truncate', spacious && 'font-medium leading-5', spacious && block.actions?.length && 'pr-7')}>{item.label}</span>
              {item.description ? <span className={cn('block truncate text-xs text-muted-foreground', spacious && 'leading-5')} title={item.description}>{item.description}</span> : null}
              {item.metadata ? <span className="block truncate text-[11px] leading-4 text-muted-foreground" title={item.metadata}>{item.metadata}</span> : null}
            </span>
          </button>
          {block.actions?.length && (!dragFileRow || spacious) ? <span className={cn('shrink-0', spacious && 'absolute right-2 top-2')} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" title={t('moreActions')} aria-label={`${t('moreActions')}: ${item.label}`} disabled={pending || item.disabled} className="md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{block.actions.map(action => <DropdownMenuItem key={action.id} disabled={pending || item.disabled || action.disabled} onSelect={() => select(action)}>{action.icon ? <PluginIcon name={action.icon} /> : null}{action.label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
          </span> : null}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          {(block.actions ?? []).map(action => <ContextMenuItem key={action.id} disabled={pending || item.disabled || action.disabled} onClick={() => select(action)}>
            {action.icon ? <PluginIcon name={action.icon} /> : null}{action.label}
          </ContextMenuItem>)}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
    {confirmation?.confirmation && confirmationGeneration.current === block.generation ? <AlertDialog open onOpenChange={open => { if (!open) setConfirmation(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirmation.confirmation.title}</AlertDialogTitle><AlertDialogDescription>{confirmation.confirmation.description ?? confirmation.confirmation.title}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{confirmation.confirmation.cancelLabel}</AlertDialogCancel><AlertDialogAction onClick={() => void invoke(confirmation)}>{confirmation.confirmation.confirmLabel}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog> : null}
  </li>
}

export function PluginItemList({ block, scope }: { block: PluginItemListBlock; scope: string }) {
  // Sortable note lists keep consistent spacing even when a note has no preview.
  const spacious = block.items.every(item => item.checked === undefined)
    && (Boolean(block.reorderCommand) || block.items.some(item => Boolean(item.description || item.metadata)))
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const dragGeneration = useRef<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  async function run(command: string, argument: PluginCommandArgument) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    try { await executePluginCommand(command, argument) }
    catch (error) { toast.error(error instanceof Error ? error.message : String(error)) }
    finally { busy.current = false; setPending(false) }
  }
  function reorder({ active, over }: DragEndEvent) {
    const startedGeneration = dragGeneration.current
    dragGeneration.current = null
    if (!block.reorderCommand || !over || active.id === over.id || busy.current || startedGeneration !== block.generation) return
    const ids = block.items.map(item => item.id), from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    // The plugin publishes a new document only after persistence succeeds.
    void run(block.reorderCommand, { generation: block.generation, itemIds: arrayMove(ids, from, to) })
  }
  return <section aria-label={block.label} aria-busy={pending} className="min-w-0">
    {block.items.length ? <DndContext id={`${scope}:${block.id}`} sensors={sensors} collisionDetection={closestCenter} onDragStart={() => { dragGeneration.current = block.generation }} onDragCancel={() => { dragGeneration.current = null }} onDragEnd={reorder}>
      <SortableContext items={block.items.map(item => item.id)} strategy={verticalListSortingStrategy}>
        <ul aria-label={block.label} className={cn('flex min-w-0 flex-col', spacious ? 'gap-1 py-1' : 'gap-0.5')}>
          {block.items.map(item => <ItemRow key={item.id} item={item} block={block} pending={pending} spacious={spacious} run={run} />)}
        </ul>
      </SortableContext>
    </DndContext> : <p className="px-3 py-8 text-center text-sm text-muted-foreground">{block.emptyText}</p>}
  </section>
}
