'use client'

import type { Editor } from '@tiptap/react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import MarkdownIt from 'markdown-it'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { AlertCircle, FileCode2, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { normalizeMarkdownPlaceholders } from './markdown-paragraph'
import { configureGitHubAlertMarkdownIt } from './github-alert-blockquote'
import { useViewportActivation } from './viewport-activation'
import { createViewportWorkQueue } from './viewport-work-scheduler'
import {
  findMarkdownSectionAtOffset,
  getMarkdownSectionSource,
  replaceMarkdownSectionSource,
  type MarkdownSection,
  type MarkdownSectionDocument,
} from './section-document'
import { splitMarkdownDocumentAsync } from './section-document-async'

const previewMarkdown = new MarkdownIt({
  breaks: false,
  html: false,
  linkify: false,
  typographer: false,
})
configureGitHubAlertMarkdownIt(previewMarkdown)

const defaultImageRenderer = previewMarkdown.renderer.rules.image
previewMarkdown.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const src = token.attrGet('src') || ''
  const alt = self.renderInlineAsText(token.children || [], options, env)

  if (!/^(?:https?:|data:|asset:|tauri:)/i.test(src)) {
    return `<span class="sectioned-markdown-image-placeholder">${previewMarkdown.utils.escapeHtml(alt || src || 'image')}</span>`
  }

  token.attrSet('loading', 'lazy')
  token.attrSet('decoding', 'async')
  return defaultImageRenderer
    ? defaultImageRenderer(tokens, index, options, env, self)
    : self.renderToken(tokens, index, options)
}

