'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, Replace, ArrowUp, ArrowDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import Vditor from 'vditor'
import { createPortal } from 'react-dom'

interface EditorSearchProps {
  editor: Vditor | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditorSearch({ editor, open, onOpenChange }: EditorSearchProps) {
  const t = useTranslations('article.editor')
  const [searchTerm, setSearchTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const highlightOverlayRef = useRef<HTMLDivElement | null>(null)
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 清除高亮
  const clearHighlights = useCallback(() => {
    const vditorElement = editor?.vditor.element
    if (!vditorElement) return

    // 清除覆盖层
    if (highlightOverlayRef.current) {
      highlightOverlayRef.current.remove()
      highlightOverlayRef.current = null
    }
    // 清除所有可能的旧高亮
    const oldHighlights = document.querySelectorAll('.vditor-search-highlight-overlay')
    oldHighlights.forEach(h => h.remove())

    // 清除编辑器 DOM 中的高亮元素
    const highlights = vditorElement.querySelectorAll('.vditor-search-highlight-temp')
    highlights.forEach(highlight => {
      const parent = highlight.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight)
        parent.normalize()
      }
    })
  }, [editor])

  // 直接在编辑器 DOM 中插入高亮元素
  const highlightMatches = useCallback((currentPos?: number) => {
    if (!editor || !searchTerm) return

    clearHighlights()

    const targetIndex = currentPos ?? 0

    // 获取编辑器元素
    const vditorElement = editor.vditor.element
    if (!vditorElement) return

    // 根据 Vditor 的当前模式选择正确的元素
    // IR 模式: 使用 .vditor-ir (整个 ir 区域)
    // WYSIWYG 模式: 使用 .vditor-wysiwyg
    // SV 模式: 使用 .vditor-sv
    const irElement = vditorElement.querySelector('.vditor-ir') as HTMLElement
    const wysiwygElement = vditorElement.querySelector('.vditor-wysiwyg') as HTMLElement
    const svElement = vditorElement.querySelector('.vditor-sv') as HTMLElement

    const searchElement: HTMLElement | null = irElement || wysiwygElement || svElement

    if (!searchElement) return

    // 使用 MutationObserver 监听 DOM 变化，在 Vditor 完成渲染后添加高亮
    const addHighlights = () => {
      // 使用 TreeWalker 找到所有文本节点
      const walker = document.createTreeWalker(
        searchElement!,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.textContent || node.textContent.trim().length === 0) {
              return NodeFilter.FILTER_REJECT
            }
            // 跳过高亮节点及其子节点
            if (node.parentElement?.closest('.vditor-search-highlight-temp')) {
              return NodeFilter.FILTER_REJECT
            }
            // 跳过输入框、工具栏等不需要搜索的区域
            const parent = node.parentElement
            if (parent?.closest('input, textarea, .vditor-toolbar, .vditor-hint')) {
              return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
          }
        }
      )

      const textNodes: Text[] = []
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text)
      }

      if (textNodes.length === 0) return

      // 查找所有匹配项并添加高亮
      let matchCount = 0
      const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi')
      let scrollToElement: HTMLElement | null = null

      // 需要处理的文本节点列表（从后往前遍历，避免 DOM 变化影响索引）
      const nodesToProcess: Array<{
        node: Text
        text: string
        matches: Array<{start: number, end: number, text: string}>
      }> = []

      for (const textNode of textNodes) {
        const text = textNode.textContent || ''
        const nodeMatches: Array<{start: number, end: number, text: string}> = []

        searchRegex.lastIndex = 0
        let matchResult
        while ((matchResult = searchRegex.exec(text)) !== null) {
          nodeMatches.push({
            start: matchResult.index,
            end: matchResult.index + matchResult[0].length,
            text: matchResult[0]
          })
        }

        if (nodeMatches.length > 0) {
          nodesToProcess.push({
            node: textNode,
            text,
            matches: nodeMatches
          })
        }
      }

      // 处理包含匹配的节点（从后往前避免索引变化）
      for (let i = nodesToProcess.length - 1; i >= 0; i--) {
        const { node, text, matches: nodeMatches } = nodesToProcess[i]

        const fragment = document.createDocumentFragment()
        let lastIndex = 0

        for (const match of nodeMatches) {
          // 添加匹配前的文本
          if (match.start > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)))
          }

          // 添加高亮
          const highlight = document.createElement('span')
          highlight.textContent = match.text
          const isCurrent = matchCount === targetIndex
          highlight.className = 'vditor-search-highlight-temp'
          highlight.style.cssText = `
            background-color: ${isCurrent ? 'hsl(var(--primary) / 0.5)' : 'hsl(var(--primary) / 0.2)'};
            border-radius: 2px;
            padding: 0 2px;
            display: inline;
          `

          if (isCurrent) {
            scrollToElement = highlight
          }

          fragment.appendChild(highlight)

          lastIndex = match.end
          matchCount++
        }

        // 添加剩余文本
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
        }

        node.parentNode?.replaceChild(fragment, node)
      }

      // 滚动到当前匹配项
      if (scrollToElement) {
        // 使用 requestAnimationFrame 确保 DOM 更新完成
        requestAnimationFrame(() => {
          scrollToElement!.scrollIntoView({ behavior: 'smooth', block: 'center' })
        })
      }

      return matchCount
    }

    // 延迟执行，确保 Vditor 完成渲染
    setTimeout(() => {
      addHighlights()
    }, 150)
  }, [editor, searchTerm, caseSensitive, clearHighlights])

  // 查找所有匹配项
  const findMatches = useCallback(() => {
    if (!editor || !searchTerm) return { matches: [], index: 0 }

    const content = editor.getValue()
    const flags = caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)

    const matches: number[] = []
    let match
    while ((match = regex.exec(content)) !== null) {
      matches.push(match.index)
    }

    return { matches, index: 0 }
  }, [editor, searchTerm, caseSensitive])

  // 更新匹配结果并高亮
  useEffect(() => {
    if (!open) {
      clearHighlights()
      return
    }

    const { matches } = findMatches()
    setTotalMatches(matches.length)
    setCurrentIndex(0)

    if (matches.length > 0) {
      highlightMatches(0)
    }
  }, [open, searchTerm, caseSensitive, findMatches, highlightMatches, clearHighlights])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }
    }
  }, [])

  // 查找下一个
  const findNext = useCallback(() => {
    if (!editor || totalMatches === 0) return

    const { matches } = findMatches()
    const nextIndex = (currentIndex + 1) % matches.length
    setCurrentIndex(nextIndex)

    highlightMatches(nextIndex)
  }, [editor, currentIndex, totalMatches, findMatches, highlightMatches])

  // 查找上一个
  const findPrev = useCallback(() => {
    if (!editor || totalMatches === 0) return

    const { matches } = findMatches()
    const prevIndex = (currentIndex - 1 + matches.length) % matches.length
    setCurrentIndex(prevIndex)

    highlightMatches(prevIndex)
  }, [editor, currentIndex, totalMatches, findMatches, highlightMatches])

  // 替换当前
  const replaceCurrent = useCallback(() => {
    if (!editor || !searchTerm || totalMatches === 0) return

    const content = editor.getValue()

    const { matches } = findMatches()
    const currentPos = matches[currentIndex]

    const before = content.substring(0, currentPos)
    const after = content.substring(currentPos + searchTerm.length)
    const newContent = before + replaceTerm + after

    editor.setValue(newContent, false)

    const newIndex = Math.max(0, currentIndex - 1)
    setCurrentIndex(newIndex)
    setTotalMatches(matches.length - 1)

    setTimeout(() => {
      if (newIndex < matches.length - 1) {
        highlightMatches(newIndex)
      } else {
        clearHighlights()
      }
    }, 50)
  }, [editor, searchTerm, replaceTerm, currentIndex, totalMatches, findMatches, highlightMatches, clearHighlights])

  // 替换全部
  const replaceAll = useCallback(() => {
    if (!editor || !searchTerm) return

    const content = editor.getValue()
    const flags = caseSensitive ? 'g' : 'gi'

    const newContent = content.replace(
      new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags),
      replaceTerm
    )
    editor.setValue(newContent, false)

    setTotalMatches(0)
    setCurrentIndex(0)
    clearHighlights()
  }, [editor, searchTerm, replaceTerm, caseSensitive, clearHighlights])

  // 键盘快捷键
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          e.preventDefault()
          findPrev()
        } else {
          e.preventDefault()
          findNext()
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, findNext, findPrev, onOpenChange])

  // 清理高亮当对话框关闭时
  useEffect(() => {
    if (!open) {
      clearHighlights()
    }
  }, [open, clearHighlights])

  // 重置状态当打开时
  useEffect(() => {
    if (open) {
      // 不重置 searchTerm，保留用户之前的搜索内容
      setReplaceTerm('')
      // currentIndex 和 totalMatches 会在搜索时更新
    }
  }, [open])

  // 同步触发器按钮状态并更新 ref
  useEffect(() => {
    const searchButton = document.getElementById('editor-search-button-container') as HTMLButtonElement | null
    if (searchButton && triggerRef.current !== searchButton) {
      triggerRef.current = searchButton
    }
    if (searchButton) {
      if (open) {
        searchButton.setAttribute('data-state', 'open')
      } else {
        searchButton.setAttribute('data-state', 'closed')
      }
    }
  }, [open])

  // 更新内容位置 - 定位在编辑器正文内容的右上角
  useEffect(() => {
    if (open && editor) {
      // 获取编辑器内容区域 .vditor-content
      const vditorElement = editor.vditor.element
      if (!vditorElement || !contentRef.current) return

      const contentArea = vditorElement.querySelector('.vditor-content') as HTMLElement
      if (!contentArea) return

      // 定位在内容区域的右上角
      const rect = contentArea.getBoundingClientRect()
      contentRef.current.style.position = 'fixed'
      contentRef.current.style.top = `${rect.top + 8}px`
      contentRef.current.style.left = `${rect.right - 340}px` // 减去搜索框宽度 + 额外间距
    }
  }, [open, editor])

  // 点击外部关闭 Popover
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (contentRef.current && !contentRef.current.contains(e.target as Node) &&
          triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  return (
    <>
      <button
        ref={triggerRef}
        id="editor-search-trigger"
        className="hidden"
        aria-label="搜索"
      />
      {open && triggerRef.current && createPortal(
        <div
          ref={contentRef}
          className="fixed z-50 w-80 p-4 bg-popover text-popover-foreground rounded-md border shadow-md"
        >
          <div className="space-y-2">
            {/* 搜索输入 */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('search.placeholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-9 pr-16 text-sm"
                autoFocus
              />
              {totalMatches > 0 && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                  {currentIndex + 1}/{totalMatches}
                </span>
              )}
            </div>

            {/* 替换输入 */}
            <div className="relative">
              <Replace className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder={t('search.replacePlaceholder')}
                value={replaceTerm}
                onChange={(e) => setReplaceTerm(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>

            {/* 操作按钮 - 单行布局 */}
            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={findPrev}
                  disabled={totalMatches === 0}
                  className="h-7 w-7 p-0"
                  title={t('search.findPrev')}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={findNext}
                  disabled={totalMatches === 0}
                  className="h-7 w-7 p-0"
                  title={t('search.findNext')}
                >
                  <ArrowDown className="size-3.5" />
                </Button>

                {/* 替换按钮 - 仅在有搜索结果时显示 */}
                {searchTerm && totalMatches > 0 && (
                  <>
                    <div className="w-px h-4 bg-border mx-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={replaceCurrent}
                      className="h-7 px-2 text-xs"
                      title={t('search.replace')}
                    >
                      {t('search.replace')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={replaceAll}
                      className="h-7 px-2 text-xs"
                      title={t('search.replaceAll')}
                    >
                      {t('search.replaceAll')}
                    </Button>
                  </>
                )}
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    className="rounded border-input"
                  />
                  {t('search.caseSensitive')}
                </label>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
