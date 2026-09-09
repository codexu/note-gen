'use client'

import { useEditor, EditorContent, type Editor as TipTapReactEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CharacterCount from '@tiptap/extension-character-count'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Typography from '@tiptap/extension-typography'
import Dropcursor from '@tiptap/extension-dropcursor'
import DragHandle from '@tiptap/extension-drag-handle'
import { getSelectionRanges } from '@tiptap/extension-node-range'
import { renderTableToMarkdown, Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace'
import { Extension, nodeInputRule, type Editor as CoreEditor, type JSONContent } from '@tiptap/core'
import { Fragment, Slice, type Node as ProseMirrorNode, type NodeType } from '@tiptap/pm/model'
import { AllSelection, EditorState, Plugin, PluginKey, TextSelection, type Selection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, redoDepth, undoDepth } from '@tiptap/pm/history'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { dropPoint } from '@tiptap/pm/transform'
import 'katex/dist/katex.min.css'
import { InlineMath, BlockMath } from './math-extension'
import { MermaidDiagram } from './mermaid-extension'
import { SearchReplacePanel } from './search-replace-panel'
import { useEffect, useId, useLayoutEffect, useRef, useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type UIEvent as ReactUIEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { open } from '@tauri-apps/plugin-dialog'
import { BaseDirectory, readFile } from '@tauri-apps/plugin-fs'
import { appDataDir, join } from '@tauri-apps/api/path'
import { handleImageUpload, saveImageToWorkspace } from '@/lib/image-handler'
import useArticleStore from '@/stores/article'
import { cn, convertImage, convertImageByWorkspace } from '@/lib/utils'
import { resolveImagePathFromMarkdown } from '@/lib/markdown-image-path'
import { ensureLocalLibraryFile } from '@/lib/sync/remote-library'
import {
  getDefaultArticleAbsolutePath,
  getFilePathOptions,
  getWorkspacePath,
  isAbsoluteFsPath,
} from '@/lib/workspace'
import { isMobileDevice } from '@/lib/check'
import { pickImagesFromPhotoLibrary } from '@/lib/image-picker'
import { useTranslations } from 'next-intl'
import { replaceLinesInRange } from '@/lib/agent/react-diff-helpers'
import { BubbleMenu as BubbleMenuComponent } from './bubble-menu'
import { ImageBubbleMenu } from './image-bubble-menu'
import { toast } from '@/hooks/use-toast'
import { FloatingTableMenu } from './floating-table-menu'
import { FooterBar } from './footer-bar/index'
import { Outline } from './outline'
import { SlashCommand, suggestionOptions } from './slash-command'
import { SlashCommandPortal } from './slash-command/slash-command-portal'
import type { SlashCommandItem } from './slash-command/suggestion'
import {
  fetchCompletionStream,
  fetchEditorAiGenerationStream,
  sanitizeEditorAiGenerationOutput,
  type EditorAiGenerationAction,
} from '@/lib/ai/completion'
import { fetchAiPolishStream, fetchAiConciseStream, fetchAiExpandStream } from '@/lib/ai/rewrite'
import { fetchAiTranslateStream } from '@/lib/ai/translate'
import { AISuggestion } from './ai-suggestion'
import { AISuggestionFloating } from './ai-suggestion-floating'
import { AiSuggestionHighlight } from './ai-suggestion-highlight'
import { AgentDiffPreview, agentDiffPreviewPluginKey } from './agent-diff-preview-extension'
import emitter, { type Events } from '@/lib/emitter'
import {
  editorPathsReferToSameFile,
  getCurrentEditorWorkspaceRoot,
  markEditorPathMutation,
  workspaceRootsReferToSameLocation,
} from '@/lib/editor-deactivation'
import { QuoteMark } from './quote-mark'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from './markdown-paragraph'
import { GitHubAlertBlockquoteEditor } from './github-alert-blockquote-view'
import { StableCodeBlockLowlight } from './code-block-extension'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'
import useSettingStore from '@/stores/setting'
import useSyncStore from '@/stores/sync'
import useChatStore, { type PendingQuote } from '@/stores/chat'
import { ArrowUp, Eye, FileCode2, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { buildMobileSelectionContext, getMobileContextPrimaryActions, isMobileSelectionContextStale } from './mobile-selection-context'
import { MobileEditorContextBar } from './mobile-editor-context-bar'
import { MobileEditorMoreSheet } from './mobile-editor-more-sheet'
import { MobileWritingToolbar } from './mobile-writing-toolbar'
import { shouldRestorePendingQuote } from './quote-session'
import {
  DEFAULT_EDITOR_CONTENT_WIDTH,
  EDITOR_LINE_HEIGHT_VALUES,
  getEditorContentContainerClass,
  type EditorViewMode,
} from '@/lib/editor-layout-styles'
import { getCanvasDragId, hasCanvasDragData } from '@/lib/canvas/canvas-dnd'
import { canvasDocumentToPngFile } from '@/lib/canvas/static-export'
import { isRecordTabPath } from '@/app/core/main/mark/mark-record-tab'
import { getCanvasProject } from '@/db/canvases'
import useCanvasStore from '@/stores/canvas'
import { useSidebarStore } from '@/stores/sidebar'
import { createCanvasTab } from '../../canvas/canvas-tab'
import { getResultIndexToFocus } from './search-navigation'
import {
  DEFAULT_OUTLINE_WIDTH,
  getOutlineContentPadding,
  isOutlineOnLeft,
  type OutlinePosition,
} from '@/lib/outline-preferences'
import { EditorShortcutsExtension } from './editor-shortcuts-extension'
import useEditorShortcutStore from '@/stores/editor-shortcut'
import type { EditorShortcutCommandId } from '@/config/editor-shortcuts'
import { isAiSuggestionShortcutVisible } from '@/lib/ai-suggestion-shortcut-state'
import { getFileManagerDragPath, hasFileManagerDragData } from '@/app/core/main/file/file-dnd'
import { getMarkLocalAssetPath, type Mark } from '@/db/marks'
import { SmartFileLink } from './smart-file-link'
import { isLargeMarkdownDocument } from './large-markdown'
import {
  activateImageSource as activateDeferredImageSource,
  createImageNodeView,
} from './image-node-view'
import type {
  SourceMarkdownEditorController,
  SourceMarkdownEditorViewState,
} from './source-markdown-editor'
import {
  SectionedMarkdownEditor,
  type SectionedMarkdownEditorController,
  type SectionedMarkdownSelection,
} from './sectioned-markdown-editor'
import {
  BlockHandleControls,
  type EditorBlockConversionType,
} from './block-handle-controls'
import dynamic from 'next/dynamic'
import {
  openMarkdownCollaboration,
  type MarkdownCollaborationController,
} from '@/lib/self-hosted-sync/markdown-collaboration'
import './style.css'
import { MainStatusBarPortal } from '../../main-status-bar'

const MathEditorDialog = dynamic(
  () => import('./math-editor-dialog').then((module) => module.MathEditorDialog),
  { ssr: false }
)
const SourceMarkdownEditor = dynamic(
  () => import('./source-markdown-editor').then((module) => module.SourceMarkdownEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full min-h-64 w-full" />,
  }
)

const EDITOR_SCROLLBAR_MIN_THUMB_SIZE = 44

interface EditorScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

function EditorScrollbar({
  refreshKey,
  scrollContainerId,
  scrollContainerRef,
}: {
  refreshKey: EditorViewMode
  scrollContainerId: string
  scrollContainerRef: { current: HTMLDivElement | null }
}) {
  const dragStateRef = useRef<{ pointerId: number; startY: number; startScrollTop: number } | null>(null)
  const [metrics, setMetrics] = useState<EditorScrollMetrics>({
    clientHeight: 0,
    scrollHeight: 0,
    scrollTop: 0,
  })

  const updateMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    setMetrics({
      clientHeight: scrollContainer.clientHeight,
      scrollHeight: scrollContainer.scrollHeight,
      scrollTop: scrollContainer.scrollTop,
    })
  }, [scrollContainerRef])

  useLayoutEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const resizeObserver = new ResizeObserver(updateMetrics)
    resizeObserver.observe(scrollContainer)
    if (scrollContainer.firstElementChild) {
      resizeObserver.observe(scrollContainer.firstElementChild)
    }
    const editorContent = scrollContainer.querySelector(
      '.sectioned-markdown-editor, .ProseMirror, textarea'
    )
    if (editorContent) {
      resizeObserver.observe(editorContent)
    }

    scrollContainer.addEventListener('scroll', updateMetrics, { passive: true })
    updateMetrics()

    return () => {
      resizeObserver.disconnect()
      scrollContainer.removeEventListener('scroll', updateMetrics)
    }
  }, [refreshKey, scrollContainerRef, updateMetrics])

  const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight)
  const thumbHeight = metrics.scrollHeight > 0
    ? Math.min(
      metrics.clientHeight,
      Math.max(EDITOR_SCROLLBAR_MIN_THUMB_SIZE, metrics.clientHeight ** 2 / metrics.scrollHeight)
    )
    : metrics.clientHeight
  const thumbTravel = Math.max(0, metrics.clientHeight - thumbHeight)
  const thumbTop = maxScrollTop > 0 ? metrics.scrollTop / maxScrollTop * thumbTravel : 0
  const hasOverflow = maxScrollTop > 1

  const scrollToThumbPosition = useCallback((thumbPosition: number) => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer || thumbTravel <= 0) return

    const clampedPosition = Math.max(0, Math.min(thumbTravel, thumbPosition))
    scrollContainer.scrollTop = clampedPosition / thumbTravel * maxScrollTop
  }, [maxScrollTop, scrollContainerRef, thumbTravel])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !hasOverflow) return

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const clickedThumb = event.target instanceof Element
      && event.target.closest('[data-editor-scrollbar-thumb]')

    if (!clickedThumb) {
      const trackRect = event.currentTarget.getBoundingClientRect()
      scrollToThumbPosition(event.clientY - trackRect.top - thumbHeight / 2)
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollTop: scrollContainerRef.current?.scrollTop ?? 0,
    }
  }, [hasOverflow, scrollContainerRef, scrollToThumbPosition, thumbHeight])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    const scrollContainer = scrollContainerRef.current
    if (!dragState || dragState.pointerId !== event.pointerId || !scrollContainer || thumbTravel <= 0) return

    event.preventDefault()
    const scrollDelta = (event.clientY - dragState.startY) / thumbTravel * maxScrollTop
    scrollContainer.scrollTop = Math.max(0, Math.min(maxScrollTop, dragState.startScrollTop + scrollDelta))
  }, [maxScrollTop, scrollContainerRef, thumbTravel])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return
    dragStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }, [])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer || !hasOverflow) return

    const pageSize = Math.max(40, scrollContainer.clientHeight * 0.85)
    const scrollBy = event.key === 'ArrowUp'
      ? -40
      : event.key === 'ArrowDown'
        ? 40
        : event.key === 'PageUp'
          ? -pageSize
          : event.key === 'PageDown'
            ? pageSize
            : null

    if (scrollBy !== null) {
      event.preventDefault()
      scrollContainer.scrollBy({ top: scrollBy })
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      scrollContainer.scrollTo({ top: event.key === 'Home' ? 0 : maxScrollTop })
    }
  }, [hasOverflow, maxScrollTop, scrollContainerRef])

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer || !hasOverflow || event.deltaY === 0) return

    event.preventDefault()
    const deltaY = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * scrollContainer.clientHeight
        : event.deltaY
    scrollContainer.scrollTop += deltaY
  }, [hasOverflow, scrollContainerRef])

  return (
    <div
      role="scrollbar"
      aria-label="编辑器滚动条"
      aria-controls={scrollContainerId}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={Math.round(maxScrollTop)}
      aria-valuenow={Math.round(metrics.scrollTop)}
      tabIndex={hasOverflow ? 0 : -1}
      className={cn(
        'editor-custom-scrollbar absolute inset-y-0 right-0 z-30 w-3 touch-none select-none',
        !hasOverflow && 'pointer-events-none opacity-0'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div
        data-editor-scrollbar-thumb
        className="editor-custom-scrollbar-thumb absolute left-0 right-0"
        style={{ height: thumbHeight, transform: `translateY(${thumbTop}px)` }}
      />
    </div>
  )
}

const AI_GENERATION_LOADING_TEXT = '···'
const MOBILE_SCROLL_TOP_THRESHOLD = 160
function createDragHandleElement(): HTMLElement {
  const element = document.createElement('div')
  element.className = 'tiptap-drag-handle'
  element.addEventListener('dragstart', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  })
  return element
}

type EditorBlockTarget = {
  editor: CoreEditor
  from: number
  to: number
  expectedDoc?: CoreEditor['state']['doc']
}

type EditorBlockDragState = EditorBlockTarget & {
  startDoc: CoreEditor['state']['doc']
  targetPos: number | null
}

type EditorBlockPointerDragState = EditorBlockDragState & {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  indicatorPos: number | null
  preview: HTMLDivElement
  handle: HTMLElement
  controls: HTMLElement
  controlsOffsetY: number
  controlsFixedLeft: number
  controlsPosition: string
  controlsLeft: string
  controlsTop: string
}

type EditorBlockDragPreview = {
  from: number
  to: number
  pos: number
  dom: HTMLDivElement
}

const editorBlockDragPreviewPluginKey = new PluginKey<DecorationSet>('editorBlockDragPreview')

const EditorBlockDragPreview = Extension.create({
  name: 'editorBlockDragPreview',

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: editorBlockDragPreviewPluginKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, current) {
          const preview = tr.getMeta(editorBlockDragPreviewPluginKey) as EditorBlockDragPreview | null | undefined
          if (preview === undefined) {
            return tr.docChanged ? DecorationSet.empty : current.map(tr.mapping, tr.doc)
          }
          if (!preview) {
            return DecorationSet.empty
          }

          const decorations: Decoration[] = []
          let sourcePos = preview.from
          while (sourcePos < preview.to) {
            const node = tr.doc.nodeAt(sourcePos)
            if (!node || sourcePos + node.nodeSize > preview.to) {
              break
            }
            decorations.push(Decoration.node(sourcePos, sourcePos + node.nodeSize, {
              class: 'tiptap-block-drag-preview-source',
            }))
            sourcePos += node.nodeSize
          }
          decorations.push(Decoration.widget(preview.pos, () => preview.dom, { side: -1 }))
          return DecorationSet.create(tr.doc, decorations)
        },
      },
      props: {
        decorations: state => editorBlockDragPreviewPluginKey.getState(state),
      },
    })]
  },
})

type ResolvedEditorBlockTarget = EditorBlockTarget & {
  node: ProseMirrorNode
}

function resolveEditorBlockTarget(target: EditorBlockTarget | null): ResolvedEditorBlockTarget | null {
  if (
    !target
    || target.editor.isDestroyed
    || (target.expectedDoc && target.editor.state.doc !== target.expectedDoc)
  ) {
    return null
  }

  const { doc } = target.editor.state
  if (
    !Number.isInteger(target.from)
    || !Number.isInteger(target.to)
    || target.from < 0
    || target.to <= target.from
    || target.to > doc.content.size
  ) {
    return null
  }

  const node = doc.nodeAt(target.from)
  if (!node || target.to !== target.from + node.nodeSize) {
    return null
  }

  return { ...target, node }
}

function getEditorBlockDragTarget(target: EditorBlockTarget): EditorBlockTarget | null {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return null
  }

  const { editor, from: targetFrom, to: targetTo } = resolvedTarget
  const { selection } = editor.state
  if (selection.empty) {
    return target
  }

  const selectionRanges = getSelectionRanges(selection.$from, selection.$to, 0)
  if (selectionRanges.length < 2) {
    return target
  }

  const targetIsSelected = selectionRanges.some(({ $from, $to }) => (
    targetFrom === $from.pos && targetTo === $to.pos
  ))
  if (!targetIsSelected) {
    return target
  }

  return {
    editor,
    from: selectionRanges[0].$from.pos,
    to: selectionRanges[selectionRanges.length - 1].$to.pos,
  }
}

function getEditorBlockTextSelection(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return null
  }

  const { from, node } = resolvedTarget
  if ((node.type.name === 'paragraph' || node.type.name === 'heading') && node.isTextblock) {
    return {
      from: from + 1,
      to: from + node.nodeSize - 1,
    }
  }

  if (node.type.name !== 'listItem' && node.type.name !== 'taskItem') {
    return null
  }

  const firstChild = node.firstChild
  if (!firstChild?.isTextblock) {
    return null
  }

  const childFrom = from + 1
  return {
    from: childFrom + 1,
    to: childFrom + firstChild.nodeSize - 1,
  }
}

function getEditorBlockActiveType(target: EditorBlockTarget | null): EditorBlockConversionType | null {
  const resolvedTarget = resolveEditorBlockTarget(target)
  const selection = getEditorBlockTextSelection(target)
  if (!resolvedTarget || !selection) {
    return null
  }

  const $from = resolvedTarget.editor.state.doc.resolve(selection.from)
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name
    if (nodeName === 'bulletList' || nodeName === 'orderedList' || nodeName === 'taskList') {
      return nodeName
    }
  }

  const textBlock = $from.parent
  if (textBlock.type.name === 'heading') {
    const level = Number(textBlock.attrs.level)
    if (level >= 1 && level <= 6) {
      return `heading${level}` as EditorBlockConversionType
    }
  }

  return textBlock.type.name === 'paragraph' ? 'paragraph' : null
}

function dispatchIsolatedEditorBlockTransaction(editor: CoreEditor, tr: Transaction) {
  editor.view.dispatch(closeHistory(tr))
  if (!editor.isDestroyed) {
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
}

function insertEditorBlockBelow(target: EditorBlockTarget | null, command?: SlashCommandItem['command']) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const { editor, from, to, node } = resolvedTarget
  const { doc, schema } = editor.state
  const $from = doc.resolve(from)
  const parent = $from.parent
  const insertIndex = $from.index() + 1
  let insertedNode: ProseMirrorNode | null = null

  if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
    const attrs = node.type.name === 'taskItem' ? { checked: false } : undefined
    const listItem = node.type.createAndFill(attrs)
    if (listItem && parent.canReplace(insertIndex, insertIndex, Fragment.from(listItem))) {
      insertedNode = listItem
    }
  } else {
    const paragraph = schema.nodes.paragraph?.createAndFill()
    if (paragraph && parent.canReplace(insertIndex, insertIndex, Fragment.from(paragraph))) {
      insertedNode = paragraph
    }
  }

  if (!insertedNode) {
    return
  }

  const tr = editor.state.tr.insert(to, insertedNode)
  if (!tr.docChanged) {
    return
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(to + 1, tr.doc.content.size))))
  editor.view.focus()
  dispatchIsolatedEditorBlockTransaction(editor, tr.scrollIntoView())
  command?.({
    editor,
    range: {
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    },
  })
}

function openEditorBlockInsertMenu(target: EditorBlockTarget | null, clientRect: DOMRect) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const frozenTarget: EditorBlockTarget = {
    editor: resolvedTarget.editor,
    from: resolvedTarget.from,
    to: resolvedTarget.to,
    expectedDoc: resolvedTarget.editor.state.doc,
  }

  document.dispatchEvent(new CustomEvent('slash-command-show', {
    detail: {
      editor: resolvedTarget.editor,
      range: {
        from: resolvedTarget.editor.state.selection.from,
        to: resolvedTarget.editor.state.selection.to,
      },
      clientRect,
      query: '',
      onSelectItem: (item: SlashCommandItem) => {
        insertEditorBlockBelow(frozenTarget, item.command)
      },
    },
  }))
}

function duplicateEditorBlock(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const { editor, from, to } = resolvedTarget
  const slice = editor.state.doc.slice(from, to)
  const tr = editor.state.tr.replaceRange(to, to, slice)
  if (!tr.docChanged) {
    return
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(to + 1, tr.doc.content.size))))
  editor.view.focus()
  dispatchIsolatedEditorBlockTransaction(editor, tr.scrollIntoView())
}

function canMoveEditorBlock(target: EditorBlockTarget | null, direction: -1 | 1) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return false
  }

  const $from = resolvedTarget.editor.state.doc.resolve(resolvedTarget.from)
  const index = $from.index()
  return direction < 0 ? index > 0 : index < $from.parent.childCount - 1
}

function moveEditorBlockByOffset(target: EditorBlockTarget | null, direction: -1 | 1) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const { editor, from, to } = resolvedTarget
  const $from = editor.state.doc.resolve(from)
  const index = $from.index()
  if (direction < 0 ? index === 0 : index >= $from.parent.childCount - 1) {
    return
  }
  const sibling = $from.parent.child(index + direction)

  moveEditorBlock({
    editor,
    from,
    to,
    startDoc: editor.state.doc,
    targetPos: direction < 0 ? from - sibling.nodeSize : to + sibling.nodeSize,
  })
}

function getEditorBlockMarkdown(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget || !resolvedTarget.editor.markdown) {
    return null
  }

  const { editor, from, to } = resolvedTarget
  return editor.markdown.serialize({
    type: 'doc',
    content: editor.state.doc.slice(from, to).content.toJSON(),
  })
}

function copyEditorBlockContent(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const text = resolvedTarget.editor.state.doc.textBetween(
    resolvedTarget.from,
    resolvedTarget.to,
    '\n',
    '\n',
  )
  void navigator.clipboard.writeText(text)
}

function copyEditorBlockMarkdown(target: EditorBlockTarget | null) {
  const markdown = getEditorBlockMarkdown(target)
  if (markdown !== null) {
    void navigator.clipboard.writeText(markdown)
  }
}

function clearEditorBlockFormatting(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  const selection = getEditorBlockTextSelection(target)
  if (!resolvedTarget || !selection) {
    return
  }

  const { editor } = resolvedTarget
  const startDoc = editor.state.doc
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr)
      return true
    })
    .setTextSelection(selection)
    .unsetAllMarks()
    .clearNodes()
    .scrollIntoView()
    .run()

  if (!editor.isDestroyed && editor.state.doc !== startDoc) {
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
}

function deleteEditorBlock(target: EditorBlockTarget | null) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  if (!resolvedTarget) {
    return
  }

  const { editor, from, to } = resolvedTarget
  const tr = editor.state.tr.deleteRange(from, to)
  if (!tr.docChanged) {
    return
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))))
  editor.view.focus()
  dispatchIsolatedEditorBlockTransaction(editor, tr.scrollIntoView())
}

function convertEditorBlock(target: EditorBlockTarget | null, type: EditorBlockConversionType) {
  const resolvedTarget = resolveEditorBlockTarget(target)
  const selection = getEditorBlockTextSelection(target)
  if (!resolvedTarget || !selection) {
    return
  }

  const { editor } = resolvedTarget
  const startDoc = editor.state.doc
  const chain = editor
    .chain()
    .focus()
    .command(({ tr }) => {
      closeHistory(tr)
      return true
    })
    .setTextSelection(selection)
    .clearNodes()

  if (type === 'paragraph') {
    chain.setParagraph().run()
  } else if (type.startsWith('heading')) {
    const level = Number(type.slice('heading'.length)) as 1 | 2 | 3 | 4 | 5 | 6
    chain.setHeading({ level }).run()
  } else if (type === 'bulletList') {
    chain.toggleBulletList().run()
  } else if (type === 'orderedList') {
    chain.toggleOrderedList().run()
  } else {
    chain.toggleTaskList().run()
  }

  if (!editor.isDestroyed && editor.state.doc !== startDoc) {
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
}

function moveEditorBlock(state: EditorBlockDragState) {
  const { editor, from, to, startDoc, targetPos } = state

  if (editor.isDestroyed || editor.state.doc !== startDoc || targetPos === null) {
    return
  }

  const slice = startDoc.slice(from, to)
  const insertPos = dropPoint(startDoc, targetPos, slice) ?? targetPos

  if (insertPos >= from && insertPos <= to) {
    return
  }

  const tr = editor.state.tr.deleteRange(from, to)
  const mappedInsertPos = tr.mapping.map(insertPos)
  const beforeInsert = tr.doc

  tr.replaceRange(mappedInsertPos, mappedInsertPos, slice)

  if (tr.doc.eq(beforeInsert)) {
    return
  }

  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(mappedInsertPos, tr.doc.content.size))))
  editor.view.focus()
  dispatchIsolatedEditorBlockTransaction(editor, tr.setMeta('uiEvent', 'drop'))
}

function createEditorBlockDragPreviewDom(editor: CoreEditor, from: number, to: number) {
  const preview = document.createElement('div')
  preview.className = 'tiptap-block-drag-preview'

  let pos = from
  while (pos < to) {
    const node = editor.state.doc.nodeAt(pos)
    const nodeDom = editor.view.nodeDOM(pos)
    if (!node || pos + node.nodeSize > to) {
      break
    }
    if (nodeDom instanceof HTMLElement) {
      preview.appendChild(nodeDom.cloneNode(true))
    }
    pos += node.nodeSize
  }

  return preview
}

function clearEditorNativeDropCursor(editor: CoreEditor) {
  if (!editor.isDestroyed) {
    editor.view.dom.dispatchEvent(new Event('dragend'))
  }
}

const INTERNAL_TEXT_FILE_PATH_RE = /\.(?:md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i
const INTERNAL_IMAGE_FILE_PATH_RE = /\.(?:jpg|jpeg|png|gif|bmp|webp|svg)$/i
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/

function getDroppedMarkImageMimeType(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()

  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'svg') return 'image/svg+xml'
  return 'image/png'
}

function isEditorAiGenerationAction(action: unknown): action is EditorAiGenerationAction {
  return action === 'section' || action === 'summary' || action === 'custom'
}

function getEditorPositionRect(targetEditor: TipTapReactEditor, position: number) {
  const safePosition = clampSelectionPosition(position, targetEditor.state.doc.content.size)
  const coords = targetEditor.view.coordsAtPos(safePosition)
  return {
    top: coords.top,
    left: coords.left,
    right: coords.right,
    bottom: coords.bottom,
  }
}

function getInsertedContentRange(targetEditor: TipTapReactEditor, from: number, docSizeBeforeInsert: number) {
  const insertedSize = Math.max(0, targetEditor.state.doc.content.size - docSizeBeforeInsert)

  return {
    from,
    to: from + insertedSize,
  }
}

type DroppedFileWithPath = File & {
  path?: string
  webkitRelativePath?: string
}

type DroppedFileLink = {
  label: string
  path: string
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getLinkProtocol(href: string): string | null {
  if (WINDOWS_ABSOLUTE_PATH_RE.test(href)) {
    return null
  }

  return href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase() ?? null
}

function stripLocalLinkFragment(href: string): string {
  const hashIndex = href.indexOf('#')
  return hashIndex >= 0 ? href.slice(0, hashIndex) : href
}

function normalizeLocalFilePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/')
  const hasUncPrefix = normalized.startsWith('//')
  const hasLeadingSlash = normalized.startsWith('/')
  const segments: string[] = []

  normalized.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return
    }

    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop()
      } else if (!hasLeadingSlash) {
        segments.push(segment)
      }
      return
    }

    segments.push(segment)
  })

  const normalizedPath = segments.join('/')
  if (hasUncPrefix) {
    return `//${normalizedPath}`
  }

  return hasLeadingSlash ? `/${normalizedPath}` : normalizedPath
}

function getFilePathFromFileUrl(href: string): string {
  try {
    const url = new URL(href)
    let pathname = safeDecodeURIComponent(url.pathname)

    if (url.hostname && url.hostname !== 'localhost') {
      pathname = `//${url.hostname}${pathname}`
    }

    if (pathname.startsWith('/') && WINDOWS_ABSOLUTE_PATH_RE.test(pathname.slice(1))) {
      return pathname.slice(1)
    }

    return pathname
  } catch {
    const withoutProtocol = href.replace(/^file:\/\//i, '')
    return safeDecodeURIComponent(stripLocalLinkFragment(withoutProtocol))
  }
}

function getPathName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized.split('/').filter(Boolean).pop() || normalized || path
}

function normalizeWorkspacePathSegments(path: string): string[] {
  const normalized = path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')

  if (!normalized) {
    return []
  }

  const segments: string[] = []

  normalized.split('/').forEach((segment) => {
    if (!segment || segment === '.') {
      return
    }

    if (segment === '..') {
      if (segments.length > 0) {
        segments.pop()
      }
      return
    }

    segments.push(segment)
  })

  return segments
}

function toMarkdownRelativePath(currentFilePath: string, targetWorkspacePath: string): string {
  const currentSegments = normalizeWorkspacePathSegments(currentFilePath)
  const currentDirSegments = currentSegments.slice(0, -1)
  const targetSegments = normalizeWorkspacePathSegments(targetWorkspacePath)

  let commonPrefixLength = 0
  while (
    commonPrefixLength < currentDirSegments.length &&
    commonPrefixLength < targetSegments.length &&
    currentDirSegments[commonPrefixLength] === targetSegments[commonPrefixLength]
  ) {
    commonPrefixLength += 1
  }

  const upwardSegments = new Array(currentDirSegments.length - commonPrefixLength).fill('..')
  const downwardSegments = targetSegments.slice(commonPrefixLength)
  return [...upwardSegments, ...downwardSegments].join('/') || getPathName(targetWorkspacePath)
}

