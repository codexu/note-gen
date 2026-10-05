'use client'

import type { Editor } from '@tiptap/react'
import { FileText, Folder, Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { getAllMarkdownFiles, type MarkdownFile } from '@/lib/files'
import {
  createRelativeMarkdownHref,
  isMarkdownPathInput,
  listMarkdownPathSuggestions,
  rankMarkdownFileSuggestions,
  type MarkdownFileLinkSuggestion,
  type MarkdownFolderLinkSuggestion,
  type MarkdownLinkInputContext,
} from '@/lib/markdown-file-link'
import { getContextForQuery } from '@/lib/rag'
import { toWorkspaceRelativePath } from '@/lib/workspace'
import useArticleStore from '@/stores/article'
import useRagSettingsStore from '@/stores/ragSettings'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

interface SmartFileLinkProps {
  editor: Editor
  activeFilePath: string
}

type MenuEntry =
  | { id: string; type: 'file'; suggestion: MarkdownFileLinkSuggestion }
  | { id: string; type: 'folder'; suggestion: MarkdownFolderLinkSuggestion }
  | { id: string; type: 'enhance' }

function findLinkInputContext(editor: Editor): MarkdownLinkInputContext | null {
  const { selection } = editor.state
  if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.type.spec.code) {
    return null
  }

  const cursor = selection.from
  const textBefore = selection.$from.parent.textBetween(0, selection.$from.parentOffset, undefined, '\ufffc')
  const match = textBefore.match(/\[([^\]\n]+)\]\(([^)\n]*)$/)
  if (!match) return null

  const matchStart = match.index ?? 0
  if (matchStart > 0 && textBefore[matchStart - 1] === '!') return null

  const linkText = match[1].trim()
  const targetText = match[2]
  if (!linkText || targetText.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(targetText)) return null

  return {
    linkText,
    targetText,
    targetFrom: cursor - targetText.length,
    cursor,
  }
}

function normalizeComparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').toLocaleLowerCase()
}

function findFileForRagPath(files: MarkdownFile[], ragPath: string): MarkdownFile | undefined {
  const normalizedRagPath = normalizeComparablePath(ragPath)
  return files.find(file => {
    const relativePath = normalizeComparablePath(file.relativePath)
    const fullPath = normalizeComparablePath(file.path)
    return relativePath === normalizedRagPath
      || fullPath === normalizedRagPath
      || normalizedRagPath.endsWith(`/${relativePath}`)
  })
}

