'use client'

import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  ExternalLink,
  Highlighter,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  PanelTop,
  Sparkles,
  Minimize2,
  Maximize2,
  Languages,
  ChevronRight,
  Workflow,
  BrainCircuit,
  Timer,
  ListTodo,
} from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

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

function getEditableLinkSourceElement(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector<HTMLElement>('.tiptap-editable-link-source')
}

function getCurrentLinkHref(editor: Editor): string {
  const editableHref = getEditableLinkSourceElement(editor)?.dataset.linkHref?.trim()
  if (editableHref) return editableHref

  const href = editor.getAttributes('link').href
  return typeof href === 'string' ? href.trim() : ''
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
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false)
  const [customTranslateLang, setCustomTranslateLang] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isInteractingWithMenu, setIsInteractingWithMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const aiSubmenuRef = useRef<HTMLDivElement>(null)
  const translateSubmenuRef = useRef<HTMLDivElement>(null)
  const hasUserSelectionIntentRef = useRef(false)
  const isPointerSelectingRef = useRef(false)
  const isComposingRef = useRef(false)

  const hideMenu = useCallback(() => {
    setShow(false)
    setShowAISubmenu(false)
    setShowTranslateSubmenu(false)
    setShowLinkInput(false)
  }, [])

  const collapseSelection = useCallback(() => {
    const { selection } = editor.state

    if (selection.empty) {
      return
    }

    const position = Math.max(0, Math.min(selection.to, editor.state.doc.content.size))
    editor.commands.setTextSelection(position)
  }, [editor])

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
    const { selection } = editor.state
    const { from, to } = selection
    const editableLinkSource = getEditableLinkSourceElement(editor)

    if (isComposingRef.current) {
      hideMenu()
      return false
    }

    if (isPointerSelectingRef.current && !editableLinkSource) {
      hideMenu()
      return false
    }

    // 应用启动或文件恢复时可能会还原一个非空选区，但这不是用户本次主动选择的文本。
    if (!editableLinkSource && !hasUserSelectionIntentRef.current) {
      if (hasTextSelection(editor)) {
        collapseSelection()
      }
      hideMenu()
      return false
    }

    // 检查选区是否有效（空选区、光标位置、无实际文本内容都不显示）
    if (!editableLinkSource && !hasTextSelection(editor)) {
      hideMenu()
      return false
    }

    if (from < 0 || to < 0 || from > editor.state.doc.content.size || to > editor.state.doc.content.size) {
      hideMenu()
      return false
    }

    const node = editableLinkSource ? null : editor.state.doc.nodeAt(from)

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

    // 获取编辑器元素和滚动容器
    const editorElement = document.querySelector('.ProseMirror')
    const scrollContainer = editorElement?.parentElement
    if (!editorElement || !scrollContainer) {
      hideMenu()
      return false
    }

    try {
      const sourceBounds = editableLinkSource?.getBoundingClientRect()
      const coords = sourceBounds ?? editor.view.coordsAtPos(from)
      const containerBounds = scrollContainer.getBoundingClientRect()

      // 转换为滚动容器内的相对坐标
      const relativeTop = coords.top - containerBounds.top + scrollContainer.scrollTop
      const relativeLeft = coords.left - containerBounds.left + scrollContainer.scrollLeft

      // 计算菜单位置（顶部在选区上方）
      const top = relativeTop - 48 // 48 是大约的菜单高度 + 间距

      // 边界检测：left 在 [0, 容器宽度 - 菜单宽度] 范围内
      const currentMenuWidth = menuRef.current?.offsetWidth || 360
      // maxLeft 不能为负数
      const maxLeft = Math.max(0, containerBounds.width - currentMenuWidth)
      const left = Math.min(relativeLeft, maxLeft)

      // 如果上方空间不够，改为在光标下方显示
      if (relativeTop < 48) {
        setPosition({ top: relativeTop + 24, left })
      } else {
        setPosition({ top, left })
      }

      setShow(true)
      return true
    } catch {
      hideMenu()
      return false
    }
  }, [collapseSelection, editor, hideMenu])

  useEffect(() => {
    hasUserSelectionIntentRef.current = false
    isPointerSelectingRef.current = false
    hideMenu()

    const editorElement = editor.view.dom
    const ownerDocument = editorElement.ownerDocument

    const handleCompositionStart = () => {
      isComposingRef.current = true
      hideMenu()
    }

    const handleCompositionEnd = () => {
      isComposingRef.current = false
    }

    const handlePointerStart = (event: MouseEvent | TouchEvent) => {
      if ((event.target as HTMLElement | null)?.closest('.tiptap-editable-link-source')) {
        isPointerSelectingRef.current = false
        hasUserSelectionIntentRef.current = true
        requestAnimationFrame(updatePosition)
        return
      }

      isPointerSelectingRef.current = true
      hasUserSelectionIntentRef.current = false
      if (hasTextSelection(editor)) {
        collapseSelection()
      }
      hideMenu()
    }

    const finishPointerSelection = () => {
      if (getEditableLinkSourceElement(editor)) {
        isPointerSelectingRef.current = false
        hasUserSelectionIntentRef.current = true
        requestAnimationFrame(updatePosition)
        return
      }

      if (!isPointerSelectingRef.current) {
        return
      }

      isPointerSelectingRef.current = false

      requestAnimationFrame(() => {
        const hasSelection = hasTextSelection(editor)
        hasUserSelectionIntentRef.current = hasSelection

        if (hasSelection) {
          updatePosition()
        } else {
          hideMenu()
        }
      })
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isKeyboardSelectionIntent(event)) {
        return
      }

      hasUserSelectionIntentRef.current = true

      requestAnimationFrame(() => {
        const hasSelection = hasTextSelection(editor)
        hasUserSelectionIntentRef.current = hasSelection

        if (hasSelection) {
          updatePosition()
        } else {
          hideMenu()
        }
      })
    }

    editorElement.addEventListener('mousedown', handlePointerStart)
    editorElement.addEventListener('touchstart', handlePointerStart, { passive: true })
    editorElement.addEventListener('keydown', handleKeyDown, true)
    editorElement.addEventListener('compositionstart', handleCompositionStart)
    editorElement.addEventListener('compositionend', handleCompositionEnd)
    ownerDocument.addEventListener('mouseup', finishPointerSelection)
    ownerDocument.addEventListener('touchend', finishPointerSelection)
    ownerDocument.addEventListener('touchcancel', finishPointerSelection)

    return () => {
      editorElement.removeEventListener('mousedown', handlePointerStart)
      editorElement.removeEventListener('touchstart', handlePointerStart)
      editorElement.removeEventListener('keydown', handleKeyDown, true)
      editorElement.removeEventListener('compositionstart', handleCompositionStart)
      editorElement.removeEventListener('compositionend', handleCompositionEnd)
      ownerDocument.removeEventListener('mouseup', finishPointerSelection)
      ownerDocument.removeEventListener('touchend', finishPointerSelection)
      ownerDocument.removeEventListener('touchcancel', finishPointerSelection)
    }
  }, [collapseSelection, editor, hideMenu, updatePosition])

  useEffect(() => {
    if (!openAiMenuSignal) return

    if (!updatePosition()) {
      return
    }

    setShowAISubmenu(true)
    setShowTranslateSubmenu(false)
    setShowLinkInput(false)
  }, [openAiMenuSignal, updatePosition])

  useEffect(() => {
    if (!openTranslateMenuSignal) return

    if (!updatePosition()) {
      return
    }

    setShowAISubmenu(true)
    setShowTranslateSubmenu(true)
    setShowLinkInput(false)
  }, [openTranslateMenuSignal, updatePosition])

  useEffect(() => {
    if (!openLinkInputSignal) return

    if (!updatePosition()) {
      return
    }

    const previousUrl = editor.getAttributes('link').href
    setLinkUrl(previousUrl || '')
    setShowLinkInput(true)
    setShowAISubmenu(false)
    setShowTranslateSubmenu(false)
  }, [editor, openLinkInputSignal, updatePosition])

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
    const updateHandler = () => updatePosition()

    // 文本选区或正在编辑的 Markdown 链接源码都显示工具栏。
    if (hasTextSelection(editor) || getEditableLinkSourceElement(editor)) {
      updatePosition()
    } else {
      hideMenu()
    }

    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updatePosition)

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updatePosition)
    }
  }, [editor, hideMenu, updatePosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        hideMenu()
        setIsInteractingWithMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [hideMenu])

  // Update position on scroll
  useEffect(() => {
    const scrollContainer = document.querySelector('.ProseMirror')?.parentElement
    if (!scrollContainer) return

    const handleScroll = () => {
      if (show) {
        updatePosition()
      }
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [show, updatePosition])

  const setLink = useCallback(() => {
    if (showLinkInput) {
      if (linkUrl === '') {
        editor.chain().focus().extendMarkRange('link').unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href: linkUrl }).run()
      }
      setShowLinkInput(false)
      setLinkUrl('')
    } else {
      const previousUrl = editor.getAttributes('link').href
      setLinkUrl(previousUrl || '')
      setShowLinkInput(true)
    }
  }, [editor, linkUrl, showLinkInput])

  const toggleEditableLinkMark = (mark: string, fallback: () => void) => {
    if (!getEditableLinkSourceElement(editor)) {
      fallback()
      return
    }

    document.dispatchEvent(new CustomEvent('tiptap-editable-link-toggle-mark', {
      detail: { mark },
    }))
  }

  const toggleBold = () => toggleEditableLinkMark('bold', () => editor.chain().focus().toggleBold().run())
  const toggleItalic = () => toggleEditableLinkMark('italic', () => editor.chain().focus().toggleItalic().run())
  const toggleStrike = () => toggleEditableLinkMark('strike', () => editor.chain().focus().toggleStrike().run())
  const toggleUnderline = () => toggleEditableLinkMark('underline', () => editor.chain().focus().toggleUnderline().run())
  const toggleCode = () => toggleEditableLinkMark('code', () => editor.chain().focus().toggleCode().run())
  const toggleHighlight = () => toggleEditableLinkMark('highlight', () => editor.chain().focus().toggleHighlight().run())
  const toggleBlockquote = () => editor.chain().focus().toggleBlockquote().run()
  const toggleBulletList = () => editor.chain().focus().toggleBulletList().run()
  const toggleOrderedList = () => editor.chain().focus().toggleOrderedList().run()
  const toggleTaskList = () => editor.chain().focus().toggleTaskList().run()
  const toggleCodeBlock = () => editor.chain().focus().toggleCodeBlock().run()

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    const editableLinkSource = getEditableLinkSourceElement(editor)
    if (editableLinkSource) {
      if (name === 'link') return true
      if (editableLinkSource.dataset.linkMarks?.split(' ').includes(name)) return true
    }
    return editor.isActive(name, attrs)
  }

  const currentLinkHref = getCurrentLinkHref(editor)
  const openCurrentLink = () => {
    if (!currentLinkHref) return
    document.dispatchEvent(new CustomEvent('tiptap-current-link-open', {
      detail: { href: currentLinkHref },
    }))
  }

  if (!show) return null

  return (
    <div
      ref={menuRef}
      data-editor-bubble-menu
      className="absolute z-50 transition-[top,left] duration-150 ease-out"
      style={{
        top: position.top,
        left: position.left
      }}
    >
      {/* 工具栏 */}
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

        {/* 文本格式化 */}
        <div className="flex gap-0.5">
          <ToolbarButton active={isActive('bold')} onClick={toggleBold} title={t('bubbleMenu.bold')}><Bold /></ToolbarButton>
          <ToolbarButton active={isActive('italic')} onClick={toggleItalic} title={t('bubbleMenu.italic')}><Italic /></ToolbarButton>
          <ToolbarButton active={isActive('strike')} onClick={toggleStrike} title={t('bubbleMenu.strike')}><Strikethrough /></ToolbarButton>
          <ToolbarButton active={isActive('underline')} onClick={toggleUnderline} title={t('bubbleMenu.underline')}><Underline /></ToolbarButton>
          <ToolbarButton active={isActive('code')} onClick={toggleCode} title={t('bubbleMenu.inlineCode')}><Code /></ToolbarButton>
          <ToolbarButton active={isActive('highlight')} onClick={toggleHighlight} title={t('bubbleMenu.highlight')}><Highlighter /></ToolbarButton>
        </div>

        <ToolbarSeparator />

        {showLinkInput && (
          <>
            <div className="relative">
              <div className="flex items-center gap-1 px-1">
                <Input type="url" placeholder={t('bubbleMenu.linkPlaceholder')} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setLink() } else if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl('') } }} className="w-32" autoFocus />
                <Button type="button" variant="ghost" size="xs" onClick={setLink}>{t('bubbleMenu.confirm')}</Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => { setShowLinkInput(false); setLinkUrl('') }}>{t('bubbleMenu.cancel')}</Button>
              </div>
            </div>
            <ToolbarSeparator />
          </>
        )}

        {/* 块级元素 */}
        <div className="flex gap-0.5">
          <ToolbarButton active={isActive('blockquote')} onClick={toggleBlockquote} title={t('bubbleMenu.blockquote')}><Quote /></ToolbarButton>
          <ToolbarButton active={isActive('bulletList')} onClick={toggleBulletList} title={t('bubbleMenu.bulletList')}><List /></ToolbarButton>
          <ToolbarButton active={isActive('orderedList')} onClick={toggleOrderedList} title={t('bubbleMenu.orderedList')}><ListOrdered /></ToolbarButton>
          <ToolbarButton active={isActive('taskList')} onClick={toggleTaskList} title={t('bubbleMenu.taskList')}><CheckSquare /></ToolbarButton>
          <ToolbarButton active={isActive('codeBlock')} onClick={toggleCodeBlock} title={t('bubbleMenu.codeBlock')}><Code /></ToolbarButton>
        </div>

        {currentLinkHref && (
          <>
            <ToolbarSeparator />
            <ToolbarButton onClick={openCurrentLink} title={t('bubbleMenu.openLink')}><ExternalLink /></ToolbarButton>
            {/^https?:\/\//.test(currentLinkHref) && (
              <ToolbarButton
                onClick={() => document.dispatchEvent(new CustomEvent('tiptap-current-link-to-bookmark'))}
                title={t('bubbleMenu.pasteAsCard')}
              >
                <PanelTop />
              </ToolbarButton>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default BubbleMenu
