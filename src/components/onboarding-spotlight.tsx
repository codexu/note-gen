'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getSpotlightTooltipPosition, type SpotlightRect } from './onboarding-spotlight-position'

interface OnboardingSpotlightProps {
  targetId: string | null
  title: string
  description: string
  dismissLabel: string
  onDismiss: (reason: 'close' | 'target') => void
}

interface SpotlightPlacement {
  targetId: string
  hole: SpotlightRect
  tooltip: ReturnType<typeof getSpotlightTooltipPosition>
}

const ARROW_EDGE_CLASS = {
  top: '-top-1 -translate-x-1/2 border-t border-l',
  bottom: '-bottom-1 -translate-x-1/2 border-r border-b',
  left: '-left-1 -translate-y-1/2 border-b border-l',
  right: '-right-1 -translate-y-1/2 border-t border-r',
} as const

function samePlacement(previous: SpotlightPlacement | null, next: SpotlightPlacement) {
  return previous?.targetId === next.targetId
    && previous.hole.top === next.hole.top
    && previous.hole.left === next.hole.left
    && previous.hole.width === next.hole.width
    && previous.hole.height === next.hole.height
    && previous.tooltip.top === next.tooltip.top
    && previous.tooltip.left === next.tooltip.left
    && previous.tooltip.arrow?.edge === next.tooltip.arrow?.edge
    && previous.tooltip.arrow?.offset === next.tooltip.arrow?.offset
}

function measureTarget(element: HTMLElement): SpotlightRect | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0 || window.getComputedStyle(element).visibility !== 'visible') return null
  const top = Math.max(0, rect.top)
  const left = Math.max(0, rect.left)
  const width = Math.min(window.innerWidth, rect.right) - left
  const height = Math.min(window.innerHeight, rect.bottom) - top
  return width > 0 && height > 0 ? { top, left, width, height } : null
}

export function OnboardingSpotlight({
  targetId,
  title,
  description,
  dismissLabel,
  onDismiss,
}: OnboardingSpotlightProps) {
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<SpotlightPlacement | null>(null)
  const visiblePlacement = placement?.targetId === targetId ? placement : null

  useEffect(() => {
    const tooltipElement = tooltipRef.current
    if (!targetId || !tooltipElement) {
      setPlacement(null)
      return
    }

    let frameId = 0
    let target: HTMLElement | null = null
    let targetVisible = false

    const update = () => {
      frameId = 0
      const currentTarget = document.getElementById(targetId)
      if (currentTarget !== target) {
        target = currentTarget
        targetVisible = false
        intersectionObserver.disconnect()
        resizeObserver.disconnect()
        resizeObserver.observe(tooltipElement)
        if (target) {
          intersectionObserver.observe(target)
          for (let element: HTMLElement | null = target; element; element = element.parentElement) {
            resizeObserver.observe(element)
          }
        }
      }

      const rect = target && targetVisible ? measureTarget(target) : null
      if (!rect) {
        setPlacement(null)
        return
      }

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const padding = 4
      const left = Math.max(0, rect.left - padding)
      const top = Math.max(0, rect.top - padding)
      const next = {
        targetId,
        hole: {
          left,
          top,
          width: Math.min(viewportWidth, rect.left + rect.width + padding) - left,
          height: Math.min(viewportHeight, rect.top + rect.height + padding) - top,
        },
        tooltip: getSpotlightTooltipPosition({
          rect,
          viewportWidth,
          viewportHeight,
          tooltipWidth: tooltipElement.offsetWidth,
          tooltipHeight: tooltipElement.offsetHeight,
        }),
      }
      setPlacement(previous => samePlacement(previous, next) ? previous : next)
    }

    function scheduleUpdate() {
      if (!frameId) frameId = window.requestAnimationFrame(update)
    }

    const intersectionObserver = new IntersectionObserver(entries => {
      const entry = entries.find(item => item.target === target)
      if (!entry) return
      targetVisible = entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
      scheduleUpdate()
    })
    const resizeObserver = new ResizeObserver(scheduleUpdate)
    const mutationObserver = new MutationObserver(() => {
      if (!target?.isConnected) scheduleUpdate()
    })
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', scheduleUpdate)
    window.addEventListener('scroll', scheduleUpdate, true)
    scheduleUpdate()
    return () => {
      window.cancelAnimationFrame(frameId)
      intersectionObserver.disconnect()
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate, true)
    }
  }, [targetId])

  const visible = Boolean(visiblePlacement)
  useEffect(() => {
    if (!visible || !targetId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape') return
      event.preventDefault()
      onDismiss('close')
    }
    const handleTargetClick = (event: MouseEvent) => {
      if (event.target instanceof Node && document.getElementById(targetId)?.contains(event.target)) onDismiss('target')
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('click', handleTargetClick, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('click', handleTargetClick, true)
    }
  }, [onDismiss, targetId, visible])

  if (!targetId) return null

  const tooltip = visiblePlacement?.tooltip
  const arrow = tooltip?.arrow
  return (
    <div className="pointer-events-none fixed inset-0 z-[45]">
      {visiblePlacement && (
        <div
          aria-hidden="true"
          className="absolute rounded-xl border border-foreground/35 [--spotlight-scrim:0.2] dark:[--spotlight-scrim:0.36]"
          style={{
            ...visiblePlacement.hole,
            boxShadow: '0 0 0 1px hsl(var(--background) / 0.85), 0 0 0 100vmax rgb(0 0 0 / var(--spotlight-scrim))',
          }}
        />
      )}
      <div
        ref={tooltipRef}
        aria-hidden={!visible}
        className="absolute"
        style={{
          top: tooltip?.top,
          left: tooltip?.left,
          width: 'min(272px, calc(100% - 16px))',
          visibility: visible ? 'visible' : 'hidden',
        }}
      >
        <div className="relative max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-border bg-popover px-3.5 py-3 text-popover-foreground shadow-lg">
          <div role="status" className="min-w-0">
            <p className="pr-6 text-sm leading-5 font-semibold tracking-tight">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto absolute top-2 right-2 text-muted-foreground hover:text-foreground"
            aria-label={dismissLabel}
            title={dismissLabel}
            tabIndex={visible ? 0 : -1}
            onClick={() => onDismiss('close')}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {arrow && (
          <span
            aria-hidden="true"
            className={cn('absolute size-2 rotate-45 border-border bg-popover', ARROW_EDGE_CLASS[arrow.edge])}
            style={arrow.edge === 'top' || arrow.edge === 'bottom' ? { left: arrow.offset } : { top: arrow.offset }}
          />
        )}
      </div>
    </div>
  )
}
