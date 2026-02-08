'use client'

import { Editor } from '@tiptap/react'
import {
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Code,
  Link,
  Highlighter,
  Quote,
  List,
  ListOrdered,
  CheckSquare,
  Sparkles,
  MessageCircle,
  Minimize2,
  Maximize2,
  Languages,
  ChevronRight
} from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { fetchAiTranslate } from '@/lib/ai/translate'
import { toast } from '@/hooks/use-toast'

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

interface BubbleMenuProps {
  editor: Editor
  onAIPolish?: () => void
  onAIConcise?: () => void
  onAIExpand?: () => void
  onQuoteToChat?: () => void
}

export function BubbleMenu({
  editor,
  onAIPolish,
  onAIConcise,
  onAIExpand,
  onQuoteToChat,
}: BubbleMenuProps) {
  const t = useTranslations('editor')
  const [show, setShow] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [showAISubmenu, setShowAISubmenu] = useState(false)
  const [showTranslateSubmenu, setShowTranslateSubmenu] = useState(false)
  const [customTranslateLang, setCustomTranslateLang] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [showLinkInput, setShowLinkInput] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const aiSubmenuRef = useRef<HTMLDivElement>(null)
  const translateSubmenuRef = useRef<HTMLDivElement>(null)

  // 存储编辑器边界用于边界检测
  const editorBoundsRef = useRef<{ left: number; right: number; top: number; bottom: number } | null>(null)

  // 处理翻译
  const handleTranslate = useCallback(async (targetLanguage: string) => {
    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)
    if (!selectedText) {
      toast({ title: t('translation.fail'), description: t('translation.failNoSelection'), variant: 'destructive' })
      return
    }
    toast({ title: t('translation.translating'), description: t('translation.translatingTo', { language: targetLanguage }) })
    try {
      const result = await fetchAiTranslate(selectedText, targetLanguage)
      if (result) {
        editor.chain().focus().insertContent(result).run()
        toast({ title: t('translation.success'), description: t('translation.successTo', { language: targetLanguage }) })
      }
    } catch (error) {
      toast({ title: t('translation.fail'), description: error instanceof Error ? error.message : t('common.error'), variant: 'destructive' })
    }
  }, [editor, t])

  const handleCustomTranslate = useCallback(async () => {
    const targetLanguage = customTranslateLang.trim()
    if (!targetLanguage) {
      toast({ title: t('translation.customLanguageEmpty'), description: t('translation.customLanguageExample'), variant: 'destructive' })
      return
    }
    await handleTranslate(targetLanguage)
    setCustomTranslateLang('')
  }, [customTranslateLang, handleTranslate, t])

  // 初始定位
  const updatePosition = useCallback(() => {
    const { selection } = editor.state
    const { from, to } = selection

    if (from === to) {
      setShow(false)
      return
    }

    // 获取编辑器边界
    const editorElement = document.querySelector('.ProseMirror')
    let editorBounds = editorBoundsRef.current
    if (!editorBounds && editorElement) {
      const rect = editorElement.getBoundingClientRect()
      editorBounds = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom
      }
      editorBoundsRef.current = editorBounds
    }

    if (!editorBounds) return

    const coords = editor.view.coordsAtPos(from)
    const centerX = coords.left + (coords.right - coords.left) / 2

    // 初始位置（居中显示）
    let left = centerX
    let top = coords.top - 8

    // 估算工具栏宽度（用于初始定位）
    const estimatedWidth = 280
    const padding = 8
    const halfWidth = estimatedWidth / 2

    // 边界检测 - 基于编辑器边缘
    if (left - halfWidth < editorBounds.left + padding) {
      left = editorBounds.left + halfWidth + padding
    } else if (left + halfWidth > editorBounds.right - padding) {
      left = editorBounds.right - halfWidth - padding
    }

    // 垂直边界检测
    const menuHeight = 40
    if (top - menuHeight < editorBounds.top) {
      top = coords.bottom + 8
    }

    // 确保菜单在编辑器底部范围内
    if (top > editorBounds.bottom - menuHeight) {
      top = editorBounds.top + padding
    }

    setPosition({ top, left })
    setShow(true)
  }, [editor])

  // 菜单显示后调整位置
  useEffect(() => {
    if (!show || !toolbarRef.current) return

    const adjustPosition = () => {
      const rect = toolbarRef.current!.getBoundingClientRect()
      const actualWidth = rect.width

      // 获取编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      let editorBounds = editorBoundsRef.current
      if (!editorBounds && editorElement) {
        const eRect = editorElement.getBoundingClientRect()
        editorBounds = {
          left: eRect.left,
          right: eRect.right,
          top: eRect.top,
          bottom: eRect.bottom
        }
        editorBoundsRef.current = editorBounds
      }

      if (!editorBounds) return

      const padding = 8
      const halfWidth = actualWidth / 2

      // 重新计算 left - 基于编辑器边缘
      let left = position.left
      if (left - halfWidth < editorBounds.left + padding) {
        left = editorBounds.left + halfWidth + padding
      } else if (left + halfWidth > editorBounds.right - padding) {
        left = editorBounds.right - halfWidth - padding
      }

      // 重新计算 top
      let top = position.top
      if (top < editorBounds.top) {
        const coords = editor.view.coordsAtPos(editor.state.selection.from)
        top = coords.bottom + 8
      }

      setPosition({ top, left })
    }

    // 延迟一帧执行，确保 DOM 已渲染
    const raf = requestAnimationFrame(adjustPosition)
    return () => cancelAnimationFrame(raf)
  }, [show, editor, position])

  // AI子菜单边界检测
  useEffect(() => {
    if (!showAISubmenu || !aiSubmenuRef.current) return

    const checkSubmenuBounds = () => {
      const rect = aiSubmenuRef.current!.getBoundingClientRect()

      // 获取编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      let editorBounds = editorBoundsRef.current
      if (!editorBounds && editorElement) {
        const eRect = editorElement.getBoundingClientRect()
        editorBounds = {
          left: eRect.left,
          right: eRect.right,
          top: eRect.top,
          bottom: eRect.bottom
        }
        editorBoundsRef.current = editorBounds
      }

      if (!editorBounds) return

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

      // 获取编辑器边界
      const editorElement = document.querySelector('.ProseMirror')
      let editorBounds = editorBoundsRef.current
      if (!editorBounds && editorElement) {
        const eRect = editorElement.getBoundingClientRect()
        editorBounds = {
          left: eRect.left,
          right: eRect.right,
          top: eRect.top,
          bottom: eRect.bottom
        }
        editorBoundsRef.current = editorBounds
      }

      if (!editorBounds) return

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
    // 更新编辑器边界
    const updateBounds = () => {
      const editorElement = document.querySelector('.ProseMirror')
      if (editorElement) {
        const rect = editorElement.getBoundingClientRect()
        editorBoundsRef.current = {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        }
      }
    }

    const updateHandler = () => {
      updateBounds()
      updatePosition()
    }
    editor.on('selectionUpdate', updateHandler)
    editor.on('transaction', updatePosition)

    // 初始化时获取一次边界
    updateBounds()

    return () => {
      editor.off('selectionUpdate', updateHandler)
      editor.off('transaction', updatePosition)
    }
  }, [editor, updatePosition])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShow(false)
        setShowAISubmenu(false)
        setShowTranslateSubmenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const handleQuoteToChat = useCallback(() => {
    onQuoteToChat?.()
    setShow(false)
    setShowAISubmenu(false)
  }, [onQuoteToChat])

  const isActive = (name: string, attrs?: Record<string, unknown>) =>
    editor.isActive(name, attrs)

  if (!show) return null

  return (
    <div
      ref={menuRef}
      className="fixed z-50 transition-[top,left] duration-150 ease-out"
      style={{
        top: position.top,
        left: position.left,
        transform: 'translate(-50%, -100%)'
      }}
    >
      {/* 工具栏 */}
      <div
        ref={toolbarRef}
        className="flex items-center gap-0.5 px-1 py-1 bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 border border-border rounded-lg shadow-lg"
      >
        {/* AI 操作 */}
        <div className="relative">
          <button
            className={cn('p-1.5 rounded hover:bg-muted transition-colors text-primary', showAISubmenu && 'bg-muted')}
            onClick={() => setShowAISubmenu(!showAISubmenu)}
            title={t('bubbleMenu.ai')}
          >
            <Sparkles className="w-4 h-4" />
          </button>

          {showAISubmenu && (
            <div
              ref={aiSubmenuRef}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-32 z-50 data-right-edge:left-auto data-right-edge:right-0 data-right-edge:translate-x-0 data-bottom-edge:top-full data-bottom-edge:mt-1 data-bottom-edge:translate-y-0"
            >
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIPolish?.() }}>
                <Sparkles className="w-3.5 h-3.5" /><span>{t('bubbleMenu.polish')}</span>
              </button>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIConcise?.() }}>
                <Minimize2 className="w-3.5 h-3.5" /><span>{t('bubbleMenu.concise')}</span>
              </button>
              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); onAIExpand?.() }}>
                <Maximize2 className="w-3.5 h-3.5" /><span>{t('bubbleMenu.expand')}</span>
              </button>

              <div className="border-t border-border my-1" />

              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => setShowTranslateSubmenu(!showTranslateSubmenu)}>
                <Languages className="w-3.5 h-3.5" /><span>{t('bubbleMenu.translate')}</span><ChevronRight className={cn('w-3.5 h-3.5 ml-auto transition-transform', showTranslateSubmenu && 'rotate-90')} />
              </button>

              {showTranslateSubmenu && (
                <div
                  ref={translateSubmenuRef}
                  className="absolute top-0 left-full ml-1 py-1 bg-background border border-border rounded-lg shadow-lg min-w-40 z-50 max-h-60 overflow-y-auto data-translate-submenu-right:left-auto data-translate-submenu-right:right-full data-translate-submenu-right:ml-0 data-translate-submenu-right:mr-1"
                  data-submenu="translate"
                >
                  {POPULAR_LANGUAGES.map((lang) => (
                    <button key={lang.code} className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); setShowTranslateSubmenu(false); handleTranslate(lang.code) }}>
                      <span>{t(`bubbleMenu.${lang.i18nKey}`)}</span>
                    </button>
                  ))}
                  <div className="border-t border-border my-1" />
                  <div className="px-3 py-1 flex items-center gap-1">
                    <input type="text" placeholder={t('bubbleMenu.customLanguagePlaceholder')} value={customTranslateLang} onChange={(e) => setCustomTranslateLang(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { handleCustomTranslate() } else if (e.key === 'Escape') { setShowTranslateSubmenu(false); setCustomTranslateLang('') } }} className="w-full px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                  </div>
                </div>
              )}

              <button className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2" onClick={() => { setShowAISubmenu(false); handleQuoteToChat() }}>
                <MessageCircle className="w-3.5 h-3.5" /><span>{t('bubbleMenu.quoteToChat')}</span>
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 文本格式化 */}
        <div className="flex gap-0.5">
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('bold') && 'bg-muted text-primary')} onClick={toggleBold} title={t('bubbleMenu.bold')}><Bold className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('italic') && 'bg-muted text-primary')} onClick={toggleItalic} title={t('bubbleMenu.italic')}><Italic className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('strike') && 'bg-muted text-primary')} onClick={toggleStrike} title={t('bubbleMenu.strike')}><Strikethrough className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('underline') && 'bg-muted text-primary')} onClick={toggleUnderline} title={t('bubbleMenu.underline')}><Underline className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('code') && 'bg-muted text-primary')} onClick={toggleCode} title={t('bubbleMenu.inlineCode')}><Code className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('highlight') && 'bg-muted text-primary')} onClick={toggleHighlight} title={t('bubbleMenu.highlight')}><Highlighter className="w-4 h-4" /></button>
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 链接 */}
        <div className="relative">
          {showLinkInput ? (
            <div className="flex items-center gap-1 px-1">
              <input type="url" placeholder={t('bubbleMenu.linkPlaceholder')} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setLink() } else if (e.key === 'Escape') { setShowLinkInput(false); setLinkUrl('') } }} className="w-32 px-2 py-1 text-sm bg-muted rounded border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
              <button className="p-1 rounded hover:bg-muted text-xs" onClick={setLink}>{t('bubbleMenu.confirm')}</button>
              <button className="p-1 rounded hover:bg-muted text-xs" onClick={() => { setShowLinkInput(false); setLinkUrl('') }}>{t('bubbleMenu.cancel')}</button>
            </div>
          ) : (
            <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('link') && 'bg-muted text-primary')} onClick={setLink} title={t('bubbleMenu.link')}><Link className="w-4 h-4" /></button>
          )}
        </div>

        <div className="w-px h-5 bg-border mx-1" />

        {/* 块级元素 */}
        <div className="flex gap-0.5">
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('blockquote') && 'bg-muted text-primary')} onClick={toggleBlockquote} title={t('bubbleMenu.blockquote')}><Quote className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('bulletList') && 'bg-muted text-primary')} onClick={toggleBulletList} title={t('bubbleMenu.bulletList')}><List className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('orderedList') && 'bg-muted text-primary')} onClick={toggleOrderedList} title={t('bubbleMenu.orderedList')}><ListOrdered className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('taskList') && 'bg-muted text-primary')} onClick={toggleTaskList} title={t('bubbleMenu.taskList')}><CheckSquare className="w-4 h-4" /></button>
          <button className={cn('p-1.5 rounded hover:bg-muted transition-colors', isActive('codeBlock') && 'bg-muted text-primary')} onClick={toggleCodeBlock} title={t('bubbleMenu.codeBlock')}><Code className="w-4 h-4" /></button>
        </div>
      </div>
    </div>
  )
}

export default BubbleMenu
