import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core'
import { ListItem, TaskItem } from '@tiptap/extension-list'

function renderListItem(node: JSONContent, helpers: MarkdownRendererHelpers, prefix: string) {
  const children = node.content ?? []
  if (!children.length) return prefix.trimEnd()

  // Continuation blocks must align with the text after the complete marker.
  // A fixed two-space indent is too short for "1. " and "- [x] ".
  const indent = ' '.repeat(prefix.length)
  // Separate sibling blocks, including paragraphs after nested lists or
  // quotes, so parsing a local Agent edit cannot merge unrelated paragraphs.
  return children.map((child, index) => {
    const markdown = helpers.renderChildren([child])
    return markdown.split('\n').map((line, lineIndex) => {
      // Keep literal leading spaces without allowing Markdown to interpret
      // them as extra nesting or an indented code block on the next parse.
      const escapedLine = child.type === 'paragraph'
        ? line.replace(/^ +/, spaces => '&#32;'.repeat(spaces.length))
        : line
      if (index === 0 && lineIndex === 0) return `${prefix}${escapedLine}`
      return escapedLine ? `${indent}${escapedLine}` : ''
    }).join('\n')
  }).join('\n\n')
}

export const MarkdownListItem = ListItem.extend({
  renderMarkdown: (node, helpers, context) => {
    const prefix = context.parentType === 'orderedList'
      ? `${Number(context.meta?.parentAttrs?.start ?? 1) + context.index}. `
      : '- '
    return renderListItem(node, helpers, prefix)
  },
})

export const MarkdownTaskItem = TaskItem.extend({
  renderMarkdown: (node, helpers) => renderListItem(
    node,
    helpers,
    `- [${node.attrs?.checked ? 'x' : ' '}] `
  ),
})
