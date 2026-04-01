export function getEditorContentContainerClass(options: {
  centeredContent: boolean
  isMobile: boolean
  outlineOpen?: boolean
  outlinePosition?: 'left' | 'right'
}) {
  if (options.isMobile) {
    return ''
  }

  const outlinePaddingClass = options.outlineOpen
    ? options.outlinePosition === 'left'
      ? 'pl-72'
      : 'pr-72'
    : ''

  if (options.centeredContent) {
    return `max-w-3xl mx-auto px-4 ${outlinePaddingClass}`.trim()
  }

  return `px-10 ${outlinePaddingClass}`.trim()
}
