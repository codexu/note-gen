'use client'

// Fork（#53）：提示詞庫頁。做法同 Inbox 頁：蓋在編輯器與右側欄上方、留著左側欄。
// 左欄是庫裡的提示詞（搜尋／標籤篩選／排序），右欄是選中提示詞的「填變數 → 預覽 → 複製」面板。
import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowDownAZ, Clock3, FolderInput, PanelsTopLeft, Plus, ScrollText, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { prepareActiveEditorPathMutationDurably } from '@/lib/editor-deactivation'
import { noteExists, writeNote } from '@/lib/daily/note-io'
import {
  collectPromptNotes,
  collectUnlistedPromptNotes,
  newPromptContent,
  promptTitle,
  sortPromptNotes,
  type PromptSort,
} from '@/lib/prompt-library/prompt-note'
import { cn } from '@/lib/utils'
import useArticleStore from '@/stores/article'
import useDailySettingsStore from '@/stores/daily-settings'
import usePromptLibraryStore from '@/stores/prompt-library'
import useVaultIndexStore from '@/stores/vault-index'
import { moveFileManagerEntries } from '../file/file-dnd'
import { PromptDetailPanel } from './prompt-detail-panel'
import { KnowledgeTabs } from '../sidebar-v3/section-tabs'
import { useUiV3 } from '@/lib/fork-ui'

const ILLEGAL_NAME_RE = /[\\/:*?"<>|#^[\]\n\r\t]+/g

function sanitizeFileName(name: string): string {
  return name.replace(ILLEGAL_NAME_RE, ' ').replace(/\s+/g, ' ').trim()
}

async function uniquePromptPath(folder: string, title: string): Promise<string> {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  const base = sanitizeFileName(title) || 'Untitled Prompt'
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = attempt === 0 ? `${base}.md` : `${base} ${attempt + 1}.md`
    const candidate = clean ? `${clean}/${name}` : name
    if (await noteExists(candidate)) continue
    return candidate
  }
  throw new Error('too many prompts with the same name')
}

