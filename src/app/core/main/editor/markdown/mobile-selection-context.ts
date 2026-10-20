const PRIMARY_ACTIONS = {
  text: ['ai', 'bold', 'highlight', 'italic', 'underline', 'strike', 'code', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'codeBlock'],
  image: ['image-src', 'image-alt', 'delete-image', 'more'],
  table: ['add-row', 'add-column', 'align', 'more'],
} as const

type TextSelectionContextInput = {
  mode: 'text'
  from: number
  to: number
  previewText: string
}

type ImageSelectionContextInput = {
  mode: 'image'
  pos: number
  src?: string
  alt?: string
}

type TableSelectionContextInput = {
  mode: 'table'
  from?: number
}

type MobileSelectionContextInput =
  | TextSelectionContextInput
  | ImageSelectionContextInput
  | TableSelectionContextInput
  | null
  | undefined

export function getMobileContextPrimaryActions(mode: keyof typeof PRIMARY_ACTIONS) {
  return PRIMARY_ACTIONS[mode] ?? []
}

export function buildMobileSelectionContext(input: MobileSelectionContextInput) {
  if (!input?.mode) {
    return null
  }

  if (input.mode === 'text') {
    const previewText = input.previewText?.trim() ?? ''
    if (typeof input.from !== 'number' || typeof input.to !== 'number' || input.from >= input.to || !previewText) {
      return null
    }

    return {
      mode: 'text' as const,
      from: input.from,
      to: input.to,
      previewText,
      actions: getMobileContextPrimaryActions('text'),
    }
  }

  if (input.mode === 'image') {
    if (typeof input.pos !== 'number') {
      return null
    }

    return {
      mode: 'image' as const,
      pos: input.pos,
      src: input.src ?? '',
      alt: input.alt ?? '',
      actions: getMobileContextPrimaryActions('image'),
    }
  }

  if (input.mode === 'table') {
    return {
      mode: 'table' as const,
      from: input.from ?? 0,
      actions: getMobileContextPrimaryActions('table'),
    }
  }

  return null
}

export function isMobileSelectionContextStale(
  context:
    | { mode: 'text'; from: number; to: number }
    | { mode: 'image'; pos: number }
    | { mode: 'table'; from: number }
    | null,
  docSize: number,
) {
  if (!context) {
    return true
  }

  if (context.mode === 'text') {
    return context.from < 0 || context.to > docSize || context.from >= context.to
  }

  if (context.mode === 'image') {
    return context.pos < 0 || context.pos > docSize
  }

  if (context.mode === 'table') {
    return typeof context.from === 'number' && (context.from < 0 || context.from > docSize)
  }

  return false
}