export function SmartFileLink({ editor, activeFilePath }: SmartFileLinkProps) {
  const t = useTranslations('editor.smartFileLink')
  const isMobile = useIsMobile()
  const automaticSearchEnabled = useRagSettingsStore(state => state.automaticSearchEnabled)
  const [context, setContext] = useState<MarkdownLinkInputContext | null>(null)
  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [currentRelativePath, setCurrentRelativePath] = useState('')
  const [enhancedSuggestions, setEnhancedSuggestions] = useState<MarkdownFileLinkSuggestion[]>([])
  const [isEnhancing, setIsEnhancing] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const requestIdRef = useRef(0)

  const refreshContext = useCallback(() => {
    const nextContext = findLinkInputContext(editor)
    setContext(nextContext)
    if (!nextContext) return

    const coordinates = editor.view.coordsAtPos(nextContext.cursor)
    const menuWidth = 360
    setPosition({
      left: Math.max(8, Math.min(coordinates.left, window.innerWidth - menuWidth - 8)),
      top: Math.min(coordinates.bottom + 6, window.innerHeight - 320),
    })
  }, [editor])

  useEffect(() => {
    const handleTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) {
        refreshContext()
      } else {
        setContext(null)
      }
    }
    const hideSuggestions = () => setContext(null)

    editor.on('transaction', handleTransaction)
    editor.on('focus', hideSuggestions)
    editor.on('blur', hideSuggestions)
    return () => {
      editor.off('transaction', handleTransaction)
      editor.off('focus', hideSuggestions)
      editor.off('blur', hideSuggestions)
    }
  }, [editor, refreshContext])

  useEffect(() => {
    let cancelled = false
    if (!context) return

    void Promise.all([getAllMarkdownFiles(), toWorkspaceRelativePath(activeFilePath)]).then(([nextFiles, relativePath]) => {
      if (cancelled) return
      setFiles(nextFiles)
      setCurrentRelativePath(relativePath)
    }).catch(() => {
      if (!cancelled) setFiles([])
    })

    return () => {
      cancelled = true
    }
  }, [activeFilePath, context?.linkText])

  const pathMode = !!context && isMarkdownPathInput(context.targetText)
  const quickSuggestions = useMemo(() => {
    if (!context || !currentRelativePath || pathMode) return []
    const recentPaths = useArticleStore.getState().openTabs
      .filter(tab => tab.kind !== 'blank')
      .map(tab => tab.path)
    return rankMarkdownFileSuggestions({
      files,
      currentFilePath: currentRelativePath,
      linkText: context.linkText,
      targetText: context.targetText,
      recentPaths,
    })
  }, [context, currentRelativePath, files, pathMode])

  const pathSuggestions = useMemo(() => {
    if (!context || !currentRelativePath || !pathMode) return []
    return listMarkdownPathSuggestions({
      files,
      currentFilePath: currentRelativePath,
      targetText: context.targetText,
    })
  }, [context, currentRelativePath, files, pathMode])

  const canEnhance = !!context && !pathMode && automaticSearchEnabled && !isEnhancing
  const secondaryQuickSuggestions = useMemo(() => {
    const enhancedPaths = new Set(enhancedSuggestions.map(suggestion => suggestion.relativePath))
    return quickSuggestions.filter(suggestion => !enhancedPaths.has(suggestion.relativePath))
  }, [enhancedSuggestions, quickSuggestions])
  const entries = useMemo<MenuEntry[]>(() => [
    ...enhancedSuggestions.map(suggestion => ({
      id: `enhanced:${suggestion.relativePath}`,
      type: 'file' as const,
      suggestion,
    })),
    ...pathSuggestions.map(suggestion => suggestion.kind === 'folder'
      ? {
          id: `folder:${suggestion.href}`,
          type: 'folder' as const,
          suggestion,
        }
      : {
          id: `path:${suggestion.relativePath}`,
          type: 'file' as const,
          suggestion,
        }),
    ...secondaryQuickSuggestions.map(suggestion => ({
      id: `quick:${suggestion.relativePath}`,
      type: 'file' as const,
      suggestion,
    })),
    ...(canEnhance ? [{ id: 'enhance', type: 'enhance' as const }] : []),
  ], [canEnhance, enhancedSuggestions, pathSuggestions, secondaryQuickSuggestions])

  useEffect(() => {
    requestIdRef.current++
    setEnhancedSuggestions([])
    setIsEnhancing(false)
    setSelectedIndex(0)
  }, [context?.linkText, context?.targetText])

  useEffect(() => {
    setSelectedIndex(previous => Math.min(previous, Math.max(entries.length - 1, 0)))
  }, [entries.length])

  const insertSuggestion = useCallback((suggestion: MarkdownFileLinkSuggestion) => {
    if (!context) return
    editor.chain()
      .focus()
      .deleteRange({ from: context.targetFrom, to: context.cursor })
      .insertContent(`${suggestion.href})`)
      .run()
    setContext(null)
  }, [context, editor])

  const openFolder = useCallback((suggestion: MarkdownFolderLinkSuggestion) => {
    if (!context) return
    editor.chain()
      .focus()
      .deleteRange({ from: context.targetFrom, to: context.cursor })
      .insertContent(suggestion.href)
      .run()
    setSelectedIndex(0)
  }, [context, editor])

  const enhanceSearch = useCallback(async () => {
    if (!context || isEnhancing) return
    const requestId = ++requestIdRef.current
    setIsEnhancing(true)

    try {
      const result = await getContextForQuery(context.linkText)
      if (requestId !== requestIdRef.current) return

      const activePath = normalizeComparablePath(currentRelativePath)
      const seenPaths = new Set<string>()
      const nextSuggestions = result.sourceDetails.flatMap((source, index) => {
        const file = findFileForRagPath(files, source.filepath)
        if (!file || normalizeComparablePath(file.relativePath) === activePath) return []
        if (seenPaths.has(file.relativePath)) return []
        seenPaths.add(file.relativePath)
        return [{
          ...file,
          href: createRelativeMarkdownHref(currentRelativePath, file.relativePath),
          score: Math.max(1, result.sourceDetails.length - index),
        }]
      }).slice(0, 5)
      setEnhancedSuggestions(nextSuggestions)
    } finally {
      if (requestId === requestIdRef.current) setIsEnhancing(false)
    }
  }, [context, currentRelativePath, files, isEnhancing])

  const selectEntry = useCallback((entry: MenuEntry | undefined) => {
    if (!entry) return
    if (entry.type === 'enhance') void enhanceSearch()
    else if (entry.type === 'folder') openFolder(entry.suggestion)
    else insertSuggestion(entry.suggestion)
  }, [enhanceSearch, insertSuggestion, openFolder])

  useEffect(() => {
    if (!context) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        setSelectedIndex(index => entries.length > 0 ? (index + 1) % entries.length : 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()
        setSelectedIndex(index => entries.length > 0 ? (index + entries.length - 1) % entries.length : 0)
      } else if (event.key === 'Enter' && entries[selectedIndex]) {
        event.preventDefault()
        event.stopPropagation()
        selectEntry(entries[selectedIndex])
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setContext(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [context, entries, selectEntry, selectedIndex])

  if (!context || typeof document === 'undefined' || (entries.length === 0 && !isEnhancing)) return null

  const quickEntryOffset = enhancedSuggestions.length

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
      <Command value={entries[selectedIndex]?.id} shouldFilter={false} className="border shadow-lg">
        <CommandList className="max-h-72 overflow-y-auto">
          {enhancedSuggestions.length > 0 && (
            <CommandGroup heading={t('enhancedResults')}>
              {enhancedSuggestions.map((suggestion, index) => (
                <CommandItem
                  key={suggestion.relativePath}
                  value={`enhanced:${suggestion.relativePath}`}
                  onSelect={() => insertSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <Sparkles />
                  <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {pathMode && pathSuggestions.length > 0 && (
            <CommandGroup heading={t('pathMatches')}>
              {pathSuggestions.map((suggestion, index) => (
                <CommandItem
                  key={suggestion.kind === 'folder' ? suggestion.href : suggestion.relativePath}
                  value={suggestion.kind === 'folder'
                    ? `folder:${suggestion.href}`
                    : `path:${suggestion.relativePath}`}
                  onSelect={() => suggestion.kind === 'folder'
                    ? openFolder(suggestion)
                    : insertSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(quickEntryOffset + index)}
                >
                  {suggestion.kind === 'folder' ? <Folder /> : <FileText />}
                  <span className="min-w-0 flex-1 truncate">
                    {suggestion.name}{suggestion.kind === 'folder' ? '/' : ''}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!pathMode && secondaryQuickSuggestions.length > 0 && (
            <>
              {enhancedSuggestions.length > 0 && <CommandSeparator />}
              <CommandGroup heading={t('fileMatches')}>
                {secondaryQuickSuggestions.map((suggestion, index) => (
                  <CommandItem
                    key={suggestion.relativePath}
                    value={`quick:${suggestion.relativePath}`}
                    onSelect={() => insertSuggestion(suggestion)}
                    onMouseEnter={() => setSelectedIndex(quickEntryOffset + index)}
                  >
                    <FileText />
                    <span className="min-w-0 flex-1 truncate">{suggestion.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}

          {!pathMode && automaticSearchEnabled && (
            <>
              {(secondaryQuickSuggestions.length > 0 || enhancedSuggestions.length > 0) && <CommandSeparator />}
              <CommandGroup heading={t('actions')}>
                <CommandItem
                  value="enhance"
                  disabled={isEnhancing}
                  onSelect={() => void enhanceSearch()}
                  onMouseEnter={() => canEnhance && setSelectedIndex(entries.length - 1)}
                >
                  {isEnhancing ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  <span className="min-w-0 flex-1 truncate">{isEnhancing ? t('searching') : t('enhance')}</span>
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
