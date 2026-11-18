'use client'

// Fork（#46）：Inbox 頁。做法同首頁：蓋在編輯器與右側欄上方、留著左側欄，從左側欄開檔時收起。
// 左欄是還沒整理的記錄與 Inbox 資料夾裡的筆記，右欄展開選中的記錄（MarkDetailPanel）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArchiveRestore, CheckCheck, FilePlus2, FileText, FolderInput, Inbox, Lightbulb, MousePointerClick, Sparkles, Tag, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { EmitterRecordEvents } from '@/config/emitters'
import type { Mark } from '@/db/marks'
import { prepareActiveEditorPathMutationDurably } from '@/lib/editor-deactivation'
import emitter from '@/lib/emitter'
import { addTagToRecords, convertRecordsToNotes, notifyRecordSaved, restoreRecords, setRecordsProcessed, setRecordsUnprocessed, trashRecords } from '@/lib/inbox/actions'
import { formatListTime } from '@/lib/time-format'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import useInboxStore from '@/stores/inbox'
import useMarkStore from '@/stores/mark'
import useTagStore from '@/stores/tag'
import useVaultIndexStore from '@/stores/vault-index'
import { moveFileManagerEntries } from '../file/file-dnd'
import { MarkDetailPanel } from '../mark/mark-detail-panel'
import { getMarkListItemContent } from '../mark/mark-list-item-content'
import { MARK_TYPE_ICONS, getMarkTypeIconClasses } from '../mark/mark-type-meta'
import { OrganizeNotes, type OpenOrganizeOptions } from '../mark/organize-notes'
import { OrganizePromptDialog } from '../mark/organize-prompt-dialog'
import { Count, EmptyState, PageHeader, PageSurface } from '../page-ui'
import { CollectTabs } from '../sidebar-v3/section-tabs'

/** 記錄有變動（新增、編輯、刪除）時重新載入 Inbox。 */
function useInboxSync() {
  const refresh = useInboxStore(state => state.refresh)
  const marks = useMarkStore(state => state.marks)
  const allMarks = useMarkStore(state => state.allMarks)
  const visible = useInboxStore(state => state.visible)
  useEffect(() => {
    void refresh()
  }, [refresh, marks, allMarks, visible])
  useEffect(() => {
    const onRefresh = () => void refresh()
    emitter.on(EmitterRecordEvents.refreshMarks, onRefresh)
    return () => emitter.off(EmitterRecordEvents.refreshMarks, onRefresh)
  }, [refresh])
}

/** 快速記錄存好後的提示（Q33）：不切換畫面，按「查看」才打開 Inbox 頁。 */
function useRecordSavedToast() {
  const t = useTranslations('inbox')
  useEffect(() => {
    const onSaved = () => notifyRecordSaved({ saved: t('saved'), view: t('view') })
    emitter.on('inbox-record-saved', onSaved)
    return () => emitter.off('inbox-record-saved', onSaved)
  }, [t])
}

/** 清單列共用的 hover 與鍵盤焦點。卡片底上用 accent：自訂深色主題裡 --muted 等於 --card。 */
const ROW = 'transition-colors duration-100 hover:bg-accent/70'
const ROW_BUTTON = 'cursor-pointer rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/65'

