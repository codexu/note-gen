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
  return value?.replace(/\s+/g, ' ').trim() || ''
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
    const { title, preview } = splitTitleAndPreview(mark.content || mark.desc)
    return {
      title: title || fallback,
      preview: preview || title || fallback,
    }
  }
  case 'recording': {
    const desc = compactText(mark.desc)
    const { title, preview } = splitTitleAndPreview(mark.content)
    return {
      title: desc || title,
      preview: preview || title || desc,
    }
  }
  case 'scan':
  case 'image': {
    const title = compactText(mark.desc) || compactText(mark.content)
    return {
      title,
      preview: compactText(mark.content) || title,
      imageUrl: mark.url,
    }
  }
  case 'link': {
    const title = compactText(mark.desc) || compactText(mark.url)
    return {
      title,
      preview: compactText(mark.url),
      linkUrl: mark.url,
    }
  }
  case 'file': {
    const desc = compactText(mark.desc)
    const { title, preview } = splitTitleAndPreview(mark.content)
    return {
      title: desc || title || compactText(mark.url),
      preview: preview || compactText(mark.url) || desc || title,
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
