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

export function parseTodoMarkContent(mark: Mark): ParsedTodoMark {
  try {
    const parsed = JSON.parse(mark.content || '{}')
    return {
      title: compactText(parsed.title) || compactText(mark.desc),
      description: compactText(parsed.description),
      completed: Boolean(parsed.completed),
      priority: parsed.priority || 'medium',
    }
  } catch {
    return {
      ...DEFAULT_TODO,
      title: compactText(mark.desc),
    }
  }
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
