import { Extension, type Editor } from '@tiptap/core'
import { ChangeSet } from '@tiptap/pm/changeset'
import { DOMSerializer, Slice, type Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { normalizeLatexForKatex } from '@/lib/latex'
import { agentDebugLog, agentDebugText, isAgentDebugEnabled } from '@/lib/agent/debug-log'
import { agentDiffTokenEncoder, buildAgentMarkdownEdit } from './agent-markdown-edit'

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

function createInsertedContentWidget(
  editor: Editor,
  content: Fragment,
  position: number,
  inline: boolean,
  listContext?: ProseMirrorNode,
  listValue?: number
) {
  let disposed = false

  return Decoration.widget(position, () => {
    // A list-level insertion needs a list item as its DOM root. Inline changes
    // must remain spans so paragraphs, headings and code blocks stay valid.
    const element = document.createElement(inline ? 'span' : listContext ? 'li' : 'div')
    element.className = 'agent-diff-preview-inserted'
    if (inline) element.classList.add('agent-diff-preview-inline')
    if (listContext) element.classList.add('agent-diff-preview-list-item')
    // The extra preview item must not advance the numbering of original items.
    if (listValue !== undefined) element.setAttribute('value', String(listValue))
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
    const previewContent = listContext
      ? serializer.serializeNode(listContext.copy(content), { document })
      : serializer.serializeFragment(content, { document })
    element.append(previewContent)

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
    // The serializer supplies the new marks. Inheriting the adjacent original
    // marks would hide formatting removals (for example bold -> plain text).
    marks: [],
    // Preview content is read-only and must not invoke editor click/keyboard handlers.
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: () => { disposed = true },
  })
}

interface DiffPreviewRange {
  fromA: number
  toA: number
  fromB: number
  toB: number
  inline: boolean
  depth: number
}

function expandToChildren(doc: ProseMirrorNode, from: number, to: number, depth: number) {
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  return {
    from: $from.depth > depth ? $from.before(depth + 1) : from,
    to: $to.depth > depth ? $to.after(depth + 1) : to,
  }
}

function buildPreviewRange(
  before: ProseMirrorNode,
  after: ProseMirrorNode,
  change: Pick<DiffPreviewRange, 'fromA' | 'toA' | 'fromB' | 'toB'>
): DiffPreviewRange {
  const $fromA = before.resolve(change.fromA)
  const $toA = before.resolve(change.toA)
  const $fromB = after.resolve(change.fromB)
  const $toB = after.resolve(change.toB)
  const sharedDepth = Math.min($fromA.sharedDepth(change.toA), $fromB.sharedDepth(change.toB))
  let depth = 0

  // Only descend through matching containers. A change to a container's own
  // attributes or structure is reviewed at its parent, while a text change in
  // a deeply nested list item or table cell stays in that item or cell.
  for (let candidate = 1; candidate <= sharedDepth; candidate += 1) {
    const oldParent = $fromA.node(candidate)
    const newParent = $fromB.node(candidate)
    if (!oldParent.sameMarkup(newParent)) break
    // Widgets cannot be divs directly inside tables or rows. Structural table
    // edits use the containing block; ordinary cell text still descends to it.
    if (!oldParent.isTextblock && !['table', 'row'].includes(oldParent.type.spec.tableRole || '')) {
      depth = candidate
    }
  }

  const inline = $fromA.sameParent($toA)
    && $fromB.sameParent($toB)
    && $fromA.parent.isTextblock
    && $fromB.parent.isTextblock
    && $fromA.depth === $fromB.depth
    && sharedDepth === $fromA.depth
    && $fromA.parent.sameMarkup($fromB.parent)
    && depth === $fromA.depth - 1

  if (inline) return { ...change, inline: true, depth: $fromA.depth }

  const oldRange = expandToChildren(before, change.fromA, change.toA, depth)
  const newRange = expandToChildren(after, change.fromB, change.toB, depth)
  return {
    fromA: oldRange.from,
    toA: oldRange.to,
    fromB: newRange.from,
    toB: newRange.to,
    inline: false,
    depth,
  }
}

function buildDiffDecorations(
  editor: Editor,
  currentDoc: ProseMirrorNode,
  payload: AgentDiffPreviewPayload
) {
  const modifiedJson = editor.markdown?.parse(payload.modifiedContent)
  if (!modifiedJson) return DecorationSet.empty

  let modifiedDoc = payload.from === undefined && payload.to === undefined
    ? buildAgentMarkdownEdit(editor, payload.originalContent, payload.modifiedContent, currentDoc)
    : editor.schema.nodeFromJSON(modifiedJson)
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

  if (isAgentDebugEnabled()) {
    const originalJson = payload.from === undefined && payload.to === undefined
      ? editor.markdown?.parse(payload.originalContent)
      : undefined
    agentDebugLog('editor_diff_preview', {
      from: payload.from,
      to: payload.to,
      originalCharCount: payload.originalContent.length,
      modifiedCharCount: payload.modifiedContent.length,
      originalRoundTripChanged: originalJson
        ? !currentDoc.eq(editor.schema.nodeFromJSON(originalJson))
        : undefined,
    })
    agentDebugText('editor_diff_original_markdown', payload.originalContent)
    agentDebugText('editor_diff_modified_markdown', payload.modifiedContent)
    agentDebugText('editor_diff_current_document', JSON.stringify(currentDoc.toJSON()))
    agentDebugText('editor_diff_modified_document', JSON.stringify(modifiedDoc.toJSON()))
  }

  const transform = new Transform(currentDoc).replaceWith(
    0,
    currentDoc.content.size,
    modifiedDoc.content
  )
  const changeSet = ChangeSet.create(currentDoc, undefined, agentDiffTokenEncoder).addSteps(
    modifiedDoc,
    transform.mapping.maps,
    'agent'
  )
  const ranges: DiffPreviewRange[] = []

  // Keep text edits inline and expand structural edits only to children of the
  // nearest matching container, never unconditionally to a top-level list.
  for (const change of changeSet.changes) {
    let range = buildPreviewRange(currentDoc, modifiedDoc, change)
    let previous = ranges[ranges.length - 1]
    // Expanding a structural change can overlap more than one earlier text
    // change. Merge backwards until every preview range is independent.
    while (previous && (range.fromA < previous.toA || range.fromB < previous.toB)) {
      ranges.pop()
      range = buildPreviewRange(currentDoc, modifiedDoc, {
        fromA: Math.min(previous.fromA, range.fromA),
        toA: Math.max(previous.toA, range.toA),
        fromB: Math.min(previous.fromB, range.fromB),
        toB: Math.max(previous.toB, range.toB),
      })
      previous = ranges[ranges.length - 1]
    }
    ranges.push(range)
  }

  const decorations: Decoration[] = []
  for (const range of ranges) {
    const removedAttributes = {
      class: 'agent-diff-preview-removed',
      'data-agent-diff-type': 'removed',
    }
    if (range.toA > range.fromA) {
      if (range.inline) {
        decorations.push(Decoration.inline(range.fromA, range.toA, removedAttributes))
      } else {
        currentDoc.nodesBetween(range.fromA, range.toA, (node, position) => {
          // nodesBetween visits enclosing ancestors too. Never mark those as
          // removed when only a descendant falls inside the changed range.
          if (position < range.fromA || position + node.nodeSize > range.toA) return true
          decorations.push(Decoration.node(position, position + node.nodeSize, removedAttributes))
          return false
        })
      }
    }

    if (range.toB > range.fromB) {
      const newParent = modifiedDoc.resolve(range.fromB).node(range.depth)
      const isList = ['orderedList', 'bulletList', 'taskList'].includes(newParent.type.name)
      const listContext = !range.inline && isList
        ? newParent.type.create({
          ...newParent.attrs,
          ...(newParent.type.name === 'orderedList' ? {
            start: Number(newParent.attrs.start || 1) + modifiedDoc.resolve(range.fromB).index(range.depth),
          } : {}),
        })
        : undefined
      const $position = currentDoc.resolve(range.toA)
      const oldParent = $position.node(range.depth)
      const listValue = listContext && oldParent.type.name === 'orderedList'
        ? Number(oldParent.attrs.start || 1) + $position.index(range.depth) - 1
        : undefined
      decorations.push(createInsertedContentWidget(
        editor,
        modifiedDoc.slice(range.fromB, range.toB).content,
        range.toA,
        range.inline,
        listContext,
        listValue
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
    active: decorations.find().length > 0,
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
