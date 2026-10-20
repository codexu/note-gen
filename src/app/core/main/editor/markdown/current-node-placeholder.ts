import Placeholder from '@tiptap/extension-placeholder'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const CurrentNodePlaceholder = Placeholder.extend({
  addProseMirrorPlugins() {
    if (!this.options.showOnlyCurrent) {
      return this.parent?.() ?? []
    }

    // ProseMirror nodes are immutable. Reuse emptiness checks for unchanged
    // subtrees, and stop at the first nonempty child instead of scanning them all.
    const emptiness = new WeakMap<ProseMirrorNode, boolean>()
    const isEmpty = (node: ProseMirrorNode): boolean => {
      const cached = emptiness.get(node)
      if (cached !== undefined) return cached

      let empty = !node.isAtom && !node.isLeaf
      if (node.isText) {
        empty = !node.text
      } else if (empty) {
        for (let index = 0; index < node.childCount; index++) {
          if (!isEmpty(node.child(index))) {
            empty = false
            break
          }
        }
      }
      emptiness.set(node, empty)
      return empty
    }
    const attribute = (this.options.dataAttribute || 'placeholder')
      .replace(/\s+/g, '-')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .replace(/^[0-9-]+/, '')
      .replace(/^-+/, '')
      .toLowerCase()

    return [new Plugin({
      key: new PluginKey('currentNodePlaceholder'),
      props: {
        decorations: ({ doc, selection }) => {
          if (this.options.showOnlyWhenEditable && !this.editor.isEditable) return null

          const decorations: Decoration[] = []
          const addPlaceholder = (node: ProseMirrorNode, pos: number) => {
            if (node.isLeaf || !isEmpty(node)) return
            const classes = [this.options.emptyNodeClass]
            if (isEmpty(doc)) classes.push(this.options.emptyEditorClass)
            decorations.push(Decoration.node(pos, pos + node.nodeSize, {
              class: classes.join(' '),
              [`data-${attribute}`]: typeof this.options.placeholder === 'function'
                ? this.options.placeholder({ editor: this.editor, node, pos, hasAnchor: true })
                : this.options.placeholder,
            }))
          }

          // Only nodes on the anchor's ancestor path can contain it. The
          // default includeChildren:false keeps the existing top-level behavior.
          const { $anchor } = selection
          const maxDepth = this.options.includeChildren ? $anchor.depth : Math.min(1, $anchor.depth)
          for (let depth = 1; depth <= maxDepth; depth++) {
            addPlaceholder($anchor.node(depth), $anchor.before(depth))
          }
          if ($anchor.depth === 0 || this.options.includeChildren) {
            const before = $anchor.nodeBefore
            const after = $anchor.nodeAfter
            if (before) addPlaceholder(before, $anchor.pos - before.nodeSize)
            if (after) addPlaceholder(after, $anchor.pos)
          }
          return DecorationSet.create(doc, decorations)
        },
      },
    })]
  },
})
