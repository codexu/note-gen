'use client'

import type { Editor } from '@tiptap/react'
import { useTranslations } from 'next-intl'
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui'
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ScrollBar } from '@/components/ui/scroll-area'

const SCROLLBAR_HEIGHT = 16
const EDGE_GAP = 4
const CLIPPING_OVERFLOW = /^(auto|scroll|hidden|clip|overlay)$/

interface TableScrollPosition {
  table: HTMLElement
  left: number
  top: number
  width: number
  maxScrollLeft: number
  scrollLeft: number
}

function getVisibleBounds(viewport: HTMLElement) {
  const visualViewport = window.visualViewport
  const bounds = {
    left: visualViewport?.offsetLeft ?? 0,
    top: visualViewport?.offsetTop ?? 0,
    right: (visualViewport?.offsetLeft ?? 0) + (visualViewport?.width ?? window.innerWidth),
    bottom: (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight),
  }

  // Record editors can scroll in an outer panel instead of their own viewport.
  for (let element: HTMLElement | null = viewport; element; element = element.parentElement) {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    if (element === viewport || CLIPPING_OVERFLOW.test(style.overflowX)) {
      bounds.left = Math.max(bounds.left, rect.left + element.clientLeft)
      bounds.right = Math.min(bounds.right, rect.left + element.clientLeft + element.clientWidth)
    }
    if (element === viewport || CLIPPING_OVERFLOW.test(style.overflowY)) {
      bounds.top = Math.max(bounds.top, rect.top + element.clientTop)
      bounds.bottom = Math.min(bounds.bottom, rect.top + element.clientTop + element.clientHeight)
    }
  }

  const toolbar = viewport.closest('.tiptap-editor')?.querySelector<HTMLElement>('.mobile-writing-toolbar')
  if (toolbar) {
    const style = getComputedStyle(toolbar)
    const rect = toolbar.getBoundingClientRect()
    if (style.display !== 'none' && style.visibility !== 'hidden'
      && rect.width > 0 && rect.height > 0 && rect.bottom >= bounds.bottom
      && rect.right > bounds.left && rect.left < bounds.right) {
      bounds.bottom = Math.min(bounds.bottom, rect.top)
    }
  }

  return bounds
}

