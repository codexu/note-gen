'use client'

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'

export const StableCodeBlockLowlight = CodeBlockLowlight.extend({
  addKeyboardShortcuts() {
    const parentShortcuts = this.parent?.() ?? {}

    return {
      ...parentShortcuts,
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const { $from, empty } = selection

        if (!empty || $from.parent.type !== this.type) {
          return false
        }

        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n')
        const action = isAtEnd && endsWithDoubleNewline ? 'exit' : 'newline'

        if (action === 'exit') {
          return editor.chain()
            .command(({ tr }) => {
              tr.delete($from.pos - 2, $from.pos)
              return true
            })
            .exitCode()
            .run()
        }

        return editor.commands.insertContent('\n')
      },
    }
  },
})
