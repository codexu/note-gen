export interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
}

const VIEWPORT_MARGIN = 8
const TARGET_GAP = 12
const ARROW_CORNER_CLEARANCE = 14

type TooltipEdge = 'top' | 'bottom' | 'left' | 'right'

interface SpotlightTooltipPosition {
  top: number
  left: number
  arrow?: { edge: TooltipEdge; offset: number }
}

function clampToViewport(value: number, viewport: number, size: number) {
  return Math.min(Math.max(VIEWPORT_MARGIN, value), Math.max(VIEWPORT_MARGIN, viewport - size - VIEWPORT_MARGIN))
}

function getArrow(edge: TooltipEdge, offset: number, edgeLength: number) {
  if (offset >= ARROW_CORNER_CLEARANCE && offset <= edgeLength - ARROW_CORNER_CLEARANCE) {
    return { edge, offset }
  }
}

export function getSpotlightTooltipPosition({
  rect,
  viewportWidth,
  viewportHeight,
  tooltipWidth,
  tooltipHeight,
}: {
  rect: SpotlightRect
  viewportWidth: number
  viewportHeight: number
  tooltipWidth: number
  tooltipHeight: number
}): SpotlightTooltipPosition {
  const targetCenterX = rect.left + rect.width / 2
  const targetCenterY = rect.top + rect.height / 2
  const centerLeft = clampToViewport(targetCenterX - tooltipWidth / 2, viewportWidth, tooltipWidth)
  const arrowX = targetCenterX - centerLeft
  const above = rect.top - tooltipHeight - TARGET_GAP
  const below = rect.top + rect.height + TARGET_GAP
  if (above >= VIEWPORT_MARGIN) {
    return { top: above, left: centerLeft, arrow: getArrow('bottom', arrowX, tooltipWidth) }
  }
  if (below + tooltipHeight <= viewportHeight - VIEWPORT_MARGIN) {
    return { top: below, left: centerLeft, arrow: getArrow('top', arrowX, tooltipWidth) }
  }

  const centerTop = clampToViewport(targetCenterY - tooltipHeight / 2, viewportHeight, tooltipHeight)
  const arrowY = targetCenterY - centerTop
  const right = rect.left + rect.width + TARGET_GAP
  const left = rect.left - tooltipWidth - TARGET_GAP
  if (right + tooltipWidth <= viewportWidth - VIEWPORT_MARGIN) {
    return { top: centerTop, left: right, arrow: getArrow('left', arrowY, tooltipHeight) }
  }
  if (left >= VIEWPORT_MARGIN) {
    return { top: centerTop, left, arrow: getArrow('right', arrowY, tooltipHeight) }
  }

  const availableAbove = rect.top
  const availableBelow = viewportHeight - rect.top - rect.height
  const fallbackTop = availableAbove >= availableBelow ? above : below
  return { top: clampToViewport(fallbackTop, viewportHeight, tooltipHeight), left: centerLeft }
}