function NewPromptDialog({ folder, open, onOpenChange, onCreated }: {
  folder: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (path: string) => void
}) {
  const t = useTranslations('promptLibrary')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleCreate() {
    setBusy(true)
    try {
      const name = title.trim() || t('untitled')
      const path = await uniquePromptPath(folder, name)
      await writeNote(path, newPromptContent(name))
      await useArticleStore.getState().loadFileTree()
      onOpenChange(false)
      setTitle('')
      onCreated(path)
    } catch (error) {
      console.error('[prompt-library] failed to create a prompt:', error)
      toast.error(t('createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('newPrompt')}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={title}
          placeholder={t('untitled')}
          onChange={event => setTitle(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') void handleCreate() }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button disabled={busy} onClick={() => void handleCreate()}>{t('create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PromptLibraryScreen() {
  const t = useTranslations('promptLibrary')
  const visible = usePromptLibraryStore(state => state.visible)
  const hide = usePromptLibraryStore(state => state.hide)
  const v3Mode = useUiV3()
  const usage = usePromptLibraryStore(state => state.usage)
  const search = usePromptLibraryStore(state => state.search)
  const setSearch = usePromptLibraryStore(state => state.setSearch)
  const tagFilter = usePromptLibraryStore(state => state.tagFilter)
  const setTagFilter = usePromptLibraryStore(state => state.setTagFilter)
  const sort = usePromptLibraryStore(state => state.sort)
  const setSort = usePromptLibraryStore(state => state.setSort)
  const selectedPath = usePromptLibraryStore(state => state.selectedPath)
  const setSelectedPath = usePromptLibraryStore(state => state.setSelectedPath)
  const promptFolder = useDailySettingsStore(state => state.promptFolder)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const [newPromptOpen, setNewPromptOpen] = useState(false)

  const promptNotes = useMemo(
    () => collectPromptNotes(notes.values(), promptFolder),
    [notes, revision, promptFolder], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const unlistedNotes = useMemo(
    () => collectUnlistedPromptNotes(notes.values(), promptFolder),
    [notes, revision, promptFolder], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const note of promptNotes) for (const tag of note.tags) set.add(tag)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [promptNotes])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return promptNotes.filter(note => {
      if (tagFilter && !note.tags.includes(tagFilter)) return false
      if (!query) return true
      return promptTitle(note).toLowerCase().includes(query)
        || note.path.toLowerCase().includes(query)
        || note.tags.some(tag => tag.toLowerCase().includes(query))
    })
  }, [promptNotes, search, tagFilter])

  const sorted = useMemo(() => sortPromptNotes(filtered, usage, sort), [filtered, usage, sort])

  if (!visible) return null

  async function openNote(path: string) {
    hide()
    await useArticleStore.getState().setActiveFilePath(path)
  }

  async function moveIntoLibrary(path: string) {
    const activeFilePath = useArticleStore.getState().activeFilePath
    if (!await prepareActiveEditorPathMutationDurably(activeFilePath, [path])) return
    const result = await moveFileManagerEntries([path], promptFolder)
    await useArticleStore.getState().loadFileTree()
    if (result.failed.length > 0) toast.error(t('moveFailed'))
    else toast.success(t('moved'))
  }

  return (
    <div className="absolute top-0 right-0 bottom-7 left-(--home-left) z-30 flex flex-col bg-card" role="region" aria-label="Prompt Library">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><ScrollText className="size-5" aria-hidden />{t('title')}</h1>
        <KnowledgeTabs active="prompts" />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="default" size="sm" className="gap-2" onClick={() => setNewPromptOpen(true)}>
            <Plus className="size-4" aria-hidden />{t('newPrompt')}
          </Button>
          {!v3Mode && (
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={hide}>
              <PanelsTopLeft className="size-4" aria-hidden />{t('backToWorkspace')}
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[380px] min-w-[300px] shrink-0 flex-col border-r">
          <div className="flex flex-col gap-2 border-b p-3">
            <Input
              value={search}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              onChange={event => setSearch(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Select value={tagFilter ?? '__all__'} onValueChange={value => setTagFilter(value === '__all__' ? null : value)}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder={t('allTags')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('allTags')}</SelectItem>
                  {allTags.map(tag => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={value => setSort(value as PromptSort)}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recentlyUsed"><Clock3 className="size-3.5" aria-hidden />{t('sort.recentlyUsed')}</SelectItem>
                  <SelectItem value="mostUsed"><Sparkles className="size-3.5" aria-hidden />{t('sort.mostUsed')}</SelectItem>
                  <SelectItem value="title"><ArrowDownAZ className="size-3.5" aria-hidden />{t('sort.title')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sorted.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
            ) : sorted.map(note => {
              const path = note.path
              const stats = usage.get(path)
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => setSelectedPath(path)}
                  className={cn(
                    'flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left hover:bg-muted/60',
                    selectedPath === path && 'bg-active hover:bg-active',
                  )}
                >
                  <span className="truncate text-sm font-medium">{promptTitle(note)}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {note.tags.slice(0, 3).map(tag => (
                      <span key={tag} className="rounded bg-muted px-1.5 py-0.5">{tag}</span>
                    ))}
                    {stats?.useCount ? <span className="ml-auto shrink-0 tabular-nums">{t('useCount', { count: stats.useCount })}</span> : null}
                  </div>
                </button>
              )
            })}
          </div>

          {unlistedNotes.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground hover:bg-muted/60">
                  <FolderInput className="size-3.5" aria-hidden />
                  {t('unlisted', { count: unlistedNotes.length })}
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-72 w-72 overflow-y-auto p-1">
                {unlistedNotes.map(note => (
                  <div key={note.path} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                    <span className="min-w-0 flex-1 truncate">{promptTitle(note)}</span>
                    <Button variant="ghost" size="sm" className="h-6 shrink-0 gap-1 px-1.5 text-xs" onClick={() => void moveIntoLibrary(note.path)}>
                      <FolderInput className="size-3" aria-hidden />{t('moveIn')}
                    </Button>
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          {selectedPath && promptNotes.some(note => note.path === selectedPath) ? (
            <PromptDetailPanel key={selectedPath} path={selectedPath} onOpenNote={() => void openNote(selectedPath)} />
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">{t('noSelection')}</div>
          )}
        </div>
      </div>

      <NewPromptDialog
        folder={promptFolder}
        open={newPromptOpen}
        onOpenChange={setNewPromptOpen}
        onCreated={path => void openNote(path)}
      />
    </div>
  )
}
