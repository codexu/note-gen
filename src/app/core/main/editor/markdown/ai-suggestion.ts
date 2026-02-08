import { Mark, mergeAttributes } from '@tiptap/core'

export interface AISuggestionOptions {
  HTMLAttributes: Record<string, string>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiSuggestion: {
      setAISuggestion: (originalText: string) => ReturnType
      acceptAISuggestion: () => ReturnType
      rejectAISuggestion: () => ReturnType
    }
  }
}

export const AISuggestion = Mark.create<AISuggestionOptions>({
  name: 'aiSuggestion',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      originalText: {
        default: '',
        parseHTML: element => element.getAttribute('data-original'),
        renderHTML: attributes => {
          return {
            'data-original': attributes.originalText,
          }
        },
      },
      type: {
        default: 'polish',
        parseHTML: element => element.getAttribute('data-type'),
        renderHTML: attributes => {
          return {
            'data-type': attributes.type,
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-ai-suggestion]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-ai-suggestion': '',
        class: 'ai-suggestion',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setAISuggestion:
        (originalText, type = 'polish') =>
        ({ commands }) => {
          return commands.setMark(this.name, { originalText, type })
        },
      acceptAISuggestion:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
      rejectAISuggestion:
        () =>
        () => {
          // Get original text from the mark and restore it
          // This is handled by the UI layer which has access to the editor state
          return true
        },
    }
  },
})
