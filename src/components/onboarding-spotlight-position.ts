export interface SpotlightRect {
  top: number
  left: number
  width: number
  height: number
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
}) {
  const left = Math.min(
    Math.max(16, rect.left + rect.width / 2 - tooltipWidth / 2),
    viewportWidth - tooltipWidth - 16
  )

  const preferredTop = rect.top - tooltipHeight - 16
  const fallbackTop = rect.top + rect.height + 16
  const top = preferredTop >= 16
    ? preferredTop
    : Math.min(fallbackTop, viewportHeight - tooltipHeight - 16)

  return { top, left }
}
