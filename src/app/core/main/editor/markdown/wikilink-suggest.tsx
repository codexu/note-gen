'use client'

import type { Editor } from '@tiptap/react'
import { FilePlus2, FileText, Hash, Heading } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Badge } from '@/components/ui/badge'
import { getAllMarkdownFiles } from '@/lib/files'
import { parseWikilink } from '@/lib/markdown/wikilink'
import { WIKILINK_NODE_NAME } from './wikilink-extension'
import {
  buildCreateInsertion,
  buildWikilinkInsertion,
  findWikilinkInputContext,
  isExactNoteName,
  rankBlockSuggestions,
  rankHeadingSuggestions,
  rankWikilinkSuggestions,
  type WikilinkAnchorResult,
  type WikilinkBlockSuggestion,
  type WikilinkHeadingSuggestion,
  type WikilinkSuggestNote,
  type WikilinkSuggestion,
} from '@/lib/wikilink-suggest-model'
import { toWorkspaceRelativePath } from '@/lib/workspace'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'
import useArticleStore from '@/stores/article'
import useVaultIndexStore from '@/stores/vault-index'

interface WikilinkSuggestProps {
  editor: Editor
  activeFilePath: string
}

interface OpenContext {
  query: string
  noteQuery: string
  mode: 'note' | 'heading' | 'block'
  /** `[[` 的編輯器 position */
  from: number
  cursor: number
  hasClosingBrackets: boolean
}

type MenuEntry =
  | { id: string, type: 'note', suggestion: WikilinkSuggestion }
  | { id: string, type: 'heading', suggestion: WikilinkHeadingSuggestion }
  | { id: string, type: 'block', suggestion: WikilinkBlockSuggestion }
  | { id: string, type: 'create', query: string }

/** 標題層級縮排。第 1 層不縮。 */
const HEADING_INDENT = ['w-0', 'w-3', 'w-6', 'w-9', 'w-12', 'w-14'] as const