function noteTitle(path: string) {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

function Section({ title, count, children, actions }: { title: string, count: number, children: ReactNode, actions?: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-card px-3 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        <Count value={count} />
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  )
}

function RecordRow({ record, selected, focused, processed, locale, onToggle, onFocus }: {
  record: Mark
  selected: boolean
  focused: boolean
  processed: boolean
  locale: string
  onToggle: () => void
  onFocus: () => void
}) {
  const Icon = MARK_TYPE_ICONS[record.type]
  const { title, preview } = getMarkListItemContent(record)
  const text = title || preview || record.url
  return (
    <div className={cn('group relative flex items-center gap-2 border-b px-3 text-sm', ROW, selected && 'bg-accent/40', focused && 'bg-hover hover:bg-active')}>
      {/* 目前展開的那筆：左側色條，不只靠底色 */}
      {focused && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-ink" aria-hidden />}
      <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={text} />
      <button type="button" onClick={onFocus} aria-current={focused ? 'true' : undefined} className={cn('flex min-w-0 flex-1 items-center gap-2 py-2 text-left', ROW_BUTTON)}>
        <Icon className={cn('size-4 shrink-0', getMarkTypeIconClasses(record.type), processed && 'opacity-60')} aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate', processed && 'text-muted-foreground')} title={text}>{text}</span>
        {processed && <CheckCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatListTime(record.createdAt, locale)}</span>
      </button>
    </div>
  )
}

export function InboxScreen() {
  const t = useTranslations('inbox')
  const visible = useInboxStore(state => state.visible)
  const hide = useInboxStore(state => state.hide)
  const records = useInboxStore(state => state.records)
  const trashRecordsList = useInboxStore(state => state.trashRecords)
  const processed = useInboxStore(state => state.processed)
  const showProcessed = useInboxStore(state => state.showProcessed)
  const setShowProcessed = useInboxStore(state => state.setShowProcessed)
  const trash = useInboxStore(state => state.trash)
  const setTrash = useInboxStore(state => state.setTrash)
  const focusedMarkId = useInboxStore(state => state.focusedMarkId)
  const setFocusedMarkId = useInboxStore(state => state.setFocusedMarkId)
  const tags = useTagStore(state => state.tags)
  const fetchTags = useTagStore(state => state.fetchTags)
  const inboxFolder = useDailySettingsStore(state => state.inboxFolder)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const locale = useLocale()
  const organizeRef = useRef<{ openOrganize: (options?: OpenOrganizeOptions) => void }>(null)
  const organizePromptRef = useRef<{ openOrganizePrompt: (record: Mark, options?: { onOrganized?: (notePath: string, recordId: number) => void }) => void }>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  useInboxSync()
  useRecordSavedToast()

  const list = useMemo(() => {
    if (trash) return trashRecordsList
    return showProcessed ? records : records.filter(record => !processed.has(record.id))
  }, [trash, trashRecordsList, showProcessed, records, processed])

  const folderNotes = useMemo(() => {
    const prefix = `${inboxFolder.replace(/^\/+|\/+$/g, '')}/`
    return [...notes.values()].filter(note => note.path.startsWith(prefix)).sort((a, b) => b.mtime - a.mtime)
  }, [notes, revision, inboxFolder]) // eslint-disable-line react-hooks/exhaustive-deps

  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const path of notes.keys()) {
      const parts = path.split('/')
      for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
    }
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [notes, revision]) // eslint-disable-line react-hooks/exhaustive-deps

  // 清單換了就丟掉已經看不到的勾選
  useEffect(() => {
    setSelected(current => {
      const ids = new Set(list.map(record => record.id))
      const next = new Set([...current].filter(id => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [list])

  useEffect(() => {
    if (visible) void fetchTags()
  }, [visible, fetchTags])

  if (!visible) return null

  const selectedRecords = list.filter(record => selected.has(record.id))
  const toggle = (id: number) => setSelected(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true)
    try {
      await action()
      setSelected(new Set())
      if (success) toast.success(success)
    } catch (error) {
      console.error('[inbox] action failed:', error)
      toast.error(t('failed'))
    } finally {
      setBusy(false)
    }
  }

  const organize = () => {
    organizeRef.current?.openOrganize({
      recordIds: selectedRecords.map(record => record.id),
      onOrganized: (notePath, recordIds) => {
        void setRecordsProcessed(recordIds, notePath)
        setSelected(new Set())
      },
    })
  }

  const organizeIntoPrompt = () => {
    const [promptDraft] = selectedRecords
    if (!promptDraft) return
    organizePromptRef.current?.openOrganizePrompt(promptDraft, {
      onOrganized: (notePath, recordId) => {
        void setRecordsProcessed([recordId], notePath)
        setSelected(new Set())
      },
    })
  }

  async function openNote(path: string) {
    hide()
    await useArticleStore.getState().setActiveFilePath(path)
  }

  async function moveNote(path: string, folder: string) {
    const activeFilePath = useArticleStore.getState().activeFilePath
    if (!await prepareActiveEditorPathMutationDurably(activeFilePath, [path])) return
    try {
      const result = await moveFileManagerEntries([path], folder)
      await useArticleStore.getState().loadFileTree()
      if (result.failed.length > 0) toast.error(t('moveFailed'))
      else toast.success(t('moved', { folder: folder || t('root') }))
    } catch (error) {
      console.error('[inbox] move failed:', error)
      toast.error(t('moveFailed'))
    }
  }

  const focusedProcessed = focusedMarkId !== null && processed.has(focusedMarkId)

  return (
    <PageSurface label="Inbox">
      <PageHeader
        title={trash ? t('trash') : 'Inbox'}
        onBack={hide}
        actions={(
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={() => setTrash(!trash)}>
            {trash ? <Undo2 className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            {trash ? t('backToInbox') : t('trash')}
          </Button>
        )}
      >
        <CollectTabs active="inbox" />
        {!trash && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={showProcessed} onCheckedChange={setShowProcessed} />
            {t('showProcessed')}
          </label>
        )}
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[440px] min-w-[320px] shrink-0 flex-col border-r">
          <div className="flex h-11 shrink-0 items-center gap-1 border-b px-3">
            <Checkbox
              checked={list.length > 0 && selected.size === list.length ? true : selected.size > 0 ? 'indeterminate' : false}
              onCheckedChange={value => setSelected(value === true ? new Set(list.map(record => record.id)) : new Set())}
              aria-label={t('selectAll')}
              disabled={list.length === 0}
            />
            <span className="ml-1 text-xs text-muted-foreground">{selected.size > 0 ? t('selected', { count: selected.size }) : t('selectAll')}</span>
            <div className="ml-auto flex items-center gap-0.5">
              {trash ? (
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" disabled={busy || selected.size === 0} onClick={() => void run(() => restoreRecords([...selected]))}>
                  <ArchiveRestore className="size-3.5" aria-hidden />{t('restore')}
                </Button>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" disabled={busy || selected.size === 0} onClick={organize} title={t('organize')}>
                    <Sparkles className="size-3.5" aria-hidden />{t('organize')}
                  </Button>
                  {selectedRecords.length === 1 && selectedRecords[0].type === 'prompt-draft' && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" disabled={busy} onClick={organizeIntoPrompt} title={t('organizeIntoPrompt')}>
                      <Lightbulb className="size-3.5" aria-hidden />{t('organizeIntoPrompt')}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" disabled={busy || selected.size === 0} title={t('convert')}
                    onClick={() => void run(async () => {
                      const paths = await convertRecordsToNotes(selectedRecords, inboxFolder)
                      toast.success(t('converted', { count: paths.length }))
                    })}>
                    <FilePlus2 className="size-3.5" aria-hidden />{t('convert')}
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-7" disabled={busy || selected.size === 0} title={t('addTag')} aria-label={t('addTag')}>
                        <Tag className="size-3.5" aria-hidden />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="max-h-72 w-56 overflow-y-auto p-1">
                      {tags.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">{t('noTags')}</p>}
                      {tags.map(tag => (
                        <button key={tag.id} type="button" className="flex w-full cursor-pointer items-center rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                          onClick={() => void run(() => addTagToRecords(selectedRecords, tag.id))}>
                          {tag.name}
                        </button>
                      ))}
                    </PopoverContent>
                  </Popover>
                  {showProcessed && (
                    <Button variant="ghost" size="icon" className="size-7" disabled={busy || selected.size === 0} title={t('markUnprocessed')} aria-label={t('markUnprocessed')}
                      onClick={() => void run(() => setRecordsUnprocessed([...selected]))}>
                      <CheckCheck className="size-3.5" aria-hidden />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="size-7" disabled={busy || selected.size === 0} title={t('delete')} aria-label={t('delete')}
                    onClick={() => {
                      const ids = [...selected]
                      void run(async () => {
                        await trashRecords(ids)
                        toast(t('deleted', { count: ids.length }), {
                          action: { label: t('undo'), onClick: () => void restoreRecords(ids).catch(() => toast.error(t('failed'))) },
                        })
                      })
                    }}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section title={t('records')} count={list.length}>
              {list.length === 0 ? (
                <EmptyState icon={trash ? Trash2 : Inbox} text={trash ? t('trashEmpty') : t('empty')} />
              ) : list.map(record => (
                <RecordRow
                  key={record.id}
                  record={record}
                  locale={locale}
                  selected={selected.has(record.id)}
                  focused={focusedMarkId === record.id}
                  processed={processed.has(record.id)}
                  onToggle={() => toggle(record.id)}
                  onFocus={() => setFocusedMarkId(record.id)}
                />
              ))}
            </Section>

            {!trash && (
              <Section title={t('folderNotes', { folder: inboxFolder })} count={folderNotes.length}>
                {folderNotes.length === 0 ? (
                  <EmptyState icon={FolderInput} text={t('folderEmpty')} />
                ) : folderNotes.map(note => (
                  <div key={note.path} className={cn('group flex items-center gap-2 border-b px-3 text-sm', ROW)}>
                    {/* 對齊記錄列：勾選框那一欄留空，再放檔案圖示 */}
                    <span className="size-4 shrink-0" aria-hidden />
                    <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-2 py-2 text-left', ROW_BUTTON)} onClick={() => void openNote(note.path)} title={t('open')}>
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate" title={noteTitle(note.path)}>{noteTitle(note.path)}</span>
                    </button>
                    {note.mtime > 0 && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatListTime(note.mtime, locale)}</span>}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" title={t('moveTo')} aria-label={t('moveTo')}>
                          <FolderInput className="size-3.5" aria-hidden />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="max-h-72 w-64 overflow-y-auto p-1">
                        {['', ...folders].filter(folder => folder !== inboxFolder.replace(/^\/+|\/+$/g, '')).map(folder => (
                          <button key={folder || '/'} type="button" className="flex w-full cursor-pointer items-center truncate rounded px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                            onClick={() => void moveNote(note.path, folder)}>
                            {folder || t('root')}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          {focusedMarkId !== null ? (
            <div className="absolute inset-0 flex flex-col">
              {focusedProcessed && (
                <div className="flex items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                  <CheckCheck className="size-3.5" aria-hidden />
                  {t('processedNote')}
                  {/* 筆記之後被搬走或刪掉就不給連結 */}
                  {processed.get(focusedMarkId)?.notePath && notes.has(processed.get(focusedMarkId)!.notePath!) && (
                    <button type="button" className="cursor-pointer underline" onClick={() => void openNote(processed.get(focusedMarkId)!.notePath!)}>
                      {noteTitle(processed.get(focusedMarkId)!.notePath!)}
                    </button>
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1">
                <MarkDetailPanel key={focusedMarkId} markId={focusedMarkId} isActive onClose={() => setFocusedMarkId(null)} />
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center">
              <EmptyState icon={MousePointerClick} text={t('noSelection')} />
            </div>
          )}
        </div>
      </div>
      <OrganizeNotes ref={organizeRef} />
      <OrganizePromptDialog ref={organizePromptRef} />
    </PageSurface>
  )
}