export function TableScrollbar({
  editor,
  scrollContainerRef,
}: {
  editor: Editor
  scrollContainerRef: { current: HTMLDivElement | null }
}) {
  const t = useTranslations('editor')
  const proxyRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<TableScrollPosition | null>(null)

  useLayoutEffect(() => {
    const viewport = scrollContainerRef.current
    if (!viewport || editor.isDestroyed) return

    const editorElement = editor.view.dom
    const editorRoot = viewport.closest('.tiptap-editor') ?? viewport
    let frame = 0
    let tablesDirty = true
    let tables: HTMLElement[] = []
    let observedTableElements = new Set<Element>()

    const updatePosition = () => {
      frame = 0
      if (editor.isDestroyed || !viewport.isConnected) return

      if (tablesDirty) {
        tablesDirty = false
        tables = Array.from(editorElement.querySelectorAll<HTMLElement>('.tableWrapper'))
        const nextElements = new Set<Element>()
        for (const table of tables) {
          nextElements.add(table)
          const content = table.querySelector('table')
          if (content) nextElements.add(content)
        }
        for (const element of observedTableElements) {
          if (!nextElements.has(element)) resizeObserver.unobserve(element)
        }
        for (const element of nextElements) {
          if (!observedTableElements.has(element)) resizeObserver.observe(element)
        }
        observedTableElements = nextElements
      }

      const bounds = tables.length ? getVisibleBounds(viewport) : null
      let next: TableScrollPosition | null = null
      if (bounds && bounds.right > bounds.left && bounds.bottom > bounds.top + SCROLLBAR_HEIGHT + EDGE_GAP) {
        const visibleHeight = bounds.bottom - bounds.top
        for (const table of tables) {
          const maxScrollLeft = table.scrollWidth - table.clientWidth
          if (maxScrollLeft <= 1) continue

          const rect = table.getBoundingClientRect()
          // Short tables can use their own scrollbar after a small vertical scroll.
          if (rect.height <= visibleHeight + 1) continue

          const left = Math.max(bounds.left, rect.left)
          const right = Math.min(bounds.right, rect.right)
          // Once the table's own scrollbar is visible, it takes over.
          if (rect.top >= bounds.bottom - SCROLLBAR_HEIGHT - EDGE_GAP
            || rect.bottom <= bounds.bottom + 1 || right - left <= 1) continue

          next = {
            table,
            left,
            top: bounds.bottom - SCROLLBAR_HEIGHT - EDGE_GAP,
            width: right - left,
            maxScrollLeft,
            scrollLeft: Math.max(0, Math.min(maxScrollLeft, table.scrollLeft)),
          }
        }
      }

      setPosition(current => current?.table === next?.table
        && current?.left === next?.left && current?.top === next?.top
        && current?.width === next?.width && current?.maxScrollLeft === next?.maxScrollLeft
        && current?.scrollLeft === next?.scrollLeft ? current : next)
    }

    const scheduleUpdate = () => {
      if (!frame) frame = requestAnimationFrame(updatePosition)
    }
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(editorElement)
    for (let element: HTMLElement | null = viewport; element; element = element.parentElement) {
      resizeObserver.observe(element)
    }

    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList')) tablesDirty = true
      scheduleUpdate()
    })
    observer.observe(editorRoot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    document.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true })
    window.addEventListener('resize', scheduleUpdate)
    window.visualViewport?.addEventListener('resize', scheduleUpdate)
    window.visualViewport?.addEventListener('scroll', scheduleUpdate)
    updatePosition()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      observer.disconnect()
      document.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', scheduleUpdate)
      window.visualViewport?.removeEventListener('resize', scheduleUpdate)
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate)
    }
  }, [editor, scrollContainerRef])

  useLayoutEffect(() => {
    const proxy = proxyRef.current
    if (proxy && position && Math.abs(proxy.scrollLeft - position.scrollLeft) > 1) {
      proxy.scrollLeft = position.scrollLeft
    }
  }, [position])

  const syncTableScroll = (scrollLeft: number) => {
    if (!position?.table.isConnected) return
    const table = position.table
    table.scrollLeft = Math.max(0, Math.min(position.maxScrollLeft, scrollLeft))
    setPosition(current => current?.table === table && current.scrollLeft !== table.scrollLeft
      ? { ...current, scrollLeft: table.scrollLeft } : current)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!position) return
    const pageSize = position.width * 0.85
    const offsets: Record<string, number> = {
      ArrowLeft: -40,
      ArrowRight: 40,
      PageUp: -pageSize,
      PageDown: pageSize,
      Home: -position.maxScrollLeft,
      End: position.maxScrollLeft,
    }
    const offset = offsets[event.key]
    if (offset === undefined) return
    event.preventDefault()
    event.stopPropagation()
    syncTableScroll(position.table.scrollLeft + offset)
  }

  if (!position) return null

  return createPortal(
    <ScrollAreaPrimitive.Root
      type="always"
      dir="ltr"
      className="editor-table-scrollbar"
      style={{ position: 'fixed', left: position.left, top: position.top, width: position.width, height: SCROLLBAR_HEIGHT }}
      onPointerDown={event => event.preventDefault()}
    >
      <ScrollAreaPrimitive.Viewport
        ref={proxyRef}
        className="size-full"
        aria-hidden="true"
        tabIndex={-1}
        onScroll={event => syncTableScroll(event.currentTarget.scrollLeft)}
      >
        <div style={{ width: position.width + position.maxScrollLeft, height: 1 }} />
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar
        orientation="horizontal"
        className="data-horizontal:h-4"
        role="scrollbar"
        aria-label={t('tableHorizontalScrollbar')}
        aria-controls={scrollContainerRef.current?.id}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(position.maxScrollLeft)}
        aria-valuenow={Math.round(position.scrollLeft)}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      />
    </ScrollAreaPrimitive.Root>,
    document.body,
  )
}
