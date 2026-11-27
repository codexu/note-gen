'use client'

import { ReactNode, useRef } from 'react'
import { BookOpen, ChevronDown, FileText, Folder, LoaderCircle, MoreVertical } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { BrowserEntry } from './types'
import { MobileActionDrawer } from '@/app/mobile/components/mobile-action-drawer'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { WikiMenuItems } from '@/components/wiki/wiki-menu-items'
import { cn } from '@/lib/utils'

type EntryAction = {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void | Promise<void>
  disabled?: boolean
  variant?: 'default' | 'outline' | 'destructive'
  separatorBefore?: boolean
}

interface EntryListItemProps {
  entry: BrowserEntry
  isActive: boolean
  onOpen: (entry: BrowserEntry) => void
  actions: EntryAction[]
  subtitle?: string
  dragDisabled?: boolean
  isDragging?: boolean
  dragOffset?: { x: number; y: number }
  isDropTarget?: boolean
  dropTargetRef?: (node: HTMLDivElement | null) => void
  onDragStart?: (entry: BrowserEntry, point: { x: number; y: number }) => void
  onDragMove?: (point: { x: number; y: number }) => void
  onDragEnd?: (point: { x: number; y: number }) => void
  onDragCancel?: () => void
}

export function EntryListItem({
  entry,
  isActive,
  onOpen,
  actions,
  subtitle,
  dragDisabled = false,
  isDragging = false,
  dragOffset,
  isDropTarget = false,
  dropTargetRef,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: EntryListItemProps) {
  const tWiki = useTranslations('wiki')
  const wikiEligible = (entry.type === 'folder' || entry.name.toLowerCase().endsWith('.md'))
    && !entry.relativePath.split('/').some(segment => segment.startsWith('.'))
  const touchStartXRef = useRef(0)
  const touchStartYRef = useRef(0)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDraggingRef = useRef(false)
  const suppressClickRef = useRef(false)

  const itemTransform = isDragging && dragOffset
    ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
    : undefined

  function clearLongPressTimer() {
    if (!longPressTimerRef.current) return
    clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
  }

  function handleTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    touchStartXRef.current = touch.clientX
    touchStartYRef.current = touch.clientY

    if (!dragDisabled) {
      clearLongPressTimer()
      longPressTimerRef.current = setTimeout(() => {
        isDraggingRef.current = true
        suppressClickRef.current = true
        onDragStart?.(entry, { x: touch.clientX, y: touch.clientY })
      }, 350)
    }
  }

  function handleTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const touch = e.touches[0]
    const deltaX = touch.clientX - touchStartXRef.current
    const deltaY = touch.clientY - touchStartYRef.current

    if (isDraggingRef.current) {
      e.preventDefault()
      onDragMove?.({ x: touch.clientX, y: touch.clientY })
      return
    }

    if (Math.hypot(deltaX, deltaY) > 10) {
      clearLongPressTimer()
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    clearLongPressTimer()
    if (isDraggingRef.current) {
      const touch = e.changedTouches[0]
      isDraggingRef.current = false
      onDragEnd?.({ x: touch.clientX, y: touch.clientY })
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
  }

  function handleTouchCancel() {
    clearLongPressTimer()
    if (isDraggingRef.current) {
      onDragCancel?.()
    }
    isDraggingRef.current = false
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }

  return (
    <div
      ref={dropTargetRef}
      className={cn(
        "relative rounded-md bg-background",
        isDragging ? "z-50 overflow-visible" : "overflow-hidden",
        isDropTarget && "outline-2 outline-primary outline-offset-2"
      )}
    >
      <div
        className={cn(
          "relative z-10 min-h-11 w-full rounded-md bg-background px-2 py-1.5 text-left transition-transform duration-200 ease-out hover:bg-accent active:bg-accent",
          isActive && "bg-accent text-accent-foreground",
          isDropTarget && "bg-primary/5",
          isDragging && "bg-background shadow-xl ring-1 ring-primary transition-none"
        )}
        style={{ transform: itemTransform }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onOpen(entry)
            }}
            className="min-w-0 flex-1 text-left"
          >
            <div className="flex items-center gap-2">
              {entry.isLoading ? (
                <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : entry.type === 'folder' ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{entry.name}</p>
            </div>
            {subtitle && (
              <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
            )}
          </button>
          <MobileActionDrawer
            title={entry.name}
            renderExtraItems={wikiEligible ? dismiss => <Collapsible>
              <CollapsibleTrigger asChild>
                <Button type="button" variant="ghost" className="h-12 w-full justify-start px-3">
                  <BookOpen />{tWiki('wikiTitle')}<ChevronDown className="ml-auto" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-4 border-l pl-1">
                <WikiMenuItems variant="drawer" kind={entry.type === 'folder' ? 'article-folder' : 'article'}
                  id={entry.relativePath} label={entry.name} local={entry.isLocale} onDismiss={dismiss} />
              </CollapsibleContent>
            </Collapsible> : undefined}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                aria-label={entry.name}
                onClick={(event) => event.stopPropagation()}
                onTouchStart={(event) => event.stopPropagation()}
                data-vaul-no-drag
              >
                <MoreVertical />
              </Button>
            }
            items={actions.map(action => ({
              key: action.key,
              label: action.label,
              icon: action.icon,
              onSelect: action.onClick,
              disabled: action.disabled,
              destructive: action.variant === 'destructive',
              separatorBefore: action.separatorBefore,
            }))}
          />
        </div>
      </div>
    </div>
  )
}