const previewHtmlCache = new Map<string, string>()
const PREVIEW_HTML_CACHE_LIMIT = 48
const scheduleSectionPreviewWork = createViewportWorkQueue()
const STRUCTURAL_MARKER_RE = /^ {0,3}(?:#{1,2}(?:[\t ]+|$)|`{3,}|~{3,}|\$\$|\\\[|\\\]|(?:=+|-+)[\t ]*$|<(?:!--|\?|![A-Z]|!\[CDATA\[|\/?[A-Za-z]))/im
const STRUCTURAL_CLOSING_MARKER_RE = /(?:-->|\]\]>|\?>|<\/(?:pre|script|style|textarea)[\t ]*>|\$\$|\\\])/i
const HTML_BLOCK_CANDIDATE_RE = /^ {0,3}<(?:!--|\?|![A-Z]|!\[CDATA\[|\/?[A-Za-z])/im

function getChangedLineWindow(source: string, from: number, to: number): string {
  const changedLineStart = source.lastIndexOf('\n', Math.max(0, from - 1)) + 1
  const previousLineBreak = source.lastIndexOf('\n', Math.max(0, changedLineStart - 2))
  const lineFrom = previousLineBreak + 1
  const changedLineBreak = source.indexOf('\n', Math.max(from, to))
  const followingLineBreak = changedLineBreak < 0
    ? -1
    : source.indexOf('\n', changedLineBreak + 1)
  const lineTo = followingLineBreak < 0 ? source.length : followingLineBreak + 1
  return source.slice(lineFrom, lineTo)
}

function mayNeedStructuralResegment(
  before: string,
  after: string,
  maxSectionCharacters: number,
): boolean {
  if (before === after) return false
  if ((before.length > maxSectionCharacters) !== (after.length > maxSectionCharacters)) {
    return true
  }

  let prefix = 0
  const sharedLength = Math.min(before.length, after.length)
  while (prefix < sharedLength && before.charCodeAt(prefix) === after.charCodeAt(prefix)) {
    prefix++
  }

  let beforeSuffix = before.length
  let afterSuffix = after.length
  while (
    beforeSuffix > prefix
    && afterSuffix > prefix
    && before.charCodeAt(beforeSuffix - 1) === after.charCodeAt(afterSuffix - 1)
  ) {
    beforeSuffix--
    afterSuffix--
  }

  const beforeWindow = getChangedLineWindow(before, prefix, beforeSuffix)
  const afterWindow = getChangedLineWindow(after, prefix, afterSuffix)
  if (
    STRUCTURAL_MARKER_RE.test(beforeWindow)
    || STRUCTURAL_MARKER_RE.test(afterWindow)
    || STRUCTURAL_CLOSING_MARKER_RE.test(beforeWindow)
    || STRUCTURAL_CLOSING_MARKER_RE.test(afterWindow)
  ) {
    return true
  }

  const newlineChanged = before.slice(prefix, beforeSuffix).includes('\n')
    || after.slice(prefix, afterSuffix).includes('\n')
  return newlineChanged
    && (HTML_BLOCK_CANDIDATE_RE.test(before) || HTML_BLOCK_CANDIDATE_RE.test(after))
}

function renderPreviewHtml(section: MarkdownSection, markdown: string): string {
  const cacheKey = `${section.contentHash}:${markdown.length}`
  const cached = previewHtmlCache.get(cacheKey)
  if (cached !== undefined) return cached

  const html = previewMarkdown.render(markdown)
  previewHtmlCache.set(cacheKey, html)
  if (previewHtmlCache.size > PREVIEW_HTML_CACHE_LIMIT) {
    const oldestKey = previewHtmlCache.keys().next().value
    if (typeof oldestKey === 'string') previewHtmlCache.delete(oldestKey)
  }
  return html
}

function estimateSectionHeight(section: MarkdownSection): number {
  // TanStack asks for an estimate for every item while building its initial
  // measurement cache. Keep this O(1): visible rows are corrected by
  // measureElement, while scanning/slicing every section here would put an
  // O(document size) pass back onto the main thread after Worker indexing.
  const characterCount = Math.max(1, section.to - section.from)
  const wrappedLines = Math.ceil(characterCount / 88)
  return Math.max(96, Math.min(18_000, wrappedLines * 25))
}

function restoreSectionBoundaryWhitespace(original: string, nextMarkdown: string): string {
  if (!/\S/.test(original)) {
    if (!/\S/.test(nextMarkdown)) return original
    return `${original}${nextMarkdown.replace(/^(?:[\t ]*(?:\r\n|\n))+/, '')}`
  }

  const leadingWhitespace = original.match(/^(?:[\t ]*(?:\r\n|\n))+/)?.[0] ?? ''
  const trailingWhitespace = original.match(/[\t ]*(?:(?:\r\n|\n)[\t ]*)+$/)?.[0] ?? ''
  let body = nextMarkdown

  if (leadingWhitespace) {
    body = body.replace(/^(?:[\t ]*(?:\r\n|\n))+/, '')
  }
  if (trailingWhitespace) {
    body = body.replace(/[\t ]*(?:(?:\r\n|\n)[\t ]*)+$/, '')
  }

  return `${leadingWhitespace}${body}${trailingWhitespace}`
}

function getFirstEditableSection(document: MarkdownSectionDocument): MarkdownSection | null {
  return document.sections.find(section => section.kind !== 'frontmatter' && !section.oversized) ?? null
}

function serializeEditorRange(editor: Editor, from: number, to: number): string {
  if (from === to) return ''
  const markdownManager = editor.markdown
  if (!markdownManager) {
    return editor.state.doc.textBetween(from, to, '\n', '\n')
  }

  try {
    const slice = editor.state.doc.slice(from, to)
    const json = { type: 'doc', content: slice.content.toJSON() }
    return normalizeMarkdownPlaceholders(markdownManager.serialize(json))
  } catch {
    return editor.state.doc.textBetween(from, to, '\n', '\n')
  }
}

export interface SectionedMarkdownSelection {
  collapsed: boolean
  selectionToken: string
  from: number
  to: number
  text: string
  markdown: string
}

function getSectionedSelection(
  document: MarkdownSectionDocument | null,
  sectionId: string | null,
  editor: Editor | null,
): SectionedMarkdownSelection | null {
  if (!document || !sectionId || !editor || editor.isDestroyed) return null

  const section = document.sections.find(candidate => candidate.id === sectionId)
  if (!section) return null

  const selection = editor.state.selection
  const text = editor.state.doc.textBetween(selection.from, selection.to, '\n', '\n')
  const selectedMarkdown = serializeEditorRange(editor, selection.from, selection.to)
  const tokenSource = `${section.id}:${selection.from}:${selection.to}:${editor.state.doc.content.size}:${selectedMarkdown}`
  let tokenHash = 2166136261
  for (let index = 0; index < tokenSource.length; index++) {
    tokenHash ^= tokenSource.charCodeAt(index)
    tokenHash = Math.imul(tokenHash, 16777619)
  }

  return {
    // Tiptap normalizes Markdown while serializing, so a ProseMirror position
    // cannot be converted to a canonical source offset by measuring a prefix.
    // Keep the selected content available, but explicitly mark exact offsets as
    // unavailable until the section host has a real source map.
    collapsed: selection.empty,
    selectionToken: `section-selection-${(tokenHash >>> 0).toString(36)}`,
    from: -1,
    to: -1,
    text,
    markdown: selectedMarkdown,
  }
}

function SectionPreview({
  section,
  markdown,
  onActivate,
  onRequestSourceMode,
}: {
  section: MarkdownSection
  markdown: string
  onActivate: (coordinates?: { left: number; top: number }) => void
  onRequestSourceMode: () => void
}) {
  const t = useTranslations('editor.largeMarkdownMode.sectioned')
  const sourceOnly = section.kind === 'frontmatter' || section.oversized
  const previewKey = `${section.contentHash}:${markdown.length}`
  const [renderedPreview, setRenderedPreview] = useState({ key: '', html: '' })
  const { elementRef, isActive } = useViewportActivation<HTMLDivElement>()
  const html = renderedPreview.key === previewKey ? renderedPreview.html : ''

  useEffect(() => {
    if (sourceOnly || !isActive) return

    let cancelled = false
    const cancelWork = scheduleSectionPreviewWork(() => {
      const renderedHtml = renderPreviewHtml(section, markdown)
      if (!cancelled) {
        setRenderedPreview({ key: previewKey, html: renderedHtml })
      }
    })

    return () => {
      cancelled = true
      cancelWork()
    }
  }, [isActive, markdown, previewKey, section, sourceOnly])

  if (sourceOnly) {
    return (
      <button
        type="button"
        className="sectioned-markdown-source-only block w-full rounded-md border border-dashed border-border/70 bg-muted/15 p-4 text-left"
        onClick={onRequestSourceMode}
      >
        <span className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <FileCode2 className="size-3.5" />
          {section.kind === 'frontmatter' ? t('frontmatter') : t('oversized')}
        </span>
        <pre className="max-h-64 overflow-hidden whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {markdown.slice(0, 4_000)}
          {markdown.length > 4_000 ? '\n…' : ''}
        </pre>
      </button>
    )
  }

  return (
    <div
      ref={elementRef}
      role="button"
      tabIndex={0}
      aria-label={section.heading?.text
        ? t('editSection', { title: section.heading.text })
        : t('editUntitled')}
      className="sectioned-markdown-preview cursor-text rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => {
        event.preventDefault()
        onActivate({ left: event.clientX, top: event.clientY })
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onActivate()
      }}
    >
      {html ? (
        <div
          className="tiptap ProseMirror sectioned-markdown-preview-content"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="max-h-80 overflow-hidden whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
          {markdown.slice(0, 2_000)}
          {markdown.length > 2_000 ? '\n…' : ''}
        </pre>
      )}
    </div>
  )
}

