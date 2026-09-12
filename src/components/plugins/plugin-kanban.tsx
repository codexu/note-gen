'use client'

import { useRef, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MoreHorizontal, Plus, FileText } from 'lucide-react'
import type { PluginCommandArgument, PluginKanbanBlock } from '@notegen/plugin-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Card, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { executePluginCommand } from '@/lib/plugins/command-registry'
import { cn } from '@/lib/utils'

type Column = PluginKanbanBlock['columns'][number]
type Item = Column['cards'][number]
type Run = (command: string, argument: PluginCommandArgument) => Promise<boolean>
type Shared = { block: PluginKanbanBlock; disabled: boolean; sortable: boolean; run: Run }

function KanbanCard({ card, column, block, disabled, sortable, run }: Shared & { card: Item; column: Column }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: card.id, disabled: !sortable, data: { kind: 'card', columnId: column.id } })
  const argument = { generation: block.generation, cardId: card.id, columnId: column.id }
  return <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'opacity-30', isOver && 'rounded-lg outline outline-1 outline-ring')}>
    <Card size="sm">
      <CardHeader>
        <div className="flex items-start gap-1">
          <Button ref={setActivatorNodeRef} variant="ghost" size="icon-xs" {...attributes} {...listeners} disabled={!sortable} aria-label={`${block.labels.drag}: ${card.title}`} className="touch-none shrink-0 cursor-grab"><GripVertical /></Button>
          <button type="button" disabled={disabled} className="min-w-0 flex-1 text-left focus-visible:outline-ring" onClick={() => void run(block.openCardCommand, argument)}>
            <CardTitle className="break-words">{card.title}</CardTitle>
          </button>
        </div>
        {card.description ? <CardDescription className="line-clamp-3 whitespace-pre-wrap">{card.description}</CardDescription> : null}
      </CardHeader>
      {card.noteLabel && block.openNoteCommand ? <CardFooter><Button variant="ghost" size="sm" disabled={disabled} className="min-w-0 max-w-full" onClick={() => void run(block.openNoteCommand!, argument)}><FileText data-icon="inline-start" /><span className="truncate">{card.noteLabel}</span></Button></CardFooter> : null}
    </Card>
  </div>
}

