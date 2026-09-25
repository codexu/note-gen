import { Extension, type Editor } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorShortcut, EditorShortcutCommandId } from '@/config/editor-shortcuts'
import {
  findMatchingEditorShortcut,
  shouldBlockEditorDefaultShortcut,
} from '@/lib/editor-shortcut-utils'

interface EditorShortcutsOptions {
  getShortcuts: () => EditorShortcut[]
  runCommand: (id: EditorShortcutCommandId, editor: Editor) => boolean
}

function getListItemTypeAtSelection(editor: Editor) {
  const { $from } = editor.state.selection

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name
    if (nodeName === 'listItem' || nodeName === 'taskItem') {
      return nodeName
    }
  }

  return null
}

export const EditorShortcutsExtension = Extension.create<EditorShortcutsOptions>({
  name: 'editorShortcuts',

  priority: 10000,

  addOptions() {
    return {
      getShortcuts: () => [],
      runCommand: () => false,
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown: (_view, event) => {
            if (
              event.key === 'Tab'
              && !event.altKey
              && !event.ctrlKey
              && !event.metaKey
            ) {
              const listItemType = getListItemTypeAtSelection(this.editor)
              if (listItemType) {
                if (event.shiftKey) {
                  this.editor.commands.liftListItem(listItemType)
                } else {
                  this.editor.commands.sinkListItem(listItemType)
                }
                event.preventDefault()
                event.stopPropagation()
                return true
              }
            }

            const shortcuts = this.options.getShortcuts()
            const matchedShortcut = findMatchingEditorShortcut(event, shortcuts)

            if (matchedShortcut) {
              const handled = this.options.runCommand(matchedShortcut.id, this.editor)
              if (handled) {
                event.preventDefault()
                event.stopPropagation()
                return true
              }
            }

            if (shouldBlockEditorDefaultShortcut(event, shortcuts)) {
              event.preventDefault()
              event.stopPropagation()
              return true
            }

            return false
          },
        },
      }),
    ]
  },
})