export interface SectionedMarkdownEditorController {
  flush(expectedCanonical?: string): string
  getActiveEditor(): Editor | null
  getActiveSectionId(): string | null
  getSelection(): SectionedMarkdownSelection | null
  isBusy(): boolean
  activateOffset(offset: number): void
  prepareToDeactivate(): boolean
}

interface ActiveSectionRenderProps {
  editorKey: string
  section: MarkdownSection
  markdown: string
  onDirty: () => void
  onChange: (markdown: string) => void
  onEditorReady: (editor: Editor) => void
  onBlockingActivityChange: (count: number) => void
}

interface SectionedMarkdownEditorProps {
  markdown: string
  getCanonicalMarkdown: () => string
  initialActiveSectionId?: string
  scrollContainerRef: RefObject<HTMLDivElement | null>
  className?: string
  renderActiveSection: (props: ActiveSectionRenderProps) => ReactNode
  onChange?: (markdown: string) => void
  onActiveEditorChange?: (editor: Editor | null) => void
  onSelectionChange?: (selection: SectionedMarkdownSelection | null) => void
  onRequestSourceMode: () => void
}

export const SectionedMarkdownEditor = forwardRef<
  SectionedMarkdownEditorController,
  SectionedMarkdownEditorProps
>(function SectionedMarkdownEditor({
  markdown,
  getCanonicalMarkdown,
  initialActiveSectionId,
  scrollContainerRef,
  className,
  renderActiveSection,
  onChange,
  onActiveEditorChange,
  onSelectionChange,
  onRequestSourceMode,
}, forwardedRef) {
  const t = useTranslations('editor.largeMarkdownMode.sectioned')
  const [document, setDocument] = useState<MarkdownSectionDocument | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(initialActiveSectionId ?? null)
  const [isIndexing, setIsIndexing] = useState(true)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [isReconciling, setIsReconciling] = useState(false)
  const [activityRevision, setActivityRevision] = useState(0)
  const [externalContentEpoch, setExternalContentEpoch] = useState(0)
  const documentRef = useRef<MarkdownSectionDocument | null>(null)
  const latestMarkdownPropRef = useRef(markdown)
  const getCanonicalMarkdownRef = useRef(getCanonicalMarkdown)
  const activeSectionIdRef = useRef<string | null>(initialActiveSectionId ?? null)
  const activeEditorRef = useRef<Editor | null>(null)
  const activeSectionDirtyRef = useRef(false)
  const activeBlockingActivityCountRef = useRef(0)
  const onChangeRef = useRef(onChange)
  const onActiveEditorChangeRef = useRef(onActiveEditorChange)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const externalContentEpochRef = useRef(0)
  const structuralResegmentPendingRef = useRef(false)
  const structuralReconcileControllerRef = useRef<AbortController | null>(null)
  const isReconcilingRef = useRef(false)
  const pendingActivationRef = useRef<{
    sectionId: string
    coordinates?: { left: number; top: number }
    requestedOffset?: number
  } | null>(null)
  const pendingFocusRef = useRef<{
    sectionId: string
    coordinates?: { left: number; top: number }
  } | null>(null)
  const compositionListenerCleanupRef = useRef<(() => void) | null>(null)
  const activeSelectionCleanupRef = useRef<(() => void) | null>(null)
  const resetVirtualMeasurementsRef = useRef<() => void>(() => {})
  const flushActiveSectionRef = useRef<(expectedCanonical?: string) => string>(() => markdown)
  const reconcileBeforeActivationRef = useRef<(
    sectionId: string,
    coordinates?: { left: number; top: number },
    requestedOffset?: number,
  ) => void>(() => {})

  getCanonicalMarkdownRef.current = getCanonicalMarkdown

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onActiveEditorChangeRef.current = onActiveEditorChange
  }, [onActiveEditorChange])

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  const ensureCanLeaveActiveSection = useCallback(() => {
    const activeEditor = activeEditorRef.current
    if (
      activeBlockingActivityCountRef.current <= 0
      && !isReconcilingRef.current
      && !(activeEditor && !activeEditor.isDestroyed && activeEditor.view.composing)
    ) {
      return true
    }
    toast({ title: t('busy') })
    return false
  }, [t])

  const requestSourceMode = useCallback(() => {
    if (!ensureCanLeaveActiveSection()) return
    onRequestSourceMode()
  }, [ensureCanLeaveActiveSection, onRequestSourceMode])

  const installDocument = useCallback((nextDocument: MarkdownSectionDocument, nextActiveId?: string | null) => {
    documentRef.current = nextDocument
    setDocument(nextDocument)

    const requestedActiveId = nextActiveId === undefined
      ? activeSectionIdRef.current
      : nextActiveId
    const requestedSection = requestedActiveId
      ? nextDocument.sections.find(section => section.id === requestedActiveId)
      : null
    const nextActiveSection = requestedSection && requestedSection.kind !== 'frontmatter' && !requestedSection.oversized
      ? requestedSection
      : getFirstEditableSection(nextDocument)
    const resolvedActiveId = nextActiveSection?.id ?? null

    activeSectionIdRef.current = resolvedActiveId
    setActiveSectionId(resolvedActiveId)
  }, [])

  useEffect(() => {
    const currentDocument = documentRef.current
    if (currentDocument?.source === markdown) {
      latestMarkdownPropRef.current = markdown
      setIsIndexing(false)
      return
    }

    const activeEditor = activeEditorRef.current
    if (
      currentDocument
      && (
        activeBlockingActivityCountRef.current > 0
        || isReconcilingRef.current
        || Boolean(activeEditor && !activeEditor.isDestroyed && activeEditor.view.composing)
      )
    ) {
      return
    }

    // An external replacement that bypassed the normal prepare hook must not
    // discard a locally dirty section. Re-assert the exact local snapshot and
    // let the caller retry through the guarded external-update path.
    if (currentDocument && activeSectionDirtyRef.current) {
      latestMarkdownPropRef.current = currentDocument.source
      flushActiveSectionRef.current(currentDocument.source)
      return
    }

    latestMarkdownPropRef.current = markdown

    structuralReconcileControllerRef.current?.abort()
    structuralReconcileControllerRef.current = null
    isReconcilingRef.current = false
    setIsReconciling(false)

    let cancelled = false
    const indexController = new AbortController()
    const preservedScrollTop = scrollContainerRef.current?.scrollTop ?? 0
    setIndexError(null)
    setIsIndexing(true)
    if (currentDocument) {
      externalContentEpochRef.current++
      activeSelectionCleanupRef.current?.()
      activeEditorRef.current = null
      activeSectionDirtyRef.current = false
      activeBlockingActivityCountRef.current = 0
      onActiveEditorChangeRef.current?.(null)
      onSelectionChangeRef.current?.(null)
      setExternalContentEpoch(value => value + 1)
    }
    const timer = window.setTimeout(() => {
      if (cancelled) return

      void splitMarkdownDocumentAsync(markdown, {
        previousDocument: currentDocument ?? undefined,
      }, indexController.signal).then(nextDocument => {
        if (cancelled) return
        structuralResegmentPendingRef.current = false
        resetVirtualMeasurementsRef.current()
        installDocument(nextDocument)
        setIsIndexing(false)
        window.requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = preservedScrollTop
          }
        })
      }).catch(error => {
        if (cancelled || (error instanceof Error && error.name === 'AbortError')) return
        console.error('Markdown section indexing failed:', error)
        setIndexError(error instanceof Error ? error.message : String(error))
        setIsIndexing(false)
      })
    }, 0)

    return () => {
      cancelled = true
      indexController.abort()
      window.clearTimeout(timer)
    }
  }, [
    activityRevision,
    installDocument,
    isReconciling,
    markdown,
    scrollContainerRef,
  ])

  const updateSectionMarkdown = useCallback((sectionId: string, nextMarkdown: string) => {
    const currentDocument = documentRef.current
    if (currentDocument?.source !== latestMarkdownPropRef.current) {
      return latestMarkdownPropRef.current
    }
    const section = currentDocument?.sections.find(candidate => candidate.id === sectionId)
    if (!currentDocument || !section) {
      return currentDocument?.source ?? markdown
    }

    const originalMarkdown = getMarkdownSectionSource(currentDocument, section)
    const sourceWithBoundary = restoreSectionBoundaryWhitespace(originalMarkdown, nextMarkdown)
    const structuralRisk = mayNeedStructuralResegment(
      originalMarkdown,
      sourceWithBoundary,
      currentDocument.maxSectionCharacters ?? 64_000,
    )
    const result = replaceMarkdownSectionSource(currentDocument, sectionId, sourceWithBoundary)
    if (result.document === currentDocument) return currentDocument.source

    if (structuralRisk) {
      structuralResegmentPendingRef.current = true
    }

    documentRef.current = result.document
    setDocument(result.document)
    onChangeRef.current?.(result.document.source)
    if (getCanonicalMarkdownRef.current() === result.document.source) {
      latestMarkdownPropRef.current = result.document.source
    }
    return result.document.source
  }, [markdown])

  const flushActiveSection = useCallback((expectedCanonical?: string) => {
    const activeEditor = activeEditorRef.current
    const activeId = activeSectionIdRef.current
    const currentDocument = documentRef.current
    const invalidateActiveSection = () => {
      externalContentEpochRef.current++
      activeSectionDirtyRef.current = false
      activeBlockingActivityCountRef.current = 0
      activeSelectionCleanupRef.current?.()
      activeEditorRef.current = null
      onActiveEditorChangeRef.current?.(null)
      onSelectionChangeRef.current?.(null)
      setIsIndexing(true)
      setExternalContentEpoch(value => value + 1)
    }

    if (expectedCanonical !== undefined && currentDocument?.source !== expectedCanonical) {
      invalidateActiveSection()
      return expectedCanonical
    }
    if (currentDocument?.source !== latestMarkdownPropRef.current) {
      invalidateActiveSection()
      return latestMarkdownPropRef.current
    }
    if (activeBlockingActivityCountRef.current > 0) {
      return currentDocument?.source ?? expectedCanonical ?? markdown
    }
    if (
      !activeEditor
      || activeEditor.isDestroyed
      || !activeId
      || !currentDocument
      || !activeSectionDirtyRef.current
    ) {
      return currentDocument?.source ?? markdown
    }

    const nextMarkdown = normalizeMarkdownPlaceholders(activeEditor.getMarkdown())
    activeSectionDirtyRef.current = false
    return updateSectionMarkdown(activeId, nextMarkdown)
  }, [markdown, updateSectionMarkdown])

  flushActiveSectionRef.current = flushActiveSection

  const prepareToDeactivate = useCallback(() => {
    if (!ensureCanLeaveActiveSection()) return false
    const expectedCanonical = getCanonicalMarkdownRef.current()
    const flushedMarkdown = flushActiveSectionRef.current(expectedCanonical)
    return flushedMarkdown === getCanonicalMarkdownRef.current()
  }, [ensureCanLeaveActiveSection])

  const reconcileBeforeActivation = useCallback((
    requestedSectionId: string,
    coordinates?: { left: number; top: number },
    requestedOffset?: number,
  ) => {
    const currentEditor = activeEditorRef.current
    if (
      requestedSectionId === activeSectionIdRef.current
      && !structuralResegmentPendingRef.current
      && currentEditor
      && !currentEditor.isDestroyed
    ) {
      const position = coordinates
        ? currentEditor.view.posAtCoords(coordinates)?.pos
        : undefined
      if (typeof position === 'number') {
        currentEditor.commands.setTextSelection(position)
      }
      currentEditor.commands.focus()
      return
    }

    if (currentEditor && !currentEditor.isDestroyed && currentEditor.view.composing) {
      pendingActivationRef.current = { sectionId: requestedSectionId, coordinates, requestedOffset }
      compositionListenerCleanupRef.current?.()

      const target = currentEditor.view.dom
      const handleCompositionEnd = () => {
        compositionListenerCleanupRef.current?.()
        const pendingActivation = pendingActivationRef.current
        pendingActivationRef.current = null
        if (!pendingActivation) return
        window.setTimeout(() => reconcileBeforeActivationRef.current(
          pendingActivation.sectionId,
          pendingActivation.coordinates,
          pendingActivation.requestedOffset,
        ), 0)
      }
      target.addEventListener('compositionend', handleCompositionEnd, { once: true })
      compositionListenerCleanupRef.current = () => {
        target.removeEventListener('compositionend', handleCompositionEnd)
        compositionListenerCleanupRef.current = null
      }
      return
    }

    if (!ensureCanLeaveActiveSection()) return

    const flushedMarkdown = flushActiveSection()
    const currentDocument = documentRef.current
    if (
      !currentDocument
      || currentDocument.source !== flushedMarkdown
      || currentDocument.source !== getCanonicalMarkdownRef.current()
    ) {
      return
    }

    const requestedSection = currentDocument.sections.find(
      section => section.id === requestedSectionId,
    )
    const targetOffset = requestedOffset ?? requestedSection?.from

    if (structuralResegmentPendingRef.current) {
      const sourceToReconcile = currentDocument.source
      const currentActiveSection = currentDocument.sections.find(
        section => section.id === activeSectionIdRef.current,
      )
      structuralReconcileControllerRef.current?.abort()
      const reconcileController = new AbortController()
      structuralReconcileControllerRef.current = reconcileController
      isReconcilingRef.current = true
      setIsReconciling(true)
      const finishReconcile = () => {
        if (structuralReconcileControllerRef.current !== reconcileController) return false
        structuralReconcileControllerRef.current = null
        isReconcilingRef.current = false
        setIsReconciling(false)
        return true
      }

      externalContentEpochRef.current++
      activeSelectionCleanupRef.current?.()
      activeEditorRef.current = null
      activeSectionDirtyRef.current = false
      activeBlockingActivityCountRef.current = 0
      onActiveEditorChangeRef.current?.(null)
      onSelectionChangeRef.current?.(null)
      setExternalContentEpoch(value => value + 1)

      void splitMarkdownDocumentAsync(sourceToReconcile, {
        targetSectionCharacters: currentDocument.targetSectionCharacters,
        maxSectionCharacters: currentDocument.maxSectionCharacters,
        previousDocument: currentDocument,
        reconcile: currentActiveSection
          ? {
              activeSectionId: currentActiveSection.id,
              anchorOffset: currentActiveSection.from,
            }
          : undefined,
      }, reconcileController.signal).then(reconciledDocument => {
        if (
          reconcileController.signal.aborted
          || structuralReconcileControllerRef.current !== reconcileController
          || documentRef.current?.source !== sourceToReconcile
          || getCanonicalMarkdownRef.current() !== sourceToReconcile
        ) {
          return
        }

        structuralResegmentPendingRef.current = false
        const nextRequestedSection = typeof targetOffset === 'number'
          ? findMarkdownSectionAtOffset(reconciledDocument, targetOffset)
          : reconciledDocument.sections.find(section => section.id === requestedSectionId)

        if (
          !nextRequestedSection
          || nextRequestedSection.kind === 'frontmatter'
          || nextRequestedSection.oversized
        ) {
          if (!finishReconcile()) return
          onRequestSourceMode()
          return
        }

        pendingFocusRef.current = {
          sectionId: nextRequestedSection.id,
          coordinates,
        }
        resetVirtualMeasurementsRef.current()
        installDocument(reconciledDocument, nextRequestedSection.id)
      }).catch(error => {
        if (
          reconcileController.signal.aborted
          || (error instanceof Error && error.name === 'AbortError')
        ) {
          return
        }
        if (!finishReconcile()) return
        structuralResegmentPendingRef.current = false
        onRequestSourceMode()
      }).finally(() => {
        finishReconcile()
      })
      return
    }

    if (!requestedSection || requestedSection.kind === 'frontmatter' || requestedSection.oversized) {
      onRequestSourceMode()
      return
    }
    const nextActiveId = requestedSection.id

    activeEditorRef.current = null
    activeSectionDirtyRef.current = false
    activeBlockingActivityCountRef.current = 0
    activeSelectionCleanupRef.current?.()
    onActiveEditorChangeRef.current?.(null)
    onSelectionChangeRef.current?.(null)
    pendingFocusRef.current = { sectionId: nextActiveId, coordinates }
    installDocument(currentDocument, nextActiveId)
  }, [ensureCanLeaveActiveSection, flushActiveSection, installDocument, onRequestSourceMode])

  reconcileBeforeActivationRef.current = reconcileBeforeActivation

  useEffect(() => () => {
    const reconcileController = structuralReconcileControllerRef.current
    structuralReconcileControllerRef.current = null
    isReconcilingRef.current = false
    reconcileController?.abort()
    compositionListenerCleanupRef.current?.()
    activeSelectionCleanupRef.current?.()
    pendingActivationRef.current = null
    pendingFocusRef.current = null
    flushActiveSectionRef.current(getCanonicalMarkdownRef.current())
    activeEditorRef.current = null
    activeSectionDirtyRef.current = false
    activeBlockingActivityCountRef.current = 0
    onActiveEditorChangeRef.current?.(null)
    onSelectionChangeRef.current?.(null)
  }, [])

  useImperativeHandle(forwardedRef, () => ({
    flush: flushActiveSection,
    getActiveEditor: () => activeEditorRef.current,
    getActiveSectionId: () => activeSectionIdRef.current,
    getSelection: () => getSectionedSelection(
      documentRef.current,
      activeSectionIdRef.current,
      activeEditorRef.current,
    ),
    isBusy: () => (
      activeBlockingActivityCountRef.current > 0
      || isReconcilingRef.current
      || Boolean(
        activeEditorRef.current
        && !activeEditorRef.current.isDestroyed
        && activeEditorRef.current.view.composing
      )
    ),
    activateOffset: (offset: number) => {
      const currentDocument = documentRef.current
      if (!currentDocument) return
      const section = findMarkdownSectionAtOffset(currentDocument, offset)
      if (!section || section.kind === 'frontmatter' || section.oversized) {
        requestSourceMode()
        return
      }
      reconcileBeforeActivation(section.id, undefined, offset)
    },
    prepareToDeactivate,
  }), [flushActiveSection, prepareToDeactivate, reconcileBeforeActivation, requestSourceMode])

  const activeIndex = document?.sections.findIndex(section => section.id === activeSectionId) ?? -1
  const rowVirtualizer = useVirtualizer({
    count: document?.sections.length ?? 0,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: index => document?.sections[index]?.id ?? index,
    estimateSize: index => {
      if (!document) return 160
      const section = document.sections[index]
      return estimateSectionHeight(section)
    },
    overscan: 2,
    rangeExtractor: range => {
      const indexes = defaultRangeExtractor(range)
      if (activeIndex < 0 || indexes.includes(activeIndex)) return indexes
      return [...indexes, activeIndex].sort((left, right) => left - right)
    },
  })
  resetVirtualMeasurementsRef.current = () => rowVirtualizer.measure()

  if (!document) {
    if (indexError) {
      return (
        <div className={cn('flex min-h-64 items-center justify-center px-4', className)}>
          <div className="w-full max-w-lg rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-destructive">{t('indexingFailed')}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{indexError}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                    onClick={() => {
                      setIndexError(null)
                      setActivityRevision(value => value + 1)
                    }}
                  >
                    {t('retryIndexing')}
                  </button>
                  <button
                    type="button"
                    className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                    onClick={requestSourceMode}
                  >
                    {t('returnToSource')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return (
      <div className={cn('flex min-h-64 items-center justify-center text-sm text-muted-foreground', className)}>
        <Loader2 className="mr-2 size-4 animate-spin" />
        {t('indexing')}
      </div>
    )
  }

  return (
    <div
      className={cn('sectioned-markdown-editor relative w-full', className)}
      style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      aria-busy={isIndexing || isReconciling}
    >
      {isIndexing || isReconciling ? (
        <div
          className="pointer-events-none sticky top-2 z-20 mx-auto flex w-fit items-center rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur"
          role="status"
        >
          <Loader2 className="mr-2 size-3.5 animate-spin" />
          {t('indexing')}
        </div>
      ) : null}
      {rowVirtualizer.getVirtualItems().map(virtualRow => {
        const section = document.sections[virtualRow.index]
        const sectionMarkdown = getMarkdownSectionSource(document, section)
        const isActiveSection = section.id === activeSectionId
        const editorEpoch = externalContentEpoch

        return (
          <div
            key={section.id}
            ref={rowVirtualizer.measureElement}
            data-index={virtualRow.index}
            data-markdown-section-id={section.id}
            className="absolute left-0 top-0 w-full py-2"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {isActiveSection && !isIndexing && !isReconciling ? (
              renderActiveSection({
                editorKey: `${section.id}:${externalContentEpoch}`,
                section,
                markdown: sectionMarkdown,
                onDirty: () => {
                  if (
                    editorEpoch === externalContentEpochRef.current
                    && activeSectionIdRef.current === section.id
                  ) {
                    activeSectionDirtyRef.current = true
                  }
                },
                onChange: nextMarkdown => {
                  if (
                    editorEpoch !== externalContentEpochRef.current
                    || activeSectionIdRef.current !== section.id
                  ) {
                    return
                  }
                  activeSectionDirtyRef.current = false
                  updateSectionMarkdown(section.id, nextMarkdown)
                },
                onBlockingActivityChange: count => {
                  if (
                    editorEpoch === externalContentEpochRef.current
                    && activeSectionIdRef.current === section.id
                  ) {
                    const nextCount = Math.max(0, count)
                    if (activeBlockingActivityCountRef.current !== nextCount) {
                      activeBlockingActivityCountRef.current = nextCount
                      setActivityRevision(value => value + 1)
                    }
                  }
                },
                onEditorReady: editor => {
                  if (
                    editorEpoch !== externalContentEpochRef.current
                    || activeSectionIdRef.current !== section.id
                  ) {
                    return
                  }
                  activeSelectionCleanupRef.current?.()
                  activeEditorRef.current = editor
                  activeSectionDirtyRef.current = false
                  onActiveEditorChangeRef.current?.(editor)
                  const emitSelection = () => {
                    if (
                      editorEpoch !== externalContentEpochRef.current
                      || activeSectionIdRef.current !== section.id
                    ) {
                      return
                    }
                    onSelectionChangeRef.current?.(getSectionedSelection(
                      documentRef.current,
                      section.id,
                      editor,
                    ))
                  }
                  const handleCompositionStateChange = () => {
                    setActivityRevision(value => value + 1)
                  }
                  editor.on('selectionUpdate', emitSelection)
                  editor.view.dom.addEventListener('compositionstart', handleCompositionStateChange)
                  editor.view.dom.addEventListener('compositionend', handleCompositionStateChange)
                  activeSelectionCleanupRef.current = () => {
                    editor.off('selectionUpdate', emitSelection)
                    editor.view.dom.removeEventListener('compositionstart', handleCompositionStateChange)
                    editor.view.dom.removeEventListener('compositionend', handleCompositionStateChange)
                    activeSelectionCleanupRef.current = null
                  }
                  emitSelection()

                  const pendingFocus = pendingFocusRef.current
                  if (pendingFocus?.sectionId === section.id) {
                    pendingFocusRef.current = null
                    window.requestAnimationFrame(() => {
                      if (editor.isDestroyed || activeSectionIdRef.current !== section.id) return
                      const position = pendingFocus.coordinates
                        ? editor.view.posAtCoords(pendingFocus.coordinates)?.pos
                        : undefined
                      if (typeof position === 'number') {
                        editor.commands.setTextSelection(position)
                      }
                      editor.commands.focus()
                    })
                  }
                },
              })
            ) : (
              <SectionPreview
                section={section}
                markdown={sectionMarkdown}
                onActivate={coordinates => {
                  if (isIndexing || isReconcilingRef.current) return
                  reconcileBeforeActivation(section.id, coordinates)
                }}
                onRequestSourceMode={requestSourceMode}
              />
            )}
          </div>
        )
      })}
    </div>
  )
})

SectionedMarkdownEditor.displayName = 'SectionedMarkdownEditor'
