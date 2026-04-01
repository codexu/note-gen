export const OUTLINE_PANEL_WIDTH_CLASS = 'w-64'
export const OUTLINE_PANEL_PADDING_CLASS = '17rem'

export function getOutlinePanelClass(
  position: 'left' | 'right' = 'right',
  floating = false
) {
  const placementClass = position === 'left'
    ? `${floating ? 'left-0' : ''} border-r`
    : `${floating ? 'right-0' : ''} border-l`

  const layoutClass = floating
    ? `absolute top-0 bottom-6 z-20 ${OUTLINE_PANEL_WIDTH_CLASS}`
    : `${OUTLINE_PANEL_WIDTH_CLASS} min-w-64 shrink-0`

  return `outline-panel ${layoutClass} ${placementClass} border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-y-auto`
}

export function getOutlineHeadingTextClass() {
  return 'flex-1 min-w-0 break-all whitespace-normal leading-5'
}
