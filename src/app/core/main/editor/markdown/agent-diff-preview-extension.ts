import { Extension, type Editor } from '@tiptap/core'
import { DOMSerializer, type Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { normalizeLatexForKatex } from '@/lib/latex'
import { agentDebugLog, agentDebugText, isAgentDebugEnabled } from '@/lib/agent/debug-log'
import { documentChanges, buildAgentMarkdownEdit, buildAgentRangeEdit, buildPreviewRange, assertAgentChangeLocal, type DiffPreviewRange } from './agent-markdown-edit'
import { shouldTransformImageSrcToWorkspaceAsset } from './image-src'

export interface AgentDiffPreviewLabels {
  inserted: string
  removed: string
  attributes: string
  before: string
  after: string
  imageLoading: string
  imageError: string
  linkUrl: string
  imageSource: string
  imageDescription: string
  title: string
}

interface AgentDiffPreviewOptions {
  resolveImageSource?: (source: string) => Promise<string>
  labels: AgentDiffPreviewLabels
}

interface AttributeChange {
  label: string
  before: string
  after: string
}

function collectReviewAttributes(content: Fragment) {
  const attributes: { type: string; values: Record<string, string> }[] = []
  content.descendants(node => {
    if (node.type.name === 'image') {
      attributes.push({ type: 'image', values: {
        imageSource: String(node.attrs.relativeSrc || node.attrs.src || ''),
        imageDescription: String(node.attrs.alt || ''),
        title: String(node.attrs.title || ''),
      } })
    }
    for (const mark of node.marks) {
      if (mark.type.name !== 'link') continue
      const entry = { type: 'link', values: {
        linkUrl: String(mark.attrs.href || ''),
        title: String(mark.attrs.title || ''),
      } }
      if (JSON.stringify(attributes[attributes.length - 1]) !== JSON.stringify(entry)) attributes.push(entry)
    }
  })
  return attributes
}

function describeAttributeChanges(before: Fragment, after: Fragment, labels: AgentDiffPreviewLabels): AttributeChange[] {
  const oldAttributes = collectReviewAttributes(before)
  const newAttributes = collectReviewAttributes(after)
  const changes: AttributeChange[] = []
  for (let index = 0; index < Math.max(oldAttributes.length, newAttributes.length); index += 1) {
    const oldEntry = oldAttributes[index]
    const newEntry = newAttributes[index]
    const names = new Set([...Object.keys(oldEntry?.values ?? {}), ...Object.keys(newEntry?.values ?? {})])
    for (const name of names) {
      const previous = oldEntry?.values[name] ?? ''
      const next = newEntry?.values[name] ?? ''
      if (previous !== next) changes.push({ label: labels[name as keyof AgentDiffPreviewLabels], before: previous, after: next })
    }
  }
  return changes
}

function createAttributeSummary(changes: AttributeChange[], labels: AgentDiffPreviewLabels) {
  const summary = document.createElement('span')
  summary.className = 'agent-diff-attributes'
  summary.setAttribute('role', 'note')
  summary.setAttribute('aria-label', labels.attributes)
  for (const change of changes) {
    const line = document.createElement('span')
    line.className = 'agent-diff-attribute'
    const label = document.createElement('span')
    label.textContent = `${change.label}: `
    const before = document.createElement('del')
    before.setAttribute('aria-label', `${labels.before}: ${change.before || '∅'}`)
    before.textContent = change.before || '∅'
    const arrow = document.createElement('span')
    arrow.textContent = ' → '
    arrow.setAttribute('aria-hidden', 'true')
    const after = document.createElement('ins')
    after.setAttribute('aria-label', `${labels.after}: ${change.after || '∅'}`)
    after.textContent = change.after || '∅'
    line.append(label, before, arrow, after)
    summary.append(line)
  }
  return summary
}

interface AgentDiffPreviewPayload {
  originalContent: string
  modifiedContent: string
  from?: number
  to?: number
  parseInlineMarkdown?: boolean
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
  groupId: string,
  options: AgentDiffPreviewOptions,
  listContext?: ProseMirrorNode,
  listValue?: number,
  tableRow = false,
  attributeChanges: AttributeChange[] = [],
  side = 1
) {
  let disposed = false

  return Decoration.widget(position, () => {
    // Each preview root follows its parent's content model: phrasing content
    // inside text blocks, list items inside lists, and real rows inside tables.
    const mathElements: { element: HTMLElement; latex: string; displayMode: boolean }[] = []
    const diagrams: { preview: HTMLElement; source: HTMLDetailsElement; code: string }[] = []
    const images: { image: HTMLImageElement; source: string; status: HTMLElement }[] = []
    const serializeImage = (node: ProseMirrorNode) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'agent-diff-image'
      const image = document.createElement('img')
      const source = String(node.attrs.relativeSrc || node.attrs.src || '')
      image.alt = String(node.attrs.alt || '')
      image.title = String(node.attrs.title || '')
      image.loading = 'lazy'
      image.decoding = 'async'
      for (const dimension of ['width', 'height'] as const) {
        const value = Number(node.attrs[dimension])
        if (Number.isFinite(value) && value > 0) {
          image.setAttribute(dimension, String(value))
          image.style[dimension] = `${value}px`
        }
      }
      const status = document.createElement('span')
      status.className = 'agent-diff-image-status'
      status.setAttribute('role', 'status')
      status.textContent = options.labels.imageLoading
      wrapper.setAttribute('aria-busy', 'true')
      image.addEventListener('load', () => {
        status.hidden = true
        wrapper.removeAttribute('aria-busy')
      })
      image.addEventListener('error', () => {
        wrapper.removeAttribute('aria-busy')
        status.hidden = false
        status.textContent = `${options.labels.imageError}: ${source}`
      })
      wrapper.append(image, status)
      images.push({ image, source, status })
      return wrapper
    }
    const serializeMermaid = (node: ProseMirrorNode) => {
      const wrapper = document.createElement('div')
      wrapper.className = 'agent-diff-mermaid'
      const preview = document.createElement('div')
      preview.className = 'agent-diff-mermaid-preview'
      const source = document.createElement('details')
      source.open = true
      const summary = document.createElement('summary')
      summary.textContent = 'Mermaid'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      const content = String(node.attrs.code || '')
      code.textContent = content
      pre.append(code)
      source.append(summary, pre)
      wrapper.append(preview, source)
      diagrams.push({ preview, source, code: content })
      return wrapper
    }
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
      mermaidDiagram: serializeMermaid,
      image: serializeImage,
    }, DOMSerializer.marksFromSchema(editor.schema))
    const rowNode = tableRow ? content.firstChild : null
    const element = rowNode
      ? serializer.serializeNode(rowNode, { document }) as HTMLElement
      : document.createElement(inline ? 'ins' : listContext ? 'li' : 'div')
    element.classList.add('agent-diff-preview-inserted')
    element.setAttribute('aria-description', options.labels.inserted)
    if (inline) element.classList.add('agent-diff-preview-inline')
    if (listContext) element.classList.add('agent-diff-preview-list-item')
    if (tableRow) element.classList.add('agent-diff-preview-table-row')
    if (!inline && !listContext && !tableRow) element.setAttribute('role', 'insertion')
    if (listValue !== undefined) element.setAttribute('value', String(listValue))
    element.dataset.agentDiffType = 'inserted'
    element.dataset.agentDiffGroup = groupId
    element.contentEditable = 'false'
    element.addEventListener('click', event => {
      if (event.target instanceof Element && event.target.closest('a')) event.preventDefault()
    })
    if (!rowNode) {
      const previewContent = listContext
        ? serializer.serializeNode(listContext.copy(content), { document })
        : serializer.serializeFragment(content, { document })
      element.append(previewContent)
    }
    if (attributeChanges.length > 0) {
      const host = tableRow ? element.querySelector('td, th') : element
      host?.append(createAttributeSummary(attributeChanges, options.labels))
    }

    for (const image of images) {
      void (async () => {
        try {
          const source = shouldTransformImageSrcToWorkspaceAsset(image.source)
            ? await options.resolveImageSource?.(image.source)
            : image.source
          if (disposed) return
          if (!source) throw new Error(options.labels.imageError)
          image.image.src = source
        } catch {
          if (disposed) return
          image.image.parentElement?.removeAttribute('aria-busy')
          image.status.textContent = `${options.labels.imageError}: ${image.source}`
        }
      })()
    }

    // Outside markers extend into the list's padding. Reserve enough room for
    // every digit so the preview's horizontal scroll container cannot clip them.
    element.querySelectorAll('ol').forEach(list => {
      // Nested markers already have the ancestor list's gutter around them.
      // Enlarging every level would change the indentation relative to the source.
      if (list.parentElement?.closest('ol, ul')) return
      let number = Number(list.getAttribute('start') ?? 1)
      let markerDigits = String(number).length
      for (const item of Array.from(list.children)) {
        if (item.tagName !== 'LI') continue
        const explicitValue = item.getAttribute('value')
        if (explicitValue !== null) number = Number(explicitValue)
        markerDigits = Math.max(markerDigits, String(number).length)
        number += 1
      }
      list.style.paddingLeft = `max(1.5em, calc(${markerDigits}ch + 0.75em))`
    })

    const gutters: string[] = []
    for (const rootList of Array.from(element.children)) {
      if (!(rootList instanceof HTMLElement) || !['OL', 'UL'].includes(rootList.tagName)) continue
      const gutter = rootList.dataset.type === 'taskList' ? '0px' : rootList.style.paddingLeft || '1.5em'
      rootList.style.setProperty('--agent-diff-root-list-gutter', gutter)
      gutters.push(gutter)
    }
    if (gutters.length > 0) {
      // Reserve a marker column outside the original text column, including
      // previews that contain multiple lists or a mix of lists and paragraphs.
      element.classList.add('agent-diff-preview-list-aligned')
      element.style.setProperty('--agent-diff-list-gutter', `max(${gutters.join(', ')})`)
    }

    if (diagrams.length > 0) {
      void import('./mermaid-extension').then(async ({ renderMermaid }) => {
        for (const diagram of diagrams) {
          if (disposed) return
          try {
            const svg = await renderMermaid(diagram.code, () => !disposed)
            if (disposed || !svg) continue
            diagram.preview.innerHTML = svg
            diagram.source.open = false
          } catch {
            // Keep the full source visible when a diagram cannot render.
          }
        }
      }).catch(() => { /* Source remains available if the renderer cannot load. */ })
    }

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
    side,
    // The serializer supplies the new marks. Inheriting the adjacent original
    // marks would hide formatting removals (for example bold -> plain text).
    marks: [],
    // Preview content is read-only and must not invoke editor click/keyboard handlers.
    stopEvent: () => true,
    ignoreSelection: true,
    destroy: () => { disposed = true },
  })
}