function encodeLocalLinkHref(path: string): string {
  return encodeURI(path)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

function toFileUrl(path: string): string {
  const normalized = normalizeLocalFilePath(path)
  const encodedPath = encodeLocalLinkHref(normalized)

  if (normalized.startsWith('//')) {
    return `file:${encodedPath}`
  }

  if (normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) {
    return `file://${normalized.startsWith('/') ? '' : '/'}${encodedPath}`
  }

  return encodedPath
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function escapeMarkdownText(text: string): string {
  return text.replace(/\\/g, '\\\\')
}

function createMarkdownLink(href: string, label: string): string {
  return `[${escapeMarkdownLinkText(label)}](${href})`
}

function getDroppedFilePath(file: File): string | null {
  const droppedFile = file as DroppedFileWithPath
  return droppedFile.path || droppedFile.webkitRelativePath || null
}

function normalizePathForCompare(path: string): string {
  const normalized = normalizeLocalFilePath(path).replace(/\/+$/, '')
  return WINDOWS_ABSOLUTE_PATH_RE.test(normalized) ? normalized.toLowerCase() : normalized
}

function getPathInsideRoot(path: string, root: string): string | null {
  const normalizedPath = normalizePathForCompare(path)
  const normalizedRoot = normalizePathForCompare(root)

  if (normalizedPath === normalizedRoot) {
    return ''
  }

  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return null
  }

  return normalizeLocalFilePath(path).slice(normalizeLocalFilePath(root).replace(/\/+$/, '').length + 1)
}

async function getWorkspaceRelativePathForAbsolutePath(path: string): Promise<string | null> {
  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    return getPathInsideRoot(path, workspace.path)
  }

  const appDir = await appDataDir()
  const defaultWorkspacePath = await join(appDir, 'article')
  return getPathInsideRoot(path, defaultWorkspacePath)
}

async function getMarkdownHrefForDroppedPath(path: string, currentFilePath: string): Promise<string> {
  const normalizedPath = normalizeLocalFilePath(path)

  if (isAbsoluteFsPath(normalizedPath)) {
    const workspaceRelativePath = await getWorkspaceRelativePathForAbsolutePath(normalizedPath)

    if (workspaceRelativePath !== null) {
      return encodeLocalLinkHref(toMarkdownRelativePath(currentFilePath, workspaceRelativePath))
    }

    return toFileUrl(normalizedPath)
  }

  return encodeLocalLinkHref(toMarkdownRelativePath(currentFilePath, normalizedPath))
}

async function createMarkdownLinksForDroppedPaths(files: DroppedFileLink[], currentFilePath: string): Promise<string[]> {
  return await Promise.all(
    files.map(async (file) => {
      const href = await getMarkdownHrefForDroppedPath(file.path, currentFilePath)
      return createMarkdownLink(href, file.label)
    })
  )
}

function getFileUrlsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const uriList = dataTransfer.getData('text/uri-list')

  if (uriList) {
    return uriList
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.startsWith('file://'))
  }

  const plainText = dataTransfer.getData('text/plain') || dataTransfer.getData('text')
  if (!plainText) {
    return []
  }

  return plainText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('file://'))
}

async function getDroppedFileMarkdownLinks(dataTransfer: DataTransfer, currentFilePath: string): Promise<string[]> {
  const droppedFiles: DroppedFileLink[] = []

  if (hasFileManagerDragData(dataTransfer)) {
    const path = getFileManagerDragPath(dataTransfer).trim()
    if (path) {
      droppedFiles.push({ path, label: getPathName(path) })
    }
  } else {
    const fileUrls = getFileUrlsFromDataTransfer(dataTransfer)

    if (fileUrls.length > 0) {
      fileUrls.forEach((fileUrl) => {
        const path = normalizeLocalFilePath(getFilePathFromFileUrl(fileUrl))
        droppedFiles.push({ path, label: getPathName(path) })
      })
    } else {
      Array.from(dataTransfer.files || []).forEach((file) => {
        const path = getDroppedFilePath(file)
        if (path) {
          droppedFiles.push({ path, label: file.name || getPathName(path) })
        }
      })
    }
  }

  return await createMarkdownLinksForDroppedPaths(droppedFiles, currentFilePath)
}

function resolveLocalLinkPath(href: string, currentFilePath: string): string {
  const decodedPath = safeDecodeURIComponent(stripLocalLinkFragment(href)).trim()

  if (!decodedPath) {
    return ''
  }

  if (isAbsoluteFsPath(decodedPath)) {
    return normalizeLocalFilePath(decodedPath)
  }

  const parentDir = currentFilePath.includes('/')
    ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
    : ''
  return normalizeLocalFilePath(parentDir ? `${parentDir}/${decodedPath}` : decodedPath)
}

function isInternalFilePath(path: string): boolean {
  return INTERNAL_TEXT_FILE_PATH_RE.test(path) || INTERNAL_IMAGE_FILE_PATH_RE.test(path)
}

async function getOpenableLocalPath(path: string): Promise<string> {
  if (isAbsoluteFsPath(path)) {
    return path
  }

  const workspace = await getWorkspacePath()

  if (workspace.isCustom) {
    const pathOptions = await getFilePathOptions(path)
    return pathOptions.path
  }

  const appDir = await appDataDir()
  return await join(appDir, 'article', path)
}

async function openLocalPathWithDefaultApp(path: string) {
  await openPath(await getOpenableLocalPath(path))
}

