import { Extension, type Editor } from '@tiptap/core'
import { ChangeSet, type TokenEncoder } from '@tiptap/pm/changeset'
import { DOMSerializer, Slice, type Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { normalizeLatexForKatex } from '@/lib/latex'

interface AgentDiffPreviewPayload {
  originalContent: string
  modifiedContent: string
  from?: number
  to?: number
}

interface AgentDiffPreviewMeta {
  type: 'show' | 'clear'
  payload?: AgentDiffPreviewPayload
}

interface AgentDiffPreviewState {
  active: boolean
  decorations: DecorationSet
}

export const agentDiffPreviewPluginKey = new PluginKey<AgentDiffPreviewState>('agentDiffPreview')

// Include marks and attributes so formula-only and formatting-only edits are visible.
const previewTokenEncoder: TokenEncoder<string> = {
  encodeCharacter: (character, marks) => marks.length > 0
    ? JSON.stringify([character, marks.map(mark => mark.toJSON())])
    : String(character),
  encodeNodeStart: node => JSON.stringify([node.type.name, node.attrs, node.marks.map(mark => mark.toJSON())]),
  encodeNodeEnd: node => `end:${node.type.name}`,
  compareTokens: (left, right) => left === right,
}

function createInsertedContentWidget(editor: Editor, content: Fragment, position: number) {
  let disposed = false

  return Decoration.widget(position, () => {
    const element = document.createElement('div')
    element.className = 'agent-diff-preview-inserted'
    element.dataset.agentDiffType = 'inserted'
    element.contentEditable = 'false'

    const mathElements: { element: HTMLElement; latex: string; displayMode: boolean }[] = []
    const serializeMath = (node: ProseMirrorNode) => {
      const displayMode = node.type.name === 'blockMath'
      const wrapper = document.createElement(displayMode ? 'div' : 'span')
      wrapper.className = displayMode
        ? 'block-math-wrapper my-4 p-4 rounded-lg bg-muted/30'
        : 'inline-math-wrapper inline mx-1 px-1 py-0.5 rounded bg-muted/50'
      const mathElement = document.createElement(displayMode ? 'div' : 'span')
      mathElement.className = 'tiptap-mathematics-render'
      mathElement.dataset.type = displayMode ? 'block-math' : 'inline-math'
      const latex = String(node.attrs.latex || '')
      // Keep the source visible while KaTeX loads, or if loading fails.
      mathElement.textContent = displayMode ? `$$${latex}$$` : `$${latex}$`
      wrapper.append(mathElement)
      mathElements.push({ element: mathElement, latex, displayMode })
      return wrapper
    }
    const serializer = new DOMSerializer({
      ...DOMSerializer.nodesFromSchema(editor.schema),
      inlineMath: serializeMath,
      blockMath: serializeMath,
    }, DOMSerializer.marksFromSchema(editor.schema))
    element.append(serializer.serializeFragment(content, { document }))

    if (mathElements.length > 0) {
      void import('katex').then(({ default: katex }) => {
        if (disposed) return
        for (const math of mathElements) {
          katex.render(normalizeLatexForKatex(math.latex), math.element, {
            displayMode: math.displayMode,
            throwOnError: false,
            trust: false,
          })
        }
      }).catch(() => {
        // The formula source above remains available when rendering is unavailable.
      })
    }

    return element
  }, {
    side: 1,
    // Preview content is read-only and must not invoke editor click/keyboard handlers.
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: () => { disposed = true },
  })
}

interface BlockDiffRange {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

function expandToBlocks(doc: ProseMirrorNode, from: number, to: number) {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return {
    from: $from.depth > 0 ? $from.before(1) : from,
    to: $to.depth > 0 ? $to.after(1) : to,
  }
}

function buildDiffDecorations(
  editor: Editor,
  currentDoc: ProseMirrorNode,
  payload: AgentDiffPreviewPayload
) {
  const modifiedJson = editor.markdown?.parse(payload.modifiedContent)
  if (!modifiedJson) return DecorationSet.empty

  let modifiedDoc = editor.schema.nodeFromJSON(modifiedJson)
  if (payload.from !== undefined && payload.to !== undefined) {
    const from = Math.min(Math.max(0, payload.from), currentDoc.content.size)
    const to = Math.min(Math.max(from, payload.to), currentDoc.content.size)
    const $from = currentDoc.resolve(from)
    const $to = currentDoc.resolve(to)
    // Match the editor's range replacement behavior without dispatching or saving.
    const transaction = editor.state.tr
    if (!payload.modifiedContent) {
      transaction.deleteRange(from, to)
    } else if (!payload.modifiedContent.includes('\n') && $from.sameParent($to) && $from.parent.isTextblock) {
      transaction.insertText(payload.modifiedContent, from, to)
    } else {
      transaction.replaceRange(from, to, new Slice(modifiedDoc.content, 0, 0))
    }
    modifiedDoc = transaction.doc
  }

  const transform = new Transform(currentDoc).replaceWith(
    0,
    currentDoc.content.size,
    modifiedDoc.content
  )
  const changeSet = ChangeSet.create(currentDoc, undefined, previewTokenEncoder).addSteps(
    modifiedDoc,
    transform.mapping.maps,
    'agent'
  )
  const ranges: BlockDiffRange[] = []

  // Render complete blocks, preserving list/table wrappers and keeping block DOM
  // out of paragraph widgets. Merge changes within the same enclosing block.
  for (const change of changeSet.changes) {
    const before = expandToBlocks(currentDoc, change.fromA, change.toA)
    const after = expandToBlocks(modifiedDoc, change.fromB, change.toB)
    const range = { fromA: before.from, toA: before.to, fromB: after.from, toB: after.to }
    const previous = ranges[ranges.length - 1]
    if (previous && (range.fromA < previous.toA || range.fromB < previous.toB)) {
      previous.toA = Math.max(previous.toA, range.toA)
      previous.toB = Math.max(previous.toB, range.toB)
    } else {
      ranges.push(range)
    }
  }

  const decorations: Decoration[] = []
  for (const range of ranges) {
    currentDoc.nodesBetween(range.fromA, range.toA, (node, position) => {
      decorations.push(Decoration.node(position, position + node.nodeSize, {
        class: 'agent-diff-preview-removed',
        'data-agent-diff-type': 'removed',
      }))
      return false
    })

    if (range.toB > range.fromB) {
      decorations.push(createInsertedContentWidget(
        editor,
        modifiedDoc.slice(range.fromB, range.toB).content,
        range.toA
      ))
    }
  }

  return DecorationSet.create(currentDoc, decorations)
}

function applyPreviewMeta(
  editor: Editor,
  transaction: Transaction,
  state: AgentDiffPreviewState,
  newState: EditorState
): AgentDiffPreviewState {
  const meta = transaction.getMeta(agentDiffPreviewPluginKey) as AgentDiffPreviewMeta | undefined
  if (!meta) {
    return transaction.docChanged
      ? { ...state, decorations: state.decorations.map(transaction.mapping, transaction.doc) }
      : state
  }

  if (meta.type === 'clear' || !meta.payload) {
    return {
      active: false,
      decorations: DecorationSet.empty,
    }
  }

  const decorations = buildDiffDecorations(editor, newState.doc, meta.payload)
  return {
    active: decorations !== DecorationSet.empty,
    decorations,
  }
}

export const AgentDiffPreview = Extension.create({
  name: 'agentDiffPreview',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin<AgentDiffPreviewState>({
        key: agentDiffPreviewPluginKey,
        state: {
          init: () => ({
            active: false,
            decorations: DecorationSet.empty,
          }),
          apply: (transaction, value, _oldState, newState) => (
            applyPreviewMeta(editor, transaction, value, newState)
          ),
        },
        filterTransaction: (transaction, state) => {
          const previewState = agentDiffPreviewPluginKey.getState(state)
          return !previewState?.active || !transaction.docChanged || Boolean(
            transaction.getMeta(agentDiffPreviewPluginKey)
          )
        },
        props: {
          decorations: (state) => (
            agentDiffPreviewPluginKey.getState(state)?.decorations ?? null
          ),
        },
      }),
    ]
  },
})
