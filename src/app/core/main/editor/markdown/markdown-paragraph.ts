import { mergeAttributes, Node } from '@tiptap/core'

export interface MarkdownParagraphOptions {
  HTMLAttributes: Record<string, any>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    markdownParagraph: {
      setParagraph: () => ReturnType
    }
  }
}

export const EMPTY_PARAGRAPH_MARKDOWN = '&nbsp;'
const NBSP_CHAR = '\u00A0'
const TABLE_MARKDOWN_LINE = /^\|(?:[^|\n]*\|)+\s*$/

export function normalizeMarkdownPlaceholders(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      if (line.trim() === EMPTY_PARAGRAPH_MARKDOWN) {
        return line
      }

      if (TABLE_MARKDOWN_LINE.test(line)) {
        return line.replace(/&nbsp;/g, ' ')
      }

      return line
    })
    .join('\n')
}

export const MarkdownParagraph = Node.create<MarkdownParagraphOptions>({
  name: 'paragraph',

  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block',

  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  parseMarkdown: (token, helpers) => {
    const tokens = token.tokens || []
    const content = helpers.parseInline(tokens)

    if (
      content.length === 1 &&
      content[0].type === 'text' &&
      (content[0].text === EMPTY_PARAGRAPH_MARKDOWN || content[0].text === NBSP_CHAR)
    ) {
      return helpers.createNode('paragraph', undefined, [])
    }

    return helpers.createNode('paragraph', undefined, content)
  },

  renderMarkdown: (node, h) => {
    if (!node) {
      return ''
    }

    const content = Array.isArray(node.content) ? node.content : []

    if (content.length === 0) {
      return EMPTY_PARAGRAPH_MARKDOWN
    }

    return h.renderChildren(content)
  },

  addCommands() {
    return {
      setParagraph:
        () =>
        ({ commands }) => {
          return commands.setNode(this.name)
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
    }
  },
})
