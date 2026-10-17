import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type UploadAction = { add: { id: string; pos: number } } | { remove: string }
const uploadsKey = new PluginKey<DecorationSet>('pendingEditorUploads')

// Widgets are view state, never document text, so saving, copying and undo cannot
// persist an upload placeholder. ProseMirror maps each anchor as the user edits.
export const PendingEditorUploads = Extension.create({
  name: 'pendingEditorUploads',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: uploadsKey,
      state: {
        init: () => DecorationSet.empty,
        apply(transaction, previous) {
          let decorations = previous.map(transaction.mapping, transaction.doc)
          const action = transaction.getMeta(uploadsKey) as UploadAction | undefined
          if (action && 'remove' in action) {
            decorations = decorations.remove(decorations.find(undefined, undefined, spec => spec.id === action.remove))
          }
          if (action && 'add' in action) {
            const { id, pos } = action.add
            decorations = decorations.add(transaction.doc, [Decoration.widget(pos, () => {
              const element = document.createElement('span')
              element.className = 'text-muted-foreground'
              element.textContent = 'Uploading…'
              element.setAttribute('role', 'status')
              element.contentEditable = 'false'
              return element
            }, { id, key: id, side: 1 })])
          }
          return decorations
        },
      },
      props: { decorations: state => uploadsKey.getState(state) ?? DecorationSet.empty },
    })]
  },
})

export function createUploadPlaceholder(editor: Editor, pos: number) {
  const id = crypto.randomUUID()
  let finished = false
  editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, { add: { id, pos } } satisfies UploadAction).setMeta('addToHistory', false))
  return {
    position: () => finished || editor.isDestroyed ? undefined
      : uploadsKey.getState(editor.state)?.find(undefined, undefined, spec => spec.id === id)[0]?.from,
    remove: () => {
      if (finished) return
      finished = true
      if (editor.isDestroyed) return
      if (!uploadsKey.getState(editor.state)?.find(undefined, undefined, spec => spec.id === id).length) return
      editor.view.dispatch(editor.state.tr.setMeta(uploadsKey, { remove: id } satisfies UploadAction).setMeta('addToHistory', false))
    },
  }
}

// Keep a selection's position across unrelated edits, but never replace text
// that the user edited or deleted while a request was in flight.
export function trackEditorRange(editor: Editor, from: number, to: number, onInvalid: () => void) {
  let document = editor.state.doc
  const original = document.slice(from, to)
  let valid = true
  const update = ({ transaction }: { transaction: Transaction }) => {
    if (!valid || !transaction.docChanged) return
    if (transaction.before !== document) valid = false
    for (const map of transaction.mapping.maps) {
      map.forEach((start, end) => {
        if (start === end ? start > from && start < to : start < to && end > from) valid = false
      })
      from = map.map(from, 1)
      to = map.map(to, -1)
    }
    document = transaction.doc
    if (valid && !document.slice(from, to).eq(original)) valid = false
    if (!valid || from >= to) { valid = false; onInvalid() }
  }
  editor.on('transaction', update)
  return {
    range: () => valid && !editor.isDestroyed && editor.state.doc === document ? { from, to } : null,
    dispose: () => { valid = false; editor.off('transaction', update) },
  }
}
