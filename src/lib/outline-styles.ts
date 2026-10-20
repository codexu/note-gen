export function getOutlinePanelClass(
  position: 'left' | 'right' = 'right',
  floating = false
) {
  const placementClass = position === 'left'
    ? `${floating ? 'left-0' : ''} border-r`
    : `${floating ? 'right-0' : ''} border-l`

  const layoutClass = floating
    ? 'absolute inset-y-0 z-20'
    : 'shrink-0'

  return `outline-panel ${layoutClass} ${placementClass} border-[hsl(var(--border))] bg-[hsl(var(--background))] overflow-hidden`
}

export function getOutlineHeadingTextClass() {
  return 'flex-1 min-w-0 break-all whitespace-normal leading-5'
}