function parseImageDimension(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!/^\d+(?:\.\d+)?(?:px)?$/i.test(trimmed)) {
    return null
  }

  const parsed = Number.parseInt(trimmed.replace(/px$/i, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getImageDimensionFromElement(element: HTMLElement, name: 'width' | 'height'): number | null {
  return (
    parseImageDimension(element.getAttribute(name)) ||
    parseImageDimension(element.style[name])
  )
}

function promoteFirstTableRowInMarkdown(node: JSONContent): JSONContent {
  const [firstRow, ...remainingRows] = node.content ?? []
  if (!firstRow?.content?.length) return node

  const hasHeader = firstRow.content.some(cell => cell.type === 'tableHeader')
  if (hasHeader) return node

  return {
    ...node,
    content: [
      {
        ...firstRow,
        content: firstRow.content.map(cell => (
          cell.type === 'tableCell' ? { ...cell, type: 'tableHeader' } : cell
        )),
      },
      ...remainingRows,
    ],
  }
}

const MarkdownTable = Table.extend({
  renderMarkdown: (node, helpers) => (
    renderTableToMarkdown(promoteFirstTableRowInMarkdown(node), helpers)
  ),
})

function normalizePastedTableNode(
  node: ProseMirrorNode,
  tableCellType: NodeType,
  tableHeaderType: NodeType
): ProseMirrorNode {
  if (node.type.name === 'table' && node.childCount > 0) {
    const firstRow = node.firstChild
    const isHeaderlessTable = firstRow
      && firstRow.childCount > 0
      && Array.from({ length: firstRow.childCount }, (_, index) => firstRow.child(index))
        .every(cell => cell.type === tableCellType)

    if (firstRow && isHeaderlessTable) {
      const headerCells = Array.from({ length: firstRow.childCount }, (_, index) => {
        const cell = firstRow.child(index)
        return tableHeaderType.create(cell.attrs, cell.content, cell.marks)
      })
      const rows = [firstRow.copy(Fragment.fromArray(headerCells))]

      for (let index = 1; index < node.childCount; index += 1) {
        rows.push(node.child(index))
      }

      return node.copy(Fragment.fromArray(rows))
    }
  }

  if (node.isLeaf) return node

  const content = normalizePastedTableFragment(node.content, tableCellType, tableHeaderType)
  return content.eq(node.content) ? node : node.copy(content)
}

function normalizePastedTableFragment(
  fragment: Fragment,
  tableCellType: NodeType,
  tableHeaderType: NodeType
): Fragment {
  const nodes: ProseMirrorNode[] = []
  fragment.forEach(node => {
    nodes.push(normalizePastedTableNode(node, tableCellType, tableHeaderType))
  })
  return Fragment.fromArray(nodes)
}

function isInlineCodeOnlySelection(selection: Selection, slice: Slice): boolean {
  if (!selection.$from.sameParent(selection.$to)) return false

  let hasText = false
  let containsOnlyInlineCode = true

  slice.content.descendants(node => {
    if (node.isText) {
      hasText = true
      if (!node.marks.some(mark => mark.type.name === 'code')) {
        containsOnlyInlineCode = false
      }
    } else if (node.isInline) {
      containsOnlyInlineCode = false
    }

    return containsOnlyInlineCode
  })

  return hasText && containsOnlyInlineCode
}

// 自定义扩展：处理粘贴 Markdown 文本
const PasteMarkdown = Extension.create({
  name: 'pasteMarkdown',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
          transformPasted(slice) {
            const { tableCell, tableHeader } = editor.schema.nodes
            if (!tableCell || !tableHeader) return slice

            const content = normalizePastedTableFragment(slice.content, tableCell, tableHeader)
            return content.eq(slice.content)
              ? slice
              : new Slice(content, slice.openStart, slice.openEnd)
          },
          handlePaste(_view, event, _slice) {
            void _slice
            const text = (event as ClipboardEvent).clipboardData?.getData('text/plain')

            if (!text) {
              return false
            }

            const { selection, schema } = _view.state
            const codeBlockType = schema.nodes.codeBlock
            const isPastingInsideCodeBlock =
              codeBlockType != null &&
              selection.$from.parent.type === codeBlockType &&
              selection.$to.parent.type === codeBlockType

            if (isPastingInsideCodeBlock) {
              _view.dispatch(_view.state.tr.insertText(text, selection.from, selection.to))
              return true
            }

            // 检查文本是否看起来像 Markdown
            if (looksLikeMarkdown(text)) {
              // 使用 editor.commands.insertContent 插入 Markdown 内容
              editor.commands.insertContent(text, { contentType: 'markdown' })
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})

interface BlurSelectionState {
  focused: boolean
  from: number
  to: number
}

interface SelfHostedRemoteCursor {
  deviceId: string
  label: string
  anchor: number
  head: number
  coordinateSpace: 'markdown' | 'prosemirror'
}

const selfHostedRemoteCursorPluginKey = new PluginKey<SelfHostedRemoteCursor[]>('selfHostedRemoteCursors')
const REMOTE_CURSOR_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#ea580c', '#0891b2']

function remoteCursorColor(deviceId: string) {
  let hash = 0
  for (const character of deviceId) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0
  return REMOTE_CURSOR_COLORS[Math.abs(hash) % REMOTE_CURSOR_COLORS.length]!
}

function createRemoteCursorDecorations(
  doc: ProseMirrorNode,
  cursors: SelfHostedRemoteCursor[],
) {
  const decorations: Decoration[] = []
  const maxPosition = doc.content.size
  for (const cursor of cursors) {
    const anchor = Math.max(0, Math.min(cursor.anchor, maxPosition))
    const head = Math.max(0, Math.min(cursor.head, maxPosition))
    const color = remoteCursorColor(cursor.deviceId)
    if (anchor !== head) {
      decorations.push(Decoration.inline(Math.min(anchor, head), Math.max(anchor, head), {
        style: `background-color: color-mix(in srgb, ${color} 22%, transparent);`,
        class: 'self-hosted-remote-selection',
      }))
    }
    decorations.push(Decoration.widget(head, () => {
      const cursorElement = document.createElement('span')
      cursorElement.className = 'self-hosted-remote-cursor'
      cursorElement.style.borderColor = color
      cursorElement.setAttribute('aria-label', `${cursor.label} 的光标`)
      const label = document.createElement('span')
      label.className = 'self-hosted-remote-cursor-label'
      label.style.backgroundColor = color
      label.textContent = cursor.label
      cursorElement.append(label)
      return cursorElement
    }, { key: cursor.deviceId, side: 1 }))
  }
  return DecorationSet.create(doc, decorations)
}

const SelfHostedRemoteCursors = Extension.create({
  name: 'selfHostedRemoteCursors',

  addProseMirrorPlugins() {
    return [new Plugin<SelfHostedRemoteCursor[]>({
      key: selfHostedRemoteCursorPluginKey,
      state: {
        init: () => [],
        apply(transaction, current) {
          const next = transaction.getMeta(selfHostedRemoteCursorPluginKey) as SelfHostedRemoteCursor[] | undefined
          if (next) return next
          return current.map(cursor => ({
            ...cursor,
            anchor: transaction.mapping.map(cursor.anchor),
            head: transaction.mapping.map(cursor.head),
          }))
        },
      },
      props: {
        decorations(state) {
          return createRemoteCursorDecorations(
            state.doc,
            selfHostedRemoteCursorPluginKey.getState(state) ?? [],
          )
        },
      },
    })]
  },
})

function updateSelfHostedRemoteCursors(
  editor: TipTapReactEditor,
  cursors: SelfHostedRemoteCursor[],
) {
  editor.view.dispatch(editor.state.tr.setMeta(selfHostedRemoteCursorPluginKey, cursors))
}

function projectRemoteCursorPosition(position: number, fromLength: number, toLength: number) {
  const safePosition = Math.max(0, Math.min(position, fromLength))
  if (fromLength <= 0 || toLength <= 0) return 0
  return Math.round((safePosition / fromLength) * toLength)
}

function projectRemoteCursor(
  cursor: SelfHostedRemoteCursor,
  coordinateSpace: SelfHostedRemoteCursor['coordinateSpace'],
  markdownLength: number,
  proseMirrorLength: number,
): SelfHostedRemoteCursor {
  if (cursor.coordinateSpace === coordinateSpace) return cursor
  const [fromLength, toLength] = coordinateSpace === 'markdown'
    ? [proseMirrorLength, markdownLength]
    : [markdownLength, proseMirrorLength]
  return {
    ...cursor,
    anchor: projectRemoteCursorPosition(cursor.anchor, fromLength, toLength),
    head: projectRemoteCursorPosition(cursor.head, fromLength, toLength),
    coordinateSpace,
  }
}

function getEditorPresenceSelection(editor: TipTapReactEditor) {
  const selection = editor.state.selection
  if (isFullDocumentSelection(selection, editor.state.doc.content.size)) {
    return { anchor: selection.head, head: selection.head }
  }
  return { anchor: selection.anchor, head: selection.head }
}

interface TextReplacement {
  from: number
  to: number
  insert: string
}

function singleTextReplacement(base: string, next: string): TextReplacement {
  const prefixLimit = Math.min(base.length, next.length)
  let from = 0
  while (from < prefixLimit && base[from] === next[from]) from++

  const suffixLimit = Math.min(base.length, next.length) - from
  let suffix = 0
  while (suffix < suffixLimit
    && base[base.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix++
  }
  return {
    from,
    to: base.length - suffix,
    insert: next.slice(from, next.length - suffix),
  }
}

function mergeCollaborationSetupMarkdown(base: string, local: string, remote: string) {
  if (local === base) return remote
  if (remote === base || local === remote) return local

  const localChange = singleTextReplacement(base, local)
  const remoteChange = singleTextReplacement(base, remote)
  if (localChange.from === remoteChange.from
    && localChange.to === remoteChange.to
    && localChange.insert === remoteChange.insert) {
    return remote
  }

  if (localChange.to <= remoteChange.from) {
    return remote.slice(0, localChange.from)
      + localChange.insert
      + remote.slice(localChange.to)
  }
  if (remoteChange.to <= localChange.from) {
    const remoteOffset = remoteChange.insert.length - (remoteChange.to - remoteChange.from)
    const from = localChange.from + remoteOffset
    const to = localChange.to + remoteOffset
    return remote.slice(0, from) + localChange.insert + remote.slice(to)
  }
  return null
}

const blurSelectionPluginKey = new PluginKey<BlurSelectionState>('blurSelectionHighlight')

function isFullDocumentRange(from: number, to: number, docSize: number): boolean {
  const start = Math.min(from, to)
  const end = Math.max(from, to)

  if (start === end || docSize <= 0) {
    return false
  }

  if (start <= 0 && end >= docSize) {
    return true
  }

  return docSize > 2 && start <= 1 && end >= docSize - 1
}

function isFullDocumentSelection(selection: Selection, docSize: number): boolean {
  if (selection.empty) {
    return false
  }

  return selection instanceof AllSelection || isFullDocumentRange(selection.from, selection.to, docSize)
}

function isFocusWithinEditor(view: EditorView): boolean {
  const activeElement = view.dom.ownerDocument.activeElement

  return view.hasFocus() || Boolean(activeElement && view.dom.contains(activeElement))
}

const BlurSelectionHighlight = Extension.create({
  name: 'blurSelectionHighlight',

  addProseMirrorPlugins() {
    let pendingBlurFrame: number | null = null
    let pendingBlurWindow: Window | null = null

    const cancelPendingBlur = () => {
      if (pendingBlurFrame === null) {
        return
      }

      pendingBlurWindow?.cancelAnimationFrame(pendingBlurFrame)
      pendingBlurFrame = null
      pendingBlurWindow = null
    }

    const setFocused = (view: EditorView) => {
      cancelPendingBlur()
      view.dispatch(view.state.tr.setMeta(blurSelectionPluginKey, {
        focused: true,
        from: 0,
        to: 0,
      }))
    }

    const setBlurredIfFocusLeftEditor = (view: EditorView) => {
      if (isFocusWithinEditor(view)) {
        setFocused(view)
        return
      }

      const { selection } = view.state
      const { from, to } = selection
      const shouldKeepSelection = from !== to && !isFullDocumentSelection(selection, view.state.doc.content.size)
      view.dispatch(view.state.tr.setMeta(blurSelectionPluginKey, {
        focused: false,
        from: shouldKeepSelection ? from : 0,
        to: shouldKeepSelection ? to : 0,
      }))
    }

    return [
      new Plugin<BlurSelectionState>({
        key: blurSelectionPluginKey,
        view: () => ({
          destroy() {
            cancelPendingBlur()
          },
        }),
        state: {
          init: () => ({
            focused: false,
            from: 0,
            to: 0,
          }),
          apply(tr, value) {
            const meta = tr.getMeta(blurSelectionPluginKey) as Partial<BlurSelectionState> | undefined
            const mapped = {
              ...value,
              from: tr.mapping.map(value.from),
              to: tr.mapping.map(value.to),
            }
            const next = meta ? { ...mapped, ...meta } : mapped
            const { from, to } = tr.selection

            if (meta && ('from' in meta || 'to' in meta)) {
              return next
            }

            if (!tr.selection.empty) {
              if (isFullDocumentSelection(tr.selection, tr.doc.content.size)) {
                return {
                  ...next,
                  from: 0,
                  to: 0,
                }
              }

              return {
                ...next,
                from,
                to,
              }
            }

            if (tr.selection.empty) {
              return {
                ...next,
                from: 0,
                to: 0,
              }
            }

            return next
          },
        },
        props: {
          decorations(state) {
            const pluginState = blurSelectionPluginKey.getState(state)
            if (!pluginState || pluginState.focused || pluginState.from === pluginState.to) {
              return DecorationSet.empty
            }

            const from = Math.max(0, Math.min(pluginState.from, state.doc.content.size))
            const to = Math.max(0, Math.min(pluginState.to, state.doc.content.size))
            if (from === to || isFullDocumentRange(from, to, state.doc.content.size)) {
              return DecorationSet.empty
            }

            return DecorationSet.create(state.doc, [
              Decoration.inline(Math.min(from, to), Math.max(from, to), {
                class: 'tiptap-blur-selection',
              }),
            ])
          },
          handleDOMEvents: {
            focus(view) {
              setFocused(view)
              return false
            },
            mousedown(view, event) {
              if (event.target instanceof Node && view.dom.contains(event.target)) {
                setFocused(view)
              }
              return false
            },
            blur(view) {
              cancelPendingBlur()
              pendingBlurWindow = view.dom.ownerDocument.defaultView

              if (!pendingBlurWindow) {
                setBlurredIfFocusLeftEditor(view)
                return false
              }

              pendingBlurFrame = pendingBlurWindow.requestAnimationFrame(() => {
                pendingBlurFrame = null
                pendingBlurWindow = null
                setBlurredIfFocusLeftEditor(view)
              })

              return false
            },
          },
        },
      }),
    ]
  },
})


// 简单的启发式函数：检查文本是否看起来像 Markdown
function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/.test(text) || // 标题
    /\*\*[^*]+\*\*/.test(text) || // 粗体
    /\*[^*]+\*/.test(text) || // 斜体
    /\[.+\]\(.+\)/.test(text) || // 链接
    /^[-*+]\s/.test(text) || // 无序列表
    /^\d+\.\s/.test(text) || // 有序列表
    /^>\s/.test(text) || // 引用
    /^```[\s\S]*```$/.test(text) || // 代码块
    /`[^`]+`/.test(text) || // 行内代码
    /\$\$[\s\S]+?\$\$/.test(text) || // 块级公式
    /(^|[^\$])\$[^\$\n]+\$(?!\$)/.test(text) // 行内公式
  )
}

function runDeferredEditorCommand(onSuccess: () => void, onError: (error: unknown) => void) {
  setTimeout(() => {
    try {
      onSuccess()
    } catch (error) {
      console.error('[TipTap Editor] Deferred editor command failed:', error)
      onError(error)
    }
  }, 0)
}

interface TipTapEditorProps {
  initialContent: string
  onChange?: (content: string) => void
  onContentDirty?: () => void
  placeholder?: string
  editable?: boolean
  activeFilePath?: string
  standalone?: boolean
  onReady?: () => void
  onEditorReady?: (editor: TipTapReactEditor) => void
  outlineOpen?: boolean
  outlinePosition?: OutlinePosition
  outlineWidth?: number
  outlineInLayout?: boolean
  onToggleOutline?: () => void
  autoScroll?: boolean
  showOverlay?: boolean
  showFooterBar?: boolean
  contentInset?: boolean
  scrollable?: boolean
  mobileMode?: boolean
  applyLayoutPreferences?: boolean
  enableLargeDocumentMode?: boolean
  isActive?: boolean
  onTerminate?: () => void
  documentScope?: 'document' | 'section'
  documentMarkdown?: string
  onBlockingActivityChange?: (count: number) => void
}

type MobileSelectionContext =
  | {
      mode: 'text'
      from: number
      to: number
      previewText: string
      actions: string[]
    }
  | {
      mode: 'image'
      pos: number
      src: string
      alt: string
      actions: string[]
    }
  | {
      mode: 'table'
      from: number
      actions: string[]
    }
  | null

type MobileSheetMode =
  | 'insert'
  | 'format'
  | 'ai'
  | 'ai-write'
  | 'ai-custom'
  | 'mobile-more'
  | 'image-src'
  | 'image-alt'
  | 'table-align'
  | 'table-more'
  | null

function blurActiveEditableElement() {
  const activeElement = document.activeElement
  if (
    activeElement instanceof HTMLElement
    && activeElement.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  ) {
    activeElement.blur()
  }
}

function clampSelectionPosition(value: number, docSize: number): number {
  return Math.max(0, Math.min(value, docSize))
}

function getMarkdownLineAtPosition(markdown: string, position: number): number {
  const safePosition = Math.max(0, Math.min(position, markdown.length))
  let line = 1
  for (let index = 0; index < safePosition; index++) {
    if (markdown.charCodeAt(index) === 10) line++
  }
  return line
}

function getEditorUndoRedoState(editor: CoreEditor): { undo: boolean; redo: boolean } {
  return {
    undo: undoDepth(editor.state) > 0,
    redo: redoDepth(editor.state) > 0,
  }
}

function emitEditorUndoRedoState(editor: CoreEditor): void {
  emitter.emit('editor-undo-redo-changed', getEditorUndoRedoState(editor))
}

function resetEditorHistory(editor: CoreEditor): void {
  const { state } = editor
  const nextState = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    storedMarks: state.storedMarks,
    plugins: state.plugins,
  })

  editor.view.updateState(nextState)
}

function setEditorContentWithoutUndo(editor: CoreEditor, content: string): void {
  editor
    .chain()
    .setMeta('addToHistory', false)
    .setContent(content, { contentType: 'markdown' })
    .run()

  resetEditorHistory(editor)
  emitEditorUndoRedoState(editor)
}

export function TipTapEditor({
  initialContent,
  onChange,
  onContentDirty,
  placeholder,
  editable = true,
  activeFilePath = '',
  standalone = false,
  onReady,
  onEditorReady,
  outlineOpen,
  outlinePosition = 'right',
  outlineWidth = DEFAULT_OUTLINE_WIDTH,
  outlineInLayout = false,
  onToggleOutline,
  autoScroll = false,
  showOverlay = false,
  showFooterBar = true,
  contentInset = true,
  scrollable = true,
  mobileMode,
  applyLayoutPreferences = false,
  enableLargeDocumentMode = applyLayoutPreferences,
  isActive = true,
  onTerminate,
  documentScope = 'document',
  documentMarkdown,
  onBlockingActivityChange,
}: TipTapEditorProps) {
  const editorRenderStartedAtRef = useRef(
    typeof performance === 'undefined' ? Date.now() : performance.now(),
  )
  const [editorRenderDurationMs, setEditorRenderDurationMs] = useState<number | null>(null)
  const t = useTranslations('editor')
  const tMermaid = useTranslations('editor.mermaid.templates')
  const tImage = useTranslations('editor.image')
  const tSourceMode = useTranslations('settings.editor.sourceMode')
  const pendingQuote = useChatStore((state) => state.pendingQuote)
  const pendingSearchKeyword = useArticleStore((state) => state.pendingSearchKeyword)
  const setPendingSearchKeyword = useArticleStore((state) => state.setPendingSearchKeyword)
  const setEditorViewState = useArticleStore((state) => state.setEditorViewState)
  const getEditorViewState = useArticleStore((state) => state.getEditorViewState)
  const isSectionScope = documentScope === 'section'
  const documentMarkdownRef = useRef(documentMarkdown)
  documentMarkdownRef.current = documentMarkdown
  const blockingActivityTokensRef = useRef(new Set<symbol>())
  const blockingActivityFlushRef = useRef<() => void>(() => {})
  const blockingActivityFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isEditorUnmountingRef = useRef(false)
  const discardPendingMarkdownOnUnmountRef = useRef(false)
  const onBlockingActivityChangeRef = useRef(onBlockingActivityChange)
  const initialEditorViewState = activeFilePath && !isSectionScope
    ? getEditorViewState(activeFilePath)
    : null

  const placeholderText = placeholder || t('placeholder')
  const isMobile = mobileMode ?? isMobileDevice()
  const [isRestoringMobileView, setIsRestoringMobileView] = useState(isMobile)
  const [sourceMarkdown, setSourceMarkdown] = useState(initialContent)
  const sourceMarkdownRef = useRef(initialContent)
  const sourceSelectionRef = useRef({
    from: initialEditorViewState?.sourceSelectionFrom ?? 0,
    to: initialEditorViewState?.sourceSelectionTo ?? 0,
  })
  const sourceEditorControllerRef = useRef<SourceMarkdownEditorController | null>(null)
  const pendingSourceSearchRef = useRef(false)
  const [markdownParseError, setMarkdownParseError] = useState<string | null>(null)
  const [isLargeDocument, setIsLargeDocument] = useState(
    () => !isSectionScope && enableLargeDocumentMode && isLargeMarkdownDocument(initialContent)
  )
  const isLargeDocumentRef = useRef(isLargeDocument)
  isLargeDocumentRef.current = isLargeDocument
  const [hasUnparsedSourceChanges, setHasUnparsedSourceChanges] = useState(false)
  const [largeDocumentVisualOverride, setLargeDocumentVisualOverride] = useState(
    () => Boolean(initialEditorViewState?.largeDocumentVisualOverride)
  )
  const [isPreparingLargeDocumentVisual, setIsPreparingLargeDocumentVisual] = useState(false)

  // Use ref for autoScroll to avoid infinite re-render loop
  const autoScrollRef = useRef(autoScroll)
  autoScrollRef.current = autoScroll
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  useEffect(() => {
    onBlockingActivityChangeRef.current = onBlockingActivityChange
  }, [onBlockingActivityChange])

  const beginBlockingActivity = useCallback((flushBeforeStart = true) => {
    if (!isSectionScope) return () => {}

    if (blockingActivityFlushTimerRef.current) {
      clearTimeout(blockingActivityFlushTimerRef.current)
      blockingActivityFlushTimerRef.current = null
    }
    if (flushBeforeStart && blockingActivityTokensRef.current.size === 0) {
      blockingActivityFlushRef.current()
    }

    const token = Symbol('section-editor-activity')
    let active = true
    blockingActivityTokensRef.current.add(token)
    onBlockingActivityChangeRef.current?.(blockingActivityTokensRef.current.size)

    return () => {
      if (!active) return
      active = false
      blockingActivityTokensRef.current.delete(token)
      if (isEditorUnmountingRef.current) return
      onBlockingActivityChangeRef.current?.(blockingActivityTokensRef.current.size)
      if (blockingActivityTokensRef.current.size === 0) {
        blockingActivityFlushTimerRef.current = setTimeout(() => {
          blockingActivityFlushTimerRef.current = null
          if (blockingActivityTokensRef.current.size === 0) {
            blockingActivityFlushRef.current()
          }
        }, 50)
      }
    }
  }, [isSectionScope])

  const aiSuggestionActivityEndRef = useRef<(() => void) | null>(null)
  const handleAiSuggestionPendingChange = useCallback((pending: boolean) => {
    if (pending) {
      if (!aiSuggestionActivityEndRef.current) {
        aiSuggestionActivityEndRef.current = beginBlockingActivity(false)
      }
      return
    }

    aiSuggestionActivityEndRef.current?.()
    aiSuggestionActivityEndRef.current = null
  }, [beginBlockingActivity])

  useEffect(() => () => {
    isEditorUnmountingRef.current = true
    discardPendingMarkdownOnUnmountRef.current = blockingActivityTokensRef.current.size > 0
    if (blockingActivityFlushTimerRef.current) {
      clearTimeout(blockingActivityFlushTimerRef.current)
      blockingActivityFlushTimerRef.current = null
    }
    aiSuggestionActivityEndRef.current?.()
    aiSuggestionActivityEndRef.current = null
    blockingActivityTokensRef.current.clear()
  }, [])
  const activeFilePathRef = useRef(activeFilePath)
  activeFilePathRef.current = activeFilePath
  const imageSourceContextSubscribersRef = useRef(new Set<() => void>())

  useEffect(() => {
    for (const notifyContextChanged of imageSourceContextSubscribersRef.current) {
      notifyContextChanged()
    }
  }, [activeFilePath])

  const {
    contentTextScale,
    editorContentWidth,
    editorLineHeight,
    editorViewMode,
    showSourceLineNumbers,
    editorSourceWrap,
    showEditorUndoRedo,
    showMobileEditorToolbar,
    enableOutline,
    primaryBackupMethod,
    workspacePath,
    setEditorViewMode,
    developerMode,
    developerPerformanceInfo,
  } = useSettingStore()
  const selfHostedRuntimeReady = useSyncStore((state) => state.selfHostedRuntimeReady)
  const viewMode: EditorViewMode = applyLayoutPreferences && !isSectionScope
    ? editorViewMode
    : 'visual'
  const shouldDeferVisualParsing = isLargeDocument && !largeDocumentVisualOverride
  const shouldDeferVisualParsingRef = useRef(shouldDeferVisualParsing)
  shouldDeferVisualParsingRef.current = shouldDeferVisualParsing
  const documentViewMode: EditorViewMode = isLargeDocument
    ? largeDocumentVisualOverride ? 'visual' : 'source'
    : viewMode
  const effectiveViewMode: EditorViewMode = (
    markdownParseError
    || shouldDeferVisualParsing
    || isPreparingLargeDocumentVisual
    || hasUnparsedSourceChanges
  ) ? 'source' : documentViewMode
  const isSourceView = effectiveViewMode === 'source'
  const isSectionVirtualView = (
    !isSectionScope
    && isLargeDocument
    && largeDocumentVisualOverride
    && effectiveViewMode === 'visual'
  )

  useEffect(() => {
    if (!developerMode || !developerPerformanceInfo || isSectionScope) return
    editorRenderStartedAtRef.current = performance.now()
    setEditorRenderDurationMs(null)
  }, [activeFilePath, developerMode, developerPerformanceInfo, isSectionScope])
  const usesCanonicalMarkdown = isSourceView || isSectionVirtualView
  const isSourceViewRef = useRef(isSourceView)
  isSourceViewRef.current = isSourceView
  const usesCanonicalMarkdownRef = useRef(usesCanonicalMarkdown)
  usesCanonicalMarkdownRef.current = usesCanonicalMarkdown
  const previousViewModeRef = useRef<EditorViewMode>(documentViewMode)

  // 编辑器容器 ref，用于应用字体缩放
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerId = useId()
  const sectionedEditorControllerRef = useRef<SectionedMarkdownEditorController | null>(null)
  const [activeSectionEditor, setActiveSectionEditor] = useState<TipTapReactEditor | null>(null)

  useEffect(() => {
    sourceMarkdownRef.current = sourceMarkdown
  }, [sourceMarkdown])

  // Math dialog state
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathType, setMathType] = useState<'inline' | 'block'>('inline')

  // Search and replace panel state
  const [searchReplaceOpen, setSearchReplaceOpen] = useState(false)
  const [searchFocusRequest, setSearchFocusRequest] = useState(0)
  const openSearchReplace = useCallback(() => {
    setSearchReplaceOpen(true)
    setSearchFocusRequest((request) => request + 1)
  }, [])
  const [mobileContext, setMobileContext] = useState<MobileSelectionContext>(null)
  const [mobileSheetMode, setMobileSheetMode] = useState<MobileSheetMode>(null)
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(isMobile && enableOutline)
  const [showMobileScrollTop, setShowMobileScrollTop] = useState(false)
  const [imageSrcDraft, setImageSrcDraft] = useState('')
  const [imageAltDraft, setImageAltDraft] = useState('')
  const [customAiInstruction, setCustomAiInstruction] = useState('')
  const [isCanvasDragOver, setIsCanvasDragOver] = useState(false)
  const [isCanvasDropPending, setIsCanvasDropPending] = useState(false)
  const [selfHostedCollaborators, setSelfHostedCollaborators] = useState<SelfHostedRemoteCursor[]>([])
  const aiActionHandlersRef = useRef({
    polish: async () => {},
    concise: async () => {},
    expand: async () => {},
    translate: async (targetLanguage: string) => {
      void targetLanguage
    },
  })

  const isInitializedRef = useRef(false)
  const initializedForPathRef = useRef<string | null>(null)
  const externalUpdateCounterRef = useRef(0)
  const pendingSyncUpdateRef = useRef<Events['sync-content-updated'] | null>(null)
  const selfHostedCollaborationRef = useRef<MarkdownCollaborationController | null>(null)
  const canonicalExternalUpdateSequenceRef = useRef(0)
  const restoredViewPathRef = useRef<string | null>(null)
  const restoreEditorViewStateRef = useRef<(path: string, attempt?: number) => void>(() => {})
  const lastViewStateRef = useRef<{
    path: string
    selectionFrom: number
    selectionTo: number
    scrollTop: number
    sectionId?: string
  } | null>(null)

  // Bug fix: Track when editor is ready (has caught up with content)
  const isReadyRef = useRef(false)
  // Bug fix: Track if this is the first onUpdate after initialization
  const isFirstUpdateRef = useRef(true)

  // Content version ref for race condition prevention between editor and agent
  const contentVersionRef = useRef(0)
  const sourceSelectionQuoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markdownChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const collaborationChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCollaborationEditorRef = useRef<TipTapReactEditor | null>(null)
  const hasPendingMarkdownChangeRef = useRef(false)
  const onChangeRef = useRef(onChange)
  const classifyCanonicalMarkdownRef = useRef<(value: string) => boolean>(() => false)
  const viewStatePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorDragHandleTargetRef = useRef<EditorBlockTarget | null>(null)
  const editorBlockMenuTargetRef = useRef<EditorBlockTarget | null>(null)
  const editorBlockPointerDragStateRef = useRef<EditorBlockPointerDragState | null>(null)
  const editorBlockMenuOpenRef = useRef(false)
  const editorDragHandleElementRef = useRef<HTMLElement | null>(null)
  const [editorDragHandleElement, setEditorDragHandleElement] = useState<HTMLElement | null>(null)
  const editorShortcuts = useEditorShortcutStore((state) => state.shortcuts)
  const editorShortcutsRef = useRef(editorShortcuts)
  const editorShortcutHandlersRef = useRef<Partial<Record<EditorShortcutCommandId, (targetEditor: CoreEditor) => boolean>>>({})
  const [openAiMenuSignal, setOpenAiMenuSignal] = useState(0)
  const [openTranslateMenuSignal, setOpenTranslateMenuSignal] = useState(0)
  const [openLinkInputSignal, setOpenLinkInputSignal] = useState(0)

  useEffect(() => {
    editorShortcutsRef.current = editorShortcuts
  }, [editorShortcuts])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const onContentDirtyRef = useRef(onContentDirty)
  useEffect(() => {
    onContentDirtyRef.current = onContentDirty
  }, [onContentDirty])

  const flushMarkdownChange = useCallback((targetEditor: TipTapReactEditor) => {
    if (markdownChangeTimerRef.current) {
      clearTimeout(markdownChangeTimerRef.current)
      markdownChangeTimerRef.current = null
    }

    if (
      !hasPendingMarkdownChangeRef.current
      || targetEditor.isDestroyed
      || discardPendingMarkdownOnUnmountRef.current
    ) {
      return
    }
    if (isSectionScope && blockingActivityTokensRef.current.size > 0) {
      return
    }

    hasPendingMarkdownChangeRef.current = false
    const markdown = normalizeMarkdownPlaceholders(targetEditor.getMarkdown())
    if (!isSectionScope) {
      sourceMarkdownRef.current = markdown
      if (classifyCanonicalMarkdownRef.current(markdown)) {
        setSourceMarkdown(markdown)
      }
    }
    onChangeRef.current?.(markdown)
    selfHostedCollaborationRef.current?.applyLocal(markdown)
  }, [isSectionScope])

  const scheduleMarkdownChange = useCallback((targetEditor: TipTapReactEditor) => {
    hasPendingMarkdownChangeRef.current = true
    if (markdownChangeTimerRef.current) {
      clearTimeout(markdownChangeTimerRef.current)
    }

    markdownChangeTimerRef.current = setTimeout(() => {
      markdownChangeTimerRef.current = null
      flushMarkdownChange(targetEditor)
    }, 500)
  }, [flushMarkdownChange])

  const flushCollaborationChange = useCallback(() => {
    if (collaborationChangeTimerRef.current) {
      clearTimeout(collaborationChangeTimerRef.current)
      collaborationChangeTimerRef.current = null
    }
    const targetEditor = pendingCollaborationEditorRef.current
    pendingCollaborationEditorRef.current = null
    if (!targetEditor || targetEditor.isDestroyed || externalUpdateCounterRef.current > 0) return
    selfHostedCollaborationRef.current?.applyLocal(
      normalizeMarkdownPlaceholders(targetEditor.getMarkdown()),
    )
  }, [])

  const scheduleCollaborationChange = useCallback((targetEditor: TipTapReactEditor) => {
    pendingCollaborationEditorRef.current = targetEditor
    if (collaborationChangeTimerRef.current) return
    collaborationChangeTimerRef.current = setTimeout(() => {
      collaborationChangeTimerRef.current = null
      flushCollaborationChange()
    }, 120)
  }, [flushCollaborationChange])

  const runEditorShortcutCommand = useCallback((id: EditorShortcutCommandId, targetEditor: CoreEditor) => {
    return editorShortcutHandlersRef.current[id]?.(targetEditor) ?? false
  }, [])

  const renderEditorDragHandle = useCallback(() => {
    const element = createDragHandleElement()
    editorDragHandleElementRef.current = element
    setEditorDragHandleElement(element)
    return element
  }, [])

  // When file path changes, reset initialization state to avoid old file content overwriting new file
  useEffect(() => {
    if (initializedForPathRef.current !== activeFilePath && activeFilePath) {
      isInitializedRef.current = false
      isReadyRef.current = false
      isFirstUpdateRef.current = true
      initializedForPathRef.current = activeFilePath
      pendingSyncUpdateRef.current = null
      restoredViewPathRef.current = null
      sourceMarkdownRef.current = initialContent
      const savedViewState = isSectionScope ? null : getEditorViewState(activeFilePath)
      sourceSelectionRef.current = {
        from: savedViewState?.sourceSelectionFrom ?? 0,
        to: savedViewState?.sourceSelectionTo ?? 0,
      }
      setSourceMarkdown(initialContent)
      const nextIsLargeDocument = !isSectionScope
        && enableLargeDocumentMode
        && isLargeMarkdownDocument(initialContent)
      isLargeDocumentRef.current = nextIsLargeDocument
      setIsLargeDocument(nextIsLargeDocument)
      setHasUnparsedSourceChanges(false)
      setLargeDocumentVisualOverride(Boolean(savedViewState?.largeDocumentVisualOverride))
      setIsPreparingLargeDocumentVisual(false)
      setIsRestoringMobileView(isMobile)
    }
  }, [activeFilePath, enableLargeDocumentMode, getEditorViewState, initialContent, isMobile, isSectionScope])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      EditorShortcutsExtension.configure({
        getShortcuts: () => editorShortcutsRef.current,
        runCommand: runEditorShortcutCommand,
      }),
      GitHubAlertBlockquoteEditor,
      StarterKit.configure({
        blockquote: false,
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        codeBlock: false,
        link: false,
        paragraph: false,
        underline: false,
        dropcursor: false,
      }),
      MarkdownParagraph,
      Placeholder.configure({
        placeholder: placeholderText,
        showOnlyCurrent: true,
      }),
      Link.configure({
        openOnClick: false,
        protocols: ['file'],
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      StableCodeBlockLowlight.configure({
        shouldHighlight: () => !isSourceViewRef.current,
      }),
      CharacterCount,
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Typography,
      SearchAndReplace,
      Dropcursor,
      EditorBlockDragPreview,
      ...(!isMobile
        ? [
            DragHandle.configure({
              render: renderEditorDragHandle,
              onNodeChange: (options) => {
                const { editor: targetEditor, node } = options
                const pos = (options as typeof options & { pos?: number }).pos

                editorDragHandleTargetRef.current = node && typeof pos === 'number' && pos >= 0
                  ? { editor: targetEditor, from: pos, to: pos + node.nodeSize }
                  : null
              },
              computePositionConfig: {
                middleware: [
                  {
                    name: 'editorDragHandleOffset',
                    fn: ({ x, y, elements }) => {
                      const editorDom = elements.floating.parentElement
                        ?.parentElement
                        ?.querySelector<HTMLElement>('.ProseMirror')

                      if (!editorDom) {
                        return { x: x - 4, y }
                      }

                      const editorRect = editorDom.getBoundingClientRect()
                      const editorPaddingLeft = Number.parseFloat(getComputedStyle(editorDom).paddingLeft) || 0
                      const contentLeft = editorRect.left + editorPaddingLeft
                      const referenceLeft = elements.reference.getBoundingClientRect().left
                      const handleHeight = elements.floating.getBoundingClientRect().height
                      const target = editorDragHandleTargetRef.current
                      const targetDom = target && !target.editor.isDestroyed
                        ? target.editor.view.nodeDOM(target.from)
                        : null
                      const referenceLineHeight = targetDom instanceof HTMLElement
                        ? Number.parseFloat(getComputedStyle(targetDom).lineHeight)
                        : handleHeight
                      const lineOffset = Number.isFinite(referenceLineHeight)
                        ? Math.max(0, (referenceLineHeight - handleHeight) / 2)
                        : 0

                      return {
                        x: x + contentLeft - referenceLeft - 4,
                        y: y + lineOffset,
                      }
                    },
                  },
                ],
              },
              nested: true,
            }),
          ]
        : []),
      MarkdownTable.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({
        indentation: {
          style: 'space',
          size: 2,
        },
      }),
      SlashCommand.configure({
        suggestion: suggestionOptions,
      }),
      QuoteMark,
      AISuggestion,
      AiSuggestionHighlight,
      AgentDiffPreview,
      InlineMath,
      BlockMath,
      MermaidDiagram,
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            relativeSrc: {
              default: null,
              parseHTML: (element) => element.getAttribute('data-relative-src'),
              renderHTML: (attributes) => {
                return {
                  'data-relative-src': attributes.relativeSrc,
                }
              },
            },
          }
        },
        parseHTML() {
          return [
            {
              tag: 'img[src]',
              getAttrs: (element) => {
                const src = element.getAttribute('src')
                const relativeSrc = element.getAttribute('data-relative-src') || src
                const width = getImageDimensionFromElement(element, 'width')
                const height = getImageDimensionFromElement(element, 'height')
                const uploading = element.getAttribute('data-uploading') === 'true'
                // 如果是相对路径（非 http/https/asset://），转换为 asset://
                if (shouldTransformImageSrcToWorkspaceAsset(src)) {
                  // 这里不能直接调用 async 函数，需要在后续处理
                  return {
                    src, // 先保持原样，后续通过其他方式处理
                    relativeSrc: src,
                    alt: element.getAttribute('alt') || '',
                    title: element.getAttribute('title') || null,
                    width,
                    height,
                    uploading,
                  }
                }
                return {
                  src,
                  relativeSrc,
                  alt: element.getAttribute('alt') || '',
                  title: element.getAttribute('title') || null,
                  width,
                  height,
                  uploading,
                }
              },
            },
          ]
        },
        renderHTML({ node }) {
          const width = parseImageDimension(node.attrs.width)
          const height = parseImageDimension(node.attrs.height)
          const style = [
            width ? `width: ${width}px` : null,
            height ? `height: ${height}px` : null,
          ].filter(Boolean).join('; ')

          return ['img', {
            src: node.attrs.src,
            alt: node.attrs.alt || '',
            title: node.attrs.title || null,
            class: 'max-w-full rounded-lg',
            loading: 'lazy',
            decoding: 'async',
            width,
            height,
            style: style || null,
            'data-relative-src': node.attrs.relativeSrc || null,
          }]
        },
        parseMarkdown(token, helpers) {
          const src = token.href || ''

          return helpers.createNode('image', {
            src,
            title: token.title,
            alt: token.text,
            relativeSrc: src,
          })
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        renderMarkdown(node, _helpers) {
          // 优先使用 relativeSrc，其次使用 src
          const attrs = node.attrs || {}
          let src = attrs.relativeSrc || attrs.src || ''
          // 如果是 asset:// 或 tauri:// 路径，提取实际路径
          src = src.replace(/^(tauri|asset|http):\/\/localhost\//, '')
          const width = parseImageDimension(attrs.width)
          const height = parseImageDimension(attrs.height)

          if (!width && !height) {
            return attrs.title
              ? `![${attrs.alt || ''}](${src} "${attrs.title}")`
              : `![${attrs.alt || ''}](${src})`
          }

          const htmlAttributes = [
            `src="${escapeHtmlAttribute(src)}"`,
            `alt="${escapeHtmlAttribute(attrs.alt || '')}"`,
            attrs.title ? `title="${escapeHtmlAttribute(attrs.title)}"` : null,
            width ? `width="${width}"` : null,
            height ? `height="${height}"` : null,
          ].filter(Boolean).join(' ')

          return `<img ${htmlAttributes}>`
        },
        addNodeView() {
          if (!this.options.resize || !this.options.resize.enabled || typeof document === 'undefined') {
            return null
          }

          const { minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize

          return createImageNodeView({
            minWidth,
            minHeight,
            alwaysPreserveAspectRatio,
            getSourceContextKey: () => activeFilePathRef.current || '',
            subscribeSourceContextChange: (callback) => {
              imageSourceContextSubscribersRef.current.add(callback)
              return () => imageSourceContextSubscribersRef.current.delete(callback)
            },
            activateImageSource: async (image) => {
              const currentFilePath = activeFilePathRef.current
                || useArticleStore.getState().activeFilePath
              if (!currentFilePath) return

              await activateDeferredImageSource(image, async (relativeSource) => {
                if (isRecordTabPath(currentFilePath)) {
                  return await convertImage(relativeSource.replace(/^\.?\//, ''))
                }

                const fullRelativePath = resolveImagePathFromMarkdown(
                  currentFilePath,
                  relativeSource
                )
                if (await ensureLocalLibraryFile(fullRelativePath)) {
                  useArticleStore.getState().markFileLocal(fullRelativePath)
                }
                return await convertImageByWorkspace(fullRelativePath)
              })
            },
          })
        },
        addInputRules() {
          return [
            nodeInputRule({
              find: /!\[(.*?)\]\((.*?)(?:\s+"(.*?)")?\)$/,
              type: this.type,
              getAttributes: (match) => {
                const [, alt, src, title] = match
                // 规范化路径：去掉 ./ 前缀
                const normalizedSrc = src.replace(/^\.\//, '')
                return { src: normalizedSrc, alt, title, relativeSrc: normalizedSrc }
              },
            }),
          ]
        },
      }).configure({
        inline: true,
        allowBase64: true,
        resize: {
          enabled: true,
          minWidth: 48,
          minHeight: 48,
          alwaysPreserveAspectRatio: true,
        },
        HTMLAttributes: {
          class: 'max-w-full rounded-lg',
        },
      }),
      // 自定义粘贴 Markdown 扩展
      PasteMarkdown,
      BlurSelectionHighlight,
      SelfHostedRemoteCursors,
    ],
    // Parse after initialization so malformed or unsupported Markdown cannot
    // throw during React render and take down the entire editor tab.
    content: '',
    contentType: 'markdown',
    editable,
    onUpdate: ({ editor }) => {
      // Bug fix: Only trigger onChange if editor is ready (not during initialization)
      // Using counter to handle rapid successive updates
      if (externalUpdateCounterRef.current === 0 && isReadyRef.current) {
        markEditorPathMutation(activeFilePathRef.current)
        selfHostedCollaborationRef.current?.markLocalActivity()
        onContentDirtyRef.current?.()
        scheduleCollaborationChange(editor)
        scheduleMarkdownChange(editor)
        // Mark that we've processed the first update
        isFirstUpdateRef.current = false
        // Increment version on user content changes
        contentVersionRef.current++
      } else if (isFirstUpdateRef.current) {
        // Skip the very first update during initialization
      } else {
        // Skip other updates (counter > 0 means external update)
      }
    },
  })

  useEffect(() => {
    if (!editor || !developerMode || !developerPerformanceInfo || isSectionScope) return
    const frame = requestAnimationFrame(() => {
      setEditorRenderDurationMs(performance.now() - editorRenderStartedAtRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeFilePath, developerMode, developerPerformanceInfo, editor, isSectionScope])

  const selfHostedMarkdownCursors = useMemo(() => {
    const markdownLength = sourceMarkdownRef.current.length
    const proseMirrorLength = editor?.state.doc.content.size ?? markdownLength
    return selfHostedCollaborators.map(cursor => projectRemoteCursor(
      cursor,
      'markdown',
      markdownLength,
      proseMirrorLength,
    ))
  }, [editor, isSourceView, selfHostedCollaborators, sourceMarkdown])
  const selfHostedProseMirrorCursors = useMemo(() => {
    const markdownLength = sourceMarkdownRef.current.length
    const proseMirrorLength = editor?.state.doc.content.size ?? markdownLength
    return selfHostedCollaborators.map(cursor => projectRemoteCursor(
      cursor,
      'prosemirror',
      markdownLength,
      proseMirrorLength,
    ))
  }, [editor, isSourceView, selfHostedCollaborators, sourceMarkdown])

  blockingActivityFlushRef.current = () => {
    if (!editor || editor.isDestroyed || blockingActivityTokensRef.current.size > 0) return
    flushMarkdownChange(editor)
  }

  const trySetMarkdownContent = useCallback((
    targetEditor: CoreEditor,
    content: string,
    options: { emitUpdate?: boolean; resetHistory?: boolean } = {}
  ): boolean => {
    try {
      if (options.resetHistory) {
        setEditorContentWithoutUndo(targetEditor, content)
      } else {
        targetEditor.commands.setContent(content, {
          contentType: 'markdown',
          emitUpdate: options.emitUpdate,
        })
      }
      setMarkdownParseError(null)
      setHasUnparsedSourceChanges(false)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Markdown 可视化解析失败，已切换到源码模式:', error)
      sourceMarkdownRef.current = content
      setSourceMarkdown(content)
      setMarkdownParseError(message)
      setHasUnparsedSourceChanges(true)
      return false
    }
  }, [])

  const classifyCanonicalMarkdown = useCallback((value: string) => {
    const nextIsLargeDocument = !isSectionScope
      && enableLargeDocumentMode
      && isLargeMarkdownDocument(value)
    if (nextIsLargeDocument === isLargeDocumentRef.current) {
      return nextIsLargeDocument
    }

    isLargeDocumentRef.current = nextIsLargeDocument
    setIsLargeDocument(nextIsLargeDocument)
    setLargeDocumentVisualOverride(false)
    setHasUnparsedSourceChanges(true)
    if (activeFilePath) {
      setEditorViewState(activeFilePath, { largeDocumentVisualOverride: false })
    }
    return nextIsLargeDocument
  }, [activeFilePath, enableLargeDocumentMode, isSectionScope, setEditorViewState])
  classifyCanonicalMarkdownRef.current = classifyCanonicalMarkdown

  const handleSourceMarkdownChange = useCallback((value: string) => {
    markEditorPathMutation(activeFilePathRef.current)
    selfHostedCollaborationRef.current?.markLocalActivity()
    sourceMarkdownRef.current = value
    setSourceMarkdown(value)
    setHasUnparsedSourceChanges(true)
    contentVersionRef.current++
    onChangeRef.current?.(value)
    selfHostedCollaborationRef.current?.applyLocal(value)
  }, [])

  const handleSectionedMarkdownChange = useCallback((value: string) => {
    if (sourceMarkdownRef.current === value) return
    selfHostedCollaborationRef.current?.markLocalActivity()
    sourceMarkdownRef.current = value
    setSourceMarkdown(value)
    setHasUnparsedSourceChanges(false)
    contentVersionRef.current++
    onChangeRef.current?.(value)
    selfHostedCollaborationRef.current?.applyLocal(value)
    classifyCanonicalMarkdown(value)
  }, [classifyCanonicalMarkdown])

  useEffect(() => {
    let cancelled = false
    let stopPresence: (() => void) | null = null
    const setup = async () => {
      if (standalone || primaryBackupMethod !== 'selfHosted' || !selfHostedRuntimeReady
        || !isActive || isSectionScope || !activeFilePath || !editor) return
      const workspace = await getWorkspacePath()
      const workspaceRoot = workspace.isCustom
        ? workspace.path
        : await getDefaultArticleAbsolutePath('')
      const normalizedRoot = workspaceRoot.normalize('NFC').replaceAll('\\', '/').replace(/\/$/, '')
      const normalizedPath = activeFilePath.normalize('NFC').replaceAll('\\', '/')
      const relativePath = normalizedPath.startsWith(`${normalizedRoot}/`)
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : normalizedPath
      const setupContentVersion = contentVersionRef.current
      const setupBaseMarkdown = sourceMarkdownRef.current
      let setupMergeBaseMarkdown = setupBaseMarkdown
      let setupAuthoritativeMarkdown = setupBaseMarkdown
      let controllerReady = false
      const applyAuthoritativeMarkdown = (markdown: string) => {
        externalUpdateCounterRef.current++
        sourceMarkdownRef.current = markdown
        setSourceMarkdown(markdown)
        if (!isSourceViewRef.current) {
          trySetMarkdownContent(editor, markdown, { resetHistory: true })
        }
        onChangeRef.current?.(markdown)
        queueMicrotask(() => {
          externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
        })
      }
      try {
        const controller = await openMarkdownCollaboration(
          workspaceRoot,
          relativePath,
          setupBaseMarkdown,
          markdown => {
            setupAuthoritativeMarkdown = markdown
            if (!controllerReady && contentVersionRef.current === setupContentVersion) {
              setupMergeBaseMarkdown = markdown
            }
            if (cancelled || markdown === sourceMarkdownRef.current) return
            if (!controllerReady && contentVersionRef.current !== setupContentVersion) return
            applyAuthoritativeMarkdown(markdown)
          },
        )
        controllerReady = true
        if (cancelled) controller.close()
        else {
          selfHostedCollaborationRef.current = controller
          // Rebase edits made while the asynchronous session was opening onto
          // the authoritative baseline. Never replace that baseline wholesale
          // with the stale source ref captured before visual-editor debounce.
          if (contentVersionRef.current !== setupContentVersion) {
            const setupLocalMarkdown = isSourceViewRef.current
              ? sourceMarkdownRef.current
              : normalizeMarkdownPlaceholders(editor.getMarkdown())
            const mergedMarkdown = mergeCollaborationSetupMarkdown(
              setupMergeBaseMarkdown,
              setupLocalMarkdown,
              setupAuthoritativeMarkdown,
            )
            const nextMarkdown = mergedMarkdown ?? setupAuthoritativeMarkdown
            if (mergedMarkdown === null) {
              console.warn('[self-hosted-sync] Concurrent setup edits overlapped; kept the authoritative document')
            } else if (mergedMarkdown !== setupAuthoritativeMarkdown) {
              controller.applyLocal(mergedMarkdown)
            }
            if (nextMarkdown !== setupLocalMarkdown) {
              applyAuthoritativeMarkdown(nextMarkdown)
            } else if (sourceMarkdownRef.current !== nextMarkdown) {
              sourceMarkdownRef.current = nextMarkdown
              setSourceMarkdown(nextMarkdown)
              onChangeRef.current?.(nextMarkdown)
            }
          }
          stopPresence = controller.subscribePresence(message => {
            const deviceId = typeof message.deviceId === 'string' ? message.deviceId : null
            if (!deviceId) return
            if (message.type === 'presence.cleared') {
              setSelfHostedCollaborators(current => current.filter(item => item.deviceId !== deviceId))
            } else if (message.type === 'presence.updated') {
              const label = typeof message.label === 'string' ? message.label : 'NoteGen'
              const anchor = typeof message.anchor === 'number' ? message.anchor : 0
              const head = typeof message.head === 'number' ? message.head : anchor
              const coordinateSpace = message.coordinateSpace === 'markdown'
                ? 'markdown'
                : 'prosemirror'
              setSelfHostedCollaborators(current => [
                ...current.filter(item => item.deviceId !== deviceId),
                { deviceId, label, anchor, head, coordinateSpace },
              ])
            }
          })
          if (isSourceViewRef.current) {
            if (sourceEditorControllerRef.current?.isFocused()) {
              controller.updatePresence(
                sourceSelectionRef.current.from,
                sourceSelectionRef.current.to,
                isMobile ? '移动端' : '桌面端',
                'markdown',
              )
            }
          } else if (editor.isFocused) {
            const selection = getEditorPresenceSelection(editor)
            controller.updatePresence(
              selection.anchor,
              selection.head,
              isMobile ? '移动端' : '桌面端',
              'prosemirror',
            )
          }
        }
      } catch (error) {
        console.warn('[self-hosted-sync] Collaborative document is unavailable:', error)
      }
    }
    void setup()
    return () => {
      cancelled = true
      stopPresence?.()
      setSelfHostedCollaborators([])
      flushCollaborationChange()
      selfHostedCollaborationRef.current?.close()
      selfHostedCollaborationRef.current = null
    }
  }, [
    activeFilePath,
    editor,
    flushCollaborationChange,
    isActive,
    isMobile,
    isSectionScope,
    primaryBackupMethod,
    selfHostedRuntimeReady,
    standalone,
    trySetMarkdownContent,
  ])

  useEffect(() => {
    if (!editor) return
    updateSelfHostedRemoteCursors(
      editor,
      isSourceView ? [] : selfHostedProseMirrorCursors,
    )
  }, [editor, isSourceView, selfHostedProseMirrorCursors])

  useEffect(() => {
    if (!editor) return
    const updatePresence = () => {
      if (isSourceViewRef.current || !editor.isFocused) return
      const selection = getEditorPresenceSelection(editor)
      selfHostedCollaborationRef.current?.updatePresence(
        selection.anchor,
        selection.head,
        isMobile ? '移动端' : '桌面端',
        'prosemirror',
      )
    }
    const clearPresence = () => {
      if (isSourceViewRef.current) return
      selfHostedCollaborationRef.current?.clearPresence()
    }
    editor.on('selectionUpdate', updatePresence)
    editor.on('focus', updatePresence)
    editor.on('blur', clearPresence)
    return () => {
      editor.off('selectionUpdate', updatePresence)
      editor.off('focus', updatePresence)
      editor.off('blur', clearPresence)
    }
  }, [activeFilePath, editor, isMobile])

  useEffect(() => {
    const controller = selfHostedCollaborationRef.current
    if (!controller || !editor) return
    if (isSourceView) {
      if (!sourceEditorControllerRef.current?.isFocused()) {
        controller.clearPresence()
        return
      }
      controller.updatePresence(
        sourceSelectionRef.current.from,
        sourceSelectionRef.current.to,
        isMobile ? '移动端' : '桌面端',
        'markdown',
      )
      return
    }
    if (editor.isFocused) {
      const selection = getEditorPresenceSelection(editor)
      controller.updatePresence(
        selection.anchor,
        selection.head,
        isMobile ? '移动端' : '桌面端',
        'prosemirror',
      )
    } else {
      controller.clearPresence()
    }
  }, [editor, isMobile, isSourceView])

  const flushSectionedMarkdown = useCallback(() => {
    const expectedCanonical = sourceMarkdownRef.current
    const flushedMarkdown = sectionedEditorControllerRef.current?.flush(expectedCanonical)
    if (flushedMarkdown === undefined) return sourceMarkdownRef.current

    // A remote/Agent replacement can update the canonical ref one render
    // before the section host installs its new index. Local flushes update the
    // same ref synchronously through handleSectionedMarkdownChange.
    return sourceMarkdownRef.current === flushedMarkdown
      ? flushedMarkdown
      : sourceMarkdownRef.current
  }, [])

  const getCurrentMarkdownSnapshot = useCallback(() => {
    if (isSectionVirtualView) return flushSectionedMarkdown()
    if (isSourceView || !editor || editor.isDestroyed) return sourceMarkdownRef.current

    flushMarkdownChange(editor)
    return normalizeMarkdownPlaceholders(editor.getMarkdown())
  }, [editor, flushMarkdownChange, flushSectionedMarkdown, isSectionVirtualView, isSourceView])

  useEffect(() => {
    if (isSectionScope || !isActive) return

    const handlePrepareDeactivate = ({
      resolve,
    }: {
      resolve: (canDeactivate: boolean) => void
    }) => {
      if (!(sectionedEditorControllerRef.current?.prepareToDeactivate() ?? true)) {
        resolve(false)
        return
      }

      try {
        // Visual Tiptap keeps Markdown serialization behind a local 500 ms
        // timer. Flush that timer synchronously before the durable step drains
        // the article store queue. Source mode already updates its canonical
        // ref and onChange bridge on every CodeMirror transaction.
        getCurrentMarkdownSnapshot()
        resolve(true)
      } catch (error) {
        console.error('Failed to flush the editor before changing files:', error)
        resolve(false)
      }
    }

    emitter.on('editor-prepare-deactivate', handlePrepareDeactivate)
    return () => {
      emitter.off('editor-prepare-deactivate', handlePrepareDeactivate)
    }
  }, [getCurrentMarkdownSnapshot, isActive, isSectionScope])

  const prepareExternalMarkdownAction = useCallback(() => (
    sectionedEditorControllerRef.current?.prepareToDeactivate() ?? true
  ), [])

  const handleActiveSectionEditorChange = useCallback((nextEditor: TipTapReactEditor | null) => {
    setActiveSectionEditor(nextEditor)
    if (!nextEditor || !activeFilePath || !isSectionVirtualView) return

    const sectionId = sectionedEditorControllerRef.current?.getActiveSectionId()
    if (sectionId) {
      setEditorViewState(activeFilePath, { sectionId })
    }
  }, [activeFilePath, isSectionVirtualView, setEditorViewState])

  const handleSectionedSelectionChange = useCallback((selection: SectionedMarkdownSelection | null) => {
    if (!isActive || !isSectionVirtualView) return

    if (sourceSelectionQuoteTimerRef.current) {
      clearTimeout(sourceSelectionQuoteTimerRef.current)
      sourceSelectionQuoteTimerRef.current = null
    }

    if (!selection) {
      useChatStore.getState().setEditorSelectionQuote(null)
      return
    }

    if (selection.collapsed) {
      useChatStore.getState().setEditorSelectionQuote(null)
      return
    }

    sourceSelectionQuoteTimerRef.current = setTimeout(() => {
      sourceSelectionQuoteTimerRef.current = null
      const currentSelection = sectionedEditorControllerRef.current?.getSelection()
      if (
        !currentSelection
        || currentSelection.collapsed !== selection.collapsed
        || currentSelection.selectionToken !== selection.selectionToken
      ) {
        return
      }

      const selectedMarkdown = currentSelection.markdown || currentSelection.text
      const quote = currentSelection.text || selectedMarkdown
      if (!quote.trim()) {
        useChatStore.getState().setEditorSelectionQuote(null)
        return
      }

      useChatStore.getState().setEditorSelectionQuote({
        quote,
        fullContent: selectedMarkdown,
        fileName: activeFilePath?.split('/').pop() || '',
        startLine: -1,
        endLine: -1,
        from: -1,
        to: -1,
        selectionToken: currentSelection.selectionToken,
        articlePath: activeFilePath || '',
      })
    }, 120)
  }, [activeFilePath, isActive, isSectionVirtualView])

  const handleSourceSelectionChange = useCallback((selection: { from: number; to: number }) => {
    sourceSelectionRef.current = selection
    if (isSectionScope) return
    if (!isActive) return
    if (!sourceEditorControllerRef.current?.isFocused()) return

    selfHostedCollaborationRef.current?.updatePresence(
      selection.from,
      selection.to,
      isMobile ? '移动端' : '桌面端',
      'markdown',
    )

    if (sourceSelectionQuoteTimerRef.current) {
      clearTimeout(sourceSelectionQuoteTimerRef.current)
      sourceSelectionQuoteTimerRef.current = null
    }

    if (selection.from === selection.to) {
      useChatStore.getState().setEditorSelectionQuote(null)
      return
    }

    sourceSelectionQuoteTimerRef.current = setTimeout(() => {
      sourceSelectionQuoteTimerRef.current = null
      if (
        sourceSelectionRef.current.from !== selection.from
        || sourceSelectionRef.current.to !== selection.to
      ) {
        return
      }

      const markdown = sourceMarkdownRef.current
      const from = Math.max(0, Math.min(selection.from, markdown.length))
      const to = Math.max(from, Math.min(selection.to, markdown.length))
      const quote = markdown.slice(from, to)
      if (!quote.trim()) {
        useChatStore.getState().setEditorSelectionQuote(null)
        return
      }

      useChatStore.getState().setEditorSelectionQuote({
        quote,
        fullContent: quote,
        fileName: activeFilePath?.split('/').pop() || '',
        startLine: getMarkdownLineAtPosition(markdown, from),
        endLine: getMarkdownLineAtPosition(markdown, to),
        from,
        to,
        articlePath: activeFilePath || '',
      })
    }, 120)
  }, [activeFilePath, isActive, isMobile, isSectionScope])

  const handleSourceFocusChange = useCallback((focused: boolean) => {
    const controller = selfHostedCollaborationRef.current
    if (!controller || !isActive || !isSourceViewRef.current) return
    if (!focused) {
      controller.clearPresence()
      return
    }
    controller.updatePresence(
      sourceSelectionRef.current.from,
      sourceSelectionRef.current.to,
      isMobile ? '移动端' : '桌面端',
      'markdown',
    )
  }, [isActive, isMobile])

  const handleSourceControllerChange = useCallback((controller: SourceMarkdownEditorController | null) => {
    sourceEditorControllerRef.current = controller
    if (!controller) return

    const pendingKeyword = useArticleStore.getState().pendingSearchKeyword.trim()
    if (pendingKeyword) {
      controller.find(pendingKeyword)
      setPendingSearchKeyword('')
      pendingSourceSearchRef.current = false
      return
    }

    if (!pendingSourceSearchRef.current) return

    pendingSourceSearchRef.current = false
    window.requestAnimationFrame(() => controller.openSearch())
  }, [setPendingSearchKeyword])

  const handleSourceUndoRedoChange = useCallback((state: { undo: boolean; redo: boolean }) => {
    if (!isActive) return
    emitter.emit('editor-undo-redo-changed', state)
  }, [isActive])

  const handleSourceViewStateChange = useCallback((state: SourceMarkdownEditorViewState) => {
    sourceSelectionRef.current = state.selection
    if (isSourceViewRef.current && sourceEditorControllerRef.current?.isFocused()) {
      selfHostedCollaborationRef.current?.updatePresence(
        state.selection.from,
        state.selection.to,
        isMobile ? '移动端' : '桌面端',
        'markdown',
      )
    }
    if (isSectionScope || !activeFilePath) return

    setEditorViewState(activeFilePath, {
      sourceSelectionFrom: state.selection.from,
      sourceSelectionTo: state.selection.to,
      sourceScrollTop: state.scrollTop,
    })
  }, [activeFilePath, isMobile, isSectionScope, setEditorViewState])

  useEffect(() => {
    return () => {
      if (sourceSelectionQuoteTimerRef.current) {
        clearTimeout(sourceSelectionQuoteTimerRef.current)
        sourceSelectionQuoteTimerRef.current = null
      }
    }
  }, [activeFilePath, isActive])

  useEffect(() => {
    if (!isActive || !isSourceView) return

    handleSourceUndoRedoChange(
      sourceEditorControllerRef.current?.getUndoRedoState() ?? { undo: false, redo: false }
    )
    handleSourceSelectionChange(sourceSelectionRef.current)
  }, [
    handleSourceSelectionChange,
    handleSourceUndoRedoChange,
    isActive,
    isSourceView,
  ])

  const handleEnterVisualMode = useCallback(() => {
    if (!editor || !isActive || isPreparingLargeDocumentVisual) return

    setIsPreparingLargeDocumentVisual(true)
  }, [editor, isActive, isPreparingLargeDocumentVisual])

  useEffect(() => {
    if (!editor || !isPreparingLargeDocumentVisual) return
    if (!isActive) {
      setIsPreparingLargeDocumentVisual(false)
      return
    }

    const currentPath = activeFilePath
    const parseTimer = window.setTimeout(() => {
      if (
        activeFilePath !== currentPath
        || editor.isDestroyed
        || !isActiveRef.current
      ) {
        setIsPreparingLargeDocumentVisual(false)
        return
      }

      const shouldUseSectionView = classifyCanonicalMarkdown(sourceMarkdownRef.current)
      if (shouldUseSectionView && !isSectionScope) {
        setMarkdownParseError(null)
        setHasUnparsedSourceChanges(false)
        setIsPreparingLargeDocumentVisual(false)
        setLargeDocumentVisualOverride(true)
        setEditorViewState(currentPath, { largeDocumentVisualOverride: true })
        previousViewModeRef.current = 'visual'
        onReady?.()
        return
      }

      isReadyRef.current = false
      const didLoadVisualContent = trySetMarkdownContent(
        editor,
        sourceMarkdownRef.current,
        { resetHistory: true }
      )
      setIsPreparingLargeDocumentVisual(false)
      if (!didLoadVisualContent) return

      isInitializedRef.current = true
      isReadyRef.current = true
      onReady?.()
      onEditorReady?.(editor)
      restoreEditorViewStateRef.current(currentPath)
      setLargeDocumentVisualOverride(true)
      setEditorViewState(currentPath, { largeDocumentVisualOverride: true })
      previousViewModeRef.current = 'visual'
      if (applyLayoutPreferences) {
        void setEditorViewMode('visual')
      }
    }, 0)

    return () => window.clearTimeout(parseTimer)
  }, [
    activeFilePath,
    applyLayoutPreferences,
    classifyCanonicalMarkdown,
    editor,
    isActive,
    isLargeDocument,
    isSectionScope,
    isPreparingLargeDocumentVisual,
    onEditorReady,
    onReady,
    setEditorViewMode,
    setEditorViewState,
    trySetMarkdownContent,
  ])

  useEffect(() => {
    if (!editor || previousViewModeRef.current === documentViewMode) return

    if (documentViewMode === 'source' && !markdownParseError && isInitializedRef.current) {
      const nextSourceMarkdown = isLargeDocument && largeDocumentVisualOverride
        ? flushSectionedMarkdown()
        : (() => {
            flushMarkdownChange(editor)
            return normalizeMarkdownPlaceholders(editor.getMarkdown())
          })()
      sourceMarkdownRef.current = nextSourceMarkdown
      setSourceMarkdown(nextSourceMarkdown)
      setHasUnparsedSourceChanges(false)
      if (isLargeDocument) {
        setLargeDocumentVisualOverride(false)
        if (activeFilePath) {
          setEditorViewState(activeFilePath, { largeDocumentVisualOverride: false })
        }
      }
    }

    previousViewModeRef.current = documentViewMode
  }, [
    editor,
    activeFilePath,
    flushMarkdownChange,
    flushSectionedMarkdown,
    isLargeDocument,
    largeDocumentVisualOverride,
    markdownParseError,
    setEditorViewState,
    documentViewMode,
  ])

  const handleToggleViewMode = useCallback(() => {
    if (isSourceView) {
      handleEnterVisualMode()
      return
    }

    if (!editor) return
    if (
      isSectionVirtualView
      && sectionedEditorControllerRef.current
      && !sectionedEditorControllerRef.current.prepareToDeactivate()
    ) {
      return
    }
    const nextSourceMarkdown = isSectionVirtualView
      ? flushSectionedMarkdown()
      : (() => {
          flushMarkdownChange(editor)
          return normalizeMarkdownPlaceholders(editor.getMarkdown())
        })()
    sourceMarkdownRef.current = nextSourceMarkdown
    setSourceMarkdown(nextSourceMarkdown)
    setHasUnparsedSourceChanges(false)
    if (isLargeDocument) {
      setLargeDocumentVisualOverride(false)
      if (activeFilePath) {
        setEditorViewState(activeFilePath, { largeDocumentVisualOverride: false })
      }
      previousViewModeRef.current = 'source'
      return
    }
    previousViewModeRef.current = 'source'
    void setEditorViewMode('source')
  }, [
    activeFilePath,
    editor,
    flushMarkdownChange,
    flushSectionedMarkdown,
    handleEnterVisualMode,
    isLargeDocument,
    isSectionVirtualView,
    isSourceView,
    setEditorViewMode,
    setEditorViewState,
  ])

  useEffect(() => {
    if (!editor) return

    const handleBlur = () => {
      if (!markdownParseError) flushMarkdownChange(editor)
    }
    editor.on('blur', handleBlur)

    return () => {
      editor.off('blur', handleBlur)
      if (!markdownParseError) flushMarkdownChange(editor)
    }
  }, [editor, flushMarkdownChange, markdownParseError])

  useEffect(() => {
    if (!editor || editor.isDestroyed || isSectionVirtualView) {
      return
    }

    const handleGutterMouseMove = (event: MouseEvent) => {
      if (!event.isTrusted) {
        return
      }

      const controls = editorDragHandleElementRef.current
      if (!controls || editorBlockMenuOpenRef.current || editorBlockPointerDragStateRef.current) {
        return
      }

      const editorRect = editor.view.dom.getBoundingClientRect()
      const editorStyle = getComputedStyle(editor.view.dom)
      const editorPaddingLeft = Number.parseFloat(editorStyle.paddingLeft) || 0
      const editorPaddingRight = Number.parseFloat(editorStyle.paddingRight) || 0
      const contentLeft = editorRect.left + editorPaddingLeft
      const contentRight = editorRect.right - editorPaddingRight
      const blockProbeX = Math.min(contentLeft + 48, contentRight - 1)
      const wasInGutter = controls.dataset.gutterHover === 'true'
      const isInGutter = event.clientX >= contentLeft - 53
        && event.clientX < contentLeft
        && event.clientY >= editorRect.top
        && event.clientY <= editorRect.bottom
      const isInsideEditor = event.clientX >= editorRect.left
        && event.clientX <= editorRect.right
        && event.clientY >= editorRect.top
        && event.clientY <= editorRect.bottom

      controls.dataset.gutterHover = String(isInGutter)
      if (isInGutter) {
        editor.view.dom.dispatchEvent(new MouseEvent('mousemove', {
          bubbles: true,
          clientX: blockProbeX,
          clientY: event.clientY,
        }))
      } else if (wasInGutter && !isInsideEditor) {
        editor.commands.setMeta('hideDragHandle', true)
      }
    }

    const finishPointerDrag = (event: PointerEvent, shouldMove: boolean) => {
      const dragState = editorBlockPointerDragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      editorBlockPointerDragStateRef.current = null
      dragState.controls.dataset.dragging = 'false'
      Object.assign(dragState.controls.style, {
        position: dragState.controlsPosition,
        left: dragState.controlsLeft,
        top: dragState.controlsTop,
      })
      if (!editor.isDestroyed) {
        editor.view.dispatch(editor.state.tr.setMeta(editorBlockDragPreviewPluginKey, null))
      }

      if (dragState.handle.hasPointerCapture(event.pointerId)) {
        dragState.handle.releasePointerCapture(event.pointerId)
      }

      if (shouldMove && dragState.moved) {
        moveEditorBlock(dragState)
      }

      if (dragState.moved) {
        dragState.controls.dataset.gutterHover = 'false'
        if (!editor.isDestroyed) {
          editor.commands.setMeta('hideDragHandle', true)
        }
        dragState.handle.dataset.editorBlockDragFinished = 'true'
        window.setTimeout(() => {
          delete dragState.handle.dataset.editorBlockDragFinished
        }, 0)
        event.preventDefault()
        event.stopPropagation()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || editorBlockMenuOpenRef.current) {
        return
      }

      const eventTarget = event.target
      const handle = eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>('[data-editor-block-drag-trigger]')
        : null
      const target = editorDragHandleTargetRef.current
      const controls = handle?.closest<HTMLElement>('.tiptap-drag-handle')

      if (
        !handle
        || !controls
        || controls !== editorDragHandleElementRef.current
        || !target
        || target.editor !== editor
      ) {
        return
      }

      const dragTarget = getEditorBlockDragTarget(target)
      if (!dragTarget) {
        return
      }
      const controlsRect = controls.getBoundingClientRect()

      editorBlockPointerDragStateRef.current = {
        ...dragTarget,
        startDoc: editor.state.doc,
        targetPos: null,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        indicatorPos: null,
        preview: createEditorBlockDragPreviewDom(editor, dragTarget.from, dragTarget.to),
        handle,
        controls,
        controlsOffsetY: event.clientY - controlsRect.top,
        controlsFixedLeft: controlsRect.left,
        controlsPosition: controls.style.position,
        controlsLeft: controls.style.left,
        controlsTop: controls.style.top,
      }

      controls.dataset.dragging = 'true'
      handle.setPointerCapture(event.pointerId)

      event.preventDefault()
      event.stopPropagation()
    }

    const handlePointerMove = (event: PointerEvent) => {
      const dragState = editorBlockPointerDragStateRef.current
      if (!dragState || dragState.pointerId !== event.pointerId) {
        return
      }

      if (!dragState.moved && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) >= 4) {
        dragState.moved = true
      }

      if (dragState.moved) {
        Object.assign(dragState.controls.style, {
          position: 'fixed',
          left: `${dragState.controlsFixedLeft}px`,
          top: `${event.clientY - dragState.controlsOffsetY}px`,
        })
        const editorRect = editor.view.dom.getBoundingClientRect()
        const editorStyle = getComputedStyle(editor.view.dom)
        const contentLeft = editorRect.left + (Number.parseFloat(editorStyle.paddingLeft) || 0)
        const contentRight = editorRect.right - (Number.parseFloat(editorStyle.paddingRight) || 0)
        const blockProbeX = Math.min(contentLeft + 48, contentRight - 1)
        const targetPos = editor.view.posAtCoords({
          left: Math.max(blockProbeX, Math.min(event.clientX, contentRight - 1)),
          top: event.clientY,
        })?.pos

        if (targetPos !== undefined) {
          dragState.targetPos = targetPos
          const slice = dragState.startDoc.slice(dragState.from, dragState.to)
          const indicatorPos = dropPoint(editor.state.doc, targetPos, slice) ?? targetPos

          if (indicatorPos !== dragState.indicatorPos) {
            dragState.indicatorPos = indicatorPos
            const preview = indicatorPos >= dragState.from && indicatorPos <= dragState.to
              ? null
              : {
                  from: dragState.from,
                  to: dragState.to,
                  pos: indicatorPos,
                  dom: dragState.preview,
                } satisfies EditorBlockDragPreview
            editor.view.dispatch(editor.state.tr.setMeta(editorBlockDragPreviewPluginKey, preview))
          }
        } else {
          dragState.targetPos = null
          dragState.indicatorPos = null
          editor.view.dispatch(editor.state.tr.setMeta(editorBlockDragPreviewPluginKey, null))
        }

        event.preventDefault()
        event.stopPropagation()
      }
    }

    const handlePointerUp = (event: PointerEvent) => finishPointerDrag(event, true)
    const handlePointerCancel = (event: PointerEvent) => finishPointerDrag(event, false)

    document.addEventListener('mousemove', handleGutterMouseMove, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('pointercancel', handlePointerCancel, true)

    return () => {
      document.removeEventListener('mousemove', handleGutterMouseMove, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('pointercancel', handlePointerCancel, true)

      const dragState = editorBlockPointerDragStateRef.current
      if (dragState?.editor === editor) {
        editorBlockPointerDragStateRef.current = null
        dragState.controls.dataset.dragging = 'false'
        Object.assign(dragState.controls.style, {
          position: dragState.controlsPosition,
          left: dragState.controlsLeft,
          top: dragState.controlsTop,
        })
        editor.view.dispatch(editor.state.tr.setMeta(editorBlockDragPreviewPluginKey, null))
        if (dragState.handle.hasPointerCapture(dragState.pointerId)) {
          dragState.handle.releasePointerCapture(dragState.pointerId)
        }
      }
      delete editorDragHandleElementRef.current?.dataset.gutterHover
    }
  }, [editor, isSectionVirtualView])

  const clearBlurSelectionHighlight = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    editor.view.dispatch(editor.state.tr.setMeta(blurSelectionPluginKey, {
      focused: true,
      from: 0,
      to: 0,
    }))
  }, [editor])

  const handleEditorMouseDownCapture = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    clearBlurSelectionHighlight()
  }, [clearBlurSelectionHighlight])

  const persistEditorViewState = useCallback(() => {
    if (isSectionScope || !editor || !activeFilePath || !scrollContainerRef.current) {
      return
    }

    if (restoredViewPathRef.current !== activeFilePath) {
      return
    }

    const { selection } = editor.state
    const docSize = editor.state.doc.content.size
    const previousState = lastViewStateRef.current
    let selectionFrom = isSectionVirtualView
      ? sourceSelectionRef.current.from
      : selection.from
    let selectionTo = isSectionVirtualView
      ? sourceSelectionRef.current.to
      : selection.to

    if (!isSectionVirtualView && isFullDocumentSelection(selection, docSize)) {
      if (
        previousState?.path === activeFilePath &&
        !isFullDocumentRange(previousState.selectionFrom, previousState.selectionTo, docSize)
      ) {
        selectionFrom = previousState.selectionFrom
        selectionTo = previousState.selectionTo
      } else {
        selectionFrom = clampSelectionPosition(selection.to, docSize)
        selectionTo = selectionFrom
      }
    }

    const nextState = {
      path: activeFilePath,
      selectionFrom,
      selectionTo,
      scrollTop: scrollContainerRef.current.scrollTop,
      sectionId: isSectionVirtualView
        ? sectionedEditorControllerRef.current?.getActiveSectionId() ?? undefined
        : undefined,
    }

    if (
      previousState &&
      previousState.path === nextState.path &&
      previousState.selectionFrom === nextState.selectionFrom &&
      previousState.selectionTo === nextState.selectionTo &&
      previousState.scrollTop === nextState.scrollTop &&
      previousState.sectionId === nextState.sectionId
    ) {
      return
    }

    lastViewStateRef.current = nextState
    setEditorViewState(activeFilePath, {
      selectionFrom,
      selectionTo,
      scrollTop: nextState.scrollTop,
      sectionId: nextState.sectionId,
    })
  }, [activeFilePath, editor, isSectionScope, isSectionVirtualView, setEditorViewState])

  const handleEditorScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    if (viewStatePersistTimerRef.current) {
      clearTimeout(viewStatePersistTimerRef.current)
    }
    viewStatePersistTimerRef.current = setTimeout(() => {
      viewStatePersistTimerRef.current = null
      persistEditorViewState()
    }, 150)

    if (!isMobile) {
      return
    }

    setShowMobileScrollTop(event.currentTarget.scrollTop > MOBILE_SCROLL_TOP_THRESHOLD)
  }, [isMobile, persistEditorViewState])

  useEffect(() => {
    if (!isMobile || !editor) {
      setShowMobileScrollTop(false)
      return
    }

    const scrollContainer = scrollContainerRef.current
    const proseMirror = editor.view.dom
    const scrollTargets = [scrollContainer, proseMirror].filter((target): target is HTMLElement => !!target)

    if (!scrollTargets.length) {
      setShowMobileScrollTop(false)
      return
    }

    let animationFrame: number | null = null

    const updateScrollTopVisibility = () => {
      animationFrame = null
      const scrollTop = Math.max(...scrollTargets.map((target) => target.scrollTop))
      setShowMobileScrollTop(scrollTop > MOBILE_SCROLL_TOP_THRESHOLD)
    }

    const scheduleUpdate = () => {
      if (animationFrame !== null) {
        return
      }
      animationFrame = window.requestAnimationFrame(updateScrollTopVisibility)
    }

    updateScrollTopVisibility()
    scrollTargets.forEach((target) => {
      target.addEventListener('scroll', scheduleUpdate, { passive: true })
    })

    return () => {
      scrollTargets.forEach((target) => {
        target.removeEventListener('scroll', scheduleUpdate)
      })
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame)
      }
    }
  }, [isMobile, editor, activeFilePath])

  useEffect(() => {
    if (!editor || !activeFilePath) {
      return
    }

    const handleBlur = () => {
      if (viewStatePersistTimerRef.current) {
        clearTimeout(viewStatePersistTimerRef.current)
        viewStatePersistTimerRef.current = null
      }
      persistEditorViewState()
    }

    editor.on('blur', handleBlur)
    return () => {
      editor.off('blur', handleBlur)
    }
  }, [activeFilePath, editor, persistEditorViewState])

  useEffect(() => {
    return () => {
      if (viewStatePersistTimerRef.current) {
        clearTimeout(viewStatePersistTimerRef.current)
        viewStatePersistTimerRef.current = null
      }
      persistEditorViewState()
    }
  }, [persistEditorViewState])

  const restoreEditorViewState = useCallback((path: string, attempt: number = 0) => {
    if (isSectionScope || !editor || !path || !scrollContainerRef.current) {
      return
    }

    if (restoredViewPathRef.current === path) {
      return
    }

    const savedViewState = getEditorViewState(path)

    if (!savedViewState) {
      const initialScrollTop = isMobile ? 0 : scrollContainerRef.current.scrollTop

      if (isMobile) {
        scrollContainerRef.current.scrollTop = initialScrollTop
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = initialScrollTop
          }
        })
        setIsRestoringMobileView(false)
      }

      restoredViewPathRef.current = path
      lastViewStateRef.current = {
        path,
        selectionFrom: editor.state.selection.from,
        selectionTo: editor.state.selection.to,
        scrollTop: initialScrollTop,
      }
      return
    }

    if (isSectionVirtualView) {
      sourceSelectionRef.current = {
        from: savedViewState.selectionFrom,
        to: savedViewState.selectionTo,
      }
      requestAnimationFrame(() => {
        if (!scrollContainerRef.current) return
        scrollContainerRef.current.scrollTop = savedViewState.scrollTop
        restoredViewPathRef.current = path
        lastViewStateRef.current = {
          path,
          selectionFrom: savedViewState.selectionFrom,
          selectionTo: savedViewState.selectionTo,
          scrollTop: savedViewState.scrollTop,
          sectionId: savedViewState.sectionId,
        }
        window.setTimeout(() => {
          if (scrollContainerRef.current && restoredViewPathRef.current === path) {
            scrollContainerRef.current.scrollTop = savedViewState.scrollTop
          }
        }, 50)
      })
      return
    }

    const docSize = editor.state.doc.content.size
    let selectionFrom = clampSelectionPosition(savedViewState.selectionFrom, docSize)
    let selectionTo = clampSelectionPosition(savedViewState.selectionTo, docSize)
    const wantedSelection = Math.max(savedViewState.selectionFrom, savedViewState.selectionTo)
    const normalizedFullDocumentSelection = isFullDocumentRange(selectionFrom, selectionTo, docSize)

    if (normalizedFullDocumentSelection) {
      selectionFrom = clampSelectionPosition(selectionTo, docSize)
      selectionTo = selectionFrom
    }

    if (docSize < wantedSelection && attempt < 5) {
      setTimeout(() => {
        restoreEditorViewState(path, attempt + 1)
      }, 16)
      return
    }

    requestAnimationFrame(() => {
      if (!scrollContainerRef.current) {
        return
      }

      if (isMobile) {
        editor.commands.setTextSelection({
          from: selectionFrom,
          to: selectionTo,
        })
      } else {
        editor.chain().focus().setTextSelection({
          from: selectionFrom,
          to: selectionTo,
        }).run()
      }

      requestAnimationFrame(() => {
        if (!scrollContainerRef.current) {
          return
        }

        scrollContainerRef.current.scrollTop = savedViewState.scrollTop
        setIsRestoringMobileView(false)
        if (isMobile) {
          window.setTimeout(() => {
            if (scrollContainerRef.current && restoredViewPathRef.current === path) {
              scrollContainerRef.current.scrollTop = savedViewState.scrollTop
            }
          }, 0)
          window.setTimeout(() => {
            if (scrollContainerRef.current && restoredViewPathRef.current === path) {
              scrollContainerRef.current.scrollTop = savedViewState.scrollTop
            }
          }, 50)
        }
        restoredViewPathRef.current = path
        lastViewStateRef.current = {
          path,
          selectionFrom,
          selectionTo,
          scrollTop: savedViewState.scrollTop,
        }
        if (normalizedFullDocumentSelection) {
          setEditorViewState(path, {
            selectionFrom,
            selectionTo,
            scrollTop: savedViewState.scrollTop,
          })
        }
      })
    })
  }, [editor, getEditorViewState, isMobile, isSectionScope, isSectionVirtualView, setEditorViewState])
  restoreEditorViewStateRef.current = restoreEditorViewState

  useEffect(() => {
    if (!isSectionVirtualView || !activeSectionEditor || !activeFilePath) return
    restoreEditorViewState(activeFilePath)
  }, [activeFilePath, activeSectionEditor, isSectionVirtualView, restoreEditorViewState])

  const scrollMobileSelectionIntoView = useCallback(() => {
    if (!isMobile || !editor || editor.isDestroyed || !scrollContainerRef.current) {
      return
    }

    const scrollContainer = scrollContainerRef.current
    let selectionCoords: { top: number; bottom: number }

    try {
      selectionCoords = editor.view.coordsAtPos(editor.state.selection.from)
    } catch {
      return
    }

    const containerRect = scrollContainer.getBoundingClientRect()
    const visualViewport = window.visualViewport
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight)
    const visibleTop = Math.max(containerRect.top, viewportTop) + 16
    const visibleBottom = Math.min(containerRect.bottom, viewportBottom) - 24

    if (visibleBottom <= visibleTop) {
      return
    }

    let nextScrollTop = scrollContainer.scrollTop

    if (selectionCoords.bottom > visibleBottom) {
      nextScrollTop += selectionCoords.bottom - visibleBottom
    } else if (selectionCoords.top < visibleTop) {
      nextScrollTop -= visibleTop - selectionCoords.top
    } else {
      return
    }

    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)
    const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop))

    if (Math.abs(clampedScrollTop - scrollContainer.scrollTop) < 1) {
      return
    }

    scrollContainer.scrollTo({
      top: clampedScrollTop,
      behavior: 'auto',
    })
  }, [editor, isMobile])

  useEffect(() => {
    if (!editor || !isMobile || isSectionVirtualView) {
      return
    }

    let scrollTimer: number | null = null
    let viewportSettleAt = 0

    const scheduleSelectionScroll = (minimumDelay = 0) => {
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer)
      }

      const delay = Math.max(minimumDelay, viewportSettleAt - Date.now())
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null
        requestAnimationFrame(scrollMobileSelectionIntoView)
      }, delay)
    }
    const handleEditorFocus = () => {
      viewportSettleAt = Date.now() + 320
      scheduleSelectionScroll()
    }
    const handleSelectionUpdate = () => scheduleSelectionScroll()
    const handleViewportChange = () => {
      viewportSettleAt = Date.now() + 120
      scheduleSelectionScroll()
    }

    editor.on('focus', handleEditorFocus)
    editor.on('selectionUpdate', handleSelectionUpdate)
    window.visualViewport?.addEventListener('resize', handleViewportChange)
    window.visualViewport?.addEventListener('scroll', handleViewportChange)

    return () => {
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer)
      }
      editor.off('focus', handleEditorFocus)
      editor.off('selectionUpdate', handleSelectionUpdate)
      window.visualViewport?.removeEventListener('resize', handleViewportChange)
      window.visualViewport?.removeEventListener('scroll', handleViewportChange)
    }
  }, [editor, isMobile, isSectionVirtualView, scrollMobileSelectionIntoView])

  // 普通点击编辑链接；组合键点击直接打开链接。
  useEffect(() => {
    if (!editor || !editorContainerRef.current || isSectionVirtualView) return

    const editorElement = editorContainerRef.current

    const openFileInApp = async (path: string) => {
      await useArticleStore.getState().setActiveFilePath(
        path,
        true,
        isMobile ? undefined : { tabOpenMode: 'preview' },
      )
    }

    const editLink = (anchor: HTMLAnchorElement, href: string) => {
      const label = anchor.textContent ?? ''
      if (!label) return

      const from = editor.view.posAtDOM(anchor, 0)
      const to = from + label.length
      document.dispatchEvent(new CustomEvent('tiptap-link-edit', {
        detail: { editor, from, to, label, href },
      }))
    }

    const openLink = async (href: string) => {
      if (href.startsWith('#')) return

      const protocol = getLinkProtocol(href)

      if (protocol === 'file') {
        const filePath = normalizeLocalFilePath(getFilePathFromFileUrl(href))

        if (!filePath) return

        if (isInternalFilePath(filePath)) {
          await openFileInApp(filePath)
          return
        }

        await openLocalPathWithDefaultApp(filePath)
        return
      }

      if (protocol) {
        await openUrl(href)
        return
      }

      const localPath = resolveLocalLinkPath(href, useArticleStore.getState().activeFilePath)

      if (!localPath) return

      if (isInternalFilePath(localPath)) {
        await openFileInApp(localPath)
        return
      }

      await openLocalPathWithDefaultApp(localPath)
    }

    let modifiedPointerHandled = false

    const handleModifiedMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return

      const href = (event.target as HTMLElement).closest<HTMLAnchorElement>('a')?.getAttribute('href')?.trim()
      if (!href || href.startsWith('#')) return

      event.preventDefault()
      event.stopPropagation()
      modifiedPointerHandled = true
      void openLink(href).catch(() => {})
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const modifiedClick = event.metaKey || event.ctrlKey

      if (modifiedClick) {
        const href = target.closest<HTMLAnchorElement>('a')?.getAttribute('href')?.trim()
        if (!href || href.startsWith('#')) return

        event.preventDefault()
        event.stopPropagation()

        if (!modifiedPointerHandled) {
          void openLink(href).catch(() => {})
        }
        modifiedPointerHandled = false
        return
      }

      const anchor = target.closest<HTMLAnchorElement>('a')
      const href = anchor?.getAttribute('href')?.trim()
      if (!anchor || !href) return

      if (isMobile && href.startsWith('#')) return

      event.preventDefault()
      event.stopPropagation()

      if (isMobile) {
        void openLink(href).catch(() => {})
      } else {
        editLink(anchor, href)
      }
    }

    const handleCurrentLinkOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ editor?: unknown; href?: unknown }>).detail
      if (!detail || detail.editor !== editor) return
      const href = detail.href
      if (typeof href !== 'string' || !href.trim()) return
      void openLink(href.trim()).catch(() => {})
    }

    editorElement.addEventListener('mousedown', handleModifiedMouseDown, true)
    editorElement.addEventListener('click', handleClick)
    document.addEventListener('tiptap-current-link-open', handleCurrentLinkOpen)

    return () => {
      editorElement.removeEventListener('mousedown', handleModifiedMouseDown, true)
      editorElement.removeEventListener('click', handleClick)
      document.removeEventListener('tiptap-current-link-open', handleCurrentLinkOpen)
    }
  }, [editor, isMobile, isSectionVirtualView])

  const restoreMobileContextSelection = useCallback((context: MobileSelectionContext = mobileContext) => {
    if (!editor || !context) {
      return false
    }

    const docSize = editor.state.doc.content.size
    if (isMobileSelectionContextStale(context, docSize)) {
      setMobileContext(null)
      setMobileSheetMode(null)
      return false
    }

    if (context.mode === 'text') {
      editor.chain().focus().setTextSelection({ from: context.from, to: context.to }).run()
      return true
    }

    if (context.mode === 'image') {
      editor.chain().focus().setNodeSelection(context.pos).run()
      return true
    }

    editor.chain().focus().setTextSelection(context.from).run()
    return true
  }, [editor, mobileContext])

  const updateMobileContext = useCallback(() => {
    if (!editor || !isMobile) {
      setMobileContext(null)
      return
    }

    const { from, to } = editor.state.selection
    const selectedNode = editor.state.doc.nodeAt(from)

    if (selectedNode?.type.name === 'image') {
      const nextContext = buildMobileSelectionContext({
        mode: 'image',
        pos: from,
        src: selectedNode.attrs.relativeSrc || selectedNode.attrs.src || '',
        alt: selectedNode.attrs.alt || '',
      }) as MobileSelectionContext
      setImageSrcDraft(selectedNode.attrs.relativeSrc || selectedNode.attrs.src || '')
      setImageAltDraft(selectedNode.attrs.alt || '')
      setMobileContext(nextContext)
      return
    }

    const previewText = editor.state.doc.textBetween(from, to).trim()
    if (from !== to && previewText) {
      const nextContext = buildMobileSelectionContext({
        mode: 'text',
        from,
        to,
        previewText,
      }) as MobileSelectionContext
      setMobileContext(nextContext)
      return
    }

    if (editor.isActive('table')) {
      const nextContext = buildMobileSelectionContext({
        mode: 'table',
        from,
      }) as MobileSelectionContext
      setMobileContext(nextContext)
      return
    }

    setMobileContext(null)
    setMobileSheetMode(null)
  }, [editor, isMobile])

  const runMobileWritingAction = useCallback((action: string) => {
    if (!editor) return

    const closeSheet = () => setMobileSheetMode(null)
    const openSheet = (mode: Exclude<MobileSheetMode, null>) => {
      window.setTimeout(() => {
        setMobileSheetMode(mode)
      }, 0)
    }
    const runCommand = (command: () => boolean) => {
      command()
      closeSheet()
      updateMobileContext()
    }

    switch (action) {
      case 'open-insert':
        openSheet('insert')
        return
      case 'open-ai-write':
        openSheet('ai-write')
        return
      case 'open-ai-custom':
        openSheet('ai-custom')
        return
      case 'open-mobile-more':
        openSheet('mobile-more')
        return
      case 'open-format-sheet':
        openSheet('format')
        return
      case 'undo':
        runCommand(() => editor.chain().focus().undo().run())
        return
      case 'redo':
        runCommand(() => editor.chain().focus().redo().run())
        return
      case 'toggle-heading-2':
      case 'insert-heading-2':
      case 'format-heading-2':
        runCommand(() => editor.chain().focus().toggleHeading({ level: 2 }).run())
        return
      case 'format-heading-1':
        runCommand(() => editor.chain().focus().toggleHeading({ level: 1 }).run())
        return
      case 'format-heading-3':
        runCommand(() => editor.chain().focus().toggleHeading({ level: 3 }).run())
        return
      case 'format-paragraph':
        runCommand(() => editor.chain().focus().setParagraph().run())
        return
      case 'toggle-task-list':
      case 'insert-task-list':
        runCommand(() => editor.chain().focus().toggleTaskList().run())
        return
      case 'toggle-blockquote':
      case 'insert-blockquote':
        runCommand(() => editor.chain().focus().toggleBlockquote().run())
        return
      case 'insert-bullet-list':
        runCommand(() => editor.chain().focus().toggleBulletList().run())
        return
      case 'insert-ordered-list':
        runCommand(() => editor.chain().focus().toggleOrderedList().run())
        return
      case 'insert-code-block':
        runCommand(() => editor.chain().focus().toggleCodeBlock().run())
        return
      case 'insert-horizontal-rule':
        runCommand(() => editor.chain().focus().setHorizontalRule().run())
        return
      case 'insert-table':
        runCommand(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())
        return
      case 'insert-image':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-image'))
        return
      case 'format-bold':
        runCommand(() => editor.chain().focus().toggleBold().run())
        return
      case 'format-italic':
        runCommand(() => editor.chain().focus().toggleItalic().run())
        return
      case 'format-highlight':
        runCommand(() => editor.chain().focus().toggleHighlight().run())
        return
      case 'ai-continue':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-ai-continue', { detail: { suppressKeyboard: true } }))
        return
      case 'ai-generate-section':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-ai-generate', { detail: { action: 'section', suppressKeyboard: true } }))
        return
      case 'ai-generate-summary':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-ai-generate', { detail: { action: 'summary', suppressKeyboard: true } }))
        return
      case 'ai-generate-custom':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-ai-generate', {
          detail: { action: 'custom', instruction: customAiInstruction, suppressKeyboard: true },
        }))
        return
      case 'open-search-replace':
        closeSheet()
        openSearchReplace()
        return
      case 'toggle-outline':
        closeSheet()
        setMobileOutlineOpen((prev) => !prev)
        return
      case 'insert-inline-math':
        closeSheet()
        setMathType('inline')
        setMathDialogOpen(true)
        return
      case 'insert-block-math':
        closeSheet()
        setMathType('block')
        setMathDialogOpen(true)
        return
      case 'insert-mermaid':
      case 'insert-mermaid-flowchart':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'flowchart' } }))
        return
      case 'insert-mermaid-sequence':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'sequence' } }))
        return
      case 'insert-mermaid-gantt':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'gantt' } }))
        return
      case 'insert-mermaid-class':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'classDiagram' } }))
        return
      case 'insert-mermaid-state':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'stateDiagram' } }))
        return
      case 'insert-mermaid-pie':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'pie' } }))
        return
      case 'insert-mermaid-er':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'er' } }))
        return
      case 'insert-mermaid-journey':
        closeSheet()
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'journey' } }))
        return
      default:
        return
    }
  }, [
    customAiInstruction,
    editor,
    openSearchReplace,
    updateMobileContext,
  ])

  const submitMobileCustomAiInstruction = useCallback(() => {
    runMobileWritingAction('ai-generate-custom')
  }, [runMobileWritingAction])

  const mobileWritingActiveActions = useMemo(() => {
    if (!editor) {
      return []
    }

    const actions: string[] = []
    if (editor.isActive('heading', { level: 2 })) actions.push('toggle-heading-2')
    if (editor.isActive('taskList')) actions.push('toggle-task-list')
    if (editor.isActive('blockquote')) actions.push('toggle-blockquote')
    if (editor.isActive('bulletList')) actions.push('insert-bullet-list')
    if (editor.isActive('orderedList')) actions.push('insert-ordered-list')
    if (editor.isActive('codeBlock')) actions.push('insert-code-block')
    return actions
  }, [editor, mobileContext, mobileSheetMode])

  const runMobileEditorAction = useCallback((action: string) => {
    if (!editor) return

    if (!mobileContext) {
      switch (action) {
        case 'ai':
          setMobileSheetMode('ai-write')
          return
        case 'bold':
          runMobileWritingAction('format-bold')
          return
        case 'highlight':
          runMobileWritingAction('format-highlight')
          return
        case 'italic':
          runMobileWritingAction('format-italic')
          return
        case 'underline':
          editor.chain().focus().toggleUnderline().run()
          return
        case 'strike':
          editor.chain().focus().toggleStrike().run()
          return
        case 'code':
          editor.chain().focus().toggleCode().run()
          return
        case 'blockquote':
          editor.chain().focus().toggleBlockquote().run()
          return
        case 'bulletList':
          editor.chain().focus().toggleBulletList().run()
          return
        case 'orderedList':
          editor.chain().focus().toggleOrderedList().run()
          return
        case 'taskList':
          editor.chain().focus().toggleTaskList().run()
          return
        case 'codeBlock':
          editor.chain().focus().toggleCodeBlock().run()
          return
        default:
          runMobileWritingAction(action)
      }
      return
    }

    switch (action) {
      case 'bold':
        if (restoreMobileContextSelection()) {
          editor.chain().focus().toggleBold().run()
        }
        return
      case 'highlight':
        if (restoreMobileContextSelection()) {
          editor.chain().focus().toggleHighlight().run()
        }
        return
      case 'ai':
        setMobileSheetMode('ai')
        return
      case 'more':
        setMobileSheetMode('table-more')
        return
      case 'image-src':
        setMobileSheetMode('image-src')
        return
      case 'image-alt':
        setMobileSheetMode('image-alt')
        return
      case 'delete-image':
        if (restoreMobileContextSelection(mobileContext) && mobileContext.mode === 'image') {
          editor.chain().focus().deleteRange({ from: mobileContext.pos, to: mobileContext.pos + 1 }).run()
          updateMobileContext()
        }
        return
      case 'add-row':
        if (restoreMobileContextSelection()) {
          editor.chain().focus().addRowAfter().run()
          updateMobileContext()
        }
        return
      case 'add-column':
        if (restoreMobileContextSelection()) {
          editor.chain().focus().addColumnAfter().run()
          updateMobileContext()
        }
        return
      case 'align':
        setMobileSheetMode('table-align')
        return
      case 'ai-polish':
        if (restoreMobileContextSelection()) {
          setMobileSheetMode(null)
          void aiActionHandlersRef.current.polish()
        }
        return
      case 'ai-concise':
        if (restoreMobileContextSelection()) {
          setMobileSheetMode(null)
          void aiActionHandlersRef.current.concise()
        }
        return
      case 'ai-expand':
        if (restoreMobileContextSelection()) {
          setMobileSheetMode(null)
          void aiActionHandlersRef.current.expand()
        }
        return
      case 'italic':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleItalic().run()
        return
      case 'underline':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleUnderline().run()
        return
      case 'strike':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleStrike().run()
        return
      case 'code':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleCode().run()
        return
      case 'blockquote':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleBlockquote().run()
        return
      case 'bulletList':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleBulletList().run()
        return
      case 'orderedList':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleOrderedList().run()
        return
      case 'taskList':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleTaskList().run()
        return
      case 'codeBlock':
        if (restoreMobileContextSelection()) editor.chain().focus().toggleCodeBlock().run()
        return
      case 'align-left':
        if (restoreMobileContextSelection()) editor.chain().focus().setCellAttribute('align', 'left').run()
        return
      case 'align-center':
        if (restoreMobileContextSelection()) editor.chain().focus().setCellAttribute('align', 'center').run()
        return
      case 'align-right':
        if (restoreMobileContextSelection()) editor.chain().focus().setCellAttribute('align', 'right').run()
        return
      case 'add-row-before':
        if (restoreMobileContextSelection()) editor.chain().focus().addRowBefore().run()
        return
      case 'add-row-after':
        if (restoreMobileContextSelection()) editor.chain().focus().addRowAfter().run()
        return
      case 'add-column-before':
        if (restoreMobileContextSelection()) editor.chain().focus().addColumnBefore().run()
        return
      case 'add-column-after':
        if (restoreMobileContextSelection()) editor.chain().focus().addColumnAfter().run()
        return
      case 'delete-row':
        if (restoreMobileContextSelection()) editor.chain().focus().deleteRow().run()
        return
      case 'delete-column':
        if (restoreMobileContextSelection()) editor.chain().focus().deleteColumn().run()
        return
      case 'delete-table':
        if (restoreMobileContextSelection()) editor.chain().focus().deleteTable().run()
        return
      default:
        runMobileWritingAction(action)
        return
    }
  }, [
    editor,
    mobileContext,
    runMobileWritingAction,
    restoreMobileContextSelection,
    updateMobileContext,
  ])

  const submitMobileImageSrc = useCallback(() => {
    if (!editor || !mobileContext || mobileContext.mode !== 'image') return
    if (!restoreMobileContextSelection(mobileContext)) return

    editor.chain().focus().updateAttributes('image', {
      src: imageSrcDraft.trim(),
      relativeSrc: imageSrcDraft.trim(),
    }).run()
    setMobileSheetMode(null)
    updateMobileContext()
  }, [editor, imageSrcDraft, mobileContext, restoreMobileContextSelection, updateMobileContext])

  const submitMobileImageAlt = useCallback(() => {
    if (!editor || !mobileContext || mobileContext.mode !== 'image') return
    if (!restoreMobileContextSelection(mobileContext)) return

    editor.chain().focus().updateAttributes('image', {
      alt: imageAltDraft.trim(),
    }).run()
    setMobileSheetMode(null)
    updateMobileContext()
  }, [editor, imageAltDraft, mobileContext, restoreMobileContextSelection, updateMobileContext])

  useEffect(() => {
    if (!editor || !isMobile) return

    updateMobileContext()
    editor.on('selectionUpdate', updateMobileContext)
    editor.on('transaction', updateMobileContext)

    return () => {
      editor.off('selectionUpdate', updateMobileContext)
      editor.off('transaction', updateMobileContext)
    }
  }, [editor, isMobile, updateMobileContext])

  useEffect(() => {
    if (!editor || isSectionScope || usesCanonicalMarkdown) return

    const quoteMarkType = editor.state.schema.marks.quote
    if (!quoteMarkType) return

    let tr = editor.state.tr
    let changed = false

    editor.state.doc.descendants((node, pos) => {
      if (!node.isText) return true
      if (node.marks.some((mark) => mark.type === quoteMarkType)) {
        tr = tr.removeMark(pos, pos + node.nodeSize, quoteMarkType)
        changed = true
      }
      return true
    })

    const quoteToRestore = pendingQuote
    if (quoteToRestore && shouldRestorePendingQuote(quoteToRestore, activeFilePath, editor.state.doc.content.size)) {
      tr = tr.addMark(quoteToRestore.from, quoteToRestore.to, quoteMarkType.create())
      changed = true
    }

    if (changed) {
      editor.view.dispatch(tr)
    }
  }, [editor, pendingQuote, activeFilePath, isSectionScope, usesCanonicalMarkdown])

  useEffect(() => {
    if (!editor || !isMobile) return

    const editorDom = editor.view.dom
    const handleMobileImageClick = (event: Event) => {
      const target = event.target as HTMLElement | null
      if (!target || target.tagName !== 'IMG') return

      const pos = editor.view.posAtDOM(target, 0)
      editor.chain().focus().setNodeSelection(pos).run()
      updateMobileContext()
    }

    editorDom.addEventListener('click', handleMobileImageClick)
    return () => {
      editorDom.removeEventListener('click', handleMobileImageClick)
    }
  }, [editor, isMobile, updateMobileContext])

  // Auto scroll to bottom when content changes and autoScroll is enabled
  useEffect(() => {
    if (!editor) return

    // Use requestAnimationFrame to avoid infinite loop
    let isScrolling = false

    const scrollToBottom = () => {
      if (!autoScrollRef.current || isScrolling) return
      isScrolling = true

      requestAnimationFrame(() => {
        try {
          if (editorContainerRef.current) {
            const proseMirror = editorContainerRef.current.querySelector('.ProseMirror') as HTMLElement
            if (proseMirror) {
              proseMirror.scrollTop = proseMirror.scrollHeight
            }
          }
        } finally {
          isScrolling = false
        }
      })
    }

    // Listen to editor updates
    editor.on('update', scrollToBottom)

    return () => {
      editor.off('update', scrollToBottom)
    }
  }, [editor])

  // 应用正文文字大小缩放
  useEffect(() => {
    if (!editor) return

    const applyFontSize = () => {
      if (editorContainerRef.current) {
        const proseMirror = editorContainerRef.current.querySelector('.ProseMirror') as HTMLElement
        if (proseMirror) {
          // 使用 16px 作为基础字体大小，根据 contentTextScale 进行缩放
          const baseFontSize = 16
          proseMirror.style.fontSize = `${(baseFontSize * contentTextScale) / 100}px`
        }
      }
    }

    // 立即应用一次
    applyFontSize()
  }, [contentTextScale, editor])

  // Handle image paste and file drop
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handlePaste = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData
      if (!clipboardData) return

      // Spreadsheet apps commonly attach a bitmap preview alongside the HTML table.
      // Prefer the editable table instead of treating that preview as an image paste.
      if (/<table(?:\s|>)/i.test(clipboardData.getData('text/html'))) return

      const files = clipboardData.files
      if (files.length === 0) return

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const imageFile = imageFiles[0]

      // Prevent default to avoid base64 image being inserted
      event.preventDefault()
      const endBlockingActivity = beginBlockingActivity()

      // Insert "Uploading..." text as placeholder
      const { from } = editor.state.selection

      editor.chain()
        .focus()
        .insertContentAt(from, {
          type: 'text',
          text: 'Uploading... ',
        })
        .run()

      // Get the position range of the placeholder
      const placeholderStart = from
      const placeholderEnd = from + 'Uploading... '.length

      handleImageUpload(imageFile, activeFilePathRef.current)
        .then(result => {
          if (editor.isDestroyed) return
          // Delete the placeholder text
          editor.chain()
            .focus()
            .deleteRange({ from: placeholderStart, to: placeholderEnd })
            .run()

          // Insert the actual image
          editor.chain()
            .insertContentAt(placeholderStart, {
              type: 'image',
              attrs: {
                src: result.src,
                alt: imageFile.name,
                relativeSrc: result.relativePath,
              },
            })
            .run()
        })
        .catch(error => {
          if (editor.isDestroyed) return
          // Remove the placeholder on error
          editor.chain()
            .focus()
            .deleteRange({ from: placeholderStart, to: placeholderEnd })
            .run()

          toast({
            title: tImage('failed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'destructive',
          })
        })
        .finally(endBlockingActivity)
    }

    const handleDrop = (event: DragEvent) => {
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) return

      const hasCanvas = hasCanvasDragData(dataTransfer)
      const hasDroppedFiles =
        hasCanvas ||
        hasFileManagerDragData(dataTransfer) ||
        dataTransfer.files.length > 0 ||
        getFileUrlsFromDataTransfer(dataTransfer).length > 0
      if (!hasDroppedFiles) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      clearEditorNativeDropCursor(editor)

      const droppedFiles = Array.from(dataTransfer.files || [])
      const droppedImageFiles = droppedFiles.filter(file =>
        file.type.startsWith('image/') || INTERNAL_IMAGE_FILE_PATH_RE.test(file.name)
      )
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      const insertPos = pos?.pos || editor.state.selection.from

      if (hasCanvas) {
        setIsCanvasDragOver(false)
        setIsCanvasDropPending(true)
      }
      const endBlockingActivity = beginBlockingActivity()

      void (async () => {
        if (hasCanvas) {
          const canvasId = getCanvasDragId(dataTransfer)
          const project = canvasId ? await getCanvasProject(canvasId) : null
          const activeFilePath = activeFilePathRef.current
          if (!project || !activeFilePath) throw new Error('无法读取画布或当前 Markdown 文件')
          const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'NoteGen-Canvas'
          const imageFile = await canvasDocumentToPngFile(project.document, `${safeTitle}.png`)
          const result = await saveImageToWorkspace(imageFile, activeFilePath)
          editor.chain()
            .focus()
            .insertContentAt(insertPos, {
              type: 'image',
              attrs: {
                src: result.src,
                alt: project.title,
                relativeSrc: result.relativePath,
              },
            })
            .run()
          toast({
            title: t('canvasDrop.success'),
            description: t('canvasDrop.successDescription', { path: result.relativePath }),
          })
          return
        }

        if (droppedImageFiles.length > 0 && droppedImageFiles.length === droppedFiles.length) {
          const uploadedImages = await Promise.all(
            droppedImageFiles.map(async file => ({
              file,
              result: await handleImageUpload(file, activeFilePathRef.current),
            }))
          )

          editor.chain()
            .focus()
            .insertContentAt(
              insertPos,
              uploadedImages.map(({ file, result }) => ({
                type: 'image',
                attrs: {
                  src: result.src,
                  alt: file.name,
                  relativeSrc: result.relativePath,
                },
              }))
            )
            .run()
          return
        }

        const links = await getDroppedFileMarkdownLinks(dataTransfer, activeFilePathRef.current)
        const droppedFileNames = droppedFiles
          .map(file => file.name.trim())
          .filter(Boolean)

        if (links.length === 0) {
          if (droppedFileNames.length > 0) {
            editor.chain()
              .focus()
              .insertContentAt(
                insertPos,
                droppedFileNames.map(escapeMarkdownText).join('\n'),
                { contentType: 'markdown' }
              )
              .run()
            return
          }

          toast({
            title: '无法获取文件路径',
            description: '当前拖拽来源没有提供真实文件路径，无法生成可打开的链接。',
            variant: 'destructive',
          })
          return
        }

        const markdown = links.join('\n')

        editor.chain()
          .focus()
          .insertContentAt(insertPos, markdown, { contentType: 'markdown' })
          .run()
      })().catch(error => {
        toast({
          title: hasCanvas
            ? t('canvasDrop.failed')
            : droppedImageFiles.length > 0
              ? tImage('failed')
              : '插入文件链接失败',
          description: error instanceof Error ? error.message : undefined,
          variant: 'destructive',
        })
      }).finally(() => {
        if (hasCanvas) setIsCanvasDropPending(false)
        endBlockingActivity()
      })
    }

    // Add event listeners to editor DOM element
    // Check if editor is fully initialized first
    if (!editor.view || !editor.view.dom) return
    const dom = editor.view.dom
    dom.addEventListener('paste', handlePaste as EventListener)
    dom.addEventListener('drop', handleDrop as EventListener, true)

    return () => {
      dom.removeEventListener('paste', handlePaste as EventListener)
      dom.removeEventListener('drop', handleDrop as EventListener, true)
    }
  }, [beginBlockingActivity, editor, t, tImage])

  // Handle copy event to output Markdown format
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handleCopy = (event: ClipboardEvent) => {
      const { selection } = editor.state
      const { from, to } = selection

      // If there's no selection, let browser handle the default copy
      if (from === to) {
        return
      }

      // Check if markdown extension is available
      if (!editor.markdown) {
        return
      }

      // Preserve Markdown for mixed selections, but expose inline code itself when copied alone.
      const slice = editor.state.doc.slice(from, to)
      const selectionJson = slice.content.toJSON()
      const clipboardText = isInlineCodeOnlySelection(selection, slice)
        ? slice.content.textBetween(0, slice.content.size, '\n')
        // A same-block slice already contains inline nodes. Wrapping them in a doc
        // makes the Markdown renderer join every text node as a separate block.
        : selection.$from.sameParent(selection.$to)
          ? editor.markdown.renderNodes(selectionJson)
          : editor.markdown.serialize({
              type: 'doc',
              content: selectionJson,
            })

      // Write Markdown to clipboard
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', clipboardText)
        event.preventDefault()
      }
    }

    const dom = editor.view.dom
    dom.addEventListener('copy', handleCopy as EventListener)

    return () => {
      dom.removeEventListener('copy', handleCopy as EventListener)
    }
  }, [editor])

  // Handle AI Polish - improve selected text (with streaming and suggestion mode)
  const handleAIPolish = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }
    const endBlockingActivity = beginBlockingActivity()

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'polish',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiPolishStream(
        selectedText,
        (chunk) => {
          if (controller.signal.aborted || editor.isDestroyed) return
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal,
        (thinkingText) => {
          emitter.emit('update-ai-thinking-content', {
            thinkingText,
            position: initialCoords,
          })
        },
      )

      if (controller.signal.aborted || editor.isDestroyed) return

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .run()

      const docSizeBeforeInsert = editor.state.doc.content.size
      editor.chain()
        .insertContentAt(startPosition, accumulatedResult, { contentType: 'markdown' })
        .run()
      const generatedRange = getInsertedContentRange(editor, startPosition, docSizeBeforeInsert)

      // Send completion event
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'polish',
        position: getEditorPositionRect(editor, generatedRange.to),
        generatedRange,
      })
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    } finally {
      endBlockingActivity()
    }
  }, [beginBlockingActivity, editor])

  // Handle AI Concise - simplify selected text (with streaming and suggestion mode)
  const handleAIConcise = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }
    const endBlockingActivity = beginBlockingActivity()

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'concise',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiConciseStream(
        selectedText,
        (chunk) => {
          if (controller.signal.aborted || editor.isDestroyed) return
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal,
        (thinkingText) => {
          emitter.emit('update-ai-thinking-content', {
            thinkingText,
            position: initialCoords,
          })
        },
      )

      if (controller.signal.aborted || editor.isDestroyed) return

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .run()

      const docSizeBeforeInsert = editor.state.doc.content.size
      editor.chain()
        .insertContentAt(startPosition, accumulatedResult, { contentType: 'markdown' })
        .run()
      const generatedRange = getInsertedContentRange(editor, startPosition, docSizeBeforeInsert)

      // Send completion event
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'concise',
        position: getEditorPositionRect(editor, generatedRange.to),
        generatedRange,
      })
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    } finally {
      endBlockingActivity()
    }
  }, [beginBlockingActivity, editor])

  // Handle AI Expand - expand selected text (with streaming and suggestion mode)
  const handleAIExpand = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }
    const endBlockingActivity = beginBlockingActivity()

    // Create abort controller for this request
    const controller = new AbortController()

    // Delete original text and start streaming
    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    // Get initial position and start streaming immediately
    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'expand',
      position: initialCoords,
      controller,
    })

    // Track accumulated result
    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiExpandStream(
        selectedText,
        (chunk) => {
          if (controller.signal.aborted || editor.isDestroyed) return
          // Insert chunk as plain text during streaming
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          // Update tracking
          accumulatedResult += chunk

          // Update floating menu with streaming content and position
          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal,
        (thinkingText) => {
          emitter.emit('update-ai-thinking-content', {
            thinkingText,
            position: initialCoords,
          })
        },
      )

      if (controller.signal.aborted || editor.isDestroyed) return

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .run()

      const docSizeBeforeInsert = editor.state.doc.content.size
      editor.chain()
        .insertContentAt(startPosition, accumulatedResult, { contentType: 'markdown' })
        .run()
      const generatedRange = getInsertedContentRange(editor, startPosition, docSizeBeforeInsert)

      // Send completion event
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'expand',
        position: getEditorPositionRect(editor, generatedRange.to),
        generatedRange,
      })
      emitter.emit('onboarding-step-complete', { step: 'ai-polish' })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      // Restore original text on error
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    } finally {
      endBlockingActivity()
    }
  }, [beginBlockingActivity, editor])

  const handleAITranslate = useCallback(async (targetLanguage: string) => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }
    const endBlockingActivity = beginBlockingActivity()

    const controller = new AbortController()

    editor.chain()
      .focus()
      .deleteSelection()
      .run()

    const initialCoords = editor.view.coordsAtPos(editor.state.selection.from)
    emitter.emit('start-ai-streaming', {
      originalText: selectedText,
      type: 'translate',
      position: initialCoords,
      controller,
    })

    let accumulatedResult = ''
    const startPosition = editor.state.selection.from

    try {
      await fetchAiTranslateStream(
        selectedText,
        targetLanguage,
        (chunk) => {
          if (controller.signal.aborted || editor.isDestroyed) return
          editor.chain()
            .insertContentAt(startPosition + accumulatedResult.length, chunk)
            .run()

          accumulatedResult += chunk

          const coords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
          emitter.emit('update-ai-streaming-content', {
            suggestedText: accumulatedResult,
            position: coords,
          })
        },
        controller.signal,
        (thinkingText) => {
          emitter.emit('update-ai-thinking-content', {
            thinkingText,
            position: initialCoords,
          })
        },
      )

      if (controller.signal.aborted || editor.isDestroyed) return

      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .run()

      const docSizeBeforeInsert = editor.state.doc.content.size
      editor.chain()
        .insertContentAt(startPosition, accumulatedResult, { contentType: 'markdown' })
        .run()
      const generatedRange = getInsertedContentRange(editor, startPosition, docSizeBeforeInsert)

      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'translate',
        position: getEditorPositionRect(editor, generatedRange.to),
        generatedRange,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      editor.chain()
        .focus()
        .insertContent(selectedText)
        .run()
      emitter.emit('ai-streaming-complete')
    } finally {
      endBlockingActivity()
    }
  }, [beginBlockingActivity, editor])

  useEffect(() => {
    aiActionHandlersRef.current = {
      polish: handleAIPolish,
      concise: handleAIConcise,
      expand: handleAIExpand,
      translate: handleAITranslate,
    }
  }, [handleAIPolish, handleAIConcise, handleAIExpand, handleAITranslate])

  const insertImageAtSelection = useCallback(async () => {
    if (!editor) return
    const endBlockingActivity = beginBlockingActivity()

    const insertPos = editor.state.selection.from
    const placeholder = 'Uploading... '

    editor.chain()
      .focus()
      .insertContentAt(insertPos, {
        type: 'text',
        text: placeholder,
      })
      .run()

    const placeholderEnd = insertPos + placeholder.length

    try {
      let fileObject: File | null = null

      if (isMobile) {
        fileObject = (await pickImagesFromPhotoLibrary())[0] || null
      } else {
        const file = await open({
          multiple: false,
          filters: [
            {
              name: 'Images',
              extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
            },
          ],
        })

        if (typeof file === 'string') {
          const fileData = await readFile(file)
          const ext = file.split('.').pop() || 'png'
          const fileName = file.split('/').pop() || `image.${ext}`
          const arrayBuffer = new Uint8Array(fileData).buffer
          fileObject = new File([arrayBuffer], fileName, { type: `image/${ext}` })
        }
      }

      if (!fileObject) {
        editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
        return
      }

      const result = await handleImageUpload(fileObject, activeFilePath)

      editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
      editor.chain().focus().insertContentAt(insertPos, {
        type: 'image',
        attrs: {
          src: result.src,
          alt: fileObject.name,
          relativeSrc: result.relativePath,
        },
      }).run()
    } catch (error) {
      editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
      toast({
        title: tImage('failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      })
    } finally {
      endBlockingActivity()
    }
  }, [activeFilePath, beginBlockingActivity, editor, isMobile, tImage])

  useEffect(() => {
    if (isSectionVirtualView || !isActive) return

    const handleInsertImage = () => {
      void insertImageAtSelection()
    }

    document.addEventListener('tiptap-insert-image', handleInsertImage)
    return () => {
      document.removeEventListener('tiptap-insert-image', handleInsertImage)
    }
  }, [insertImageAtSelection, isActive, isSectionVirtualView])

  useEffect(() => {
    editorShortcutHandlersRef.current = {
      undo: (targetEditor) => targetEditor.chain().focus().undo().run(),
      redo: (targetEditor) => targetEditor.chain().focus().redo().run(),
      setParagraph: (targetEditor) => targetEditor.chain().focus().setParagraph().run(),
      toggleHeading1: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 1 }).run(),
      toggleHeading2: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 2 }).run(),
      toggleHeading3: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 3 }).run(),
      toggleHeading4: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 4 }).run(),
      toggleHeading5: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 5 }).run(),
      toggleHeading6: (targetEditor) => targetEditor.chain().focus().toggleHeading({ level: 6 }).run(),
      openSearch: () => {
        openSearchReplace()
        return true
      },
      openSlashCommand: (targetEditor) => targetEditor.commands.triggerSlashCommand(),
      toggleOutline: () => {
        if (isMobile) {
          setMobileOutlineOpen((prev) => !prev)
        } else {
          onToggleOutline?.()
        }
        return true
      },
      toggleBold: (targetEditor) => targetEditor.chain().focus().toggleBold().run(),
      toggleItalic: (targetEditor) => targetEditor.chain().focus().toggleItalic().run(),
      toggleStrike: (targetEditor) => targetEditor.chain().focus().toggleStrike().run(),
      toggleUnderline: (targetEditor) => targetEditor.chain().focus().toggleUnderline().run(),
      toggleInlineCode: (targetEditor) => targetEditor.chain().focus().toggleCode().run(),
      toggleHighlight: (targetEditor) => targetEditor.chain().focus().toggleHighlight().run(),
      openLinkInput: () => {
        setOpenLinkInputSignal((value) => value + 1)
        return true
      },
      toggleBlockquote: (targetEditor) => targetEditor.chain().focus().toggleBlockquote().run(),
      toggleBulletList: (targetEditor) => targetEditor.chain().focus().toggleBulletList().run(),
      toggleOrderedList: (targetEditor) => targetEditor.chain().focus().toggleOrderedList().run(),
      toggleTaskList: (targetEditor) => targetEditor.chain().focus().toggleTaskList().run(),
      toggleCodeBlock: (targetEditor) => targetEditor.chain().focus().toggleCodeBlock().run(),
      openAiMenu: () => {
        setOpenAiMenuSignal((value) => value + 1)
        return true
      },
      aiContinue: () => {
        document.dispatchEvent(new CustomEvent('tiptap-ai-continue'))
        return true
      },
      aiPolish: () => {
        void aiActionHandlersRef.current.polish()
        return true
      },
      aiConcise: () => {
        void aiActionHandlersRef.current.concise()
        return true
      },
      aiExpand: () => {
        void aiActionHandlersRef.current.expand()
        return true
      },
      aiTranslate: () => {
        setOpenTranslateMenuSignal((value) => value + 1)
        return true
      },
      acceptAiSuggestion: () => {
        if (!isAiSuggestionShortcutVisible()) {
          return false
        }
        emitter.emit('accept-ai-suggestion')
        return true
      },
      rejectAiSuggestion: () => {
        if (!isAiSuggestionShortcutVisible()) {
          return false
        }
        emitter.emit('reject-ai-suggestion')
        return true
      },
      abortAiGeneration: () => {
        if (onTerminate) {
          onTerminate()
        } else {
          emitter.emit('abort-ai-streaming')
        }
        return true
      },
      insertTable: (targetEditor) => targetEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      addColumnBefore: (targetEditor) => targetEditor.chain().focus().addColumnBefore().run(),
      addColumnAfter: (targetEditor) => targetEditor.chain().focus().addColumnAfter().run(),
      addRowBefore: (targetEditor) => targetEditor.chain().focus().addRowBefore().run(),
      addRowAfter: (targetEditor) => targetEditor.chain().focus().addRowAfter().run(),
      deleteColumn: (targetEditor) => targetEditor.chain().focus().deleteColumn().run(),
      deleteRow: (targetEditor) => targetEditor.chain().focus().deleteRow().run(),
      deleteTable: (targetEditor) => targetEditor.chain().focus().deleteTable().run(),
      alignLeft: (targetEditor) => {
        if (targetEditor.isActive('table')) {
          return targetEditor.chain().focus().setCellAttribute('align', 'left').run()
        }
        return targetEditor.chain().focus().setTextAlign('left').run()
      },
      alignCenter: (targetEditor) => {
        if (targetEditor.isActive('table')) {
          return targetEditor.chain().focus().setCellAttribute('align', 'center').run()
        }
        return targetEditor.chain().focus().setTextAlign('center').run()
      },
      alignRight: (targetEditor) => {
        if (targetEditor.isActive('table')) {
          return targetEditor.chain().focus().setCellAttribute('align', 'right').run()
        }
        return targetEditor.chain().focus().setTextAlign('right').run()
      },
      insertImage: () => {
        void insertImageAtSelection()
        return true
      },
      insertInlineMath: () => {
        setMathType('inline')
        setMathDialogOpen(true)
        return true
      },
      insertBlockMath: () => {
        setMathType('block')
        setMathDialogOpen(true)
        return true
      },
      insertMermaid: () => {
        document.dispatchEvent(new CustomEvent('tiptap-insert-mermaid', { detail: { type: 'flowchart' } }))
        return true
      },
      insertHorizontalRule: (targetEditor) => targetEditor.chain().focus().setHorizontalRule().run(),
    }
  }, [
    insertImageAtSelection,
    isMobile,
    openSearchReplace,
    onTerminate,
    onToggleOutline,
  ])

  // Initialize content only once - preserves undo/redo history when switching tabs
  // Bug fix: Only initialize if the editor is for the current file path
  useEffect(() => {
    if (!editor || !activeFilePath) return

    // Check if this is still the correct file path (handle race conditions)
    const currentPath = activeFilePath

    // Only initialize on first mount - subsequent content changes should not overwrite
    // user edits (e.g., when switching back to a previously edited tab)
    // Bug fix: Also check that we're initializing for the correct file path
    if (!isInitializedRef.current) {
      // Use setTimeout to avoid flushSync conflict during React render
      setTimeout(() => {
        // Check if the file path is still the same (handle race condition)
        if (activeFilePath !== currentPath) return

        const nextContent = isLargeDocument
          ? sourceMarkdownRef.current
          : initialContent || ''
        sourceMarkdownRef.current = nextContent
        setSourceMarkdown(nextContent)
        if (isLargeDocument && !isSectionScope) {
          isInitializedRef.current = true
          isReadyRef.current = false
          setIsRestoringMobileView(false)
          onReady?.()
          return
        }

        const didLoadVisualContent = trySetMarkdownContent(editor, nextContent, { resetHistory: true })
        setIsPreparingLargeDocumentVisual(false)
        if (!didLoadVisualContent) return

        // Mark as initialized to allow subsequent content updates
        isInitializedRef.current = true
        // Bug fix: Mark editor as ready AFTER content is set
        // This prevents onUpdate from firing with empty content during init
        isReadyRef.current = true
        // Notify mobile editor that editor is ready
        onReady?.()
        // Notify parent component about editor instance
        onEditorReady?.(editor)
        if (isSectionScope) {
          // Section editors reuse the real document path for local assets, but
          // their selection and scroll positions are owned by the section host.
          setIsRestoringMobileView(false)
        } else {
          restoreEditorViewState(currentPath)
        }
      }, 0)
    }
  }, [
    activeFilePath,
    editor,
    initialContent,
    isLargeDocument,
    isSectionScope,
    onEditorReady,
    onReady,
    restoreEditorViewState,
    shouldDeferVisualParsing,
    trySetMarkdownContent,
    viewMode,
  ])

  // Listen to editor transactions and notify header/tab bar about undo/redo state
  useEffect(() => {
    if (!editor || !isActive || isSectionVirtualView) return

    let frameId: number | null = null

    const emitUndoRedoState = () => {
      emitEditorUndoRedoState(editor)
    }

    emitUndoRedoState()
    const handleTransaction = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }

      frameId = requestAnimationFrame(() => {
        emitUndoRedoState()
        frameId = null
      })
    }

    editor.on('transaction', handleTransaction)
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
      editor.off('transaction', handleTransaction)
    }
  }, [activeFilePath, editor, isActive, isSectionVirtualView])

  // Listen for search trigger from layout (Ctrl+F / Cmd+F)
  useEffect(() => {
    if (isSectionScope || !isActive) return

    const handleSearchTrigger = () => {
      if (isSectionVirtualView) {
        pendingSourceSearchRef.current = true
        handleToggleViewMode()
        return
      }

      if (isSourceView) {
        const sourceController = sourceEditorControllerRef.current
        if (sourceController) {
          sourceController.openSearch()
        } else {
          pendingSourceSearchRef.current = true
        }
        return
      }

      openSearchReplace()
    }

    emitter.on('editor-search-trigger' as any, handleSearchTrigger)
    return () => {
      emitter.off('editor-search-trigger' as any, handleSearchTrigger)
    }
  }, [handleToggleViewMode, isActive, isSectionScope, isSectionVirtualView, isSourceView, openSearchReplace])

  useEffect(() => {
    if (
      isSectionScope
      || !isActive
      || !activeFilePath
      || !pendingSearchKeyword.trim()
    ) {
      return
    }

    if (isSectionVirtualView) {
      handleToggleViewMode()
      return
    }

    if (isSourceView) {
      const sourceController = sourceEditorControllerRef.current
      if (sourceController) {
        sourceController.find(pendingSearchKeyword)
        setPendingSearchKeyword('')
      }
      return
    }

    if (!editor) return

    let cancelled = false
    let readyRetryTimer: ReturnType<typeof setTimeout> | null = null
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    let readyAttempts = 0
    const maxReadyAttempts = 20

    const applyPendingSearch = () => {
      if (cancelled) return

      if (!isInitializedRef.current || !isReadyRef.current) {
        if (readyAttempts >= maxReadyAttempts) {
          setPendingSearchKeyword('')
          return
        }
        readyAttempts += 1
        readyRetryTimer = setTimeout(applyPendingSearch, 50)
        return
      }

      const storage = (editor.storage as any).searchAndReplace
      if (!storage) {
        setPendingSearchKeyword('')
        return
      }

      storage.searchTerm = pendingSearchKeyword
      openSearchReplace()
      editor.view.dispatch(editor.state.tr)

      focusTimer = setTimeout(() => {
        if (cancelled) return

        const results = storage.results || []
        const resultIndex = getResultIndexToFocus(results, 0)

        if (resultIndex === -1) {
          setPendingSearchKeyword('')
          return
        }

        storage.resultIndex = resultIndex
        const result = results[resultIndex]
        if (!result) {
          setPendingSearchKeyword('')
          return
        }

        const selection = TextSelection.near(editor.state.doc.resolve(result.from))
        editor.view.dispatch(editor.state.tr.setSelection(selection))
        editor.commands.scrollIntoView()

        setTimeout(() => {
          const domPos = editor.view.domAtPos(result.from)
          if (domPos.node instanceof Element) {
            domPos.node.scrollIntoView({ behavior: 'smooth', block: 'center' })
          } else if (domPos.node.parentElement) {
            domPos.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }, 0)

        setPendingSearchKeyword('')
      }, 0)
    }

    applyPendingSearch()

    return () => {
      cancelled = true
      if (readyRetryTimer) clearTimeout(readyRetryTimer)
      if (focusTimer) clearTimeout(focusTimer)
    }
  }, [
    editor,
    activeFilePath,
    pendingSearchKeyword,
    setPendingSearchKeyword,
    initialContent,
    handleToggleViewMode,
    isActive,
    isSectionScope,
    isSectionVirtualView,
    isSourceView,
    openSearchReplace,
  ])

  // Handle remote file pull updates via event (instead of initialContent change).
  // All canonical update channels share a sequence so a delayed older event
  // can never overwrite a newer Agent or sync result.
  useEffect(() => {
    if (isSectionScope || !isActive) return
    let retryTimer: number | null = null

    const handleRemoteContentUpdate = (event: { content: string }) => {
      if (!editor || typeof event?.content !== 'string') return
      if (sourceMarkdownRef.current !== event.content) {
        markEditorPathMutation(activeFilePathRef.current)
      }
      const sequence = ++canonicalExternalUpdateSequenceRef.current
      const applyUpdate = () => {
        if (sequence !== canonicalExternalUpdateSequenceRef.current) return
        if (
          isSectionVirtualView
          && (
            sectionedEditorControllerRef.current?.isBusy()
            || !prepareExternalMarkdownAction()
          )
        ) {
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(applyUpdate, 100)
          return
        }
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer)
          retryTimer = null
        }

        const newContent = event.content
        const sourceChanged = sourceMarkdownRef.current !== newContent
        sourceMarkdownRef.current = newContent
        setSourceMarkdown(newContent)
        if (sourceChanged) contentVersionRef.current++
        const nextIsLargeDocument = classifyCanonicalMarkdown(newContent)
        if (nextIsLargeDocument) return
        if (usesCanonicalMarkdownRef.current) {
          if (sourceChanged && isSourceViewRef.current) setHasUnparsedSourceChanges(true)
          return
        }

        const currentContent = editor.getMarkdown()
        if (newContent !== currentContent) {
          isReadyRef.current = false
          externalUpdateCounterRef.current++
          try {
            if (sequence !== canonicalExternalUpdateSequenceRef.current) {
              return
            }
            trySetMarkdownContent(editor, newContent)
          } finally {
            isReadyRef.current = true
            externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
          }
        }
      }
      applyUpdate()
    }

    emitter.on('editor-content-from-remote', handleRemoteContentUpdate as any)
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      emitter.off('editor-content-from-remote', handleRemoteContentUpdate as any)
    }
  }, [
    editor,
    activeFilePath,
    classifyCanonicalMarkdown,
    isActive,
    isSectionScope,
    isSectionVirtualView,
    prepareExternalMarkdownAction,
    trySetMarkdownContent,
  ])

  // NOTE: Removed initialContent useEffect that caused cursor jump during local edits.
  useEffect(() => {
    if (isSectionScope) return
    let retryTimer: number | null = null
    let disposed = false
    let syncEventSequence = 0
    const currentWorkspaceRootPromise = getCurrentEditorWorkspaceRoot()
      .catch(() => null)

    const handleSyncContentUpdated = async (event: Events['sync-content-updated']) => {
      if (!event) return
      const eventSequence = ++syncEventSequence
      const sourceMarkdownBeforeRootCheck = sourceMarkdownRef.current
      if (event.workspaceRoot) {
        const currentWorkspaceRoot = await currentWorkspaceRootPromise
        if (
          disposed
          || eventSequence !== syncEventSequence
          || !currentWorkspaceRoot
          || !workspaceRootsReferToSameLocation(
            currentWorkspaceRoot,
            event.workspaceRoot,
          )
          || (
            sourceMarkdownRef.current !== sourceMarkdownBeforeRootCheck
            && sourceMarkdownRef.current !== event.content
          )
        ) {
          return
        }
      }
      if (
        !editor
        || !event
        || !editorPathsReferToSameFile(
          event.path,
          activeFilePath,
          event.workspaceRoot,
        )
      ) return
      if (sourceMarkdownRef.current !== event.content) {
        markEditorPathMutation(event.path, event.workspaceRoot)
      }
      const sequence = ++canonicalExternalUpdateSequenceRef.current
      const applyUpdate = () => {
        if (sequence !== canonicalExternalUpdateSequenceRef.current) return
        if (
          isSectionVirtualView
          && (
            sectionedEditorControllerRef.current?.isBusy()
            || !prepareExternalMarkdownAction()
          )
        ) {
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(applyUpdate, 100)
          return
        }
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer)
          retryTimer = null
        }

        const sourceChanged = sourceMarkdownRef.current !== event.content
        sourceMarkdownRef.current = event.content
        setSourceMarkdown(event.content)
        if (sourceChanged) contentVersionRef.current++
        const nextIsLargeDocument = classifyCanonicalMarkdown(event.content)
        if (nextIsLargeDocument) return
        if (usesCanonicalMarkdownRef.current) {
          if (sourceChanged && isSourceViewRef.current) setHasUnparsedSourceChanges(true)
          return
        }

        const currentContent = editor.getMarkdown()
        if (currentContent === event.content) return
        pendingSyncUpdateRef.current = event
        isReadyRef.current = false
        externalUpdateCounterRef.current++
        try {
          if (sequence !== canonicalExternalUpdateSequenceRef.current) {
            return
          }
          trySetMarkdownContent(editor, event.content)
        } finally {
          isReadyRef.current = true
          if (pendingSyncUpdateRef.current === event) {
            pendingSyncUpdateRef.current = null
          }
          externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
        }
      }
      applyUpdate()
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated as any)
    return () => {
      disposed = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      emitter.off('sync-content-updated', handleSyncContentUpdated as any)
    }
  }, [
    editor,
    activeFilePath,
    classifyCanonicalMarkdown,
    isSectionScope,
    isSectionVirtualView,
    prepareExternalMarkdownAction,
    trySetMarkdownContent,
    workspacePath,
  ])

  // Handle external content updates (e.g., from Agent tools).
  useEffect(() => {
    if (isSectionScope || !isActive) return
    let retryTimer: number | null = null

    const handleExternalUpdate = (newContent: string) => {
      if (!editor) return
      if (sourceMarkdownRef.current !== newContent) {
        markEditorPathMutation(activeFilePathRef.current)
      }
      const sequence = ++canonicalExternalUpdateSequenceRef.current
      const applyUpdate = () => {
        if (sequence !== canonicalExternalUpdateSequenceRef.current) return
        if (
          externalUpdateCounterRef.current !== 0
          || (
            isSectionVirtualView
            && (
              sectionedEditorControllerRef.current?.isBusy()
              || !prepareExternalMarkdownAction()
            )
          )
        ) {
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(applyUpdate, 100)
          return
        }
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer)
          retryTimer = null
        }

        const sourceChanged = sourceMarkdownRef.current !== newContent
        sourceMarkdownRef.current = newContent
        setSourceMarkdown(newContent)
        if (sourceChanged) contentVersionRef.current++
        const nextIsLargeDocument = classifyCanonicalMarkdown(newContent)
        if (nextIsLargeDocument) return
        if (usesCanonicalMarkdownRef.current) {
          if (sourceChanged && isSourceViewRef.current) setHasUnparsedSourceChanges(true)
          return
        }

        const currentContent = editor.getMarkdown()
        if (currentContent === newContent) return
        isReadyRef.current = false
        externalUpdateCounterRef.current++
        try {
          if (sequence !== canonicalExternalUpdateSequenceRef.current) {
            return
          }
          trySetMarkdownContent(editor, newContent)
        } finally {
          isReadyRef.current = true
          externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
        }
      }
      applyUpdate()
    }

    emitter.on('external-content-update', handleExternalUpdate as any)
    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      emitter.off('external-content-update', handleExternalUpdate as any)
    }
  }, [
    classifyCanonicalMarkdown,
    editor,
    isActive,
    isSectionScope,
    isSectionVirtualView,
    prepareExternalMarkdownAction,
    trySetMarkdownContent,
  ])

  // Set editable state
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  // Handle AI continue writing
  useEffect(() => {
    if (isSectionVirtualView || !isActive) return

    let abortController: AbortController | null = null

    const handleAIContinue = async (event: Event) => {
      if (!editor) return

      const shouldSuppressKeyboard = isMobile && (event as CustomEvent<{ suppressKeyboard?: boolean }>).detail?.suppressKeyboard === true
      const editorChain = () => shouldSuppressKeyboard ? editor.chain() : editor.chain().focus()
      const blurEditor = () => {
        if (shouldSuppressKeyboard) {
          blurActiveEditableElement()
        }
      }

      // Get content before cursor as context
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(0, from, '\n')

      // Get last 500 characters as context
      const context = textBefore.slice(-500)

      if (!context.trim()) {
        toast({
          title: '续写失败',
          description: '请先输入一些内容',
          variant: 'destructive',
        })
        return
      }

      abortController?.abort()
      const currentController = new AbortController()
      abortController = currentController
      const endBlockingActivity = beginBlockingActivity()

      const startPosition = from
      let accumulatedResult = ''
      let loadingVisible = true

      const removeLoadingIndicator = () => {
        if (!loadingVisible) {
          return
        }
        editorChain()
          .deleteRange({
            from: startPosition,
            to: startPosition + AI_GENERATION_LOADING_TEXT.length,
          })
          .run()
        loadingVisible = false
      }

      editorChain().insertContent(AI_GENERATION_LOADING_TEXT).run()
      blurEditor()

      try {
        await fetchCompletionStream(
          context,
          (chunk, isFirst) => {
            if (currentController.signal.aborted || editor.isDestroyed) return
            if (isFirst) {
              removeLoadingIndicator()
            }
            editorChain()
              .insertContentAt(startPosition + accumulatedResult.length, chunk)
              .run()
            blurEditor()
            accumulatedResult += chunk
          },
          currentController.signal
        )

        if (currentController.signal.aborted || editor.isDestroyed) return

        if (!accumulatedResult) {
          removeLoadingIndicator()
          return
        }

        editorChain()
          .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
          .run()

        const docSizeBeforeInsert = editor.state.doc.content.size
        editorChain()
          .insertContentAt(startPosition, accumulatedResult, { contentType: 'markdown' })
          .run()
        blurEditor()

        const insertedSize = Math.max(0, editor.state.doc.content.size - docSizeBeforeInsert)
        const generatedRange = {
          from: startPosition,
          to: startPosition + insertedSize,
        }

        editor.commands.setTextSelection(generatedRange.to)

        emitter.emit('show-ai-suggestion', {
          originalText: '',
          suggestedText: accumulatedResult,
          type: 'continue',
          position: getEditorPositionRect(editor, generatedRange.to),
          generatedRange,
        })
      } catch (error) {
        removeLoadingIndicator()
        blurEditor()

        // Show error toast (but not for aborted requests)
        if (error instanceof Error && error.message !== 'Request was aborted.') {
          toast({
            title: '续写失败',
            description: error.message || '网络错误',
            variant: 'destructive',
          })
        }
      } finally {
        endBlockingActivity()
      }
    }

    document.addEventListener('tiptap-ai-continue', handleAIContinue)
    return () => {
      document.removeEventListener('tiptap-ai-continue', handleAIContinue)
      abortController?.abort()
    }
  }, [beginBlockingActivity, editor, isActive, isMobile, isSectionScope, isSectionVirtualView])

  // Handle slash-command AI generation actions that operate without selected text.
  useEffect(() => {
    if (isSectionVirtualView || !isActive) return

    let abortController: AbortController | null = null

    const actionTitle: Record<EditorAiGenerationAction, string> = {
      section: '生成章节',
      summary: '总结',
      custom: '自定义指令',
    }

    const handleAIGenerate = async (event: Event) => {
      if (!editor) return

      const detail = (event as CustomEvent<{
        action?: unknown
        instruction?: string
        suppressKeyboard?: boolean
      }>).detail

      if (!isEditorAiGenerationAction(detail?.action)) {
        return
      }

      const action = detail.action
      const instruction = detail.instruction?.trim()
      const shouldSuppressKeyboard = isMobile && detail.suppressKeyboard === true
      const editorChain = () => shouldSuppressKeyboard ? editor.chain() : editor.chain().focus()
      const blurEditor = () => {
        if (shouldSuppressKeyboard) {
          blurActiveEditableElement()
        }
      }

      if (action === 'custom' && !instruction) {
        toast({
          title: '自定义指令失败',
          description: '请输入指令',
          variant: 'destructive',
        })
        return
      }

      const { from } = editor.state.selection
      const localMarkdown = normalizeMarkdownPlaceholders(editor.getMarkdown())
      const fullText = isSectionScope
        ? documentMarkdownRef.current ?? localMarkdown
        : localMarkdown
      const plainText = isSectionScope ? fullText : editor.getText()
      const textBeforeCursor = editor.state.doc.textBetween(0, from, '\n')
      const textAfterCursor = editor.state.doc.textBetween(from, editor.state.doc.content.size, '\n')

      if (action !== 'custom' && !plainText.trim()) {
        toast({
          title: `${actionTitle[action]}失败`,
          description: '请先输入一些内容',
          variant: 'destructive',
        })
        return
      }

      abortController?.abort()
      const currentController = new AbortController()
      abortController = currentController
      const endBlockingActivity = beginBlockingActivity()

      const startPosition = from
      let accumulatedResult = ''
      let loadingVisible = true

      const removeLoadingIndicator = () => {
        if (!loadingVisible) {
          return
        }
        editorChain()
          .deleteRange({
            from: startPosition,
            to: startPosition + AI_GENERATION_LOADING_TEXT.length,
          })
          .run()
        loadingVisible = false
      }

      editorChain().insertContent(AI_GENERATION_LOADING_TEXT).run()
      blurEditor()

      try {
        await fetchEditorAiGenerationStream(
          {
            action,
            fullText,
            textBeforeCursor,
            textAfterCursor,
            instruction,
          },
          (chunk, isFirst) => {
            if (currentController.signal.aborted || editor.isDestroyed) return
            if (isFirst) {
              removeLoadingIndicator()
            }
            editorChain()
              .insertContentAt(startPosition + accumulatedResult.length, chunk)
              .run()
            blurEditor()
            accumulatedResult += chunk
          },
          currentController.signal
        )

        if (currentController.signal.aborted || editor.isDestroyed) return

        if (!accumulatedResult) {
          removeLoadingIndicator()
          return
        }

        const sanitizedResult = sanitizeEditorAiGenerationOutput(accumulatedResult)
        editorChain()
          .deleteRange({
            from: startPosition,
            to: startPosition + accumulatedResult.length,
          })
          .run()

        if (!sanitizedResult) {
          return
        }

        const docSizeBeforeInsert = editor.state.doc.content.size
        editorChain()
          .insertContentAt(startPosition, sanitizedResult, { contentType: 'markdown' })
          .run()
        blurEditor()

        const insertedSize = Math.max(0, editor.state.doc.content.size - docSizeBeforeInsert)
        const generatedRange = {
          from: startPosition,
          to: startPosition + insertedSize,
        }

        editor.commands.setTextSelection(generatedRange.to)

        emitter.emit('show-ai-suggestion', {
          originalText: '',
          suggestedText: sanitizedResult,
          type: action,
          position: getEditorPositionRect(editor, generatedRange.to),
          generatedRange,
        })
      } catch (error) {
        removeLoadingIndicator()
        blurEditor()

        if (error instanceof Error && error.message !== 'Request was aborted.') {
          toast({
            title: `${actionTitle[action]}失败`,
            description: error.message || '网络错误',
            variant: 'destructive',
          })
        }
      } finally {
        endBlockingActivity()
      }
    }

    document.addEventListener('tiptap-ai-generate', handleAIGenerate)
    return () => {
      document.removeEventListener('tiptap-ai-generate', handleAIGenerate)
      abortController?.abort()
    }
  }, [beginBlockingActivity, editor, isActive, isMobile, isSectionVirtualView])

  // Handle drag and drop from marks
  const handleEditorDrop = useCallback((e: React.DragEvent) => {
    if (hasCanvasDragData(e.dataTransfer)) {
      setIsCanvasDragOver(false)
    }
    const markData = e.dataTransfer.getData('application/json')
    if (markData) {
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      if (editor) {
        clearEditorNativeDropCursor(editor)
      }

      const dropPos = editor?.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      })?.pos

      try {
        const mark = JSON.parse(markData) as Mark
        if (mark && mark.id !== undefined) {
          if ((mark.type === 'image' || mark.type === 'scan') && mark.url) {
            const endBlockingActivity = beginBlockingActivity()
            void (async () => {
              let src = mark.url
              let relativeSrc = mark.url

              if (!/^https?:\/\//i.test(mark.url)) {
                const localAssetPath = getMarkLocalAssetPath(mark)
                if (!localAssetPath) {
                  throw new Error('无法获取图片记录的本地文件路径')
                }

                const bytes = await readFile(localAssetPath, { baseDir: BaseDirectory.AppData })
                const fileName = localAssetPath.split('/').pop() || mark.url
                const imageFile = new File([bytes], fileName, {
                  type: getDroppedMarkImageMimeType(fileName),
                })
                const result = await handleImageUpload(imageFile, activeFilePathRef.current)
                src = result.src
                relativeSrc = result.relativePath
              }

              const insertPos = dropPos ?? editor?.state.selection.from
              if (insertPos === undefined || editor?.isDestroyed) {
                return
              }

              editor?.chain()
                .focus()
                .insertContentAt(insertPos, {
                  type: 'image',
                  attrs: {
                    src,
                    alt: mark.desc || 'image',
                    relativeSrc,
                  },
                })
                .run()

              toast({
                title: '已插入记录',
                description: mark.desc || '图片记录',
              })
            })().catch(error => {
              toast({
                title: tImage('failed'),
                description: error instanceof Error ? error.message : undefined,
                variant: 'destructive',
              })
            }).finally(endBlockingActivity)
            return
          }

          const endBlockingActivity = beginBlockingActivity()
          import('@/lib/mark-to-markdown').then(({ markToMarkdown }) => {
            if (editor?.isDestroyed) return
            const markdown = markToMarkdown(mark)
            if (dropPos !== undefined) {
              editor?.commands.insertContentAt(dropPos, markdown, { contentType: 'markdown' })
            } else {
              editor?.commands.insertContent(markdown, { contentType: 'markdown' })
            }
            toast({
              title: '已插入记录',
              description: mark.desc || mark.content?.slice(0, 50) || '记录内容'
            })
          }).finally(endBlockingActivity)
        }
      } catch (error) {
        console.error('Failed to parse dropped mark:', error)
      }
    }
  }, [beginBlockingActivity, editor, tImage])

  // Handle math formula insertion from slash menu
  useEffect(() => {
    if (!editor || isSectionVirtualView || !isActive) return

    const handleInsertInlineMath = () => {
      setMathType('inline')
      setMathDialogOpen(true)
    }

    const handleInsertBlockMath = () => {
      setMathType('block')
      setMathDialogOpen(true)
    }

    document.addEventListener('tiptap-insert-inline-math', handleInsertInlineMath)
    document.addEventListener('tiptap-insert-block-math', handleInsertBlockMath)

    return () => {
      document.removeEventListener('tiptap-insert-inline-math', handleInsertInlineMath)
      document.removeEventListener('tiptap-insert-block-math', handleInsertBlockMath)
    }
  }, [editor, isActive, isSectionVirtualView])

  const handleEditorDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!hasCanvasDragData(event.dataTransfer)) return
    event.dataTransfer.dropEffect = 'copy'
    setIsCanvasDragOver(true)
  }, [])

  const handleEditorDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setIsCanvasDragOver(false)
  }, [])

  // Handle math dialog insert
  const handleMathInsert = useCallback((latex: string, type: 'inline' | 'block') => {
    if (!editor) return

    if (type === 'inline') {
      editor.chain().focus().insertContent({
        type: 'inlineMath',
        attrs: { latex },
      }).run()
    } else {
      editor.chain().focus().insertContent({
        type: 'blockMath',
        attrs: { latex },
      }).run()
    }
  }, [editor])

  // Editor tools event handlers for Agent integration
  useEffect(() => {
    let lastEditorSelectionQuote: PendingQuote | null = null

    const buildQuoteDataFromRange = (from: number, to: number): PendingQuote | null => {
      if (usesCanonicalMarkdown) {
        const markdown = sourceMarkdownRef.current
        const safeFrom = Math.max(0, Math.min(from, markdown.length))
        const safeTo = Math.max(safeFrom, Math.min(to, markdown.length))
        const quote = markdown.slice(safeFrom, safeTo)
        if (!quote.trim()) return null

        const fileName = activeFilePath?.split('/').pop() || ''
        const startLine = getMarkdownLineAtPosition(markdown, safeFrom)
        const endLine = getMarkdownLineAtPosition(markdown, safeTo)

        return {
          quote,
          fullContent: quote,
          fileName,
          startLine,
          endLine,
          from: safeFrom,
          to: safeTo,
          articlePath: activeFilePath || '',
        }
      }

      if (!editor) {
        return null
      }

      if (from === to) {
        return null
      }

      const quote = editor.state.doc.textBetween(from, to)
      if (!quote.trim()) {
        return null
      }

      let selectedMarkdown = quote
      if (editor.markdown) {
        try {
          const slice = editor.state.doc.slice(from, to)
          const json = { type: 'doc', content: slice.content.toJSON() }
          selectedMarkdown = editor.markdown.serialize(json).trim() || quote
        } catch {
          selectedMarkdown = quote
        }
      }

      const fileName = activeFilePath?.split('/').pop() || ''
      const textBeforeFrom = editor.state.doc.textBetween(0, from, '\n', '\n')
      const startLine = (textBeforeFrom.match(/\n/g)?.length || 0) + 1

      const textBeforeTo = editor.state.doc.textBetween(0, to, '\n', '\n')
      const endLine = (textBeforeTo.match(/\n/g)?.length || 0) + 1

      return {
        quote,
        fullContent: selectedMarkdown,
        fileName,
        startLine,
        endLine,
        from,
        to,
        articlePath: activeFilePath || '',
      }
    }

    const buildCurrentQuoteData = (): PendingQuote | null => {
      if (isSectionVirtualView) {
        const selection = sectionedEditorControllerRef.current?.getSelection()
        if (!selection || selection.collapsed) return null

        const quote = selection.text || selection.markdown
        const selectedMarkdown = selection.markdown || quote
        if (!quote.trim()) return null

        return {
          quote,
          fullContent: selectedMarkdown,
          fileName: activeFilePath?.split('/').pop() || '',
          startLine: -1,
          endLine: -1,
          from: -1,
          to: -1,
          selectionToken: selection.selectionToken,
          articlePath: activeFilePath || '',
        }
      }

      if (usesCanonicalMarkdown) {
        const { from, to } = sourceSelectionRef.current
        return buildQuoteDataFromRange(from, to)
      }

      if (!editor) {
        return null
      }

      const { from, to } = editor.state.selection
      return buildQuoteDataFromRange(from, to)
    }

    const syncEditorSelectionQuote = () => {
      if (!editor) {
        useChatStore.getState().setEditorSelectionQuote(null)
        return
      }

      const quoteData = buildCurrentQuoteData()
      if (quoteData) {
        lastEditorSelectionQuote = quoteData
        useChatStore.getState().setEditorSelectionQuote(quoteData)
        return
      }

      if (isMobile && !isFocusWithinEditor(editor.view) && lastEditorSelectionQuote) {
        useChatStore.getState().setEditorSelectionQuote(lastEditorSelectionQuote)
        return
      }

      lastEditorSelectionQuote = null
      useChatStore.getState().setEditorSelectionQuote(null)
    }

    const getCurrentEditorSelection = () => {
      if (isSectionVirtualView) {
        const selection = sectionedEditorControllerRef.current?.getSelection()
        if (!selection) {
          return { text: '', from: -1, to: -1, startLine: -1, endLine: -1 }
        }

        return {
          text: selection.text,
          from: -1,
          to: -1,
          startLine: -1,
          endLine: -1,
        }
      }

      if (usesCanonicalMarkdown) {
        const markdown = sourceMarkdownRef.current
        const selection = sourceSelectionRef.current
        const from = Math.max(0, Math.min(selection.from, markdown.length))
        const to = Math.max(from, Math.min(selection.to, markdown.length))
        const startLine = getMarkdownLineAtPosition(markdown, from)
        const endLine = getMarkdownLineAtPosition(markdown, to)

        return {
          text: markdown.slice(from, to),
          from,
          to,
          startLine,
          endLine,
        }
      }

      if (!editor) {
        return { text: '', from: 0, to: 0, startLine: 1, endLine: 1 }
      }

      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)
      const textBeforeFrom = editor.state.doc.textBetween(0, from, '\n', '\n')
      const startLine = (textBeforeFrom.match(/\n/g)?.length || 0) + 1
      const textBeforeTo = editor.state.doc.textBetween(0, to, '\n', '\n')
      const endLine = (textBeforeTo.match(/\n/g)?.length || 0) + 1

      return { text, from, to, startLine, endLine }
    }

    // Get editor selection
    const handleGetSelection = ({ resolve }: { resolve: (data: { text: string; from: number; to: number; html?: string; startLine?: number; endLine?: number }) => void }) => {
      if (!editor) {
        resolve({ text: '', from: 0, to: 0, startLine: 1, endLine: 1 })
        return
      }

      const selection = getCurrentEditorSelection()

      resolve({
        ...selection,
        html: usesCanonicalMarkdown ? undefined : editor.getHTML(),
      })
    }

    // Get editor content
    const handleGetContent = ({ resolve }: { resolve: (data: { markdown: string; text: string; wordCount: number; charCount: number; totalLines?: number; numberedLines?: string; version: number; selection?: { text: string; from: number; to: number; startLine: number; endLine: number } }) => void }) => {
      if (!editor) {
        resolve({ markdown: '', text: '', wordCount: 0, charCount: 0, totalLines: 1, numberedLines: '1 | ', version: 0 })
        return
      }

      const markdown = usesCanonicalMarkdown
        ? isSectionVirtualView
          ? flushSectionedMarkdown()
          : sourceMarkdownRef.current
        : normalizeMarkdownPlaceholders(editor.getMarkdown())
      const text = usesCanonicalMarkdown ? markdown : editor.getText()
      const markdownLines = markdown.split('\n')
      const totalLines = markdownLines.length
      const lineNumberWidth = String(totalLines).length
      const numberedLines = markdownLines
        .map((line, index) => `${String(index + 1).padStart(lineNumberWidth)} | ${line}`)
        .join('\n')

      resolve({
        markdown,
        text,
        wordCount: text.split(/\s+/).filter(w => w).length,
        charCount: text.length,
        totalLines,
        numberedLines,
        version: contentVersionRef.current,
        selection: getCurrentEditorSelection(),
      })
    }

    const applyCanonicalMarkdownChange = (nextMarkdown: string) => {
      if (isSectionVirtualView) {
        handleSectionedMarkdownChange(nextMarkdown)
        return
      }
      handleSourceMarkdownChange(nextMarkdown)
    }

    // Insert content at cursor
    const handleInsert = ({
      filePath,
      content,
      position,
      replaceSelection = false,
      expectedSelection,
      expectedSelectionToken,
      resolve,
    }: {
      filePath: string;
      content: string;
      position?: number;
      replaceSelection?: boolean;
      expectedSelection?: string;
      expectedSelectionToken?: string;
      resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void;
    }) => {
      if (
        !editor
        || normalizePathForCompare(filePath) !== normalizePathForCompare(activeFilePath)
      ) {
        resolve({ success: false, insertedLength: 0 })
        return
      }
      if (isSectionVirtualView && sectionedEditorControllerRef.current?.isBusy()) {
        resolve({ success: false, insertedLength: 0 })
        return
      }

      if (isSectionVirtualView && typeof position !== 'number') {
        runDeferredEditorCommand(() => {
          flushSectionedMarkdown()
          const activeEditor = sectionedEditorControllerRef.current?.getActiveEditor()
          if (!activeEditor || activeEditor.isDestroyed) {
            throw new Error('Active section editor is not available')
          }

          const activeSelection = sectionedEditorControllerRef.current?.getSelection()
          if (replaceSelection) {
            const selectedContent = activeSelection?.markdown || activeSelection?.text || ''
            if (
              !activeSelection
              || activeSelection.collapsed
              || (expectedSelectionToken !== undefined
                && expectedSelectionToken !== activeSelection.selectionToken)
              || (expectedSelection !== undefined
                && expectedSelection !== selectedContent
                && expectedSelection !== activeSelection.text)
            ) {
              throw new Error('The active section selection changed before the edit')
            }
          }

          if (!replaceSelection && !activeEditor.state.selection.empty) {
            activeEditor.commands.setTextSelection(activeEditor.state.selection.to)
          }

          const didInsert = activeEditor
            .chain()
            .focus()
            .insertContent(content, { contentType: 'markdown' })
            .run()
          if (!didInsert) {
            throw new Error('Unable to insert content into the active section')
          }

          flushSectionedMarkdown()
          resolve({ success: true, insertedLength: content.length })
        }, () => {
          resolve({ success: false, insertedLength: 0 })
        })
        return
      }

      if (usesCanonicalMarkdown) {
        const markdown = isSectionVirtualView
          ? flushSectionedMarkdown()
          : sourceMarkdownRef.current
        const sectionSelection = isSectionVirtualView
          ? sectionedEditorControllerRef.current?.getSelection()
          : null
        const currentSelection = sectionSelection ?? sourceSelectionRef.current
        const insertFrom = Math.max(
          0,
          Math.min(
            typeof position === 'number'
              ? position
              : replaceSelection
                ? currentSelection.from
                : currentSelection.to,
            markdown.length
          )
        )
        const insertTo = typeof position === 'number' || !replaceSelection
          ? insertFrom
          : Math.max(insertFrom, Math.min(currentSelection.to, markdown.length))
        const nextMarkdown = `${markdown.slice(0, insertFrom)}${content}${markdown.slice(insertTo)}`
        const nextSelection = {
          from: insertFrom + content.length,
          to: insertFrom + content.length,
        }
        const sourceController = sourceEditorControllerRef.current
        if (sourceController) {
          sourceController.replaceValue(nextMarkdown, nextSelection)
        } else {
          applyCanonicalMarkdownChange(nextMarkdown)
          sourceSelectionRef.current = nextSelection
        }
        resolve({
          success: true,
          insertedLength: content.length,
          newCursorPosition: insertFrom + content.length,
        })
        return
      }

      try {
        // Insert content with markdown parsing
        // Wrap in setTimeout to avoid React lifecycle flushSync conflict
        runDeferredEditorCommand(() => {
          if (typeof position === 'number') {
            const insertPosition = clampSelectionPosition(position, editor.state.doc.content.size)
            editor.commands.setTextSelection({ from: insertPosition, to: insertPosition })
          } else if (!replaceSelection && !editor.state.selection.empty) {
            editor.commands.setTextSelection(editor.state.selection.to)
          }

          editor.commands.insertContent(content, { contentType: 'markdown' })

          // Use the actual cursor position after transaction
          const newPosition = editor.state.selection.from

          resolve({
            success: true,
            insertedLength: content.length,
            newCursorPosition: newPosition,
          })
        }, () => {
          resolve({ success: false, insertedLength: 0 })
        })
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        resolve({ success: false, insertedLength: 0 })
      }
    }

    // Replace content in range
    const handleReplace = ({
      filePath,
      content,
      range,
      searchContent,
      occurrence,
      startLine,
      endLine,
      expectedVersion,
      resolve,
    }: {
      filePath: string
      content?: string
      range?: { from: number; to: number }
      searchContent?: string
      occurrence?: number
      startLine?: number
      endLine?: number
      expectedVersion?: number
      resolve: (result: { success: boolean; insertedLength: number; message?: string; error?: string; newCursorPosition?: number; versionMismatch?: boolean }) => void
    }) => {
      if (
        !editor
        || normalizePathForCompare(filePath) !== normalizePathForCompare(activeFilePath)
      ) {
        resolve({ success: false, insertedLength: 0, error: 'Editor not initialized' })
        return
      }
      if (isSectionVirtualView && sectionedEditorControllerRef.current?.isBusy()) {
        resolve({ success: false, insertedLength: 0, error: 'Editor is completing another operation' })
        return
      }

      const flushedMarkdown = isSectionVirtualView
        ? flushSectionedMarkdown()
        : sourceMarkdownRef.current

      // Verify version if provided
      if (expectedVersion !== undefined && expectedVersion !== contentVersionRef.current) {
        resolve({ success: false, versionMismatch: true, insertedLength: 0, error: 'Content has changed, please get editor content again' })
        return
      }

      const hasExplicitCanonicalTarget = Boolean(
        range
        || searchContent
        || (startLine !== undefined && endLine !== undefined)
      )
      if (isSectionVirtualView && content !== undefined && !hasExplicitCanonicalTarget) {
        runDeferredEditorCommand(() => {
          flushSectionedMarkdown()
          const activeEditor = sectionedEditorControllerRef.current?.getActiveEditor()
          if (!activeEditor || activeEditor.isDestroyed) {
            throw new Error('Active section editor is not available')
          }

          const { from, to } = activeEditor.state.selection
          const newContent = content || ''
          const $from = activeEditor.state.doc.resolve(from)
          const $to = activeEditor.state.doc.resolve(to)
          const isInlineTextReplacement = !newContent.includes('\n')
            && $from.sameParent($to)
            && $from.parent.isTextblock
          const didReplace = isInlineTextReplacement
            ? activeEditor.chain().focus().command(({ tr }) => {
                tr.insertText(newContent, from, to)
                return true
              }).run()
            : newContent
              ? activeEditor.chain()
                  .focus()
                  .deleteRange({ from, to })
                  .insertContent(newContent, { contentType: 'markdown' })
                  .run()
              : activeEditor.chain().focus().deleteRange({ from, to }).run()

          if (!didReplace) {
            throw new Error('Unable to replace the active section selection')
          }

          flushSectionedMarkdown()
          resolve({
            success: true,
            insertedLength: newContent.length,
            message: `成功替换 ${to - from} 个字符为 ${newContent.length} 个字符`,
          })
        }, (error) => {
          resolve({ success: false, insertedLength: 0, error: String(error) })
        })
        return
      }

      if (usesCanonicalMarkdown) {
        try {
          const markdown = flushedMarkdown
          const newContent = content || ''
          let nextMarkdown: string
          let replacedLength = 0
          let newCursorPosition: number | undefined

          if (range) {
            if (
              !Number.isInteger(range.from)
              || !Number.isInteger(range.to)
              || range.from < 0
              || range.to < range.from
              || range.to > markdown.length
            ) {
              resolve({ success: false, insertedLength: 0, error: '无效或不可用的 Markdown 范围' })
              return
            }
            const from = range.from
            const to = range.to
            nextMarkdown = `${markdown.slice(0, from)}${newContent}${markdown.slice(to)}`
            replacedLength = to - from
            newCursorPosition = from + newContent.length
          } else if (searchContent) {
            const targetOccurrence = Math.max(1, occurrence || 1)
            const haystack = markdown.toLocaleLowerCase()
            const needle = searchContent.toLocaleLowerCase()
            let searchFrom = 0
            let foundIndex = -1

            for (let index = 0; index < targetOccurrence; index++) {
              foundIndex = haystack.indexOf(needle, searchFrom)
              if (foundIndex === -1) break
              searchFrom = foundIndex + Math.max(1, needle.length)
            }

            if (foundIndex === -1) {
              resolve({ success: false, insertedLength: 0, error: `找不到文本 "${searchContent}"` })
              return
            }

            nextMarkdown = `${markdown.slice(0, foundIndex)}${newContent}${markdown.slice(foundIndex + searchContent.length)}`
            replacedLength = searchContent.length
            newCursorPosition = foundIndex + newContent.length
          } else if (startLine !== undefined && endLine !== undefined) {
            nextMarkdown = replaceLinesInRange(
              markdown,
              startLine,
              endLine,
              newContent.split('\n')
            )
          } else if (content !== undefined) {
            const selection = sourceSelectionRef.current
            const from = Math.max(0, Math.min(selection.from, markdown.length))
            const to = Math.max(from, Math.min(selection.to, markdown.length))
            nextMarkdown = `${markdown.slice(0, from)}${newContent}${markdown.slice(to)}`
            replacedLength = to - from
            newCursorPosition = from + newContent.length
          } else {
            resolve({ success: false, insertedLength: 0, error: '请提供 content、range、searchContent 或 startLine/endLine 参数' })
            return
          }

          const sourceController = sourceEditorControllerRef.current
          if (newCursorPosition !== undefined) {
            const nextSelection = {
              from: newCursorPosition,
              to: newCursorPosition,
            }
            if (sourceController) {
              sourceController.replaceValue(nextMarkdown, nextSelection)
            } else {
              applyCanonicalMarkdownChange(nextMarkdown)
              sourceSelectionRef.current = nextSelection
            }
          } else if (sourceController) {
            sourceController.replaceValue(nextMarkdown)
          } else {
            applyCanonicalMarkdownChange(nextMarkdown)
          }
          resolve({
            success: true,
            insertedLength: newContent.length,
            message: `成功替换 ${replacedLength} 个字符为 ${newContent.length} 个字符`,
            newCursorPosition,
          })
        } catch (error) {
          resolve({ success: false, insertedLength: 0, error: String(error) })
        }
        return
      }

      try {
        let { from, to } = editor.state.selection
        let replacementMode: 'range' | 'line' = 'range'

        // Mode 1: Position-based (use current selection if not specified)
        if (range) {
          from = range.from
          to = range.to
        }
        // Mode 2: Text-based search
        else if (searchContent) {
          // Try to find searchContent in the document using a more robust method
          const doc = editor.state.doc
          const content = editor.state.doc.textContent
          const searchLower = searchContent.toLowerCase()
          const contentLower = content.toLowerCase()

          // Count occurrences to find the target one
          let currentOccurrence = 0
          let searchFrom = 0
          let foundIndex = -1

          while (currentOccurrence < (occurrence || 1)) {
            foundIndex = contentLower.indexOf(searchLower, searchFrom)
            if (foundIndex === -1) {
              resolve({ success: false, insertedLength: 0, error: `找不到文本 "${searchContent}"` })
              return
            }
            currentOccurrence++
            searchFrom = foundIndex + 1
          }

          // Now find the exact position in the ProseMirror doc
          // Use ProseMirror's descendant traversal to find text position
          let foundFrom = -1
          let foundTo = -1

          doc.descendants((node, pos) => {
            if (foundFrom !== -1) return false // Already found, stop traversal

            if (node.isText && node.text) {
              const idxInNode = node.text.toLowerCase().indexOf(searchLower)
              if (idxInNode !== -1) {
                foundFrom = pos + idxInNode
                foundTo = foundFrom + searchContent.length
                return false // Stop traversal
              }
            }
          })

          if (foundFrom === -1) {
            // Fallback: use approximate position from markdown
            foundFrom = foundIndex
            foundTo = foundIndex + searchContent.length
          }

          from = foundFrom
          to = foundTo
        }
        // Mode 3: Line-based
        else if (startLine !== undefined && endLine !== undefined) {
          replacementMode = 'line'
        }
        // Fallback: use current selection (only if content is provided)
        else if (content) {
          // Don't change from/to, use current selection
        } else {
          resolve({ success: false, insertedLength: 0, error: '请提供 content、range、searchContent 或 startLine/endLine 参数' })
          return
        }

        const newContent = content || ''

        // Delete old content and insert new content with markdown parsing
        // Wrap in setTimeout to avoid React lifecycle flushSync conflict
        runDeferredEditorCommand(() => {
          if (replacementMode === 'line' && startLine !== undefined && endLine !== undefined) {
            const currentMarkdown = normalizeMarkdownPlaceholders(editor.getMarkdown())
            const updatedMarkdown = replaceLinesInRange(
              currentMarkdown,
              startLine,
              endLine,
              newContent.split('\n')
            )

            if (classifyCanonicalMarkdown(updatedMarkdown)) {
              sourceMarkdownRef.current = updatedMarkdown
              setSourceMarkdown(updatedMarkdown)
              setHasUnparsedSourceChanges(true)
              contentVersionRef.current++
              onChangeRef.current?.(updatedMarkdown)
              resolve({
                success: true,
                insertedLength: newContent.length,
                message: `成功替换第 ${startLine}-${endLine} 行内容`,
              })
              return
            }

            editor.commands.setContent(updatedMarkdown, { contentType: 'markdown' })
          } else {
            const $from = editor.state.doc.resolve(from)
            const $to = editor.state.doc.resolve(to)
            const isInlineTextReplacement = !newContent.includes('\n')
              && $from.sameParent($to)
              && $from.parent.isTextblock

            if (isInlineTextReplacement) {
              editor.chain()
                .focus()
                .command(({ tr }) => {
                  tr.insertText(newContent, from, to)
                  return true
                })
                .run()
            } else {
              editor.chain()
                .focus()
                .deleteRange({ from, to })
                .insertContent(newContent, { contentType: 'markdown' })
                .run()
            }
          }

          // Increment version after successful replacement
          contentVersionRef.current++

          resolve({
            success: true,
            insertedLength: newContent.length,
            message: `成功替换 ${to - from} 个字符为 ${newContent.length} 个字符`,
            newCursorPosition: from + newContent.length,
          })
        }, (error) => {
          resolve({ success: false, insertedLength: 0, error: String(error) })
        })
      } catch (error) {
        resolve({ success: false, insertedLength: 0, error: String(error) })
      }
    }

    // Get quote from editor for chat
    const handleGetQuote = () => {
      const quoteData = buildCurrentQuoteData()
      if (quoteData) {
        useChatStore.getState().setPendingQuote(quoteData)
        emitter.emit('insert-quote', quoteData)
      }
    }

    // Track if listeners have been set up (for cleanup)
    let listenersSetup = false
    let editorListenersRegistered = false

    // Handle Mermaid diagram insertion
    const handleInsertMermaid = (event: CustomEvent) => {
      if (!editor) return
      const { type } = event.detail || {}

      // Get template from i18n
      const getTemplate = (diagramType: string) => {
        return tMermaid(diagramType) || tMermaid('flowchart')
      }

      const code = getTemplate(type || 'flowchart')

      // Insert mermaid diagram node
      editor.chain().focus().insertContent({
        type: 'mermaidDiagram',
        attrs: { code, type: type || 'flowchart' },
      }).run()
    }

    // Handle undo/redo from TabBar buttons
    const handleUndo = () => {
      if (isSourceView) {
        sourceEditorControllerRef.current?.undo()
        return
      }
      if (isSectionVirtualView) {
        const sectionEditor = sectionedEditorControllerRef.current?.getActiveEditor()
        sectionEditor?.chain().focus().undo().run()
        return
      }
      if (!editor) return
      editor.chain().focus().undo().run()
    }

    const handleRedo = () => {
      if (isSourceView) {
        sourceEditorControllerRef.current?.redo()
        return
      }
      if (isSectionVirtualView) {
        const sectionEditor = sectionedEditorControllerRef.current?.getActiveEditor()
        sectionEditor?.chain().focus().redo().run()
        return
      }
      if (!editor) return
      editor.chain().focus().redo().run()
    }

    const handleAgentDiffPreview = ({
      originalContent,
      modifiedContent,
      filePath,
      from,
      to,
    }: {
      originalContent: string
      modifiedContent: string
      filePath?: string
      from?: number
      to?: number
    }) => {
      if (!editor || (filePath && activeFilePath && filePath !== activeFilePath)) {
        return
      }

      editor.view.dispatch(editor.state.tr.setMeta(agentDiffPreviewPluginKey, {
        type: 'show',
        payload: { originalContent, modifiedContent, from, to },
      }))

      window.requestAnimationFrame(() => {
        if (editor.isDestroyed || !scrollContainerRef.current) return

        const scrollContainer = scrollContainerRef.current
        const containerRect = scrollContainer.getBoundingClientRect()
        const diffElement = editor.view.dom.querySelector<HTMLElement>(
          '.agent-diff-preview-removed, .agent-diff-preview-inserted'
        )
        let targetTop: number | undefined

        if (diffElement) {
          targetTop = diffElement.getBoundingClientRect().top
        } else if (from !== undefined) {
          try {
            const position = clampSelectionPosition(from, editor.state.doc.content.size)
            targetTop = editor.view.coordsAtPos(position).top
          } catch {
            return
          }
        }

        if (targetTop === undefined) return

        const centeredScrollTop = scrollContainer.scrollTop
          + targetTop
          - containerRect.top
          - scrollContainer.clientHeight / 2
        const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight)

        scrollContainer.scrollTo({
          top: Math.max(0, Math.min(maxScrollTop, centeredScrollTop)),
          behavior: 'smooth',
        })
      })
    }

    const handleAgentDiffClear = () => {
      if (!editor) return
      editor.view.dispatch(editor.state.tr.setMeta(agentDiffPreviewPluginKey, { type: 'clear' }))
    }

    const handleMobileToggleOutline = () => {
      if (!isMobile) return
      setMobileOutlineOpen((prev) => !prev)
    }

    // Handle query for undo/redo capability
    const handleCanUndoRedo = ({ resolve }: { resolve: (can: { undo: boolean; redo: boolean }) => void }) => {
      if (isSourceView) {
        resolve(sourceEditorControllerRef.current?.getUndoRedoState() ?? { undo: false, redo: false })
        return
      }
      if (isSectionVirtualView) {
        const sectionEditor = sectionedEditorControllerRef.current?.getActiveEditor()
        resolve(sectionEditor ? getEditorUndoRedoState(sectionEditor) : { undo: false, redo: false })
        return
      }
      if (!editor) {
        resolve({ undo: false, redo: false })
        return
      }
      resolve(getEditorUndoRedoState(editor))
    }

    // Defer emitter and document listener registration to avoid flushSync conflict during React render
    const setupListeners = () => {
      // Check if editor is initialized before registering listeners
      if (!editor || !isActive) return

      if (isSectionScope) {
        document.addEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
        listenersSetup = true
        return
      }

      if (usesCanonicalMarkdown) {
        // Keep the Markdown-aware Agent bridge active, while leaving commands that
        // target the hidden ProseMirror view (history, diffs and node insertion)
        // disabled.
        emitter.on('editor-get-selection', handleGetSelection)
        emitter.on('editor-get-content', handleGetContent)
        emitter.on('editor-insert', handleInsert)
        emitter.on('editor-replace', handleReplace)
        emitter.on('get-quote-from-editor', handleGetQuote)
        emitter.on('editor-undo', handleUndo)
        emitter.on('editor-redo', handleRedo)
        emitter.on('editor-can-undo-redo', handleCanUndoRedo)
        editorListenersRegistered = true
        return
      }

      emitter.on('editor-get-selection', handleGetSelection)
      emitter.on('editor-get-content', handleGetContent)
      emitter.on('editor-insert', handleInsert)
      emitter.on('editor-replace', handleReplace)
      emitter.on('get-quote-from-editor', handleGetQuote)
      emitter.on('editor-undo', handleUndo)
      emitter.on('editor-redo', handleRedo)
      emitter.on('editor-agent-diff-preview', handleAgentDiffPreview)
      emitter.on('editor-agent-diff-clear', handleAgentDiffClear)
      emitter.on('mobile-editor-toggle-outline', handleMobileToggleOutline)
      emitter.on('editor-can-undo-redo', handleCanUndoRedo)
      editor.on('selectionUpdate', syncEditorSelectionQuote)
      document.addEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
      syncEditorSelectionQuote()
      editorListenersRegistered = true
      listenersSetup = true
    }

    const cleanupListeners = () => {
      emitter.off('editor-get-selection', handleGetSelection)
      emitter.off('editor-get-content', handleGetContent)
      emitter.off('editor-insert', handleInsert)
      emitter.off('editor-replace', handleReplace)
      emitter.off('get-quote-from-editor', handleGetQuote)
      emitter.off('editor-undo', handleUndo)
      emitter.off('editor-redo', handleRedo)
      emitter.off('editor-agent-diff-preview', handleAgentDiffPreview)
      emitter.off('editor-agent-diff-clear', handleAgentDiffClear)
      emitter.off('mobile-editor-toggle-outline', handleMobileToggleOutline)
      emitter.off('editor-can-undo-redo', handleCanUndoRedo)
      editor?.off('selectionUpdate', syncEditorSelectionQuote)
      if (editorListenersRegistered && !isMobile) {
        useChatStore.getState().clearEditorSelectionQuote()
      }
      editorListenersRegistered = false
      // Only remove event listener if it was actually added
      if (listenersSetup) {
        document.removeEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
        listenersSetup = false
      }
    }

    // Register listeners synchronously
    if (editor) {
      setupListeners()
    }

    return cleanupListeners
  }, [
    activeFilePath,
    classifyCanonicalMarkdown,
    editor,
    flushSectionedMarkdown,
    handleSectionedMarkdownChange,
    handleSourceMarkdownChange,
    isActive,
    isSectionScope,
    isSectionVirtualView,
    isSourceView,
    trySetMarkdownContent,
    usesCanonicalMarkdown,
  ])

  if (!editor) {
    return null
  }

  const effectiveOutlineOpen = isMobile ? mobileOutlineOpen : outlineOpen
  const outlineContentPadding = `${getOutlineContentPadding(outlineWidth)}px`
  const handleOutlineToggle = () => {
    if (isMobile) {
      setMobileOutlineOpen((prev) => !prev)
      return
    }
    onToggleOutline?.()
  }

  const handleMobileScrollTop = () => {
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
    editor.view.dom.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  const handleCreateCanvasFromSelection = async (type: 'flowchart' | 'mindmap' | 'timeline' | 'tasks') => {
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, '\n', '\n').trim()
    if (!selectedText) return
    const labels = {
      flowchart: t('bubbleMenu.canvasFlowchart'),
      mindmap: t('bubbleMenu.canvasMindmap'),
      timeline: t('bubbleMenu.canvasTimeline'),
      tasks: t('bubbleMenu.canvasTasks'),
    }
    const titleSource = selectedText.split('\n').find(Boolean)?.slice(0, 32) || labels[type]
    const project = await useCanvasStore.getState().createProject('blank', titleSource)
    if (!project) return
    await useArticleStore.getState().addTab(createCanvasTab(project))
    await useSidebarStore.getState().setLeftSidebarTab('canvases')
    if (!useSidebarStore.getState().rightSidebarVisible) await useSidebarStore.getState().toggleRightSidebar()
    const instruction = t(`bubbleMenu.canvasPrompts.${type}`)
    useChatStore.getState().setOnboardingPromptDraft(
      `${instruction}\n\n${t('bubbleMenu.canvasSource')}\n---\n${selectedText.slice(0, 12000)}\n---\n${t('bubbleMenu.canvasPromptSuffix')}`
    )
  }

  return (
    <div
      ref={editorContainerRef}
      id={isSectionScope ? undefined : 'aritcle-md-editor'}
      className={cn(
        "tiptap-editor relative flex select-none flex-col",
        scrollable ? "h-full" : "h-auto min-h-full",
        !contentInset && "tiptap-editor-no-inset"
      )}
      data-editor-line-height={applyLayoutPreferences ? editorLineHeight : undefined}
      style={
        applyLayoutPreferences
          ? {
              '--editor-line-height': EDITOR_LINE_HEIGHT_VALUES[editorLineHeight],
            } as CSSProperties
          : undefined
      }
    >
      {developerMode && developerPerformanceInfo && !isSectionScope ? (
        <div className="pointer-events-none absolute left-3 top-3 z-40 rounded-md border bg-background/90 px-2.5 py-2 font-mono text-[11px] leading-5 text-muted-foreground shadow-sm backdrop-blur">
          <div>{t('developerPerformance.documentSize')}: {formatDeveloperDocumentSize(sourceMarkdown)}</div>
          <div>{t('developerPerformance.mode')}: {isLargeDocument ? t('developerPerformance.largeDocument') : t('developerPerformance.standardDocument')}</div>
          <div>{t('developerPerformance.view')}: {effectiveViewMode}</div>
          <div>{t('developerPerformance.renderTime')}: {editorRenderDurationMs === null ? '—' : `${editorRenderDurationMs.toFixed(1)} ms`}</div>
        </div>
      ) : null}
      {selfHostedCollaborators.length > 0 ? (
        <div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-full border bg-background/90 px-2 py-1 shadow-sm backdrop-blur">
          {selfHostedCollaborators.slice(0, 3).map(collaborator => (
            <span key={collaborator.deviceId} className="grid size-6 place-items-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground" title={collaborator.label}>
              {collaborator.label.slice(0, 1).toUpperCase()}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">{selfHostedCollaborators.length}</span>
        </div>
      ) : null}
      {isMobile && effectiveViewMode === 'visual' && !isSectionVirtualView && (
        <MobileEditorContextBar
          mode={mobileContext?.mode ?? 'text'}
          previewText={mobileContext?.mode === 'text' ? mobileContext.previewText : undefined}
          activeActions={[
            ...(showEditorUndoRedo ? ['undo', 'redo'] : []),
            ...(mobileContext?.actions ?? getMobileContextPrimaryActions('text')),
          ]}
          onAction={runMobileEditorAction}
        />
      )}

      {/* Editor content - scrollable area */}
      <div className={cn('relative min-h-0', scrollable ? 'flex-1' : 'min-h-full')}>
        {isSectionVirtualView && !showFooterBar ? (
          <div className="pointer-events-none absolute right-3 top-3 z-30">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="pointer-events-auto bg-background/95 shadow-sm backdrop-blur"
              onClick={handleToggleViewMode}
            >
              <FileCode2 data-icon="inline-start" />
              {t('largeMarkdownMode.sectioned.returnToSource')}
            </Button>
          </div>
        ) : null}
        <div
          ref={scrollContainerRef}
          id={scrollContainerId}
          data-editor-viewport-root={scrollable ? 'true' : undefined}
          className={cn(
            "editor-scroll-container relative",
            scrollable && effectiveViewMode === 'source'
              ? "h-full overflow-x-hidden overflow-y-hidden overscroll-y-contain"
              : scrollable
                ? "h-full overflow-x-hidden overflow-y-auto overscroll-y-contain"
                : "overflow-x-clip overflow-y-visible",
            scrollable && !isMobile && "editor-scroll-container-custom",
            isMobile && "mobile-under-dock-scroll mobile-writing-editor-scroll",
            isMobile && activeFilePath && isRestoringMobileView && "opacity-0"
          )}
          onMouseDownCapture={isSectionVirtualView ? undefined : handleEditorMouseDownCapture}
          onScroll={handleEditorScroll}
          onDragEnter={effectiveViewMode === 'visual' && !isSectionVirtualView ? handleEditorDragOver : undefined}
          onDragOver={effectiveViewMode === 'visual' && !isSectionVirtualView ? handleEditorDragOver : undefined}
          onDragLeave={effectiveViewMode === 'visual' && !isSectionVirtualView ? handleEditorDragLeave : undefined}
          onDropCapture={effectiveViewMode === 'visual' && !isSectionVirtualView ? handleEditorDrop : undefined}
        >
        {(isCanvasDragOver || isCanvasDropPending) && (
          <div className={cn(
            'pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-primary/60 bg-primary/5 transition-colors duration-150',
            isCanvasDropPending && 'border-transparent bg-transparent'
          )}>
            <div className="flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-sm text-foreground shadow-md backdrop-blur">
              {isCanvasDropPending && <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />}
              <span>{t(isCanvasDropPending ? 'canvasDrop.generating' : 'canvasDrop.hint')}</span>
            </div>
          </div>
        )}
        <div
          className={cn(
            effectiveViewMode === 'source'
              ? 'w-full'
              : getEditorContentContainerClass({
                contentWidth: applyLayoutPreferences
                  ? editorContentWidth
                  : DEFAULT_EDITOR_CONTENT_WIDTH,
                isMobile,
                outlineOpen: !isSectionVirtualView && !!outlineOpen,
                outlinePosition,
                contentInset,
              }),
            scrollable && effectiveViewMode !== 'source' && !isSectionVirtualView && 'h-full',
            isSectionVirtualView && 'min-h-full',
            effectiveViewMode === 'source' && 'h-full min-h-0'
          )}
          style={
            !isMobile
            && effectiveViewMode !== 'source'
            && !isSectionVirtualView
            && outlineOpen
            && !outlineInLayout
              ? {
                [isOutlineOnLeft(outlinePosition) ? 'paddingLeft' : 'paddingRight']: outlineContentPadding,
              }
              : undefined
          }
        >
        {effectiveViewMode === 'source' ? (
          <div className="flex h-full min-h-0 w-full flex-col">
            {markdownParseError ? (
              <div className="m-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-destructive">{t('markdownParseFallback.title')}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {t('markdownParseFallback.description')}
                  </p>
                  <p className="mt-1 max-h-12 overflow-auto break-words font-mono text-xs text-destructive">
                    {markdownParseError}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isPreparingLargeDocumentVisual}
                  onClick={handleEnterVisualMode}
                >
                  {isPreparingLargeDocumentVisual ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : null}
                  {t('markdownParseFallback.retry')}
                </Button>
              </div>
            ) : null}
            {isLargeDocument && (shouldDeferVisualParsing || isPreparingLargeDocumentVisual) && !markdownParseError ? (
              <div className="m-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{t('largeMarkdownMode.title')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('largeMarkdownMode.description')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPreparingLargeDocumentVisual}
                  onClick={handleEnterVisualMode}
                >
                  {isPreparingLargeDocumentVisual ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Eye data-icon="inline-start" />
                  )}
                  {isPreparingLargeDocumentVisual
                    ? t('largeMarkdownMode.preparing')
                    : t('largeMarkdownMode.openVisual')}
                </Button>
              </div>
            ) : null}
            <SourceMarkdownEditor
              key={activeFilePath}
              value={sourceMarkdown}
              editable={editable}
              showLineNumbers={showSourceLineNumbers}
              lineWrapping={editorSourceWrap}
              fontSize={(14 * contentTextScale) / 100}
              lineHeight={EDITOR_LINE_HEIGHT_VALUES[editorLineHeight]}
              ariaLabel={tSourceMode('source')}
              className="min-w-0 flex-1 select-text"
              onChange={handleSourceMarkdownChange}
              onControllerChange={handleSourceControllerChange}
              onSelectionChange={handleSourceSelectionChange}
              onUndoRedoChange={handleSourceUndoRedoChange}
              onViewStateChange={handleSourceViewStateChange}
              onFocusChange={handleSourceFocusChange}
              initialScrollTop={initialEditorViewState?.sourceScrollTop ?? 0}
              selection={sourceSelectionRef.current}
              remoteCursors={selfHostedMarkdownCursors}
            />
          </div>
        ) : isSectionVirtualView ? (
          <SectionedMarkdownEditor
            ref={sectionedEditorControllerRef}
            markdown={sourceMarkdown}
            getCanonicalMarkdown={() => sourceMarkdownRef.current}
            initialActiveSectionId={initialEditorViewState?.sectionId}
            scrollContainerRef={scrollContainerRef}
            className="min-h-full select-text"
            onChange={handleSectionedMarkdownChange}
            onActiveEditorChange={handleActiveSectionEditorChange}
            onSelectionChange={handleSectionedSelectionChange}
            onRequestSourceMode={handleToggleViewMode}
            renderActiveSection={({
              editorKey,
              markdown,
              onDirty,
              onChange: onSectionChange,
              onEditorReady: onSectionEditorReady,
              onBlockingActivityChange: onSectionBlockingActivityChange,
            }) => (
              <TipTapEditor
                key={editorKey}
                initialContent={markdown}
                onChange={onSectionChange}
                onContentDirty={onDirty}
                placeholder={placeholderText}
                editable={editable}
                activeFilePath={activeFilePath}
                onEditorReady={onSectionEditorReady}
                onBlockingActivityChange={onSectionBlockingActivityChange}
                outlineOpen={false}
                autoScroll={autoScroll}
                showOverlay={false}
                showFooterBar={false}
                contentInset={false}
                scrollable={false}
                mobileMode={isMobile}
                applyLayoutPreferences={false}
                isActive={isActive}
                onTerminate={onTerminate}
                documentScope="section"
                documentMarkdown={sourceMarkdown}
              />
            )}
          />
        ) : (
          <>
            {editorDragHandleElement ? createPortal(
              <BlockHandleControls
                editor={editor}
                getActiveType={() => getEditorBlockActiveType(
                  editorBlockMenuTargetRef.current ?? editorDragHandleTargetRef.current,
                )}
                canConvert={() => Boolean(getEditorBlockTextSelection(
                  editorBlockMenuTargetRef.current ?? editorDragHandleTargetRef.current,
                ))}
                canMoveUp={() => canMoveEditorBlock(editorBlockMenuTargetRef.current, -1)}
                canMoveDown={() => canMoveEditorBlock(editorBlockMenuTargetRef.current, 1)}
                onAddBelow={(anchor) => openEditorBlockInsertMenu(
                  editorDragHandleTargetRef.current,
                  anchor,
                )}
                onCopyContent={() => copyEditorBlockContent(editorBlockMenuTargetRef.current)}
                onCopyMarkdown={() => copyEditorBlockMarkdown(editorBlockMenuTargetRef.current)}
                onDuplicate={() => duplicateEditorBlock(editorBlockMenuTargetRef.current)}
                onMoveUp={() => moveEditorBlockByOffset(editorBlockMenuTargetRef.current, -1)}
                onMoveDown={() => moveEditorBlockByOffset(editorBlockMenuTargetRef.current, 1)}
                onClearFormatting={() => clearEditorBlockFormatting(editorBlockMenuTargetRef.current)}
                onDelete={() => deleteEditorBlock(editorBlockMenuTargetRef.current)}
                onConvert={(type) => convertEditorBlock(editorBlockMenuTargetRef.current, type)}
                onMenuOpenChange={(open) => {
                  editorBlockMenuOpenRef.current = open
                  editorDragHandleElement.dataset.menuOpen = String(open)

                  if (open) {
                    const target = editorDragHandleTargetRef.current
                    editorBlockMenuTargetRef.current = target
                      ? { ...target, expectedDoc: target.editor.state.doc }
                      : null
                  }

                  if (!editor.isDestroyed) {
                    if (open) {
                      editor.commands.lockDragHandle()
                    } else {
                      editor.commands.unlockDragHandle()
                    }
                  }

                  if (!open) {
                    editorBlockMenuTargetRef.current = null
                  }
                }}
              />,
              editorDragHandleElement,
            ) : null}
            <EditorContent editor={editor} className={cn("relative select-text", scrollable && "h-full")}>
              <SmartFileLink editor={editor} activeFilePath={activeFilePath} />

              {!isMobile && <ImageBubbleMenu editor={editor} />}

              <AISuggestionFloating
                editor={editor}
                onPendingChange={handleAiSuggestionPendingChange}
              />

              {!isMobile && <FloatingTableMenu editor={editor} />}

              {!isMobile && (
                <BubbleMenuComponent
                  editor={editor}
                  onAIPolish={handleAIPolish}
                  onAIConcise={handleAIConcise}
                  onAIExpand={handleAIExpand}
                  onAITranslate={handleAITranslate}
                  onCreateCanvas={type => void handleCreateCanvasFromSelection(type)}
                  openAiMenuSignal={openAiMenuSignal}
                  openTranslateMenuSignal={openTranslateMenuSignal}
                  openLinkInputSignal={openLinkInputSignal}
                />
              )}
            </EditorContent>

            <SearchReplacePanel
              editor={editor}
              open={searchReplaceOpen}
              focusRequest={searchFocusRequest}
              onOpenChange={setSearchReplaceOpen}
            />
          </>
        )}
        </div>
        </div>
        {scrollable && !isMobile && effectiveViewMode === 'visual' ? (
          <EditorScrollbar
            refreshKey={viewMode}
            scrollContainerId={scrollContainerId}
            scrollContainerRef={scrollContainerRef}
          />
        ) : null}
      </div>

      {isMobile && showMobileScrollTop && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="返回顶部"
          className="mobile-scroll-top-button absolute right-4 size-11 rounded-full border-border/70 bg-background/90 text-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75"
          onMouseDown={(event) => event.preventDefault()}
          onClick={handleMobileScrollTop}
        >
          <ArrowUp className="size-5" />
        </Button>
      )}

      {isMobile && effectiveViewMode === 'visual' && !isSectionVirtualView && showMobileEditorToolbar && !mobileContext && (
        <MobileWritingToolbar
          activeActions={mobileWritingActiveActions}
          onAction={runMobileWritingAction}
        />
      )}

      {isMobile && (
        <MobileEditorMoreSheet
          open={mobileSheetMode !== null}
          mode={mobileSheetMode}
          imageSrc={imageSrcDraft}
          imageAlt={imageAltDraft}
          customAiInstruction={customAiInstruction}
          onOpenChange={(open) => {
            if (!open) {
              setMobileSheetMode(null)
            }
          }}
          onImageSrcChange={setImageSrcDraft}
          onImageAltChange={setImageAltDraft}
          onCustomAiInstructionChange={setCustomAiInstruction}
          onSubmitImageSrc={submitMobileImageSrc}
          onSubmitImageAlt={submitMobileImageAlt}
          onSubmitCustomAiInstruction={submitMobileCustomAiInstruction}
          onAction={runMobileEditorAction}
        />
      )}

      {isMobile && !isSectionVirtualView && (
        <Outline
          editor={editor}
          isOpen={mobileOutlineOpen}
          variant="drawer"
          onHeadingSelect={() => setMobileOutlineOpen(false)}
        />
      )}

      {/* AI Generation Overlay */}
      {showOverlay && (
        <div className="absolute inset-0 z-50 flex items-start justify-end p-4 bg-background/20 pointer-events-none">
          <div className="flex items-center gap-2 bg-background/90 border rounded-md px-3 py-2 shadow-md pointer-events-auto">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">AI 整理中</span>
            {onTerminate && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={onTerminate}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
        </div>
      )}

      {showFooterBar ? (
        <MainStatusBarPortal active={isActive} inline={isMobile || standalone}>
          <FooterBar
            editor={activeSectionEditor ?? editor}
            outlineOpen={isSectionVirtualView ? false : effectiveOutlineOpen}
            onToggleOutline={isSectionVirtualView ? undefined : handleOutlineToggle}
            viewMode={effectiveViewMode}
            onToggleViewMode={applyLayoutPreferences ? handleToggleViewMode : undefined}
            sourceMarkdown={usesCanonicalMarkdown ? sourceMarkdown : undefined}
            getMarkdown={getCurrentMarkdownSnapshot}
            prepareExternalAction={prepareExternalMarkdownAction}
            onMarkdownChange={isSourceView
              ? handleSourceMarkdownChange
              : isSectionVirtualView
                ? handleSectionedMarkdownChange
                : undefined}
            deferSourceStatistics={isLargeDocument && usesCanonicalMarkdown}
            embedded={!isMobile && !standalone}
          />
        </MainStatusBarPortal>
      ) : null}

      {!isSectionVirtualView ? <SlashCommandPortal /> : null}

      {mathDialogOpen ? (
        <MathEditorDialog
          open={mathDialogOpen}
          onOpenChange={setMathDialogOpen}
          onInsert={handleMathInsert}
          type={mathType}
          title={mathType === 'inline' ? '插入行内公式' : '插入块级公式'}
        />
      ) : null}
    </div>
  )
}

export default TipTapEditor

function formatDeveloperDocumentSize(markdown: string): string {
  const bytes = new TextEncoder().encode(markdown).byteLength
  const formattedBytes = bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 ** 2
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${formattedBytes} · ${markdown.length.toLocaleString()}`
}