export function WikilinkSuggest({ editor, activeFilePath }: WikilinkSuggestProps) {
  const t = useTranslations('editor.wikilinkSuggest')
  const isMobile = useIsMobile()
  const status = useVaultIndexStore(state => state.status)
  const notes = useVaultIndexStore(state => state.notes)
  const revision = useVaultIndexStore(state => state.revision)
  const openTabs = useArticleStore(state => state.openTabs)
  const [context, setContext] = useState<OpenContext | null>(null)
  const [fallbackNotes, setFallbackNotes] = useState<WikilinkSuggestNote[] | null>(null)
  const [currentPath, setCurrentPath] = useState(activeFilePath)
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0 })

  const refreshContext = useCallback(() => {
    if (editor.isDestroyed || !editor.isFocused) {
      setContext(null)
      return
    }
    const { selection } = editor.state
    if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) {
      setContext(null)
      return
    }

    const cursor = selection.from
    const parentOffset = selection.$from.parentOffset
    const textBefore = selection.$from.parent.textBetween(0, parentOffset, undefined, '\ufffc')
    const found = findWikilinkInputContext(textBefore)
    if (!found) {
      setContext(null)
      return
    }

    const textAfter = selection.$from.parent.textBetween(
      parentOffset,
      selection.$from.parent.content.size,
      undefined,
      '\ufffc',
    )
    try {
      const coordinates = editor.view.coordsAtPos(cursor)
      const menuWidth = 360
      setPosition({
        left: Math.max(8, Math.min(coordinates.left, window.innerWidth - menuWidth - 8)),
        top: Math.min(coordinates.bottom + 6, window.innerHeight - 320),
      })
    } catch {
      setContext(null)
      return
    }

    setContext({
      query: found.query,
      noteQuery: found.noteQuery,
      mode: found.mode,
      from: cursor - (textBefore.length - found.from),
      cursor,
      hasClosingBrackets: textAfter.startsWith(']]'),
    })
  }, [editor])

  useEffect(() => {
    const refresh = () => refreshContext()
    const hide = () => setContext(null)
    refreshContext()
    editor.on('transaction', refresh)
    editor.on('selectionUpdate', refresh)
    editor.on('blur', hide)
    return () => {
      editor.off('transaction', refresh)
      editor.off('selectionUpdate', refresh)
      editor.off('blur', hide)
    }
  }, [editor, refreshContext])

  const menuOpen = context !== null

  useEffect(() => {
    if (status === 'ready' || !menuOpen) return
    let cancelled = false
    setFallbackNotes(null)
    void getAllMarkdownFiles().then(files => {
      if (cancelled) return
      setFallbackNotes(files.map(file => ({
        path: file.relativePath,
        aliases: [],
        mtime: file.modifiedAt?.getTime() ?? 0,
      })))
    }).catch(() => {
      if (!cancelled) setFallbackNotes([])
    })
    return () => {
      cancelled = true
    }
  }, [menuOpen, status])

  useEffect(() => {
    let cancelled = false
    void toWorkspaceRelativePath(activeFilePath).then(path => {
      if (!cancelled) setCurrentPath(path)
    }).catch(() => {
      if (!cancelled) setCurrentPath(activeFilePath)
    })
    return () => {
      cancelled = true
    }
  }, [activeFilePath])

  useEffect(() => {
    let cancelled = false
    const tabs = openTabs.filter(tab => tab.kind !== 'blank' && !tab.isFolder)
    void Promise.all(tabs.map(tab => toWorkspaceRelativePath(tab.path).catch(() => tab.path))).then(paths => {
      if (!cancelled) setRecentPaths(paths)
    })
    return () => {
      cancelled = true
    }
  }, [openTabs])

  // revision 變了代表索引內容更新，即使 Map 參考沒換也要重算
  const indexedNotes = useMemo(() => {
    if (status !== 'ready') return fallbackNotes ?? []
    const list: WikilinkSuggestNote[] = []
    for (const note of notes.values()) {
      list.push({
        path: note.path,
        aliases: note.aliases ?? [],
        mtime: note.mtime,
        headings: note.headings ?? [],
        blockIds: note.blockIds ?? [],
      })
    }
    return list
  }, [fallbackNotes, notes, revision, status])

  const suggestions = useMemo(() => {
    if (!context || context.mode !== 'note') return []
    return rankWikilinkSuggestions({
      query: context.query,
      notes: indexedNotes,
      currentPath,
      recentPaths,
      limit: 8,
    })
  }, [context, currentPath, indexedNotes, recentPaths])

  const headingResult = useMemo<WikilinkAnchorResult<WikilinkHeadingSuggestion> | null>(() => {
    if (!context || context.mode !== 'heading') return null
    return rankHeadingSuggestions({
      noteQuery: context.noteQuery,
      query: context.query,
      notes: indexedNotes,
      currentPath,
    })
  }, [context, currentPath, indexedNotes])

  const blockResult = useMemo<WikilinkAnchorResult<WikilinkBlockSuggestion> | null>(() => {
    if (!context || context.mode !== 'block') return null
    return rankBlockSuggestions({
      noteQuery: context.noteQuery,
      query: context.query,
      notes: indexedNotes,
      currentPath,
    })
  }, [context, currentPath, indexedNotes])

  const showCreate = !!context
    && context.mode === 'note'
    && context.query.length > 0
    && !indexedNotes.some(note => isExactNoteName(context.query, note.path))

  const entries = useMemo<MenuEntry[]>(() => {
    if (context?.mode === 'heading') {
      return (headingResult?.suggestions ?? []).map(suggestion => ({
        id: `heading:${suggestion.path}:${suggestion.line}`,
        type: 'heading' as const,
        suggestion,
      }))
    }
    if (context?.mode === 'block') {
      return (blockResult?.suggestions ?? []).map(suggestion => ({
        id: `block:${suggestion.path}:${suggestion.line}:${suggestion.id}`,
        type: 'block' as const,
        suggestion,
      }))
    }
    const noteEntries: MenuEntry[] = suggestions.map(suggestion => ({
      id: `note:${suggestion.path}`,
      type: 'note',
      suggestion,
    }))
    if (!showCreate || !context) return noteEntries
    return [
      ...noteEntries,
      { id: 'create', type: 'create', query: context.query },
    ]
  }, [blockResult, context, headingResult, showCreate, suggestions])

  useEffect(() => {
    setSelectedIndex(0)
  }, [context?.query, context?.noteQuery, context?.mode, context?.from])

  useEffect(() => {
    setSelectedIndex(previous => Math.min(previous, Math.max(entries.length - 1, 0)))
  }, [entries.length])

  const insertText = useCallback((text: string) => {
    if (!context || editor.isDestroyed) return
    // 掛了 L1 的 wikilink 節點時直接插入節點（連同既有的 `]]` 一起換掉），否則退回純文字
    const raw = context.hasClosingBrackets ? `${text}]]` : text
    const attrs = editor.schema.nodes[WIKILINK_NODE_NAME] ? parseWikilink(raw) : null
    if (attrs) {
      const to = context.hasClosingBrackets ? context.cursor + 2 : context.cursor
      editor.chain().focus().insertContentAt({ from: context.from, to }, { type: WIKILINK_NODE_NAME, attrs }).run()
      setContext(null)
      return
    }
    const cursorAfter = context.from + text.length + (context.hasClosingBrackets ? 2 : 0)
    let chain = editor.chain().focus().insertContentAt({ from: context.from, to: context.cursor }, text)
    if (context.hasClosingBrackets) chain = chain.setTextSelection(cursorAfter)
    chain.run()
    setContext(null)
  }, [context, editor])

  const selectEntry = useCallback((entry: MenuEntry | undefined) => {
    if (!entry || !context) return
    if (entry.type === 'create') {
      const created = buildCreateInsertion(entry.query)
      insertText(context.hasClosingBrackets ? created.slice(0, -2) : created)
      return
    }
    if (entry.type === 'heading') {
      insertText(buildWikilinkInsertion({
        suggestion: { path: entry.suggestion.path, matchedAlias: null },
        allPaths: indexedNotes.map(note => note.path),
        hasClosingBrackets: context.hasClosingBrackets,
        heading: entry.suggestion.text,
        self: entry.suggestion.target === '',
      }))
      return
    }
    if (entry.type === 'block') {
      insertText(buildWikilinkInsertion({
        suggestion: { path: entry.suggestion.path, matchedAlias: null },
        allPaths: indexedNotes.map(note => note.path),
        hasClosingBrackets: context.hasClosingBrackets,
        blockId: entry.suggestion.id,
        self: entry.suggestion.target === '',
      }))
      return
    }
    insertText(buildWikilinkInsertion({
      suggestion: entry.suggestion,
      allPaths: indexedNotes.map(note => note.path),
      hasClosingBrackets: context.hasClosingBrackets,
    }))
  }, [context, indexedNotes, insertText])

  useEffect(() => {
    if (!context || editor.isDestroyed) return
    const dom = editor.view.dom
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (entries.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        setSelectedIndex(index => event.key === 'ArrowDown'
          ? (index + 1) % entries.length
          : (index + entries.length - 1) % entries.length)
      } else if ((event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) && entries[selectedIndex]) {
        event.preventDefault()
        event.stopPropagation()
        selectEntry(entries[selectedIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setContext(null)
      }
    }
    dom.addEventListener('keydown', handleKeyDown, true)
    return () => dom.removeEventListener('keydown', handleKeyDown, true)
  }, [context, editor, entries, selectEntry, selectedIndex])

  if (!context || typeof document === 'undefined') return null
  if (status !== 'ready' && fallbackNotes === null) return null

  return createPortal(
    <div
      className={cn(
        'fixed',
        isMobile
          ? 'inset-x-2 bottom-[calc(4.5rem+env(safe-area-inset-bottom))]'
          : 'w-[360px] max-w-[calc(100vw-16px)]',
      )}
      style={isMobile ? undefined : { left: position.left, top: position.top }}
      onMouseDown={event => event.preventDefault()}
    >
      <Command value={entries[selectedIndex]?.id ?? ''} shouldFilter={false} className="border shadow-lg">
        <CommandList className="max-h-72 overflow-y-auto">
          {context.mode === 'note' && suggestions.length > 0 && (
            <CommandGroup>
              {suggestions.map((suggestion, index) => (
                <CommandItem
                  key={suggestion.path}
                  value={`note:${suggestion.path}`}
                  onSelect={() => selectEntry(entries[index])}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <FileText />
                  <span className="min-w-0 flex-1 truncate">{suggestion.label}</span>
                  {suggestion.folder ? (
                    <span className="max-w-[40%] shrink truncate text-xs text-muted-foreground">
                      {suggestion.folder}
                    </span>
                  ) : null}
                  {suggestion.matchedAlias ? (
                    <Badge variant="secondary" title={suggestion.matchedAlias} className="bg-hover font-normal text-ink">
                      {t('alias')}
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {context.mode === 'note' && suggestions.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('noResults')}</div>
          )}

          {context.mode === 'heading' && (headingResult?.suggestions.length ?? 0) > 0 && (
            <CommandGroup heading={t('headings')}>
              {headingResult?.suggestions.map((suggestion, index) => (
                <CommandItem
                  key={`${suggestion.path}:${suggestion.line}`}
                  value={`heading:${suggestion.path}:${suggestion.line}`}
                  onSelect={() => selectEntry(entries[index])}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span aria-hidden className={cn('shrink-0', HEADING_INDENT[suggestion.level - 1])} />
                  <Heading className="text-ink" />
                  <span className="min-w-0 flex-1 truncate">{suggestion.text}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {context.mode === 'heading' && (headingResult?.suggestions.length ?? 0) === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {headingResult?.notePath && headingResult.total === 0 ? t('noHeadings') : t('noResults')}
            </div>
          )}

          {context.mode === 'block' && (blockResult?.suggestions.length ?? 0) > 0 && (
            <CommandGroup heading={t('blocks')}>
              {blockResult?.suggestions.map((suggestion, index) => (
                <CommandItem
                  key={`${suggestion.path}:${suggestion.line}:${suggestion.id}`}
                  value={`block:${suggestion.path}:${suggestion.line}:${suggestion.id}`}
                  onSelect={() => selectEntry(entries[index])}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <Hash className="text-ink" />
                  <span className="shrink-0 rounded bg-hover px-1 font-mono text-ink">^{suggestion.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{suggestion.context}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {context.mode === 'block' && (blockResult?.suggestions.length ?? 0) === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {blockResult?.notePath && blockResult.total === 0 ? t('noBlocks') : t('noResults')}
            </div>
          )}

          {showCreate && context.query && (
            <>
              {suggestions.length > 0 && <CommandSeparator />}
              <CommandGroup>
                <CommandItem
                  value="create"
                  onSelect={() => selectEntry(entries[entries.length - 1])}
                  onMouseEnter={() => setSelectedIndex(entries.length - 1)}
                >
                  <FilePlus2 />
                  <span className="min-w-0 flex-1 truncate">{t('create', { name: context.query })}</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </div>,
    document.body,
  )
}
