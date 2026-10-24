'use client'

import { PluginEditorToolbar } from '@/components/plugins/plugin-editor-toolbar'
import { PluginEmbeddedViews } from '@/components/plugins/plugin-embedded-views'
import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Unlink,
  ExternalLink,
  Highlighter,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Sparkles,
  Minimize2,
  Maximize2,
  Languages,
  ChevronRight,
  Workflow,
  BrainCircuit,
  Timer,
  ListTodo,
  Type,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
} from 'lucide-react'
import { useState, useCallback, useEffect, useId, useLayoutEffect, useRef } from 'react'
import { TextSelection } from '@tiptap/pm/state'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'

const HEADING_OPTIONS = [
  { level: 1, icon: Heading1 },
  { level: 2, icon: Heading2 },
  { level: 3, icon: Heading3 },
  { level: 4, icon: Heading4 },
  { level: 5, icon: Heading5 },
  { level: 6, icon: Heading6 },
] as const

const EDITOR_SELECTION_TARGET = { kind: 'editor-selection' } as const

const POPULAR_LANGUAGES = [
  { name: 'English', code: 'English', i18nKey: 'languages.English' },
  { name: '日本語', code: 'Japanese', i18nKey: 'languages.Japanese' },
  { name: '한국어', code: 'Korean', i18nKey: 'languages.Korean' },
  { name: 'Français', code: 'French', i18nKey: 'languages.French' },
  { name: 'Deutsch', code: 'German', i18nKey: 'languages.German' },
  { name: 'Español', code: 'Spanish', i18nKey: 'languages.Spanish' },
  { name: 'Português', code: 'Portuguese', i18nKey: 'languages.Portuguese' },
  { name: 'Русский', code: 'Russian', i18nKey: 'languages.Russian' },
  { name: 'العربية', code: 'Arabic', i18nKey: 'languages.Arabic' },
]

function ToolbarButton({
  active = false,
  ...props
}: React.ComponentProps<typeof Button> & { active?: boolean }) {
  return <Button type="button" variant={active ? "secondary" : "ghost"} size="icon-sm" {...props} />
}

function ToolbarSeparator() {
  return (
    <div className="mx-1 flex h-5 items-center">
      <Separator orientation="vertical" className="h-full" />
    </div>
  )
}

const KEYBOARD_SELECTION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

interface BubbleMenuProps {
  pluginsEnabled?: boolean
  editor: Editor
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onAITranslate?: (targetLanguage: string) => void
  onCreateCanvas?: (type: 'flowchart' | 'mindmap' | 'timeline' | 'tasks') => void
  openAiMenuSignal?: number
  openTranslateMenuSignal?: number
  openLinkInputSignal?: number
}

interface LinkEditorState {
  from: number
  to: number
  text: string
  url: string
  existing: boolean
}

function getSelectedText(editor: Editor): string {
  const { from, to } = editor.state.selection

  return editor.state.doc.textBetween(from, to, '\n', '\n')
}

function hasTextSelection(editor: Editor): boolean {
  const { doc, selection } = editor.state
  const { from, to } = selection

  if (selection.empty || from === to || from < 0 || to < 0 || from > doc.content.size || to > doc.content.size) {
    return false
  }

  return getSelectedText(editor).trim().length > 0
}

function canConvertTextSelection(editor: Editor): boolean {
  const { doc, selection } = editor.state
  if (!(selection instanceof TextSelection) || selection.empty) return false

  let hasTextBlock = false
  let allowed = true
  doc.nodesBetween(selection.from, selection.to, (node) => {
    hasTextBlock = true
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') {
      allowed = false
    }
    // Inspect top-level blocks so paragraphs inside other containers stay excluded.
    return false
  })
  return hasTextBlock && allowed
}

function isKeyboardSelectionIntent(event: KeyboardEvent): boolean {
  if (event.isComposing) {
    return false
  }

  if (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'a'
  ) {
    return true
  }

  return event.shiftKey && KEYBOARD_SELECTION_KEYS.has(event.key)
}

