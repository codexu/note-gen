'use client'

// Fork（almanac ALMNC-8）：V3 收集頁。一個框收文字、連結、圖片與檔案，系統拆成筆記、任務、時段等提案，逐條收下、修改或丟掉。
// 做法同 Inbox 頁：蓋在編輯器與右側欄上方、留著左側欄。只在新介面（v3）顯示。
// 外觀依 redesign_v5.html：單色、提案是虛線框、收下後變實線。
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClock, Check, FileText, ImagePlus, Inbox as InboxIcon, Link2, ListTodo, Paperclip, Pencil, Type, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { extractSchedule } from '@/lib/collect/split'
import type { CollectInput, ProposalKind } from '@/lib/collect/types'
import { useUiV3 } from '@/lib/fork-ui'
import { recordNoteContent } from '@/lib/inbox/record-to-note'
import { classifyUnifiedRecordInput } from '@/lib/unified-record-input'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useCollectStore, { type CaptureItem, type CaptureProposal } from '@/stores/collect'
import useInboxStore, { selectUnprocessedRecords } from '@/stores/inbox'
import { getMarkListItemContent } from '../mark/mark-list-item-content'
import { Count, EmptyState, PageHeader, PageSurface } from '../page-ui'
import { CollectTabs } from '../sidebar-v3/section-tabs'

const KIND_ICON: Record<ProposalKind, typeof FileText> = { note: FileText, task: ListTodo, event: CalendarClock }
const INPUT_ICON = { text: Type, link: Link2, image: ImagePlus, file: Paperclip } as const
const MAX_FILE_BYTES = 8 * 1024 * 1024

