import type { JSONContent, MarkdownRendererHelpers } from '@tiptap/core'
import { ListItem, TaskItem } from '@tiptap/extension-list'
import { preserveEscapedTaskMarker } from './markdown-task-list'

function canFollowItemParagraph(child: JSONContent) {
  return child.type === 'bulletList'
    || child.type === 'taskList'
    || child.type === 'blockquote'
    || (child.type === 'orderedList' && Number(child.attrs?.start ?? 1) === 1)
}

function renderListItem(node: JSONContent, helpers: MarkdownRendererHelpers, marker: string, taskPrefix = '') {
  const children = node.content ?? []
  const prefix = `${marker}${taskPrefix}`
  if (!children.length) return taskPrefix ? prefix : prefix.trimEnd()

  // The list marker sets the continuation indent. A checkbox is item text.
  const indent = ' '.repeat(marker.length)
  return children.map((child, index) => {
    // The separator after a checkbox already distinguishes an empty task from literal text.
    const emptyTaskParagraph = taskPrefix && index === 0 && child.type === 'paragraph' && !child.content?.length
    const markdown = emptyTaskParagraph ? '' : helpers.renderChildren([child])
    const block = markdown.split('\n').map((line, lineIndex) => {
      // Keep literal leading spaces without allowing Markdown to interpret
      // them as extra nesting or an indented code block on the next parse.
      const escapedLine = child.type === 'paragraph'
        ? line.replace(/^ +/, spaces => '&#32;'.repeat(spaces.length))
        : line
      if (index === 0 && lineIndex === 0) {
        // A bullet whose text begins with a checkbox marker is still a bullet.
        const literalMarker = !taskPrefix && marker === '- ' && child.type === 'paragraph'
          && /^\[[ xX]\][ \t]/.test(escapedLine)
        return `${prefix}${literalMarker ? '\\' : ''}${escapedLine}`
      }
      return escapedLine ? `${indent}${escapedLine}` : ''
    }).join('\n')
    if (index === 0) return block

    // Keep interrupting blocks tight after the first paragraph. Other blocks
    // need a blank line to stay distinct in the editor and Markdown export.
    const followsItemParagraph = index === 1 && children[0].type === 'paragraph' && canFollowItemParagraph(child)
    return `${followsItemParagraph ? '\n' : '\n\n'}${block}`
  }).join('')
}

export const MarkdownListItem = ListItem.extend({
  parseMarkdown: (token, helpers) => {
    const firstBlock = token.tokens?.[0]
    if (firstBlock?.tokens) firstBlock.tokens = preserveEscapedTaskMarker(firstBlock.tokens)
    return ListItem.config.parseMarkdown?.(token, helpers) ?? []
  },

  renderMarkdown: (node, helpers, context) => {
    const marker = context.parentType === 'orderedList'
      ? `${Number(context.meta?.parentAttrs?.start ?? 1) + context.index}. `
      : '- '
    return renderListItem(node, helpers, marker)
  },
})

export const MarkdownTaskItem = TaskItem.extend({
  renderMarkdown: (node, helpers) => renderListItem(
    node,
    helpers,
    '- ',
    `[${node.attrs?.checked ? 'x' : ' '}] `
  ),
})
