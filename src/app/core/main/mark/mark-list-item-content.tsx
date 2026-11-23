import type { Mark } from "@/db/marks"
import type { Priority } from "./todo-form"

export type ParsedTodoMark = {
  title: string
  description: string
  completed: boolean
  priority: Priority
}

export type MarkListItemContent = {
  title: string
  preview: string
  imageUrl?: string
  linkUrl?: string
  todo?: ParsedTodoMark
}

const DEFAULT_TODO: ParsedTodoMark = {
  title: '',
  description: '',
  completed: false,
  priority: 'medium',
}

function compactText(value?: string) {
  return value
    ?.replace(/&#(x[\da-f]+|\d+);/gi, (entity, code) => {
      const codePoint = code[0].toLowerCase() === 'x'
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10)
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || ''
}

function splitTitleAndPreview(value?: string) {
  const text = compactText(value)
  if (!text) {
    return { title: '', preview: '' }
  }

  const title = text.slice(0, 48).trim()
  const preview = text.length > 48 ? text.slice(48).trim() : text

  return { title, preview }
}

export function parseTodoMarkContent(mark: Mark, { preserveFormatting = false } = {}): ParsedTodoMark {
  try {
    const parsed = JSON.parse(mark.content || '{}') as Partial<ParsedTodoMark>
    const title = typeof parsed.title === 'string' ? parsed.title : mark.desc || ''
    const description = typeof parsed.description === 'string' ? parsed.description : ''
    const priority = parsed.priority === 'low' || parsed.priority === 'high' ? parsed.priority : 'medium'
    return {
      title: preserveFormatting ? title : compactText(title) || compactText(mark.desc),
      description: preserveFormatting ? description : compactText(description),
      completed: Boolean(parsed.completed),
      priority,
    }
  } catch {
    return {
      ...DEFAULT_TODO,
      title: preserveFormatting ? mark.desc || '' : compactText(mark.desc),
    }
  }
}

export function getRecordBodyMarkdown(mark: Mark): string {
  if (mark.type === 'todo') return parseTodoMarkContent(mark, { preserveFormatting: true }).description
  return mark.content || (mark.type === 'text' ? mark.desc || '' : '')
}

export function canEditRecordDescription(mark: Pick<Mark, 'type' | 'deleted'>): boolean {
  return mark.deleted !== 1 && mark.type !== 'text' && mark.type !== 'todo'
}

export function patchTodoMarkContent(mark: Mark, changes: Partial<ParsedTodoMark>): Mark {
  if (Object.keys(changes).length === 0) return mark

  let existing: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(mark.content || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = { ...parsed }
  } catch {
    // Legacy records can have only a display title.
  }

  return {
    ...mark,
    desc: changes.title === undefined ? mark.desc : changes.title.trim(),
    content: JSON.stringify({ ...existing, ...changes }),
  }
}

export function replaceRecordBodyMarkdown(mark: Mark, content: string): Mark {
  if (mark.type === 'todo') return patchTodoMarkContent(mark, { description: content })
  if (mark.type === 'text') return { ...mark, content, desc: content }
  if (mark.type === 'recording' && (!mark.desc || mark.desc === mark.content?.trim().slice(0, 100))) {
    return { ...mark, content, desc: content.trim().slice(0, 100) }
  }
  return { ...mark, content }
}

export function getMarkListItemContent(mark: Mark): MarkListItemContent {
  switch (mark.type) {
  case 'text': {
    const fallback = compactText(mark.desc)
    const content = compactText(mark.content || mark.desc)
    return {
      title: content || fallback,
      preview: '',
    }
  }
  case 'recording': {
    const desc = compactText(mark.desc)
    const { title } = splitTitleAndPreview(mark.content)
    return {
      title: desc || title,
      preview: '',
    }
  }
  case 'scan':
  case 'image': {
    const desc = compactText(mark.desc)
    const content = compactText(mark.content)
    const hasAiDescription = Boolean(desc && desc !== content)
    const displayText = hasAiDescription ? desc : content || desc
    return {
      title: displayText,
      preview: '',
      imageUrl: mark.url,
    }
  }
  case 'link': {
    const title = compactText(mark.desc) || compactText(mark.url)
    return {
      title,
      preview: compactText(mark.content),
      linkUrl: mark.url,
    }
  }
  case 'file': {
    const desc = compactText(mark.desc)
    const content = compactText(mark.content)
    return {
      // A file's description is its stable display name. Its editable content
      // belongs in the preview so edits are immediately reflected in every list view.
      title: desc || compactText(mark.url),
      preview: content || compactText(mark.url),
    }
  }
  case 'todo': {
    const todo = parseTodoMarkContent(mark)
    return {
      title: todo.title,
      preview: todo.description,
      todo,
    }
  }
  default:
    return {
      title: compactText(mark.desc) || compactText(mark.content) || compactText(mark.url),
      preview: compactText(mark.content) || compactText(mark.desc) || compactText(mark.url),
    }
  }
}