function KanbanColumn({ column, block, disabled, sortable, run, query }: Shared & { column: Column; query: string }) {
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: column.id, disabled: !sortable, data: { kind: 'column' } })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${column.id}`, disabled: !sortable, data: { kind: 'column-drop', columnId: column.id } })
  const cards = column.cards.filter(card => `${card.title}\n${card.description ?? ''}\n${card.noteLabel ?? ''}`.toLocaleLowerCase().includes(query))
  async function add() {
    if (!title.trim() || disabled) return
    if (await run(block.addCardCommand, { generation: block.generation, columnId: column.id, title: title.trim() })) {
      setTitle('')
      input.current?.focus()
    }
  }
  return <section ref={setNodeRef} aria-label={column.title} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3', isDragging && 'opacity-30')}>
    <header className="flex items-center gap-1">
      <Button ref={setActivatorNodeRef} variant="ghost" size="icon-xs" {...attributes} {...listeners} disabled={!sortable} aria-label={`${block.labels.drag}: ${column.title}`} className="touch-none cursor-grab"><GripVertical /></Button>
      <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title={column.title}>{column.title}</h3>
      <Badge variant="secondary">{query ? `${cards.length}/` : ''}{column.cards.length}</Badge>
      <Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={`${block.labels.editColumn}: ${column.title}`} onClick={() => void run(block.editColumnCommand, { generation: block.generation, columnId: column.id })}><MoreHorizontal /></Button>
    </header>
    <div ref={setDropRef} className={cn('flex min-h-24 flex-1 flex-col gap-2 rounded-md', isOver && 'outline outline-1 outline-ring')}>
      <SortableContext items={cards.map(card => card.id)} strategy={verticalListSortingStrategy}>
        {cards.map(card => <KanbanCard key={card.id} card={card} column={column} block={block} disabled={disabled} sortable={sortable} run={run} />)}
      </SortableContext>
      {!cards.length ? <p className="p-4 text-center text-sm text-muted-foreground">{query ? block.labels.noResults : block.labels.emptyColumn}</p> : null}
    </div>
    <form onSubmit={event => { event.preventDefault(); void add() }} className="flex items-end gap-1">
      <Field className="min-w-0 flex-1"><FieldLabel htmlFor={`${block.id}-${column.id}-add`} className="sr-only">{block.labels.addCard}</FieldLabel><Input ref={input} id={`${block.id}-${column.id}-add`} value={title} maxLength={240} placeholder={block.labels.addCard} disabled={disabled} onChange={event => setTitle(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault()
        if (event.key === 'Escape') { setTitle(''); input.current?.blur() }
      }} /></Field>
      <Button type="submit" variant="ghost" size="icon" disabled={disabled || !title.trim()} aria-label={block.labels.addCard}><Plus /></Button>
    </form>
  </section>
}

export function PluginKanban({ block, scope }: { block: PluginKanbanBlock; scope: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [dragTitle, setDragTitle] = useState('')
  const busy = useRef(false)
  const generation = useRef<string | null>(null)
  const latest = useRef(block)
  latest.current = block
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const disabled = pending || block.disabled === true
  const query = search.trim().toLocaleLowerCase()
  const sortable = !disabled && !query
  async function run(command: string, argument: PluginCommandArgument) {
    if (busy.current || block.disabled) return false
    busy.current = true
    setPending(true)
    setError('')
    try {
      const result = await executePluginCommand(command, argument)
      // A plugin may return a form-style failure instead of throwing.
      if (result && typeof result === 'object' && !Array.isArray(result) && 'message' in result && typeof result.message === 'string') throw new Error(result.message)
      return true
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false }
    finally { busy.current = false; setPending(false) }
  }
  const collision: CollisionDetection = args => {
    if (args.active.data.current?.kind === 'column') return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(item => item.data.current?.kind === 'column') })
    const containers = args.droppableContainers.filter(item => item.data.current?.kind !== 'column')
    const hits = pointerWithin({ ...args, droppableContainers: containers })
    if (hits.length) {
      const cardHits = hits.filter(hit => containers.find(item => item.id === hit.id)?.data.current?.kind === 'card')
      return cardHits.length ? cardHits : hits
    }
    return closestCenter({ ...args, droppableContainers: containers })
  }
  function start({ active }: DragStartEvent) {
    generation.current = block.generation
    setDragTitle(block.columns.find(col => col.id === active.id)?.title ?? block.columns.flatMap(col => col.cards).find(card => card.id === active.id)?.title ?? '')
  }
  function end({ active, over }: DragEndEvent) {
    const started = generation.current
    generation.current = null
    setDragTitle('')
    if (!sortable || !over || active.id === over.id || started !== latest.current.generation) return
    const fromColumn = block.columns.find(col => col.cards.some(card => card.id === active.id))
    if (!fromColumn) {
      const target = block.columns.find(col => col.id === over.id || col.cards.some(card => card.id === over.id) || `drop:${col.id}` === over.id)
      const from = block.columns.findIndex(col => col.id === active.id)
      const to = block.columns.findIndex(col => col.id === target?.id)
      if (from >= 0 && to >= 0 && from !== to) void run(block.reorderColumnsCommand, { generation: block.generation, columnIds: arrayMove(block.columns.map(col => col.id), from, to) })
      return
    }
    const target = block.columns.find(col => col.id === over.id || `drop:${col.id}` === over.id || col.cards.some(card => card.id === over.id))
    if (!target) return
    const overIndex = target.cards.findIndex(card => card.id === over.id)
    const fromIndex = fromColumn.cards.findIndex(card => card.id === active.id)
    const beforeCardId = overIndex < 0 ? null : fromColumn.id === target.id && fromIndex < overIndex ? target.cards[overIndex + 1]?.id ?? null : target.cards[overIndex].id
    void run(block.moveCardCommand, { generation: block.generation, cardId: String(active.id), fromColumnId: fromColumn.id, toColumnId: target.id, beforeCardId })
  }
  return <section aria-label={block.label} aria-busy={pending} className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center gap-3"><Field className="max-w-xs"><FieldLabel htmlFor={`${scope}-${block.id}-search`} className="sr-only">{block.labels.search}</FieldLabel><Input id={`${scope}-${block.id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={block.labels.search} /></Field><span role="status" className="text-xs text-muted-foreground">{pending ? block.labels.saving : error ? '' : block.labels.saved}</span></div>
    {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <DndContext id={`${scope}:${block.id}`} sensors={sensors} collisionDetection={collision} onDragStart={start} onDragEnd={end} onDragCancel={() => { generation.current = null; setDragTitle('') }} accessibility={{ screenReaderInstructions: { draggable: block.labels.drag }, announcements: { onDragStart: () => block.labels.drag, onDragOver: ({ over }) => over ? block.columns.find(col => col.id === over.id || `drop:${col.id}` === over.id)?.title ?? block.columns.flatMap(col => col.cards).find(card => card.id === over.id)?.title : undefined, onDragEnd: () => block.labels.saving, onDragCancel: () => block.label } }}>
      <div className="flex items-stretch gap-3 overflow-x-auto pb-3">
        <SortableContext items={block.columns.map(col => col.id)} strategy={horizontalListSortingStrategy}>
          {block.columns.map(column => <KanbanColumn key={column.id} column={column} block={block} disabled={disabled} sortable={sortable} run={run} query={query} />)}
        </SortableContext>
      </div>
      <DragOverlay>{dragTitle ? <Card size="sm" className="w-64"><CardHeader><CardTitle>{dragTitle}</CardTitle></CardHeader></Card> : null}</DragOverlay>
    </DndContext>
  </section>
}
