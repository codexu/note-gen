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
    const content = compactText(mark.content)
    return {
      title: content || compactText(mark.desc),
      preview: content || compactText(mark.desc),
    }
  }
  case 'recording': {
    const title = compactText(mark.desc) || compactText(mark.content)
    return {
      title,
      preview: compactText(mark.content) || title,
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
    const title = compactText(mark.desc) || compactText(mark.content) || compactText(mark.url)
    return {
      title,
      preview: compactText(mark.url) || title,
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
