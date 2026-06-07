'use client'

import { useEditor, EditorContent } from '@tiptap/react'
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
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import Image from '@tiptap/extension-image'
import { common, createLowlight } from 'lowlight'
import { Markdown } from '@tiptap/markdown'
import { SearchAndReplace } from '@sereneinserenade/tiptap-search-and-replace'
import UniqueId from '@tiptap/extension-unique-id'
import { Extension, nodeInputRule, ResizableNodeView, type Editor as CoreEditor, type ResizableNodeViewDirection } from '@tiptap/core'
import { AllSelection, Plugin, PluginKey, TextSelection, type Selection } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import 'katex/dist/katex.min.css'
import { InlineMath, BlockMath } from './math-extension'
import { MermaidDiagram } from './mermaid-extension'
import { MathEditorDialog } from './math-editor-dialog'
import { SearchReplacePanel } from './search-replace-panel'
import { useEffect, useRef, useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { openUrl } from '@tauri-apps/plugin-opener'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { handleImageUpload } from '@/lib/image-handler'
import useArticleStore from '@/stores/article'
import { convertImageByWorkspace } from '@/lib/utils'
import { resolveImagePathFromMarkdown } from '@/lib/markdown-image-path'
import { isMobileDevice } from '@/lib/check'
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
import { fetchCompletionStream } from '@/lib/ai/completion'
import { fetchAiPolishStream, fetchAiConciseStream, fetchAiExpandStream } from '@/lib/ai/rewrite'
import { fetchAiTranslateStream } from '@/lib/ai/translate'
import { AISuggestion } from './ai-suggestion'
import { AISuggestionFloating } from './ai-suggestion-floating'
import emitter from '@/lib/emitter'
import { QuoteMark } from './quote-mark'
import { MarkdownParagraph, normalizeMarkdownPlaceholders } from './markdown-paragraph'
import { StableCodeBlockLowlight } from './code-block-extension'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'
import useSettingStore from '@/stores/setting'
import useChatStore, { type PendingQuote } from '@/stores/chat'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { buildMobileSelectionContext, isMobileSelectionContextStale } from './mobile-selection-context'
import { MobileEditorContextBar } from './mobile-editor-context-bar'
import { MobileEditorMoreSheet } from './mobile-editor-more-sheet'
import { shouldRestorePendingQuote } from './quote-session'
import { getEditorContentContainerClass } from '@/lib/editor-layout-styles'
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
import './style.css'

const lowlight = createLowlight(common)

const IMAGE_RESIZE_DIRECTIONS: ResizableNodeViewDirection[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
]

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

function applyImageNodeAttributes(element: HTMLImageElement, attrs: Record<string, unknown>) {
  const src = typeof attrs.src === 'string' ? attrs.src : ''
  const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
  const title = typeof attrs.title === 'string' ? attrs.title : ''
  const relativeSrc = typeof attrs.relativeSrc === 'string' ? attrs.relativeSrc : ''
  const width = parseImageDimension(attrs.width)
  const height = parseImageDimension(attrs.height)
  const currentSrc = element.getAttribute('src')
  const currentRelativeSrc = element.getAttribute('data-relative-src') || ''
  const shouldKeepConvertedSrc =
    Boolean(relativeSrc) &&
    currentRelativeSrc === relativeSrc &&
    shouldTransformImageSrcToWorkspaceAsset(src) &&
    currentSrc !== src

  if (!shouldKeepConvertedSrc && currentSrc !== src) {
    element.setAttribute('src', src)
  }

  element.setAttribute('alt', alt)
  element.className = 'max-w-full rounded-lg'

  if (title) {
    element.setAttribute('title', title)
  } else {
    element.removeAttribute('title')
  }

  if (relativeSrc) {
    element.setAttribute('data-relative-src', relativeSrc)
  } else {
    element.removeAttribute('data-relative-src')
  }

  if (width) {
    element.setAttribute('width', String(width))
    element.style.width = `${width}px`
  } else {
    element.removeAttribute('width')
    element.style.removeProperty('width')
  }

  if (height) {
    element.setAttribute('height', String(height))
    element.style.height = `${height}px`
  } else {
    element.removeAttribute('height')
    element.style.removeProperty('height')
  }
}

// 自定义扩展：处理粘贴 Markdown 文本
const PasteMarkdown = Extension.create({
  name: 'pasteMarkdown',

  addProseMirrorPlugins() {
    const { editor } = this
    return [
      new Plugin({
        props: {
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
  placeholder?: string
  editable?: boolean
  activeFilePath?: string
  onReady?: () => void
  onEditorReady?: (editor: any) => void
  outlineOpen?: boolean
  outlinePosition?: OutlinePosition
  outlineWidth?: number
  onToggleOutline?: () => void
  autoScroll?: boolean
  showOverlay?: boolean
  onTerminate?: () => void
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

type MobileSheetMode = 'ai' | 'image-src' | 'image-alt' | 'table-align' | 'table-more' | null

function clampSelectionPosition(value: number, docSize: number): number {
  return Math.max(0, Math.min(value, docSize))
}

export function TipTapEditor({
  initialContent,
  onChange,
  placeholder,
  editable = true,
  activeFilePath = '',
  onReady,
  onEditorReady,
  outlineOpen,
  outlinePosition = 'right',
  outlineWidth = DEFAULT_OUTLINE_WIDTH,
  onToggleOutline,
  autoScroll = false,
  showOverlay = false,
  onTerminate,
}: TipTapEditorProps) {
  const t = useTranslations('editor')
  const tMermaid = useTranslations('editor.mermaid.templates')
  const tImage = useTranslations('editor.image')
  const pendingQuote = useChatStore((state) => state.pendingQuote)
  const pendingSearchKeyword = useArticleStore((state) => state.pendingSearchKeyword)
  const setPendingSearchKeyword = useArticleStore((state) => state.setPendingSearchKeyword)
  const setEditorViewState = useArticleStore((state) => state.setEditorViewState)
  const getEditorViewState = useArticleStore((state) => state.getEditorViewState)

  const placeholderText = placeholder || t('placeholder')
  const isMobile = isMobileDevice()

  // Use ref for autoScroll to avoid infinite re-render loop
  const autoScrollRef = useRef(autoScroll)
  autoScrollRef.current = autoScroll

  // 获取正文缩放设置
  const { contentTextScale } = useSettingStore()

  // 居中内容设置
  const [centeredContent, setCenteredContent] = useState(false)

  // 编辑器容器 ref，用于应用字体缩放
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Math dialog state
  const [mathDialogOpen, setMathDialogOpen] = useState(false)
  const [mathType, setMathType] = useState<'inline' | 'block'>('inline')

  // Search and replace panel state
  const [searchReplaceOpen, setSearchReplaceOpen] = useState(false)
  const [mobileContext, setMobileContext] = useState<MobileSelectionContext>(null)
  const [mobileSheetMode, setMobileSheetMode] = useState<MobileSheetMode>(null)
  const [mobileOutlineOpen, setMobileOutlineOpen] = useState(false)
  const [imageSrcDraft, setImageSrcDraft] = useState('')
  const [imageAltDraft, setImageAltDraft] = useState('')
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
  const pendingSyncUpdateRef = useRef<{ path: string; content: string } | null>(null)
  const restoredViewPathRef = useRef<string | null>(null)
  const lastViewStateRef = useRef<{ path: string; selectionFrom: number; selectionTo: number; scrollTop: number } | null>(null)

  // 读取居中内容设置（移动端强制关闭）
  useEffect(() => {
    async function loadCenteredContent() {
      // 移动端强制关闭居中内容
      if (isMobileDevice()) {
        setCenteredContent(false)
        return
      }
      const store = await Store.load('store.json');
      const centered = await store.get<boolean>('centeredContent') || false
      setCenteredContent(centered)
    }
    loadCenteredContent()
  }, [])
  // Bug fix: Track when editor is ready (has caught up with content)
  const isReadyRef = useRef(false)
  // Bug fix: Track if this is the first onUpdate after initialization
  const isFirstUpdateRef = useRef(true)

  // Content version ref for race condition prevention between editor and agent
  const contentVersionRef = useRef(0)
  const editorShortcuts = useEditorShortcutStore((state) => state.shortcuts)
  const editorShortcutsRef = useRef(editorShortcuts)
  const editorShortcutHandlersRef = useRef<Partial<Record<EditorShortcutCommandId, (targetEditor: CoreEditor) => boolean>>>({})
  const [openAiMenuSignal, setOpenAiMenuSignal] = useState(0)
  const [openTranslateMenuSignal, setOpenTranslateMenuSignal] = useState(0)
  const [openLinkInputSignal, setOpenLinkInputSignal] = useState(0)

  useEffect(() => {
    editorShortcutsRef.current = editorShortcuts
  }, [editorShortcuts])

  const runEditorShortcutCommand = useCallback((id: EditorShortcutCommandId, targetEditor: CoreEditor) => {
    return editorShortcutHandlersRef.current[id]?.(targetEditor) ?? false
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
    }
  }, [activeFilePath])

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      EditorShortcutsExtension.configure({
        getShortcuts: () => editorShortcutsRef.current,
        runCommand: runEditorShortcutCommand,
      }),
      StarterKit.configure({
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
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      StableCodeBlockLowlight.configure({
        lowlight,
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
      Table.configure({
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
      UniqueId.configure({
        attributeName: 'data-id',
        types: ['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'bulletList', 'orderedList', 'taskItem', 'table', 'tableRow', 'tableCell', 'tableHeader'],
      }),
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

          const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize

          return ({ node, getPos, editor }) => {
            const element = document.createElement('img')
            applyImageNodeAttributes(element, node.attrs)

            const nodeView = new ResizableNodeView({
              element,
              editor,
              node,
              getPos,
              onResize: (width, height) => {
                element.style.width = `${width}px`
                element.style.height = `${height}px`
              },
              onCommit: (width, height) => {
                const pos = getPos()

                if (typeof pos !== 'number') {
                  return
                }

                editor
                  .chain()
                  .setNodeSelection(pos)
                  .updateAttributes(this.name, {
                    width,
                    height,
                  })
                  .run()
              },
              onUpdate: (updatedNode) => {
                if (updatedNode.type !== node.type) {
                  return false
                }

                applyImageNodeAttributes(element, updatedNode.attrs)
                return true
              },
              options: {
                directions,
                min: {
                  width: minWidth,
                  height: minHeight,
                },
                preserveAspectRatio: alwaysPreserveAspectRatio === true,
                className: {
                  container: 'image-resize-container',
                  wrapper: 'image-resize-wrapper',
                  handle: 'image-resize-handle',
                  resizing: 'image-resize-active',
                },
              },
            })

            const dom = nodeView.dom as HTMLElement
            const revealNodeView = () => {
              dom.style.visibility = ''
              dom.style.pointerEvents = ''
            }

            dom.style.visibility = 'hidden'
            dom.style.pointerEvents = 'none'
            element.onload = revealNodeView
            element.onerror = revealNodeView

            if (element.complete) {
              revealNodeView()
            }

            return nodeView
          }
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
          directions: IMAGE_RESIZE_DIRECTIONS,
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
    ],
    content: initialContent,
    contentType: 'markdown',
    editable,
    onUpdate: ({ editor }) => {
      // Bug fix: Only trigger onChange if editor is ready (not during initialization)
      // Using counter to handle rapid successive updates
      if (externalUpdateCounterRef.current === 0 && isReadyRef.current) {
        const markdown = normalizeMarkdownPlaceholders(editor.getMarkdown())
        onChange?.(markdown)
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
    if (!editor || !activeFilePath || !scrollContainerRef.current) {
      return
    }

    if (restoredViewPathRef.current !== activeFilePath) {
      return
    }

    const { selection } = editor.state
    const docSize = editor.state.doc.content.size
    const previousState = lastViewStateRef.current
    let selectionFrom = selection.from
    let selectionTo = selection.to

    if (isFullDocumentSelection(selection, docSize)) {
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
    }

    if (
      previousState &&
      previousState.path === nextState.path &&
      previousState.selectionFrom === nextState.selectionFrom &&
      previousState.selectionTo === nextState.selectionTo &&
      previousState.scrollTop === nextState.scrollTop
    ) {
      return
    }

    lastViewStateRef.current = nextState
    setEditorViewState(activeFilePath, {
      selectionFrom,
      selectionTo,
      scrollTop: nextState.scrollTop,
    })
  }, [activeFilePath, editor, setEditorViewState])

  useEffect(() => {
    if (!editor || !activeFilePath) {
      return
    }

    const handleSelectionUpdate = () => {
      persistEditorViewState()
    }

    editor.on('selectionUpdate', handleSelectionUpdate)
    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [activeFilePath, editor, persistEditorViewState])

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer || !activeFilePath) {
      return
    }

    const handleScroll = () => {
      persistEditorViewState()
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [activeFilePath, persistEditorViewState])

  useEffect(() => {
    return () => {
      persistEditorViewState()
    }
  }, [persistEditorViewState])

  const restoreEditorViewState = useCallback((path: string, attempt: number = 0) => {
    if (!editor || !path || !scrollContainerRef.current) {
      return
    }

    if (restoredViewPathRef.current === path) {
      return
    }

    const savedViewState = getEditorViewState(path)

    if (!savedViewState) {
      restoredViewPathRef.current = path
      lastViewStateRef.current = {
        path,
        selectionFrom: editor.state.selection.from,
        selectionTo: editor.state.selection.to,
        scrollTop: scrollContainerRef.current.scrollTop,
      }
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

      editor.chain().focus().setTextSelection({
        from: selectionFrom,
        to: selectionTo,
      }).run()

      requestAnimationFrame(() => {
        if (!scrollContainerRef.current) {
          return
        }

        scrollContainerRef.current.scrollTop = savedViewState.scrollTop
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
  }, [editor, getEditorViewState, setEditorViewState])

  // 处理编辑器内链接点击
  useEffect(() => {
    if (!editor || !editorContainerRef.current) return

    const editorElement = editorContainerRef.current

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const anchor = target.closest('a')

      if (!anchor) return

      let href = anchor.getAttribute('href')
      if (!href) return

      // 阻止默认行为
      event.preventDefault()
      // 阻止事件冒泡，防止其他处理器触发
      event.stopPropagation()

      // 处理 file:// 协议
      if (href.startsWith('file://')) {
        href = href.replace(/^file:\/\//, '')
        // Windows 路径处理
        if (href.startsWith('/') && !href.match(/^[A-Z]:/)) {
          href = href.substring(1)
        }
        openUrl(`file://${href}`).catch(console.error)
        return
      }

      // 检查是否是本地开发服务器的 URL (localhost 或 127.0.0.1)
      const isLocalUrl = href.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//)

      // 根据链接类型执行不同操作
      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (isLocalUrl) {
          // 本地开发服务器 URL，提取路径部分作为本地文件
          const url = new URL(href)
          let filePath = url.pathname
          // 移除开头的斜杠（如果是 Unix 风格路径）
          if (filePath.startsWith('/')) {
            filePath = filePath.substring(1)
          }
          // Windows 路径处理
          if (filePath.match(/^[A-Z]:/)) {
            // 已经是 Windows 绝对路径
          } else if (filePath.startsWith('/')) {
            filePath = filePath.substring(1)
          }
          // URL 解码
          filePath = decodeURIComponent(filePath)

          // 获取当前文件的父目录，计算相对路径
          const currentFilePath = useArticleStore.getState().activeFilePath
          let fullPath: string

          if (filePath.startsWith('/') || filePath.match(/^[A-Z]:/)) {
            // 绝对路径
            fullPath = filePath
          } else {
            // 相对路径，基于当前文件所在目录
            const parentDir = currentFilePath.includes('/')
              ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
              : ''
            fullPath = parentDir ? `${parentDir}/${filePath}` : filePath
          }

          // 在软件内部打开文件
          useArticleStore.getState().setActiveFilePath(fullPath)
          return
        } else {
          // 外部 HTTP/HTTPS 链接：用浏览器打开
          openUrl(href).catch(console.error)
          return
        }
      } else if (href.startsWith('mailto:') || href.startsWith('tel:')) {
        // 邮件和电话链接，用默认应用打开
        openUrl(href).catch(console.error)
        return
      } else {
        // 本地路径相对路径，基于当前文件所在目录
        const currentFilePath = useArticleStore.getState().activeFilePath
        let fullPath: string

        if (href.startsWith('/') || href.match(/^[A-Z]:/)) {
          // 绝对路径
          fullPath = href
        } else {
          // 相对路径
          const parentDir = currentFilePath.includes('/')
            ? currentFilePath.substring(0, currentFilePath.lastIndexOf('/'))
            : ''
          fullPath = parentDir ? `${parentDir}/${href}` : href
        }

        // 在软件内部打开文件
        useArticleStore.getState().setActiveFilePath(fullPath)
        return
      }
    }

    editorElement.addEventListener('click', handleClick)

    return () => {
      editorElement.removeEventListener('click', handleClick)
    }
  }, [editor])

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

  const runMobileEditorAction = useCallback((action: string) => {
    if (!editor || !mobileContext) return

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
        return
    }
  }, [
    editor,
    mobileContext,
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
    if (!editor) return

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
  }, [editor, pendingQuote, activeFilePath])

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

  // Track active file path for image uploads (ref to avoid re-initializing editor)
  const activeFilePathRef = useRef(activeFilePath)
  useEffect(() => {
    activeFilePathRef.current = activeFilePath
  }, [activeFilePath])

  // Handle image paste and drop
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = event.clipboardData?.files
      if (!files || files.length === 0) return

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const imageFile = imageFiles[0]

      // Prevent default to avoid base64 image being inserted
      event.preventDefault()

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
          // Remove the placeholder on error
          editor.chain()
            .focus()
            .deleteRange({ from: placeholderStart, to: placeholderEnd })
            .run()

          // Show error toast
          console.error('Image upload failed:', error)
          toast({
            title: tImage('failed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'destructive',
          })
        })
    }

    const handleDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return

      const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return

      const imageFile = imageFiles[0]

      // Prevent default to avoid base64 image being inserted
      event.preventDefault()

      // Get drop position
      const pos = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
      const insertPos = pos?.pos || editor.state.selection.from

      // Insert "Uploading..." text as placeholder
      editor.chain()
        .focus()
        .insertContentAt(insertPos, {
          type: 'text',
          text: 'Uploading... ',
        })
        .run()

      // Get the position range of the placeholder
      const placeholderStart = insertPos
      const placeholderEnd = insertPos + 'Uploading... '.length

      handleImageUpload(imageFile, activeFilePathRef.current)
        .then(result => {
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
          // Remove the placeholder on error
          editor.chain()
            .focus()
            .deleteRange({ from: placeholderStart, to: placeholderEnd })
            .run()

          // Show error toast
          console.error('Image upload failed:', error)
          toast({
            title: tImage('failed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'destructive',
          })
        })
    }

    // Add event listeners to editor DOM element
    // Check if editor is fully initialized first
    if (!editor.view || !editor.view.dom) return
    const dom = editor.view.dom
    dom.addEventListener('paste', handlePaste as EventListener)
    dom.addEventListener('drop', handleDrop as EventListener)

    return () => {
      dom.removeEventListener('paste', handlePaste as EventListener)
      dom.removeEventListener('drop', handleDrop as EventListener)
    }
  }, [editor])

  // Handle copy event to output Markdown format
  useEffect(() => {
    // Check if editor is fully initialized
    if (!editor || !editor.view || !editor.view.dom) return

    const handleCopy = (event: ClipboardEvent) => {
      const { from, to } = editor.state.selection

      // If there's no selection, let browser handle the default copy
      if (from === to) {
        return
      }

      // Check if markdown extension is available
      if (!editor.markdown) {
        return
      }

      // Get the selected content as Markdown
      const slice = editor.state.doc.slice(from, to)
      // Wrap in doc node for proper serialization
      const json = { type: 'doc', content: slice.content.toJSON() }
      const markdown = editor.markdown.serialize(json)

      // Write Markdown to clipboard
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', markdown)
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

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'polish',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
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
    }
  }, [editor])

  // Handle AI Concise - simplify selected text (with streaming and suggestion mode)
  const handleAIConcise = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

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

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'concise',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
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
    }
  }, [editor])

  // Handle AI Expand - expand selected text (with streaming and suggestion mode)
  const handleAIExpand = useCallback(async () => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

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

      // Streaming complete - replace all content with proper Markdown parsing
      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      // Send completion event
      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'expand',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
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
    }
  }, [editor])

  const handleAITranslate = useCallback(async (targetLanguage: string) => {
    if (!editor) return

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to)

    if (!selectedText.trim()) {
      return
    }

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

      editor.chain()
        .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
        .insertContent(accumulatedResult, { contentType: 'markdown' })
        .run()

      const finalCoords = editor.view.coordsAtPos(startPosition + accumulatedResult.length)
      emitter.emit('ai-streaming-complete', {
        originalText: selectedText,
        suggestedText: accumulatedResult,
        type: 'translate',
        position: finalCoords,
        generatedRange: { from: startPosition, to: startPosition + accumulatedResult.length },
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
    }
  }, [editor])

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
      const file = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
          },
        ],
      })

      if (!file) {
        editor.chain().focus().deleteRange({ from: insertPos, to: placeholderEnd }).run()
        return
      }

      let fileObject: File

      if (typeof file === 'string') {
        const fileData = await readFile(file)
        const ext = file.split('.').pop() || 'png'
        const fileName = file.split('/').pop() || `image.${ext}`
        const arrayBuffer = new Uint8Array(fileData).buffer
        fileObject = new File([arrayBuffer], fileName, { type: `image/${ext}` })
      } else {
        fileObject = file
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
    }
  }, [activeFilePath, editor, tImage])

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
        setSearchReplaceOpen(true)
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

        if (initialContent) {
          editor.commands.setContent(initialContent || '', { contentType: 'markdown' })
        }
        // Mark as initialized to allow subsequent content updates
        isInitializedRef.current = true
        // Bug fix: Mark editor as ready AFTER content is set
        // This prevents onUpdate from firing with empty content during init
        isReadyRef.current = true
        // Notify mobile editor that editor is ready
        onReady?.()
        // Notify parent component about editor instance
        onEditorReady?.(editor)
        restoreEditorViewState(currentPath)
      }, 0)
    }
  }, [editor, initialContent, onReady, onEditorReady, activeFilePath, restoreEditorViewState])

  // 处理编辑器中图片的相对路径，转换为 asset:// URL
  useEffect(() => {
    if (!editor || !editor.view) return

    const transformImagePaths = () => {
      // 获取编辑器 DOM 中的所有图片
      const editorDom = editor.view.dom
      const images = editorDom.querySelectorAll('img')

      const currentFilePath = useArticleStore.getState().activeFilePath

      for (const img of images) {
        const src = img.getAttribute('src')
        // 如果是相对路径，转换为 asset://
        if (src && currentFilePath && shouldTransformImageSrcToWorkspaceAsset(src)) {
          const fullRelativePath = resolveImagePathFromMarkdown(currentFilePath, src)
          // 异步转换路径
          convertImageByWorkspace(fullRelativePath).then((assetUrl: string) => {
            // 只有当 src 仍然是相对路径时才更新（避免覆盖已转换的）
            const currentSrc = img.getAttribute('src')
            if (currentSrc === src || !currentSrc?.startsWith('asset://')) {
              img.setAttribute('src', assetUrl)
            }
          })
        }
        // 添加 onerror 处理：如果加载失败，尝试转换路径
        if (img && !img.onerror) {
          img.onerror = async () => {
            const currentSrc = img.getAttribute('src')
            if (currentSrc && currentFilePath && shouldTransformImageSrcToWorkspaceAsset(currentSrc)) {
              const fullRelativePath = resolveImagePathFromMarkdown(currentFilePath, currentSrc)
              const assetUrl = await convertImageByWorkspace(fullRelativePath)
              img.setAttribute('src', assetUrl)
            }
          }
        }
      }
    }

    // 监听 transaction 事件 - 在文档更新时立即转换
    const handleTransaction = () => {
      transformImagePaths()
    }

    // 监听 selectionUpdate 事件
    const handleSelectionUpdate = () => {
      transformImagePaths()
    }

    editor.on('transaction', handleTransaction)
    editor.on('selectionUpdate', handleSelectionUpdate)

    // 初始执行
    transformImagePaths()

    return () => {
      editor.off('transaction', handleTransaction)
      editor.off('selectionUpdate', handleSelectionUpdate)
    }
  }, [editor])

  // Listen to editor transactions and notify header/tab bar about undo/redo state
  useEffect(() => {
    if (!editor) return

    let frameId: number | null = null

    const emitUndoRedoState = () => {
      emitter.emit('editor-undo-redo-changed', {
        undo: editor.can().undo(),
        redo: editor.can().redo()
      })
    }

    emitUndoRedoState()
    const handleTransaction = () => {
      emitUndoRedoState()

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
  }, [editor, activeFilePath])

  // Listen for search trigger from layout (Ctrl+F / Cmd+F)
  useEffect(() => {
    const handleSearchTrigger = () => {
      setSearchReplaceOpen(true)
    }

    emitter.on('editor-search-trigger' as any, handleSearchTrigger)
    return () => {
      emitter.off('editor-search-trigger' as any, handleSearchTrigger)
    }
  }, [])

  useEffect(() => {
    if (!editor || !activeFilePath || !pendingSearchKeyword.trim()) {
      return
    }

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
  }, [editor, activeFilePath, pendingSearchKeyword, setPendingSearchKeyword, initialContent])

  // Handle remote file pull updates via event (instead of initialContent change)
  // This fixes cursor jump issue caused by unnecessary setContent during local saves
  useEffect(() => {
    const handleRemoteContentUpdate = (event: { content: string }) => {
      if (!editor || !event?.content) return

      const currentContent = editor.getMarkdown()
      const newContent = event.content

      // Only update if content actually changed
      if (newContent !== currentContent) {
        isReadyRef.current = false
        externalUpdateCounterRef.current++
        setTimeout(() => {
          editor.commands.setContent(newContent, { contentType: 'markdown' })
          isReadyRef.current = true
          setTimeout(() => {
            externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
          }, 100)
        }, 0)
      }
    }

    emitter.on('editor-content-from-remote', handleRemoteContentUpdate as any)
    return () => {
      emitter.off('editor-content-from-remote', handleRemoteContentUpdate as any)
    }
  }, [editor, activeFilePath])

  // NOTE: Removed initialContent useEffect that caused cursor jump during local edits
  // Remote pull is now handled via 'editor-content-from-remote' event
  // Sync and external updates are handled by their respective events

  // Handle sync content updated from auto-sync
  useEffect(() => {
    const handleSyncContentUpdated = (event: { path: string; content: string }) => {
      // Bug fix: Only update if this is the active file
      if (!editor || !event || event.path !== activeFilePath) return

      // Bug fix: Skip if content hasn't actually changed
      const currentContent = editor.getMarkdown()
      if (currentContent === event.content) return

      // Bug fix: Set pending update and verify path when processing
      pendingSyncUpdateRef.current = event

      // Bug fix: Mark editor as not ready during update
      isReadyRef.current = false
      externalUpdateCounterRef.current++
      // Use setTimeout to avoid flushSync conflict during React render
      setTimeout(() => {
        editor.commands.setContent(event.content, { contentType: 'markdown' })
        // Bug fix: Mark editor as ready after content is set
        isReadyRef.current = true
        // Reset the counter and pending update after a short delay
        setTimeout(() => {
          // Only reset if this is still the same pending update
          if (pendingSyncUpdateRef.current === event) {
            pendingSyncUpdateRef.current = null
          }
          externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
        }, 100)
      }, 0)
    }

    emitter.on('sync-content-updated', handleSyncContentUpdated as any)
    return () => {
      emitter.off('sync-content-updated', handleSyncContentUpdated as any)
    }
  }, [editor, activeFilePath])

  // Handle external content updates (e.g., from Agent tools)
  useEffect(() => {
    const handleExternalUpdate = (newContent: string) => {
      if (editor && externalUpdateCounterRef.current === 0) {
        // Bug fix: Skip if content hasn't actually changed
        const currentContent = editor.getMarkdown()
        if (currentContent === newContent) return

        // Bug fix: Mark editor as not ready during update
        isReadyRef.current = false
        // Set counter first to prevent circular updates
        externalUpdateCounterRef.current++
        // Use setTimeout to avoid flushSync conflict during React render
        setTimeout(() => {
          // Set content in editor with Markdown parsing
          editor.commands.setContent(newContent, { contentType: 'markdown' })
          // Bug fix: Mark editor as ready after content is set
          isReadyRef.current = true
          // Reset the counter after a short delay to handle rapid updates
          setTimeout(() => {
            externalUpdateCounterRef.current = Math.max(0, externalUpdateCounterRef.current - 1)
          }, 100)
        }, 0)
      }
    }

    emitter.on('external-content-update', handleExternalUpdate as any)
    return () => {
      emitter.off('external-content-update', handleExternalUpdate as any)
    }
  }, [editor])

  // Set editable state
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  // Handle AI continue writing
  useEffect(() => {
    let abortController: AbortController | null = null

    const handleAIContinue = async () => {
      if (!editor) return

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

      // Create new AbortController for this request
      abortController = new AbortController()

      // Insert loading indicator at cursor position
      const loadingMark = editor.state.schema.marks.strong
      if (!loadingMark) {
        // If no strong mark available, insert simple text
        editor.chain().focus().insertContent('...').run()
      } else {
        editor.chain().focus().insertContent('···').run()
      }

      // Track accumulated result for streaming
      let accumulatedResult = ''
      const startPosition = from

      try {
        await fetchCompletionStream(
          context,
          (chunk, isFirst) => {
            if (isFirst) {
              // Delete the loading indicator before inserting first chunk
              const { to } = editor.state.selection
              editor.chain().focus().deleteRange({ from: to - 3, to }).run()
            }
            // Insert chunk as plain text during streaming
            editor.chain().focus().insertContent(chunk).run()
            accumulatedResult += chunk
          },
          abortController.signal
        )

        // Streaming complete - replace content with proper Markdown parsing
        if (accumulatedResult) {
          editor.chain()
            .deleteRange({ from: startPosition, to: startPosition + accumulatedResult.length })
            .insertContent(accumulatedResult, { contentType: 'markdown' })
            .run()
        }
      } catch (error) {
        // Delete loading indicator on error
        const { to } = editor.state.selection
        editor.chain().focus().deleteRange({ from: to - 3, to }).run()

        // Show error toast (but not for aborted requests)
        if (error instanceof Error && error.message !== 'Request was aborted.') {
          toast({
            title: '续写失败',
            description: error.message || '网络错误',
            variant: 'destructive',
          })
        }
      }
    }

    document.addEventListener('tiptap-ai-continue', handleAIContinue)
    return () => {
      document.removeEventListener('tiptap-ai-continue', handleAIContinue)
      abortController?.abort()
    }
  }, [editor])

  // Handle drag and drop from marks
  const handleEditorDrop = useCallback((e: React.DragEvent) => {
    const markData = e.dataTransfer.getData('application/json')
    if (markData) {
      try {
        const mark = JSON.parse(markData)
        if (mark && mark.id !== undefined) {
          import('@/lib/mark-to-markdown').then(({ markToMarkdown }) => {
            const markdown = markToMarkdown(mark)
            editor?.commands.insertContent(markdown, { contentType: 'markdown' })
            toast({
              title: '已插入记录',
              description: mark.desc || mark.content?.slice(0, 50) || '记录内容'
            })
          })
        }
      } catch (error) {
        console.error('Failed to parse dropped mark:', error)
      }
    }
  }, [editor])

  // Handle math formula insertion from slash menu
  useEffect(() => {
    if (!editor) return

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
  }, [editor])

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

    // Get editor selection
    const handleGetSelection = ({ resolve }: { resolve: (data: { text: string; from: number; to: number; html?: string; startLine?: number; endLine?: number }) => void }) => {
      if (!editor) {
        resolve({ text: '', from: 0, to: 0, startLine: 1, endLine: 1 })
        return
      }

      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)

      // Calculate line numbers (1-indexed) by counting newlines before position
      const textBeforeFrom = editor.state.doc.textBetween(0, from, '\n', '\n')
      const startLine = (textBeforeFrom.match(/\n/g)?.length || 0) + 1

      const textBeforeTo = editor.state.doc.textBetween(0, to, '\n', '\n')
      const endLine = (textBeforeTo.match(/\n/g)?.length || 0) + 1

      resolve({
        text,
        from,
        to,
        html: editor.getHTML(),
        startLine,
        endLine,
      })
    }

    // Get editor content
    const handleGetContent = ({ resolve }: { resolve: (data: { markdown: string; text: string; wordCount: number; charCount: number; totalLines?: number; numberedLines?: string; version: number }) => void }) => {
      if (!editor) {
        resolve({ markdown: '', text: '', wordCount: 0, charCount: 0, totalLines: 1, numberedLines: '1 | ', version: 0 })
        return
      }

      const markdown = normalizeMarkdownPlaceholders(editor.getMarkdown())
      const text = editor.getText()
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
      })
    }

    // Insert content at cursor
    const handleInsert = ({
      content,
      position,
      resolve,
    }: {
      content: string;
      position?: number;
      resolve: (result: { success: boolean; insertedLength: number; newCursorPosition?: number }) => void;
    }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0 })
        return
      }

      try {
        // Insert content with markdown parsing
        // Wrap in setTimeout to avoid React lifecycle flushSync conflict
        runDeferredEditorCommand(() => {
          if (typeof position === 'number') {
            const insertPosition = clampSelectionPosition(position, editor.state.doc.content.size)
            editor.commands.setTextSelection({ from: insertPosition, to: insertPosition })
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
      content,
      range,
      searchContent,
      occurrence,
      startLine,
      endLine,
      expectedVersion,
      resolve,
    }: {
      content?: string
      range?: { from: number; to: number }
      searchContent?: string
      occurrence?: number
      startLine?: number
      endLine?: number
      expectedVersion?: number
      resolve: (result: { success: boolean; insertedLength: number; message?: string; error?: string; newCursorPosition?: number; versionMismatch?: boolean }) => void
    }) => {
      if (!editor) {
        resolve({ success: false, insertedLength: 0, error: 'Editor not initialized' })
        return
      }

      // Verify version if provided
      if (expectedVersion !== undefined && expectedVersion !== contentVersionRef.current) {
        resolve({ success: false, versionMismatch: true, insertedLength: 0, error: 'Content has changed, please get editor content again' })
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

            editor.commands.setContent(updatedMarkdown, { contentType: 'markdown' })
          } else {
            editor.chain()
              .focus()
              .deleteRange({ from, to })
              .insertContent(newContent, { contentType: 'markdown' })
              .run()
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
      if (!editor) return
      editor.chain().focus().undo().run()
    }

    const handleRedo = () => {
      if (!editor) return
      editor.chain().focus().redo().run()
    }

    const handleMobileToggleOutline = () => {
      if (!isMobile) return
      setMobileOutlineOpen((prev) => !prev)
    }

    // Handle query for undo/redo capability
    const handleCanUndoRedo = ({ resolve }: { resolve: (can: { undo: boolean; redo: boolean }) => void }) => {
      if (!editor) {
        resolve({ undo: false, redo: false })
        return
      }
      resolve({
        undo: editor.can().undo(),
        redo: editor.can().redo()
      })
    }

    // Defer emitter and document listener registration to avoid flushSync conflict during React render
    const setupListeners = () => {
      // Check if editor is initialized before registering listeners
      if (!editor) return

      emitter.on('editor-get-selection', handleGetSelection)
      emitter.on('editor-get-content', handleGetContent)
      emitter.on('editor-insert', handleInsert)
      emitter.on('editor-replace', handleReplace)
      emitter.on('get-quote-from-editor', handleGetQuote)
      emitter.on('editor-undo', handleUndo)
      emitter.on('editor-redo', handleRedo)
      emitter.on('mobile-editor-toggle-outline', handleMobileToggleOutline)
      emitter.on('editor-can-undo-redo', handleCanUndoRedo)
      editor.on('selectionUpdate', syncEditorSelectionQuote)
      document.addEventListener('tiptap-insert-mermaid', handleInsertMermaid as EventListener)
      syncEditorSelectionQuote()
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
      emitter.off('mobile-editor-toggle-outline', handleMobileToggleOutline)
      emitter.off('editor-can-undo-redo', handleCanUndoRedo)
      editor?.off('selectionUpdate', syncEditorSelectionQuote)
      if (!isMobile) {
        useChatStore.getState().clearEditorSelectionQuote()
      }
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
  }, [editor, activeFilePath])

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

  return (
    <div ref={editorContainerRef} id="aritcle-md-editor" className="tiptap-editor relative flex flex-col h-full">
      {isMobile && mobileContext && (
        <MobileEditorContextBar
          mode={mobileContext.mode}
          previewText={mobileContext.mode === 'text' ? mobileContext.previewText : undefined}
          activeActions={mobileContext.actions}
          onAction={runMobileEditorAction}
        />
      )}

      {/* Editor content - scrollable area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-hidden overflow-y-auto relative"
        onMouseDownCapture={handleEditorMouseDownCapture}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleEditorDrop}
      >
        <div
          className={getEditorContentContainerClass({
            centeredContent,
            isMobile,
            outlineOpen: !!outlineOpen,
            outlinePosition,
          })}
          style={
            !isMobile && outlineOpen
              ? {
                [isOutlineOnLeft(outlinePosition) ? 'paddingLeft' : 'paddingRight']: outlineContentPadding,
              }
              : undefined
          }
        >
        <EditorContent editor={editor} className="h-full relative">
          {!isMobile && <ImageBubbleMenu editor={editor} />}

          <AISuggestionFloating editor={editor} />

          {!isMobile && <FloatingTableMenu editor={editor} />}

          {!isMobile && (
            <BubbleMenuComponent
              editor={editor}
              onAIPolish={handleAIPolish}
              onAIConcise={handleAIConcise}
              onAIExpand={handleAIExpand}
              onAITranslate={handleAITranslate}
              openAiMenuSignal={openAiMenuSignal}
              openTranslateMenuSignal={openTranslateMenuSignal}
              openLinkInputSignal={openLinkInputSignal}
            />
          )}
        </EditorContent>

        <SearchReplacePanel
          editor={editor}
          open={searchReplaceOpen}
          onOpenChange={setSearchReplaceOpen}
        />
        </div>
      </div>

      {isMobile && (
        <MobileEditorMoreSheet
          open={mobileSheetMode !== null}
          mode={mobileSheetMode}
          imageSrc={imageSrcDraft}
          imageAlt={imageAltDraft}
          onOpenChange={(open) => {
            if (!open) {
              setMobileSheetMode(null)
            }
          }}
          onImageSrcChange={setImageSrcDraft}
          onImageAltChange={setImageAltDraft}
          onSubmitImageSrc={submitMobileImageSrc}
          onSubmitImageAlt={submitMobileImageAlt}
          onAction={runMobileEditorAction}
        />
      )}

      {isMobile && (
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

      {/* Bottom toolbar - always visible */}
      <FooterBar
        editor={editor}
        outlineOpen={effectiveOutlineOpen}
        onToggleOutline={handleOutlineToggle}
      />

      <SlashCommandPortal />

      <MathEditorDialog
        open={mathDialogOpen}
        onOpenChange={setMathDialogOpen}
        onInsert={handleMathInsert}
        type={mathType}
        title={mathType === 'inline' ? '插入行内公式' : '插入块级公式'}
      />
    </div>
  )
}

export default TipTapEditor
