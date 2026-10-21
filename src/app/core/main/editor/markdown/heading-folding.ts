import { Extension, type Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

interface HeadingRange {
  pos: number
  from: number
  to: number
  level: number
}

interface FoldingState {
  collapsed: Set<number>
  ranges: HeadingRange[]
  decorations: DecorationSet
}

interface FoldingOptions {
  label: (collapsed: boolean) => string
}

const foldingKey = new PluginKey<FoldingState>('headingFolding')

// Only document-level headings define document sections. Headings inside a
// quote, list or table must not hide unrelated siblings outside that container.
function getRanges(doc: ProseMirrorNode): HeadingRange[] {
  const ranges: HeadingRange[] = []
  const stack: HeadingRange[] = []
  doc.forEach((node, pos) => {
    if (node.type.name !== 'heading') return
    const level = Number(node.attrs.level)
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop()!.to = pos
    }
    const range = { pos, from: pos + node.nodeSize, to: doc.content.size, level }
    ranges.push(range)
    stack.push(range)
  })
  return ranges.filter(range => range.from < range.to)
}

function intersectsSelection(state: EditorState, range: HeadingRange): boolean {
  return state.selection.from < range.to && state.selection.to >= range.from
}

function dispatchFold(view: EditorView, collapsed: Set<number>) {
  const state = foldingKey.getState(view.state)
  if (!state) return false
  const tr = view.state.tr
  const containing = state.ranges.find(range => collapsed.has(range.pos) && intersectsSelection(view.state, range))
  if (containing) tr.setSelection(TextSelection.create(tr.doc, containing.pos + 1))
  view.dispatch(tr.setMeta(foldingKey, collapsed).setMeta('addToHistory', false))
  return true
}

export function setHeadingsFolded(editor: Editor, folded: boolean): boolean {
  const state = foldingKey.getState(editor.state)
  if (!state) return false
  return dispatchFold(editor.view, new Set(folded ? state.ranges.map(range => range.pos) : []))
}

function decorate(doc: ProseMirrorNode, ranges: HeadingRange[], collapsed: Set<number>, options: FoldingOptions) {
  const decorations: Decoration[] = []
  // Nested folds keep their state, but only outermost hidden ranges need DOM decorations.
  const hidden: HeadingRange[] = []
  for (const range of ranges) {
    if (hidden.length && range.pos < hidden[hidden.length - 1].to) continue
    const folded = collapsed.has(range.pos)
    if (folded) hidden.push(range)
    // Recreate the inline positioning anchor when its heading changes. Reusing
    // the same widget DOM can leave an absolutely positioned child at the old
    // inline fragment in WebKit while typing, especially across a line wrap.
    const headingContent = JSON.stringify(doc.nodeAt(range.pos)?.toJSON())
    decorations.push(Decoration.node(range.pos, range.from, { class: 'heading-foldable' }))
    decorations.push(Decoration.widget(range.from - 1, (view, getPos) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'heading-fold-control'
      wrapper.contentEditable = 'false'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'heading-fold-toggle'
      button.contentEditable = 'false'
      button.setAttribute('aria-expanded', String(!folded))
      button.setAttribute('aria-label', options.label(folded))
      button.title = options.label(folded)
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icon.setAttribute('viewBox', '0 0 24 24')
      icon.setAttribute('fill', 'none')
      icon.setAttribute('stroke', 'currentColor')
      icon.setAttribute('stroke-width', '2.5')
      icon.setAttribute('stroke-linecap', 'round')
      icon.setAttribute('stroke-linejoin', 'round')
      icon.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', folded ? 'm9 6 6 6-6 6' : 'm6 9 6 6 6-6')
      icon.appendChild(path)
      button.appendChild(icon)
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', event => {
        event.preventDefault()
        event.stopPropagation()
        const pos = getPos()
        const current = foldingKey.getState(view.state)
        if (pos === undefined || !current) return
        const heading = current.ranges.find(candidate => candidate.from - 1 === pos)
        if (!heading) return
        const next = new Set(current.collapsed)
        if (next.has(heading.pos)) next.delete(heading.pos)
        else next.add(heading.pos)
        dispatchFold(view, next)
        view.focus()
      })
      wrapper.appendChild(button)
      return wrapper
    }, {
      side: 1,
      key: `heading-fold-${range.pos}-${range.from}-${folded}-${headingContent}`,
      stopEvent: () => true,
    }))
  }
  let hiddenIndex = 0
  doc.forEach((node, pos) => {
    while (hiddenIndex < hidden.length && pos >= hidden[hiddenIndex].to) hiddenIndex++
    const range = hidden[hiddenIndex]
    if (range && pos >= range.from && pos < range.to) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'heading-fold-hidden' }))
    }
  })
  return DecorationSet.create(doc, decorations)
}

export const HeadingFolding = Extension.create<FoldingOptions>({
  name: 'headingFolding',
  addOptions() {
    return { label: collapsed => collapsed ? 'Expand section' : 'Collapse section' }
  },
  addProseMirrorPlugins() {
    const options = this.options
    return [new Plugin<FoldingState>({
      key: foldingKey,
      state: {
        init: (_, state) => {
          const ranges = getRanges(state.doc)
          const collapsed = new Set<number>()
          return { ranges, collapsed, decorations: decorate(state.doc, ranges, collapsed, options) }
        },
        apply: (tr, previous, _oldState, state) => {
          const action = tr.getMeta(foldingKey) as Set<number> | undefined
          if (!tr.docChanged && !tr.selectionSet && !action) return previous
          const ranges = tr.docChanged ? getRanges(tr.doc) : previous.ranges
          let collapsed = new Set(previous.collapsed)
          if (tr.docChanged) {
            collapsed = new Set<number>()
            const positions = new Set(ranges.map(range => range.pos))
            for (const pos of previous.collapsed) {
              const mapped = tr.mapping.mapResult(pos, 1)
              if (!mapped.deleted && positions.has(mapped.pos)) collapsed.add(mapped.pos)
            }
          }
          if (action) collapsed = action
          // Search, outline navigation and cursor movement reveal their target.
          // No transaction is appended: folding remains local presentation state.
          for (const range of ranges) {
            if (collapsed.has(range.pos) && intersectsSelection(state, range)) collapsed.delete(range.pos)
          }
          if (!tr.docChanged && !action && collapsed.size === previous.collapsed.size) return previous
          return { ranges, collapsed, decorations: decorate(tr.doc, ranges, collapsed, options) }
        },
      },
      props: { decorations: state => foldingKey.getState(state)?.decorations },
    })]
  },
})