export function BubbleMenu({
  pluginsEnabled = false,
  editor,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onAITranslate,
  onCreateCanvas,
  openAiMenuSignal = 0,
  openTranslateMenuSignal = 0,
  openLinkInputSignal = 0,
}: BubbleMenuProps) {
  const t = useTranslations('editor')
  const pluginMenuOwner = useId()
  const linkTextInputId = useId()
  const linkUrlInputId = useId()
  const [show, setShow] = useState(false)
  const [selectionRevision, setSelectionRevision] = useState(0)
  const selectionSnapshot = useRef<{ doc: Editor['state']['doc']; from: number; to: number } | null>(null)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false)
  const [customTranslateLang, setCustomTranslateLang] = useState('')
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null)
  const isLinkEditorOpen = linkEditor !== null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isInteractingWithMenu, setIsInteractingWithMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const linkUrlInputRef = useRef<HTMLInputElement>(null)
  const aiSubmenuRef = useRef<HTMLDivElement>(null)
  const translateSubmenuRef = useRef<HTMLDivElement>(null)
  const hasUserSelectionIntentRef = useRef(false)
  const isPointerSelectingRef = useRef(false)
  const isComposingRef = useRef(false)
  const positionFrameRef = useRef<number | null>(null)
  const focusEditorOnBlockMenuCloseRef = useRef(false)

  const hideMenu = useCallback(() => {
    setShow(false)
    setShowAISubmenu(false)
    setShowTranslateSubmenu(false)
    setLinkEditor(null)
  }, [])

  // 处理翻译
  const handleTranslate = useCallback(async (targetLanguage: string) => {
    const selectedText = getSelectedText(editor)
    if (!selectedText.trim()) {
      toast({ title: t('translation.fail'), description: t('translation.failNoSelection'), variant: 'destructive' })
      return
    }
    onAITranslate?.(targetLanguage)
  }, [editor, onAITranslate, t])

  const handleCustomTranslate = useCallback(async () => {
    const targetLanguage = customTranslateLang.trim()
    if (!targetLanguage) {
      toast({ title: t('translation.customLanguageEmpty'), description: t('translation.customLanguageExample'), variant: 'destructive' })
      return
    }
    await handleTranslate(targetLanguage)
    setCustomTranslateLang('')
  }, [customTranslateLang, handleTranslate, t])

  // 更新定位
  const updatePosition = useCallback(() => {
    if (editor.isDestroyed) {
      hideMenu()
      return false
    }
    const { selection } = editor.state
    const { from, to } = selection

    if (isComposingRef.current) {
      hideMenu()
      return false
    }

    if (isPointerSelectingRef.current) {
      hideMenu()
      return false
    }

    // 恢复的选区不主动显示菜单，但菜单显示逻辑不能修改编辑器选区。
    // 原生全选等操作可能不经过这里的 keydown 意图检测。
    if (!hasUserSelectionIntentRef.current) {
      hideMenu()
      return false
    }

    // 检查选区是否有效（空选区、光标位置、无实际文本内容都不显示）
    if (!hasTextSelection(editor)) {
      hideMenu()
      return false
    }

    if (from < 0 || to < 0 || from > editor.state.doc.content.size || to > editor.state.doc.content.size) {
      hideMenu()
      return false
    }

    const node = editor.state.doc.nodeAt(from)

    // 检查是否是图片节点
    if (node?.type.name === 'image') {
      hideMenu()
      return false
    }

    // 检查是否是数学公式节点，如果是则不显示 bubble menu
    if (node?.type.name === 'inlineMath' || node?.type.name === 'blockMath') {
      hideMenu()
      return false
    }

    // 使用视口坐标定位，避免长文档滚动后 EditorContent 与滚动容器的坐标系发生偏移。
    const editorElement = editor.view.dom
    const scrollContainer = editorElement.closest<HTMLElement>('.editor-scroll-container')
    if (!scrollContainer) {
      hideMenu()
      return false
    }

    try {
      const startCoords = editor.view.coordsAtPos(from)
      const endCoords = editor.view.coordsAtPos(to)
      const scrollBounds = scrollContainer.getBoundingClientRect()

      const anchorTop = Math.min(startCoords.top, endCoords.top)
      const anchorBottom = Math.max(startCoords.bottom, endCoords.bottom)
      const menuHeight = menuRef.current?.offsetHeight || 40
      const currentMenuWidth = menuRef.current?.offsetWidth || 360
      const gap = 8

      const minimumLeft = scrollBounds.left + 8
      const maximumLeft = scrollBounds.right - currentMenuWidth - 8
      const left = Math.max(minimumLeft, Math.min(startCoords.left, Math.max(minimumLeft, maximumLeft)))

      const spaceAbove = anchorTop - scrollBounds.top
      const preferredTop = spaceAbove >= menuHeight + gap
        ? anchorTop - menuHeight - gap
        : anchorBottom + gap
      const visibleTop = scrollBounds.top + 8
      const visibleBottom = scrollBounds.bottom - 8
      const maxTop = Math.max(visibleTop, visibleBottom - menuHeight)
      const top = Math.max(visibleTop, Math.min(preferredTop, maxTop))
      setPosition(previous => previous.top === top && previous.left === left ? previous : { top, left })

      setShow(true)
      return true
    } catch {
      hideMenu()
      return false
    }
  }, [editor, hideMenu])

  const updateMenu = useCallback(() => {
    if (editor.isDestroyed) return
    const { doc, selection } = editor.state
    const previous = selectionSnapshot.current
    const selectionChanged = !previous || previous.doc !== doc
      || previous.from !== selection.from || previous.to !== selection.to
    if (selectionChanged) {
      selectionSnapshot.current = { doc, from: selection.from, to: selection.to }
    }
    if (!isPointerSelectingRef.current && !hasTextSelection(editor)) {
      hasUserSelectionIntentRef.current = false
    }
    // Read all geometry before scheduling React writes for the toolbar.
    updatePosition()
    if (selectionChanged && (!selection.empty || (previous && previous.from !== previous.to))) {
      setSelectionRevision(value => value + 1)
    }
  }, [editor, updatePosition])

  const schedulePositionUpdate = useCallback(() => {
    if (positionFrameRef.current !== null) return
    positionFrameRef.current = requestAnimationFrame(() => {
      positionFrameRef.current = null
      updateMenu()
    })
  }, [updateMenu])

  useEffect(() => () => {
    if (positionFrameRef.current !== null) cancelAnimationFrame(positionFrameRef.current)
    positionFrameRef.current = null
  }, [schedulePositionUpdate])

  useEffect(() => {
    hasUserSelectionIntentRef.current = false
    isPointerSelectingRef.current = false
    hideMenu()

    if (editor.isDestroyed) return
    const editorElement = editor.view.dom
    const ownerDocument = editorElement.ownerDocument

    const handleCompositionStart = () => {
      isComposingRef.current = true
      hideMenu()
    }

    const handleCompositionEnd = () => {
      isComposingRef.current = false
    }

    const handlePointerStart = () => {
      isPointerSelectingRef.current = true
      hasUserSelectionIntentRef.current = false
      hideMenu()
    }

    const finishPointerSelection = () => {
      if (!isPointerSelectingRef.current) {
        return
      }

      isPointerSelectingRef.current = false
      hasUserSelectionIntentRef.current = true
      schedulePositionUpdate()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isKeyboardSelectionIntent(event)) {
        return
      }

      hasUserSelectionIntentRef.current = true
      schedulePositionUpdate()
    }

    editorElement.addEventListener('mousedown', handlePointerStart, true)
    editorElement.addEventListener('touchstart', handlePointerStart, { passive: true })
    editorElement.addEventListener('keydown', handleKeyDown, true)
    editorElement.addEventListener('compositionstart', handleCompositionStart)
    editorElement.addEventListener('compositionend', handleCompositionEnd)
    ownerDocument.addEventListener('mouseup', finishPointerSelection)
    ownerDocument.addEventListener('touchend', finishPointerSelection)
    ownerDocument.addEventListener('touchcancel', finishPointerSelection)

    return () => {
      editorElement.removeEventListener('mousedown', handlePointerStart, true)
      editorElement.removeEventListener('touchstart', handlePointerStart)
      editorElement.removeEventListener('keydown', handleKeyDown, true)
      editorElement.removeEventListener('compositionstart', handleCompositionStart)
      editorElement.removeEventListener('compositionend', handleCompositionEnd)
      ownerDocument.removeEventListener('mouseup', finishPointerSelection)
      ownerDocument.removeEventListener('touchend', finishPointerSelection)
      ownerDocument.removeEventListener('touchcancel', finishPointerSelection)
    }
  }, [editor, hideMenu, schedulePositionUpdate])

  useEffect(() => {
    if (!openAiMenuSignal) return

    if (!updatePosition()) {
      return
    }

    setShowAISubmenu(true)
    setShowTranslateSubmenu(false)
    setLinkEditor(null)
  }, [openAiMenuSignal, updatePosition])

  useEffect(() => {
    if (!openTranslateMenuSignal) return

    if (!updatePosition()) {
      return
    }

    setShowAISubmenu(true)
    setShowTranslateSubmenu(true)
    setLinkEditor(null)
  }, [openTranslateMenuSignal, updatePosition])

  useEffect(() => {
    if (!openLinkInputSignal) return

    const { from, to } = editor.state.selection
    const text = getSelectedText(editor)
    if (!text.trim()) return

    const url = editor.getAttributes('link').href
    hasUserSelectionIntentRef.current = true
    setLinkEditor({ from, to, text, url: typeof url === 'string' ? url : '', existing: Boolean(url) })
    setShow(true)
    setShowAISubmenu(false)
    setShowTranslateSubmenu(false)
  }, [editor, openLinkInputSignal])

  useEffect(() => {
    const handleLinkEdit = (event: Event) => {
      const detail = (event as CustomEvent<{
        editor?: unknown
        from?: unknown
        to?: unknown
        label?: unknown
        href?: unknown
      }>).detail

      if (
        !detail
        || detail.editor !== editor
        || typeof detail.from !== 'number'
        || typeof detail.to !== 'number'
        || typeof detail.label !== 'string'
        || typeof detail.href !== 'string'
      ) return

      hasUserSelectionIntentRef.current = true
      editor.commands.setTextSelection({ from: detail.from, to: detail.to })
      setLinkEditor({
        from: detail.from,
        to: detail.to,
        text: detail.label,
        url: detail.href,
        existing: true,
      })
      setShowAISubmenu(false)
      setShowTranslateSubmenu(false)
      setShow(true)
    }

    document.addEventListener('tiptap-link-edit', handleLinkEdit)
    return () => document.removeEventListener('tiptap-link-edit', handleLinkEdit)
  }, [editor])

  useLayoutEffect(() => {
    if (!show) return
    updatePosition()
  }, [linkEditor, show, updatePosition])

  useLayoutEffect(() => {
    if (!editor.isDestroyed) editor.view.dom.dispatchEvent(new Event('notegen-selection-menu-position'))
  }, [editor, position, show])

  useLayoutEffect(() => {
    if (!show || !isLinkEditorOpen) return
    linkUrlInputRef.current?.focus({ preventScroll: true })
  }, [isLinkEditorOpen, show])

  // AI子菜单边界检测
  useEffect(() => {
    if (!showAISubmenu || !aiSubmenuRef.current) return

    const checkSubmenuBounds = () => {
      const rect = aiSubmenuRef.current!.getBoundingClientRect()

      // 直接获取最新编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      if (!editorElement) return

      const editorBounds = editorElement.getBoundingClientRect()
      const padding = 8

      // 检测右边界 - 基于编辑器边缘
      if (rect.right > editorBounds.right - padding) {
        aiSubmenuRef.current!.setAttribute('data-right-edge', 'true')
      } else {
        aiSubmenuRef.current!.removeAttribute('data-right-edge')
      }

      // 检测下边界 - 基于编辑器边缘
      if (rect.bottom > editorBounds.bottom - padding) {
        aiSubmenuRef.current!.setAttribute('data-bottom-edge', 'true')
      } else {
        aiSubmenuRef.current!.removeAttribute('data-bottom-edge')
      }
    }

    const raf = requestAnimationFrame(checkSubmenuBounds)
    return () => cancelAnimationFrame(raf)
  }, [showAISubmenu, show])

  // 翻译子菜单边界检测
  useEffect(() => {
    if (!showTranslateSubmenu || !translateSubmenuRef.current) return

    const checkTranslateBounds = () => {
      const rect = translateSubmenuRef.current!.getBoundingClientRect()

      // 直接获取最新编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      if (!editorElement) return

      const editorBounds = editorElement.getBoundingClientRect()
      const padding = 8

      // 检测右边界 - 基于编辑器边缘
      if (rect.right > editorBounds.right - padding) {
        translateSubmenuRef.current!.setAttribute('data-translate-submenu-right', 'true')
      } else {
        translateSubmenuRef.current!.removeAttribute('data-translate-submenu-right')
      }
    }

    const raf = requestAnimationFrame(checkTranslateBounds)
    return () => cancelAnimationFrame(raf)
  }, [showTranslateSubmenu, show])

  useEffect(() => {
    if (hasTextSelection(editor)) {
      updatePosition()
    } else {
      hideMenu()
    }

    editor.on('selectionUpdate', schedulePositionUpdate)
    editor.on('transaction', schedulePositionUpdate)

    return () => {
      editor.off('selectionUpdate', schedulePositionUpdate)
      editor.off('transaction', schedulePositionUpdate)
    }
  }, [editor, hideMenu, schedulePositionUpdate, updatePosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-editor-bubble-menu-owner]')?.getAttribute('data-editor-bubble-menu-owner') === pluginMenuOwner) return
      if (event.target instanceof Element && !editor.isDestroyed
        && event.target.closest('[data-editor-table-menu]')?.getAttribute('data-editor-table-menu') === editor.view.dom.dataset.tableMenuOwner) return
      if (event.target instanceof Element && event.target.closest('[data-plugin-menu-owner]')?.getAttribute('data-plugin-menu-owner') === pluginMenuOwner) return
      if (event.target instanceof Element && event.target.closest('[data-plugin-selection-popover]')) return
      if (!menuRef.current?.contains(event.target as Node)) {
        hasUserSelectionIntentRef.current = false
        if (!editor.isDestroyed && event.target instanceof Node && !editor.view.dom.contains(event.target)) {
          isPointerSelectingRef.current = false
        }
        hideMenu()
        setIsInteractingWithMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [editor, hideMenu, pluginMenuOwner])

  // Update position on scroll
  useEffect(() => {
    if (editor.isDestroyed) return
    const scrollContainer = editor.view.dom.closest<HTMLElement>('.editor-scroll-container')
    if (!scrollContainer) return

    const handleScroll = () => {
      if (show) schedulePositionUpdate()
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [editor, show, schedulePositionUpdate])

  const openLinkEditorForSelection = useCallback(() => {
    const { from, to } = editor.state.selection
    const text = getSelectedText(editor)
    if (!text.trim()) return

    const url = editor.getAttributes('link').href
    setLinkEditor({ from, to, text, url: typeof url === 'string' ? url : '', existing: Boolean(url) })
    setShowAISubmenu(false)
    setShowTranslateSubmenu(false)
  }, [editor])

  const applyLink = useCallback(() => {
    if (!linkEditor) return

    const text = linkEditor.text.trim()
    const url = linkEditor.url.trim()
    const { from, to } = linkEditor
    if (!text || !url || from < 0 || to > editor.state.doc.content.size || from >= to) return

    const linkMark = editor.state.schema.marks.link
    if (!linkMark) return

    const marks = (editor.state.doc.nodeAt(from)?.marks ?? editor.state.doc.resolve(from).marks())
      .filter(mark => mark.type !== linkMark)
    const linkedText = editor.state.schema.text(text, [...marks, linkMark.create({ href: url })])
    const transaction = editor.state.tr.replaceWith(from, to, linkedText)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(from + linkedText.nodeSize)))
    editor.view.dispatch(transaction)
    editor.view.focus()
    hideMenu()
  }, [editor, hideMenu, linkEditor])

  const removeLink = useCallback(() => {
    if (!linkEditor) return

    const text = linkEditor.text.trim()
    const { from, to } = linkEditor
    if (!text || from < 0 || to > editor.state.doc.content.size || from >= to) return

    const linkMark = editor.state.schema.marks.link
    const marks = (editor.state.doc.nodeAt(from)?.marks ?? editor.state.doc.resolve(from).marks())
      .filter(mark => mark.type !== linkMark)
    const plainText = editor.state.schema.text(text, marks)
    const transaction = editor.state.tr.replaceWith(from, to, plainText)
    transaction.setSelection(TextSelection.near(transaction.doc.resolve(from + plainText.nodeSize)))
    editor.view.dispatch(transaction)
    editor.view.focus()
    hideMenu()
  }, [editor, hideMenu, linkEditor])

  const openCurrentLink = useCallback(() => {
    const url = linkEditor?.url.trim()
    if (!url) return

    document.dispatchEvent(new CustomEvent('tiptap-current-link-open', {
      detail: { editor, href: url },
    }))
  }, [editor, linkEditor])

  const toggleBold = () => editor.chain().focus().toggleBold().run()
  const toggleItalic = () => editor.chain().focus().toggleItalic().run()
  const toggleStrike = () => editor.chain().focus().toggleStrike().run()
  const toggleUnderline = () => editor.chain().focus().toggleUnderline().run()
  const toggleCode = () => editor.chain().focus().toggleCode().run()
  const toggleHighlight = () => editor.chain().focus().toggleHighlight().run()
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run()
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run()
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run()
  const toggleTaskList = () => editor.chain().focus().toggleTaskList().run()
  const toggleCodeBlock = () => editor.chain().focus().toggleCodeBlock().run()

  const isActive = (name: string, attrs?: Record<string, unknown>) => editor.isActive(name, attrs)

  if (!show) return null

  const showBlockTypeConversion = canConvertTextSelection(editor)
  const activeHeading = HEADING_OPTIONS.find(({ level }) => isActive('heading', { level }))
  const activeBlockType = activeHeading ? String(activeHeading.level) : isActive('paragraph') ? 'paragraph' : undefined
  const BlockTypeIcon = activeHeading?.icon ?? Type

  return (
    <div
      ref={menuRef}
      data-editor-bubble-menu
      className="fixed left-0 top-0 z-50 max-w-[calc(100%_-_1rem)] transition-transform duration-150 ease-out"
      style={{
        transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
      }}
    >
      {linkEditor ? (
        <form
          className="w-96 max-w-full rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10"
          onSubmit={(event) => {
            event.preventDefault()
            applyLink()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            hideMenu()
            editor.view.focus()
          }}
        >
          <FieldGroup className="gap-2">
            <Field className="gap-1">
              <FieldLabel htmlFor={linkTextInputId}>
                {t('bubbleMenu.linkText')}
              </FieldLabel>
              <Input
                id={linkTextInputId}
                value={linkEditor.text}
                onChange={(event) => setLinkEditor(current => current && ({ ...current, text: event.target.value }))}
                placeholder={t('bubbleMenu.linkTextPlaceholder')}
                aria-label={t('bubbleMenu.linkText')}
              />
            </Field>
            <Field className="gap-1">
              <FieldLabel htmlFor={linkUrlInputId}>
                {t('bubbleMenu.linkUrl')}
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  ref={linkUrlInputRef}
                  id={linkUrlInputId}
                  value={linkEditor.url}
                  onChange={(event) => setLinkEditor(current => current && ({ ...current, url: event.target.value }))}
                  placeholder={t('bubbleMenu.linkPlaceholder')}
                  aria-label={t('bubbleMenu.linkUrl')}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    onClick={openCurrentLink}
                    disabled={!linkEditor.url.trim()}
                    title={t('bubbleMenu.openLink')}
                  >
                    <ExternalLink />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </FieldGroup>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div>
              {linkEditor.existing && (
                <Button type="button" variant="ghost" size="xs" onClick={removeLink}>
                  <Unlink data-icon="inline-start" />
                  {t('bubbleMenu.removeLink')}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="xs" onClick={hideMenu}>
                {t('bubbleMenu.cancel')}
              </Button>
              <Button type="submit" size="xs" disabled={!linkEditor.text.trim() || !linkEditor.url.trim()}>
                {t('bubbleMenu.saveLink')}
              </Button>
            </div>
          </div>
        </form>
      ) : (
      <div
        className="flex items-center gap-1 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {/* AI 操作 */}
        <div className="relative">
          <ToolbarButton
            active={showAISubmenu}
            className="text-primary"
            onClick={() => setShowAISubmenu(!showAISubmenu)}
            title={t('bubbleMenu.ai')}
          >
            <Sparkles />
          </ToolbarButton>

          {showAISubmenu && (
            <div
              ref={aiSubmenuRef}
              className="absolute top-full mt-1 min-w-36 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-right-edge:right-0 data-right-edge:left-auto data-right-edge:translate-x-0 data-bottom-edge:top-full data-bottom-edge:mt-1 data-bottom-edge:translate-y-0"
            >
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setShowAISubmenu(false); onAIPolish?.() }}>
                <Sparkles data-icon="inline-start" /><span>{t('bubbleMenu.polish')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setShowAISubmenu(false); onAIConcise?.() }}>
                <Minimize2 data-icon="inline-start" /><span>{t('bubbleMenu.concise')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setShowAISubmenu(false); onAIExpand?.() }}>
                <Maximize2 data-icon="inline-start" /><span>{t('bubbleMenu.expand')}</span>
              </Button>

              <Separator className="my-1" />
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">{t('bubbleMenu.generateCanvas')}</p>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { hideMenu(); onCreateCanvas?.('flowchart') }}>
                <Workflow data-icon="inline-start" /><span>{t('bubbleMenu.canvasFlowchart')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { hideMenu(); onCreateCanvas?.('mindmap') }}>
                <BrainCircuit data-icon="inline-start" /><span>{t('bubbleMenu.canvasMindmap')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { hideMenu(); onCreateCanvas?.('timeline') }}>
                <Timer data-icon="inline-start" /><span>{t('bubbleMenu.canvasTimeline')}</span>
              </Button>
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start" onClick={() => { hideMenu(); onCreateCanvas?.('tasks') }}>
                <ListTodo data-icon="inline-start" /><span>{t('bubbleMenu.canvasTasks')}</span>
              </Button>

              <Separator className="my-1" />

              <div
                className="relative"
                onMouseEnter={() => setShowTranslateSubmenu(true)}
                onMouseLeave={() => setShowTranslateSubmenu(false)}
              >
                <Button type="button" variant="ghost" size="sm" className="w-full justify-start"
                  onClick={() => setShowTranslateSubmenu(!showTranslateSubmenu)}
                >
                  <Languages data-icon="inline-start" /><span>{t('bubbleMenu.translate')}</span><ChevronRight data-icon="inline-end" className={cn('ml-auto transition-transform', showTranslateSubmenu && 'rotate-90')} />
                </Button>

                {showTranslateSubmenu && (
                  <div
                    ref={translateSubmenuRef}
                    className="absolute top-0 left-full ml-1 max-h-60 min-w-40 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-translate-submenu-right:right-full data-translate-submenu-right:left-auto data-translate-submenu-right:mr-1 data-translate-submenu-right:ml-0"
                    data-submenu="translate"
                  >
                    {POPULAR_LANGUAGES.map((lang) => (
                      <Button type="button" variant="ghost" size="sm" key={lang.code} className="w-full justify-start" onClick={() => { setShowAISubmenu(false); setShowTranslateSubmenu(false); handleTranslate(lang.code) }}>
                        <span>{t(`bubbleMenu.${lang.i18nKey}`)}</span>
                      </Button>
                    ))}
                    <Separator className="my-1" />
                    <div className="flex items-center px-1 py-1">
                      <Input type="text" placeholder={t('bubbleMenu.customLanguagePlaceholder')} value={customTranslateLang} onChange={(e) => setCustomTranslateLang(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleCustomTranslate() } else if (e.key === 'Escape') { setShowTranslateSubmenu(false); setCustomTranslateLang('') } }} />
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        <ToolbarSeparator />

        {pluginsEnabled ? <PluginEditorToolbar editor={editor} location="editor/selection" owner={pluginMenuOwner} /> : null}
        {pluginsEnabled && editor.isActive('link') ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'link' }} owner={pluginMenuOwner} /> : null}
        {pluginsEnabled && editor.isActive('codeBlock') ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'codeBlock' }} owner={pluginMenuOwner} /> : null}
        {pluginsEnabled && (editor.isActive('inlineMath') || editor.isActive('blockMath')) ? <PluginEditorToolbar editor={editor} location="editor/node-actions" target={{ nodeKind: 'math' }} owner={pluginMenuOwner} /> : null}
        {pluginsEnabled ? <PluginEmbeddedViews location="editor/selection-panel" contextKey={String(selectionRevision)} target={EDITOR_SELECTION_TARGET} compact /> : null}
        {/* 文本格式化 */}
        <div className="flex gap-0.5">
          {showBlockTypeConversion && (
            <DropdownMenu
              modal={false}
              onOpenChange={(open) => {
                if (!open) return
                focusEditorOnBlockMenuCloseRef.current = false
                setShowAISubmenu(false)
                setShowTranslateSubmenu(false)
              }}
            >
              <DropdownMenuTrigger asChild>
                <ToolbarButton
                  aria-label={t('blockHandle.turnInto')}
                  title={t('blockHandle.turnInto')}
                >
                  <BlockTypeIcon />
                </ToolbarButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                data-editor-bubble-menu-owner={pluginMenuOwner}
                align="start"
                collisionPadding={8}
                className="min-w-40"
                onEscapeKeyDown={() => { focusEditorOnBlockMenuCloseRef.current = true }}
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  if (focusEditorOnBlockMenuCloseRef.current && !editor.isDestroyed) {
                    focusEditorOnBlockMenuCloseRef.current = false
                    editor.view.focus()
                  }
                }}
              >
                <DropdownMenuGroup>
                  <DropdownMenuRadioGroup value={activeBlockType}>
                    <DropdownMenuRadioItem
                      value="paragraph"
                      disabled={!editor.can().setParagraph()}
                      onSelect={() => {
                        if (!canConvertTextSelection(editor)) return
                        focusEditorOnBlockMenuCloseRef.current = true
                        editor.chain().focus().setParagraph().run()
                      }}
                    >
                      <Type />
                      {t('blockHandle.paragraph')}
                    </DropdownMenuRadioItem>
                    {HEADING_OPTIONS.map(({ level, icon: Icon }) => (
                      <DropdownMenuRadioItem
                        key={level}
                        value={String(level)}
                        disabled={!editor.can().setHeading({ level })}
                        onSelect={() => {
                          if (!canConvertTextSelection(editor)) return
                          focusEditorOnBlockMenuCloseRef.current = true
                          editor.chain().focus().setHeading({ level }).run()
                        }}
                      >
                        <Icon />
                        {t(`slashCommand.items.heading${level}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <ToolbarButton active={isActive('bold')} onClick={toggleBold} title={t('bubbleMenu.bold')}><Bold /></ToolbarButton>
          <ToolbarButton active={isActive('italic')} onClick={toggleItalic} title={t('bubbleMenu.italic')}><Italic /></ToolbarButton>
          <ToolbarButton active={isActive('strike')} onClick={toggleStrike} title={t('bubbleMenu.strike')}><Strikethrough /></ToolbarButton>
          <ToolbarButton active={isActive('underline')} onClick={toggleUnderline} title={t('bubbleMenu.underline')}><Underline /></ToolbarButton>
          <ToolbarButton active={isActive('code')} onClick={toggleCode} title={t('bubbleMenu.inlineCode')}><Code /></ToolbarButton>
          <ToolbarButton active={isActive('highlight')} onClick={toggleHighlight} title={t('bubbleMenu.highlight')}><Highlighter /></ToolbarButton>
        </div>

        <ToolbarSeparator />

        <ToolbarButton active={isActive('link')} onClick={openLinkEditorForSelection} title={t('bubbleMenu.link')}><Link /></ToolbarButton>

        <ToolbarSeparator />

        {/* 块级元素 */}
        <div className="flex gap-0.5">
          <ToolbarButton active={isActive('blockquote')} onClick={toggleBlockquote} title={t('bubbleMenu.blockquote')}><Quote /></ToolbarButton>
          <ToolbarButton active={isActive('bulletList')} onClick={toggleBulletList} title={t('bubbleMenu.bulletList')}><List /></ToolbarButton>
          <ToolbarButton active={isActive('orderedList')} onClick={toggleOrderedList} title={t('bubbleMenu.orderedList')}><ListOrdered /></ToolbarButton>
          <ToolbarButton active={isActive('taskList')} onClick={toggleTaskList} title={t('bubbleMenu.taskList')}><CheckSquare /></ToolbarButton>
          <ToolbarButton active={isActive('codeBlock')} onClick={toggleCodeBlock} title={t('bubbleMenu.codeBlock')}><Code /></ToolbarButton>
        </div>

      </div>
      )}
    </div>
  )
}

export default BubbleMenu
