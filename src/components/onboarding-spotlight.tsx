'use client'

import { useEffect, useState } from 'react'
import { getSpotlightTooltipPosition, type SpotlightRect } from './onboarding-spotlight-position'

interface OnboardingSpotlightProps {
  targetId: string | null
  title: string
  description: string
  onDismiss: () => void
}

function measureTarget(targetId: string): SpotlightRect | null {
  const element = document.getElementById(targetId)
  if (!element) {
    return null
  }

  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function OnboardingSpotlight({
  targetId,
  title,
  description,
  onDismiss,
}: OnboardingSpotlightProps) {
  const [rect, setRect] = useState<SpotlightRect | null>(null)

  useEffect(() => {
    if (!targetId) {
      setRect(null)
      return
    }

    const update = () => {
      setRect(measureTarget(targetId))
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const intervalId = window.setInterval(update, 250)

    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.clearInterval(intervalId)
    }
  }, [targetId])

  if (!rect) {
    return null
  }

  const tooltipWidth = 280
  const tooltipHeight = 120
  const { top: tooltipTop, left: tooltipLeft } = getSpotlightTooltipPosition({
    rect,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    tooltipWidth,
    tooltipHeight,
  })
  const holeTop = Math.max(0, rect.top - 8)
  const holeLeft = Math.max(0, rect.left - 8)
  const holeWidth = rect.width + 16
  const holeHeight = rect.height + 16

  return (
    <div className="fixed inset-0 z-[10010]" onClick={onDismiss}>
      <div
        className="pointer-events-none absolute rounded-2xl border-2 border-primary transition-all duration-200"
        style={{
          top: holeTop,
          left: holeLeft,
          width: holeWidth,
          height: holeHeight,
          boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.45)',
        }}
      />
      <div
        className="absolute rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: tooltipWidth,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