function buildDiffDecorations(
  editor: Editor,
  currentDoc: ProseMirrorNode,
  payload: AgentDiffPreviewPayload,
  options: AgentDiffPreviewOptions
) {
  const modifiedDoc = payload.from !== undefined && payload.to !== undefined
    ? buildAgentRangeEdit(editor, payload.modifiedContent, {
      from: payload.from,
      to: payload.to,
    }, payload.parseInlineMarkdown).doc
    : buildAgentMarkdownEdit(editor, payload.originalContent, payload.modifiedContent, currentDoc)

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

  const ranges: DiffPreviewRange[] = []

  // Keep text edits inline and expand structural edits only to children of the
  // nearest matching container, never unconditionally to a top-level list.
  for (const change of documentChanges(currentDoc, modifiedDoc)) {
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
    if (payload.from === undefined || payload.to === undefined) {
      assertAgentChangeLocal(currentDoc, modifiedDoc, range)
    }
    ranges.push(range)
  }

  // Group navigation by paragraph without expanding the actual highlighted
  // ranges: unchanged text between two edits must remain unchanged in the diff.
  const paragraphGroups = new Map<string, number>()
  const groupAnchors: DiffPreviewRange[] = []
  const groupIds = ranges.map(range => {
    const paragraph = range.inline
      ? `${currentDoc.resolve(range.fromA).start()}:${modifiedDoc.resolve(range.fromB).start()}`
      : undefined
    const existing = paragraph === undefined ? undefined : paragraphGroups.get(paragraph)
    if (existing !== undefined) return existing
    const id = groupAnchors.length
    groupAnchors.push(range)
    if (paragraph !== undefined) paragraphGroups.set(paragraph, id)
    return id
  })

  const decorations: Decoration[] = []
  for (const [rangeIndex, range] of ranges.entries()) {
    const index = groupIds[rangeIndex]
    const removedAttributes = {
      class: 'agent-diff-preview-removed',
      'data-agent-diff-type': 'removed',
      'data-agent-diff-group': String(index),
      'aria-description': options.labels.removed,
    }
    if (range.toA > range.fromA) {
      if (range.inline) {
        decorations.push(Decoration.inline(range.fromA, range.toA, { ...removedAttributes, nodeName: 'del' }))
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
      const content = modifiedDoc.slice(range.fromB, range.toB).content
      const oldContent = currentDoc.slice(range.fromA, range.toA).content
      if (!range.inline && newParent.type.spec.tableRole === 'table') {
        // Real row roots keep the surrounding tbody valid and do not duplicate
        // unchanged rows or add cells to the original row's column layout.
        content.forEach((row, offset, rowIndex) => {
          const oldRow = oldContent.maybeChild(rowIndex)
          const changes = describeAttributeChanges(oldRow?.content ?? row.content.cut(0, 0), row.content, options.labels)
          decorations.push(createInsertedContentWidget(
            editor, content.cut(offset, offset + row.nodeSize), range.toA,
            false, String(index), options, undefined, undefined, true, changes, rowIndex + 1
          ))
        })
        continue
      }
      const isList = ['orderedList', 'bulletList', 'taskList'].includes(newParent.type.name)
      const listContext = !range.inline && isList
        ? newParent.type.create({
          ...newParent.attrs,
          ...(newParent.type.name === 'orderedList' ? {
            start: Number(newParent.attrs.start ?? 1) + modifiedDoc.resolve(range.fromB).index(range.depth),
          } : {}),
        })
        : undefined
      const $position = currentDoc.resolve(range.toA)
      const oldParent = $position.node(range.depth)
      const listValue = listContext && oldParent.type.name === 'orderedList'
        ? Number(oldParent.attrs.start ?? 1) + $position.index(range.depth) - 1
        : undefined
      decorations.push(createInsertedContentWidget(
        editor,
        content,
        range.toA,
        range.inline,
        String(index),
        options,
        listContext,
        listValue,
        false,
        describeAttributeChanges(oldContent, content, options.labels)
      ))
    }
  }

  return DecorationSet.create(currentDoc, decorations)
}

function applyPreviewMeta(
  editor: Editor,
  transaction: Transaction,
  state: AgentDiffPreviewState,
  newState: EditorState,
  options: AgentDiffPreviewOptions
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

  const decorations = buildDiffDecorations(editor, newState.doc, meta.payload, options)
  return {
    active: decorations.find().length > 0,
    decorations,
  }
}

export const AgentDiffPreview = Extension.create<AgentDiffPreviewOptions>({
  name: 'agentDiffPreview',

  addOptions() {
    return {
      labels: {
        inserted: 'Inserted', removed: 'Removed', attributes: 'Attribute changes',
        before: 'Before', after: 'After', imageLoading: 'Loading image…',
        imageError: 'Image unavailable', linkUrl: 'Link address', imageSource: 'Image source',
        imageDescription: 'Image description', title: 'Title',
      },
    }
  },

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
            applyPreviewMeta(editor, transaction, value, newState, this.options)
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
