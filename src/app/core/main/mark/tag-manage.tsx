'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Pencil, TagIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useIsMobile } from '@/hooks/use-mobile'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { GroupImperativeHandle, Layout } from 'react-resizable-panels'
import { initTagsDb, insertTag, delTag, updateTag, updateTagsOrder, normalizeTagName, type Tag } from '@/db/tags'
import { buildRecordTagTree, type RecordTagNode } from '@/lib/record-tag-tree'
import { recordTagIds, tagPathMatches } from '@/lib/record-tags'
import { cn } from '@/lib/utils'
import emitter from '@/lib/emitter'
import { EmitterRecordEvents } from '@/config/emitters'
import { toast } from '@/hooks/use-toast'
import useTagStore from '@/stores/tag'
import useMarkStore from '@/stores/mark'
import useChatStore from '@/stores/chat'
import { MarkList } from './mark-list'

type TagAction = { kind: 'create'; parent: string } | { kind: 'rename' | 'delete'; tag: Tag }
const parentPath = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const leafName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

export function TagManage() {
  const isMobile = useIsMobile()
  const t = useTranslations('record.tagging')
  const common = useTranslations('common')
  const old = useTranslations('record.mark.tag')
  const id = React.useId()
  const { tags, currentTagId, fetchTags, initTags, setCurrentTagId, getCurrentTag } = useTagStore()
  const { marks, allMarks, recordFilters, fetchMarks, fetchAllMarks, setRecordTagId, pendingScrollMarkId, setPendingScrollMarkId, highlightedMarkId, setHighlightedMarkId } = useMarkStore()
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [showTags, setShowTags] = React.useState(true)
  const [tagsCollapsed, setTagsCollapsed] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [action, setAction] = React.useState<TagAction | null>(null)
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  const selectingRef = React.useRef(false)
  const recordArea = React.useRef<HTMLDivElement>(null)
  const tagLayoutRef = React.useRef<GroupImperativeHandle | null>(null)
  const [tagLayout] = React.useState<Layout>(() => {
    if (typeof window === 'undefined') return { tags: 35, records: 65 }
    try {
      const saved = JSON.parse(localStorage.getItem('notegen-record-tag-layout') || 'null') as Layout | null
      if (saved && typeof saved.tags === 'number' && typeof saved.records === 'number'
        && saved.tags >= 0 && saved.tags <= 70 && saved.records >= 30 && saved.records <= 100) {
        return saved
      }
    } catch {
      // Ignore malformed local layout data and keep the defaults.
    }
    return { tags: 35, records: 65 }
  })
  const tree = React.useMemo(() => buildRecordTagTree(tags), [tags])
  const selected = tags.find(tag => tag.id === recordFilters.tagId)
  const destination = tags.find(tag => tag.id === currentTagId)
  const selectedPath = selected?.name ?? destination?.name

  const report = React.useCallback((error: unknown) => {
    toast({ title: common('error'), description: String(error), variant: 'destructive' })
  }, [common])

  const initialize = React.useCallback(async () => {
    setLoadError(false)
    try {
      await initTagsDb()
      await initTags()
      await fetchTags()
      const tagState = useTagStore.getState()
      const filteredTag = tagState.tags.find(tag => tag.id === useMarkStore.getState().recordFilters.tagId)
      if (filteredTag) await setCurrentTagId(filteredTag.id)
      getCurrentTag()
      setExpanded(current => new Set([...current, ...buildRecordTagTree(useTagStore.getState().tags)
        .filter(node => node.children.length > 0).map(node => node.path)]))
      await Promise.all([fetchAllMarks(), fetchMarks()])
      setReady(true)
    } catch (error) {
      setLoadError(true)
      console.error('Unable to load tags:', error)
    }
  }, [initTags, fetchTags, fetchAllMarks, fetchMarks, setCurrentTagId, getCurrentTag])

  React.useEffect(() => { void initialize() }, [initialize])
  React.useEffect(() => {
    if (ready) void fetchAllMarks().catch(report)
  // A record edit updates marks; allMarks supplies the independent browsing list.
  }, [marks, ready, fetchAllMarks, report])

  React.useEffect(() => {
    const collapsed = tagLayout.tags <= 6
    setTagsCollapsed(collapsed)
    setShowTags(!collapsed)
  }, [tagLayout.tags])

  React.useEffect(() => {
    if (!selectedPath) return
    const parts = selectedPath.split('/')
    setExpanded(current => new Set([...current, ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]))
  }, [selectedPath])

  const scopedMarks = React.useMemo(() => {
    if (!selectedPath) return []
    const ids = new Set(tags.filter(tag => tagPathMatches(tag.name, selectedPath)).map(tag => tag.id))
    return allMarks.filter(mark => recordTagIds(mark).some(tagId => ids.has(tagId)))
  }, [allMarks, tags, selectedPath])
  const counts = React.useMemo(() => {
    const result = new Map<string, Set<number>>()
    const names = new Map(tags.map(tag => [tag.id, tag.name]))
    for (const mark of allMarks) {
      for (const tagId of recordTagIds(mark)) {
        const path = names.get(tagId)
        if (!path) continue
        const parts = path.split('/')
        parts.forEach((_, index) => {
          const ancestor = parts.slice(0, index + 1).join('/')
          if (!result.has(ancestor)) result.set(ancestor, new Set())
          result.get(ancestor)!.add(mark.id)
        })
      }
    }
    return result
  }, [tags, allMarks])

  function beginAction(next: TagAction) {
    setAction(next)
    setName(next.kind === 'rename' ? leafName(next.tag.name) : '')
    setError('')
  }

  React.useEffect(() => {
    const create = () => beginAction({ kind: 'create', parent: '' })
    const refresh = () => { void Promise.all([fetchTags(), fetchAllMarks()]).catch(report) }
    emitter.on(EmitterRecordEvents.openNewTag, create)
    emitter.on(EmitterRecordEvents.refreshMarks, refresh)
    return () => {
      emitter.off(EmitterRecordEvents.openNewTag, create)
      emitter.off(EmitterRecordEvents.refreshMarks, refresh)
    }
  }, [fetchTags, fetchAllMarks, report])

  async function selectNode(node: RecordTagNode) {
    if (selectingRef.current) return
    selectingRef.current = true
    try {
      // Only an explicit selection materializes a missing parent, so it can receive records.
      const tagId = node.tag?.id ?? (await insertTag({ name: node.path })).lastInsertId
      if (!tagId) throw new Error(t('savedRefreshFailed'))
      if (!node.tag) await fetchTags()
      await setCurrentTagId(tagId)
      setRecordTagId(tagId)
      getCurrentTag()
      await Promise.all([fetchMarks(), useChatStore.getState().init(tagId)])
    } finally {
      selectingRef.current = false
    }
  }

  async function saveAction() {
    if (!action || savingRef.current) return
    const active = action
    const parent = active.kind === 'create' ? active.parent : parentPath(active.tag.name)
    let path = ''
    if (active.kind !== 'delete') {
      try {
        if (!name.trim()) throw new Error(t('nameRequired'))
        path = normalizeTagName(parent ? parent + '/' + name : name)
        if (tags.some(tag => tag.name === path && (active.kind !== 'rename' || tag.id !== active.tag.id))) throw new Error(t('nameExists'))
      } catch (error) { setError(String(error)); return }
    }
    savingRef.current = true
    setSaving(true)
    try {
      let createdId: number | undefined
      if (active.kind === 'create') {
        const result = await insertTag({ name: path })
        createdId = result.lastInsertId ?? undefined
      } else if (active.kind === 'rename') {
        await updateTag({ ...active.tag, name: path })
      } else {
        await delTag(active.tag.id)
      }
      setAction(null)
      try {
        await fetchTags()
        if (createdId) {
          setShowTags(true)
          await setCurrentTagId(createdId)
          setRecordTagId(createdId)
          getCurrentTag()
          await useChatStore.getState().init(createdId)
        }
        await Promise.all([fetchMarks(), fetchAllMarks()])
      } catch (error) {
        report(t('savedRefreshFailed'))
        console.error(error)
      }
    } catch (error) { setError(String(error)) }
    finally { savingRef.current = false; setSaving(false) }
  }

  async function moveSibling(node: RecordTagNode, direction: -1 | 1) {
    if (!node.tag) return
    const siblings = tags.filter(tag => parentPath(tag.name) === parentPath(node.path))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name))
    const index = siblings.findIndex(tag => tag.id === node.tag!.id)
    const target = index + direction
    if (target < 0 || target >= siblings.length) return
    const moved = siblings[index]
    siblings[index] = siblings[target]
    siblings[target] = moved
    await updateTagsOrder(siblings.map((tag, sortOrder) => ({ id: tag.id, sortOrder })))
    await fetchTags()
  }

  React.useEffect(() => {
    if (!pendingScrollMarkId || !ready) return
    const target = allMarks.find(mark => mark.id === pendingScrollMarkId)
    if (target && !scopedMarks.some(mark => mark.id === target.id)) {
      void setCurrentTagId(target.tagId).catch(report)
      setRecordTagId(target.tagId)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const reveal = () => {
      if (cancelled) return
      const element = recordArea.current?.querySelector<HTMLElement>('[data-mark-id="' + pendingScrollMarkId + '"]')
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedMarkId(pendingScrollMarkId)
        setPendingScrollMarkId(null)
      } else if (++attempts < 20) {
        timer = setTimeout(reveal, 50)
      } else {
        setPendingScrollMarkId(null)
      }
    }
    reveal()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pendingScrollMarkId, allMarks, scopedMarks, ready, setCurrentTagId, report, setRecordTagId, setHighlightedMarkId, setPendingScrollMarkId])

  React.useEffect(() => {
    if (!highlightedMarkId) return
    const timer = setTimeout(() => setHighlightedMarkId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedMarkId, setHighlightedMarkId])

  function renderActions(node: RecordTagNode, mobile: boolean) {
    const Group = mobile ? DropdownMenuGroup : ContextMenuGroup
    const Item = mobile ? DropdownMenuItem : ContextMenuItem
    const MenuSeparator = mobile ? DropdownMenuSeparator : ContextMenuSeparator
    return <>
      <Group>
        <Item onSelect={() => beginAction({ kind: 'create', parent: node.path })}><FolderPlus />{old('newChildTag')}</Item>
        <Item disabled={!node.tag || node.tag.isLocked} onSelect={() => node.tag && beginAction({ kind: 'rename', tag: node.tag })}><Pencil />{old('rename')}</Item>
      </Group>
      <MenuSeparator />
      <Group>
        <Item disabled={!node.tag} onSelect={() => void moveSibling(node, -1).catch(report)}><ArrowUp />{t('moveUp')}</Item>
        <Item disabled={!node.tag} onSelect={() => void moveSibling(node, 1).catch(report)}><ArrowDown />{t('moveDown')}</Item>
        <Item variant="destructive" disabled={!node.tag || node.tag.isLocked || node.children.length > 0}
          onSelect={() => node.tag && beginAction({ kind: 'delete', tag: node.tag })}><Trash2 />{old('delete')}</Item>
      </Group>
    </>
  }

  function renderNode(node: RecordTagNode): React.ReactNode {
    const open = expanded.has(node.path)
    const active = selectedPath === node.path
    return (
      <li key={node.path}>
        <Collapsible open={open} onOpenChange={value => setExpanded(current => {
          const next = new Set(current)
          if (value) next.add(node.path); else next.delete(node.path)
          return next
        })}>
          <ContextMenu>
            <ContextMenuTrigger asChild disabled={isMobile}>
          <div className={cn(
            'flex min-w-0 items-center gap-0.5 rounded-md pe-1 transition-colors hover:bg-accent',
            active && 'bg-accent'
          )}>
            {node.children.length ? (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="hover:bg-transparent hover:text-foreground" aria-label={t(open ? 'collapseTag' : 'expandTag', { name: node.label })}>
                  {open ? <ChevronDown /> : <ChevronRight />}
                </Button>
              </CollapsibleTrigger>
            ) : <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden="true"><TagIcon className="size-4" /></span>}
            <Button variant="ghost" className="h-8 min-w-0 flex-1 justify-start px-1.5 hover:bg-transparent hover:text-foreground" aria-pressed={active} title={node.path}
              onClick={() => void selectNode(node).catch(report)}>
              <span className="min-w-0 flex-1 truncate text-start">{node.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{counts.get(node.path)?.size ?? 0}</span>
            </Button>
            {isMobile && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="hover:bg-transparent hover:text-foreground" aria-label={t('tagActions', { name: node.label })}><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {renderActions(node, true)}
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>
            </ContextMenuTrigger>
            {!isMobile && <ContextMenuContent>{renderActions(node, false)}</ContextMenuContent>}
          </ContextMenu>
          {node.children.length > 0 ? <CollapsibleContent>
            <ul className="ms-3 flex min-w-0 flex-col border-s ps-3">{node.children.map(renderNode)}</ul>
          </CollapsibleContent> : null}
        </Collapsible>
      </li>
    )
  }

  function collapseTagTree() {
    const layout = { tags: 5, records: 95 }
    tagLayoutRef.current?.setLayout(layout)
    setTagsCollapsed(true)
    setShowTags(false)
    localStorage.setItem('notegen-record-tag-layout', JSON.stringify(layout))
  }

  const actionTitle = action?.kind === 'rename' ? old('rename') : action?.kind === 'delete' ? old('delete') : action?.kind === 'create' && action.parent ? old('newChildTag') : old('newTag')
  const actionParent = action?.kind === 'create' ? action.parent : action ? parentPath(action.tag.name) : ''
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        groupRef={tagLayoutRef}
        defaultLayout={tagLayout}
        onLayoutChange={(layout) => {
          const collapsed = layout.tags <= 6
          setTagsCollapsed(collapsed)
          setShowTags(!collapsed)
        }}
        onLayoutChanged={(layout, meta) => {
          const collapsed = layout.tags <= 6
          setTagsCollapsed(collapsed)
          setShowTags(!collapsed)
          if (meta.isUserInteraction && typeof window !== 'undefined') {
            localStorage.setItem('notegen-record-tag-layout', JSON.stringify(layout))
          }
        }}
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="tags" minSize="5%" maxSize="70%">
          <Collapsible open={showTags} className="flex h-full min-h-0 flex-col">
            {showTags ? <CollapsibleContent id="record-tag-tree" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
              <nav aria-label={t('browseTags')}>
                <ul className="flex min-w-0 flex-col">{tree.map(renderNode)}</ul>
              </nav>
            </CollapsibleContent> : <Button
              variant="ghost"
              className="m-0.5 h-7 min-h-7 flex-1 justify-start px-2 text-xs hover:bg-accent"
              aria-controls="record-tag-tree"
              aria-expanded={false}
              onClick={() => {
                tagLayoutRef.current?.setLayout({ tags: 35, records: 65 })
                setTagsCollapsed(false)
                setShowTags(true)
              }}
            >
              <TagIcon data-icon="inline-start" />
              <span className="flex-1 truncate text-start">{selectedPath ?? t('browseTags')}</span>
              <ChevronDown data-icon="inline-end" />
            </Button>}
          </Collapsible>
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            'cursor-row-resize transition-colors',
            'h-2'
          )}
          aria-label={t(tagsCollapsed ? 'expandTag' : 'collapseTag', { name: t('browseTags') })}
          onDoubleClick={collapseTagTree}
          onClick={() => {
            if (tagsCollapsed) {
              tagLayoutRef.current?.setLayout({ tags: 35, records: 65 })
              setTagsCollapsed(false)
              setShowTags(true)
            }
          }}
        />
        <ResizablePanel id="records" minSize="30%">
          <div ref={recordArea} className="flex h-full min-h-0 flex-col overflow-hidden">
        {loadError ? <div className="flex flex-col items-center gap-2 p-6"><p className="text-sm text-muted-foreground">{common('error')}</p><Button variant="outline" onClick={() => void initialize()}>{t('retry')}</Button></div>
          : !ready ? <div className="flex justify-center p-6"><Spinner /></div>
          : <MarkList records={scopedMarks} queueTagIds={selectedPath ? tags.filter(tag => tagPathMatches(tag.name, selectedPath)).map(tag => tag.id) : undefined} />}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
      <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !savingRef.current) setAction(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{actionTitle}</DialogTitle>
            <DialogDescription>{action?.kind === 'delete' ? t('deleteTagHelp', { name: action.tag.name }) : actionParent ? t('underParent', { name: actionParent }) : t('rootTagHelp')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={event => { event.preventDefault(); void saveAction() }} className="flex flex-col gap-5">
            {action?.kind !== 'delete' ? <FieldGroup><Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor={id + '-name'}>{t('tagName')}</FieldLabel>
              <Input id={id + '-name'} autoFocus value={name} disabled={saving} aria-invalid={Boolean(error)}
                placeholder={old('newTagPlaceholder')} onChange={event => { setName(event.target.value); setError('') }} />
              {actionParent && name.trim() ? <FieldDescription className="break-all">{actionParent + '/' + name.trim()}</FieldDescription> : null}
            </Field></FieldGroup> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setAction(null)}>{common('cancel')}</Button>
              <Button type="submit" variant={action?.kind === 'delete' ? 'destructive' : 'default'} disabled={saving || (action?.kind !== 'delete' && !name.trim())}>
                {saving ? <Spinner data-icon="inline-start" /> : null}{action?.kind === 'delete' ? old('delete') : common('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
