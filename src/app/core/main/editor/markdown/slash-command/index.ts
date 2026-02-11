import { Extension, type Editor, type RawCommands } from '@tiptap/core'
import { Suggestion, SuggestionPluginKey } from '@tiptap/suggestion'
import { suggestionOptions, findSlashMatch, setMenuKeyDownHandler } from './suggestion'

// Re-export for use in SlashCommandPortal
export { setMenuKeyDownHandler }

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    slashCommand: {
      triggerSlashCommand: () => ReturnType
    }
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: SuggestionPluginKey,
        command: ({ editor, range, props }: { editor: Editor; range: any; props: any }) => {
          props.command({ editor, range })
        },
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '/',
        findSuggestionMatch: findSlashMatch,
        ...suggestionOptions,
        pluginKey: SuggestionPluginKey,
      }),
    ]
  },

  addCommands() {
    return {
      triggerSlashCommand:
        () =>
        ({ editor }) => {
          const tr = editor.state.tr
          tr.insertText('/')
          editor.view.dispatch(tr)
          editor.view.focus()
          return true
        },
    } as RawCommands
  },
})

export { suggestionOptions }
