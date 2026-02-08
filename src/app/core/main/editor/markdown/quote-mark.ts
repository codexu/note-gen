import { Mark, mergeAttributes } from '@tiptap/core'

export interface QuoteOptions {
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    quote: {
      setQuote: () => ReturnType
      unsetQuote: () => ReturnType
    }
  }
}

export const QuoteMark = Mark.create<QuoteOptions>({
  name: 'quote',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      'data-quote': {
        default: 'true',
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-quote]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
      'data-quote': 'true',
      class: 'tiptap-quote-mark',
      style: 'border: 2px solid currentColor !important; border-radius: 4px !important;'
    }), 0]
  },

  addCommands() {
    return {
      setQuote:
        () =>
        ({ commands }) => {
          return commands.setMark(this.name)
        },
      unsetQuote:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },
})