type Filter = 'all' | 'pending' | 'done'

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function shortDate(due: string): string {
  const m = due.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[1])}/${Number(m[2])}` : due
}

function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function itemTitle(input: CollectInput): string {
  if (input.name) return input.name
  const first = input.text.trim().split('\n')[0] ?? ''
  return Array.from(first).slice(0, 48).join('')
}

function waiting(item: CaptureItem): number {
  return item.proposals.filter(proposal => proposal.status === 'wait').length
}

function ProposalCard({ item, proposal }: { item: CaptureItem, proposal: CaptureProposal }) {
  const t = useTranslations('collect')
  const accept = useCollectStore(state => state.accept)
  const reject = useCollectStore(state => state.reject)
  const edit = useCollectStore(state => state.edit)
  const undo = useCollectStore(state => state.undo)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const Icon = KIND_ICON[proposal.kind]
  const when = [proposal.due && shortDate(proposal.due), proposal.time].filter(Boolean).join(' ')
  const destination = proposal.kind === 'note' ? t('to.inbox') : t('to.today')

  async function onAccept() {
    setBusy(true)
    try {
      const result = await accept(item.id, proposal.id)
      toast.success(t('accepted', { title: proposal.title }), {
        action: result.record
          ? { label: t('undo'), onClick: () => void undo(item.id, proposal.id).then(ok => { if (!ok) toast.error(t('undoFailed')) }) }
          : undefined,
      })
    } catch (error) {
      console.error('[collect] accept failed:', error)
      toast.error(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  async function openTarget() {
    if (!proposal.result) return
    useCollectStore.getState().hide()
    await useArticleStore.getState().setActiveFilePath(proposal.result.path)
  }

  const base = 'flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 transition-colors duration-100 sm:w-[196px]'

  if (proposal.status === 'ok') {
    return (
      <div className={cn(base, 'border-line-soft bg-hover')} data-status="ok">
        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint"><Icon className="size-3" aria-hidden />{t(`kind.${proposal.kind}`)}</div>
        <b className="text-[13px] leading-5 font-medium">{proposal.title}</b>
        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-1"><Check className="size-3 shrink-0" aria-hidden /><span className="truncate">{t('status.ok')}</span></span>
          <span className="flex shrink-0 gap-0.5">
            <button type="button" onClick={() => void openTarget()} className="cursor-pointer rounded px-1.5 py-0.5 text-brand outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65">{t('open')}</button>
            {proposal.result?.record && (
              <button type="button" onClick={() => void undo(item.id, proposal.id).then(ok => { if (!ok) toast.error(t('undoFailed')) })} className="cursor-pointer rounded px-1.5 py-0.5 outline-none hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65">{t('undo')}</button>
            )}
          </span>
        </div>
      </div>
    )
  }

  if (proposal.status === 'no') {
    return (
      <div className={cn(base, 'border-dashed border-faint opacity-40')} data-status="no">
        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint"><Icon className="size-3" aria-hidden />{t(`kind.${proposal.kind}`)}</div>
        <b className="text-[13px] leading-5 font-medium line-through">{proposal.title}</b>
        <span className="text-xs text-muted-foreground">{t('status.no')}</span>
      </div>
    )
  }

  if (editing) {
    return (
      <div className={cn(base, 'border-dashed border-faint')} data-status="editing">
        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-faint"><Icon className="size-3" aria-hidden />{t(`kind.${proposal.kind}`)}</div>
        <input
          autoFocus
          value={proposal.title}
          onChange={event => edit(item.id, proposal.id, { title: event.target.value })}
          aria-label={t('fieldTitle')}
          className="h-7 w-full rounded border border-line bg-bg px-1.5 text-[13px] outline-none focus-visible:border-faint"
        />
        {proposal.kind !== 'note' && (
          <div className="flex flex-col gap-1">
            <input type="date" value={proposal.due} onChange={event => edit(item.id, proposal.id, { due: event.target.value })} aria-label={t('fieldDate')} className="h-7 w-full rounded border border-line bg-bg px-1 text-xs outline-none focus-visible:border-faint" />
            {proposal.kind === 'event' && (
              <input type="time" value={proposal.time} onChange={event => edit(item.id, proposal.id, { time: event.target.value })} aria-label={t('fieldTime')} className="h-7 w-full rounded border border-line bg-bg px-1 text-xs outline-none focus-visible:border-faint" />
            )}
          </div>
        )}
        <Button size="sm" variant="ghost" className="h-7 self-end px-2" onClick={() => setEditing(false)} disabled={!proposal.title.trim()}>{t('editDone')}</Button>
      </div>
    )
  }

  return (
    <div className={cn(base, 'border-dashed border-faint')} data-status="wait">
      <div className="flex items-center justify-between font-mono text-[10.5px] text-faint">
        <span className="flex items-center gap-1.5"><Icon className="size-3" aria-hidden />{t(`kind.${proposal.kind}`)}</span>
        {when && <span>{when}</span>}
      </div>
      <b className="text-[13px] leading-5 font-medium break-words">{proposal.title}</b>
      <span className="truncate text-xs text-muted-foreground" title={destination}>{destination}</span>
      <div className="mt-1 flex items-center gap-0.5">
        <Button size="sm" className="h-7 px-2.5" onClick={() => void onAccept()} disabled={busy}>{t('accept')}</Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-muted-foreground" onClick={() => setEditing(true)}><Pencil className="size-3" aria-hidden />{t('edit')}</Button>
        <Button size="icon" variant="ghost" className="ml-auto size-7 text-muted-foreground" onClick={() => reject(item.id, proposal.id)} aria-label={t('reject')} title={t('reject')}><X className="size-3.5" aria-hidden /></Button>
      </div>
    </div>
  )
}

function Entry({ item }: { item: CaptureItem }) {
  const t = useTranslations('collect')
  const accept = useCollectStore(state => state.accept)
  const remove = useCollectStore(state => state.remove)
  const Icon = INPUT_ICON[item.input.kind]
  const pending = waiting(item)
  const excerpt = item.input.text.trim()

  async function acceptAll() {
    let accepted = 0
    for (const proposal of item.proposals.filter(entry => entry.status === 'wait')) {
      try {
        await accept(item.id, proposal.id)
        accepted += 1
      } catch (error) {
        console.error('[collect] accept failed:', error)
        toast.error(t('failed'))
        break
      }
    }
    if (accepted > 0) toast.success(t('acceptedMany', { count: accepted }))
  }

  return (
    <article className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 border-b border-line-soft py-4" data-testid="collect-entry">
      <div className="flex flex-col gap-1.5 pt-0.5 text-xs text-faint">
        <span className="font-mono">{clock(item.createdAt)}</span>
        <span className="flex items-center gap-1"><Icon className="size-3.5" aria-hidden />{t(`input.${item.input.kind}`)}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] leading-[22px] font-semibold tracking-[-0.006em] break-words">{itemTitle(item.input) || t('input.text')}</h3>
          <button type="button" onClick={() => remove(item.id)} aria-label={t('remove')} title={t('remove')} className="cursor-pointer rounded p-1 text-faint outline-none hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ring/65"><X className="size-3.5" aria-hidden /></button>
        </div>
        {excerpt && excerpt !== itemTitle(item.input) && <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-[13.5px] leading-[1.75] break-words text-muted-foreground">{excerpt}</p>}

        {item.state === 'reading' ? (
          <p className="mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-faint border-r-transparent" aria-hidden />{t('reading')}
          </p>
        ) : (
          <>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {item.proposals.map(proposal => <ProposalCard key={proposal.id} item={item} proposal={proposal} />)}
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-faint">
              <span>{item.source === 'ai' ? t('source.ai') : t('source.rules')}</span>
              {pending > 1 && <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-xs" onClick={() => void acceptAll()}>{t('acceptAll')}</Button>}
            </div>
          </>
        )}
      </div>
    </article>
  )
}

export function CollectScreen() {
  const t = useTranslations('collect')
  const isV3 = useUiV3()
  const visible = useCollectStore(state => state.visible)
  const hide = useCollectStore(state => state.hide)
  const captures = useCollectStore(state => state.items)
  const items = useMemo(() => captures.filter(item => !item.proposals.some(proposal => proposal.slot)), [captures])
  const submit = useCollectStore(state => state.submit)
  const records = useInboxStore(state => state.records)
  const processed = useInboxStore(state => state.processed)
  const refreshInbox = useInboxStore(state => state.refresh)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const active = visible && isV3
  useEffect(() => {
    if (active) void refreshInbox()
  }, [active, refreshInbox])

  const unprocessed = useMemo(() => selectUnprocessedRecords({ records, processed }), [records, processed])
  const queued = useMemo(() => new Set(items.map(item => item.recordId).filter((id): id is number => id !== undefined)), [items])
  const shown = useMemo(() => items.filter(item => filter === 'all' || (filter === 'pending' ? waiting(item) > 0 || item.state === 'reading' : item.state === 'ready' && waiting(item) === 0)), [items, filter])
  const counts = useMemo(() => ({
    all: items.length,
    pending: items.filter(item => waiting(item) > 0 || item.state === 'reading').length,
    done: items.filter(item => item.state === 'ready' && waiting(item) === 0).length,
  }), [items])

  if (!active) return null

  const trimmed = text.trim()
  const kind = trimmed ? classifyUnifiedRecordInput(trimmed) : null
  const schedule = trimmed && kind === 'text' && !trimmed.includes('\n') && Array.from(trimmed).length <= 40 ? extractSchedule(trimmed, new Date()) : null
  const detected: 'link' | 'task' | 'text' | null = !kind ? null : kind === 'link' ? 'link' : schedule && (schedule.due || schedule.time) ? 'task' : 'text'

  function send() {
    if (!trimmed) return
    void submit({ kind: classifyUnifiedRecordInput(trimmed) === 'link' ? 'link' : 'text', text: trimmed })
    setText('')
    areaRef.current?.focus()
  }

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(t('fileTooLarge', { name: file.name }))
        continue
      }
      const isImage = file.type.startsWith('image/')
      try {
        void submit({
          kind: isImage ? 'image' : 'file',
          text: files.length === 1 ? trimmed : '',
          name: file.name || (isImage ? 'image.png' : 'file'),
          imageDataUrl: isImage ? await readAsDataUrl(file) : undefined,
        })
      } catch (error) {
        console.error('[collect] read file failed:', error)
        toast.error(t('failed'))
      }
    }
    if (files.length === 1) setText('')
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.files]
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (files.length > 0) void addFiles(files)
    else {
      const dropped = event.dataTransfer.getData('text')
      if (dropped) setText(dropped)
    }
  }

  const samples: Array<{ key: string, icon: typeof Link2, value: string }> = [
    { key: 'link', icon: Link2, value: 'https://www.latent.space/p/agent-memory' },
    { key: 'text', icon: Type, value: t('sample.textValue') },
    { key: 'task', icon: ListTodo, value: t('sample.taskValue') },
  ]

  return (
    <PageSurface label="Collect">
      <PageHeader title={t('title')} subtitle={t('subtitle')} onBack={hide}>
        <CollectTabs active="collect" />
      </PageHeader>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px] lg:overflow-hidden">
        <div className="min-w-0 px-6 py-5 lg:overflow-y-auto">
          <div className="mx-auto max-w-[760px]">
            <div
              onDragOver={event => { event.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn('rounded-lg border border-line bg-bg transition-[border-color,box-shadow] duration-100 focus-within:border-faint', dragging && 'shadow-[inset_0_0_0_3px_color-mix(in_srgb,var(--ink)_7%,transparent)]')}
            >
              <textarea
                ref={areaRef}
                value={text}
                onChange={event => setText(event.target.value)}
                onPaste={onPaste}
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    send()
                  }
                }}
                placeholder={t('placeholder')}
                aria-label={t('inputLabel')}
                rows={3}
                className="block min-h-[76px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 pb-1.5 text-base leading-[26px] outline-none placeholder:text-faint"
              />
              <div className={cn('mx-3 mb-3 flex min-h-9 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]', detected ? 'bg-hover' : 'border border-dashed border-line text-faint')} aria-live="polite">
                {detected ? (
                  <><span className="flex items-center gap-1.5 font-medium">{(() => { const D = detected === 'link' ? Link2 : detected === 'task' ? ListTodo : Type; return <D className="size-3.5" aria-hidden /> })()}{t(`detect.${detected}.name`)}</span><span className="text-muted-foreground">{t(`detect.${detected}.hint`)}</span></>
                ) : t('detect.empty')}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-1.5 pr-1.5 pl-3">
                <div className="flex items-center gap-0.5">
                  <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-muted-foreground" onClick={() => fileRef.current?.click()}><ImagePlus className="size-3.5" aria-hidden />{t('pickFile')}</Button>
                  <input ref={fileRef} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={event => { void addFiles([...(event.target.files ?? [])]); event.target.value = '' }} />
                </div>
                <Button size="sm" className="h-8 gap-2 px-3" onClick={send} disabled={!trimmed}>{t('send')}<kbd className="rounded bg-invert-ink/15 px-1 font-mono text-[11px]">⌘↵</kbd></Button>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5" aria-label={t('try')}>
              <span className="text-xs text-faint">{t('try')}</span>
              {samples.map(sample => (
                <button key={sample.key} type="button" onClick={() => { setText(sample.value); areaRef.current?.focus() }} className="flex h-6 cursor-pointer items-center gap-1.5 rounded border border-line-soft px-2 text-xs text-muted-foreground outline-none transition-colors duration-100 hover:bg-hover hover:text-ink focus-visible:ring-1 focus-visible:ring-ring/65">
                  <sample.icon className="size-3" aria-hidden />{t(`sample.${sample.key}`)}
                </button>
              ))}
            </div>

            <div className="mt-6 flex gap-0.5 border-b border-line pb-2" role="group" aria-label={t('filter.label')}>
              {(['all', 'pending', 'done'] as const).map(value => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn('h-[26px] cursor-pointer rounded px-2 text-[12.5px] text-muted-foreground outline-none transition-colors duration-100 hover:bg-hover focus-visible:ring-1 focus-visible:ring-ring/65', filter === value && 'bg-active font-semibold text-ink')}>
                  {t(`filter.${value}`)}<span className="ml-1.5 font-mono text-[10.5px] text-faint">{counts[value]}</span>
                </button>
              ))}
            </div>

            {shown.length === 0 ? (
              <EmptyState icon={InboxIcon} text={items.length === 0 ? t('empty') : t('emptyFilter')} />
            ) : shown.map(item => <Entry key={item.id} item={item} />)}
          </div>
        </div>

        <aside className="min-w-0 border-t border-line-soft px-4 py-5 lg:overflow-y-auto lg:border-t-0 lg:border-l">
          <div className="flex items-center gap-2 border-b border-line pb-1.5 text-[12.5px] font-semibold">
            <span>{t('records')}</span><Count value={unprocessed.length} />
          </div>
          <p className="mt-2 text-xs leading-5 text-faint">{t('recordsHint')}</p>
          {unprocessed.length === 0 ? (
            <EmptyState icon={InboxIcon} text={t('recordsEmpty')} compact />
          ) : (
            <ul className="mt-1">
              {unprocessed.slice(0, 12).map(record => {
                const { title, preview } = getMarkListItemContent(record)
                const label = title || preview || record.url
                const inQueue = queued.has(record.id)
                return (
                  <li key={record.id} className="flex items-center gap-2 border-b border-line-soft py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-xs"
                      disabled={inQueue}
                      onClick={() => void submit({
                        kind: record.type === 'link' ? 'link' : record.type === 'image' || record.type === 'scan' ? 'image' : record.type === 'file' || record.type === 'recording' ? 'file' : 'text',
                        text: recordNoteContent(record),
                        name: record.type === 'image' || record.type === 'scan' || record.type === 'file' || record.type === 'recording' ? (record.desc || label).slice(0, 60) : undefined,
                      }, { recordId: record.id })}
                    >
                      {inQueue ? t('queued') : t('split')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-4 text-xs leading-5 text-faint">{t('writeHint')}</p>
        </aside>
      </div>
    </PageSurface>
  )
}
