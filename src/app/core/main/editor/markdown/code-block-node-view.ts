'use client'

import { mergeAttributes, NodeView, type Editor, type NodeViewRenderer, type NodeViewRendererProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { ReactRenderer } from '@tiptap/react'
import { CodeBlockView, type CodeBlockViewProps } from './code-block-view'
import { observeElementNearViewport } from './viewport-activation'

interface FocusedSelectionRevision {
  value: number
  references: number
  onSelectionUpdate(): void
}

const selectionRevisions = new WeakMap<Editor, FocusedSelectionRevision>()

function retainSelectionRevision(editor: Editor) {
  let revision = selectionRevisions.get(editor)
  if (!revision) {
    const created: FocusedSelectionRevision = {
      value: 0,
      references: 0,
      onSelectionUpdate() {
        if (editor.isFocused) created.value += 1
      },
    }
    revision = created
    selectionRevisions.set(editor, revision)
    editor.on('selectionUpdate', revision.onSelectionUpdate)
  }
  revision.references += 1
  return revision
}

function releaseSelectionRevision(editor: Editor, revision: FocusedSelectionRevision) {
  revision.references -= 1
  if (revision.references > 0) return
  editor.off('selectionUpdate', revision.onSelectionUpdate)
  selectionRevisions.delete(editor)
}

/** Keep editable code and highlighting native; mount the React controls only
 * when the block approaches the viewport or receives focus.
 */
class CodeBlockNodeView extends NodeView<null> {
  private readonly wrapper: HTMLDivElement
  private readonly pre: HTMLPreElement
  private readonly code: HTMLElement
  private readonly languageClassPrefix: string | null
  private readonly selectionRevision: FocusedSelectionRevision
  private readonly initialSelectionRevision: number
  private renderer: ReactRenderer<unknown, CodeBlockViewProps> | null = null
  private observerCleanup: (() => void) | null = null
  private activationFrame: number | null = null
  private destroyed = false

  constructor(props: NodeViewRendererProps, languageClassPrefix: string | null) {
    super(null, props)
    this.languageClassPrefix = languageClassPrefix
    this.selectionRevision = retainSelectionRevision(this.editor)
    this.initialSelectionRevision = this.selectionRevision.value
    this.wrapper = document.createElement('div')
    this.pre = document.createElement('pre')
    this.code = document.createElement('code')
    this.code.style.whiteSpace = 'inherit'

    const attributes = mergeAttributes(props.HTMLAttributes, {
      class: `node-${this.node.type.name} code-block-wrapper`,
      'data-node-view-wrapper': '',
      spellcheck: 'false',
    })
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) this.wrapper.setAttribute(name, String(value))
    }

    this.pre.appendChild(this.code)
    this.wrapper.appendChild(this.pre)
    this.updateLanguageClass()
    this.wrapper.addEventListener('focusin', this.activateControls)
    this.wrapper.addEventListener('beforeinput', this.activateSourceControls, true)
    this.wrapper.addEventListener('paste', this.activateSourceControls, true)
    this.wrapper.addEventListener('drop', this.activateSourceControls, true)

    // Node views are constructed before their DOM is attached. Wait until the
    // viewport root can be found, without creating a React view for each block.
    this.activationFrame = window.requestAnimationFrame(() => {
      this.activationFrame = null
      if (this.destroyed || this.renderer) return
      this.observerCleanup = observeElementNearViewport(this.wrapper, this.activateControls)
    })
  }

  get dom() {
    return this.wrapper
  }

  get contentDOM() {
    return this.code
  }

  private updateLanguageClass() {
    const language: unknown = this.node.attrs.language
    this.code.className = this.languageClassPrefix && typeof language === 'string' && language
      ? `${this.languageClassPrefix}${language}`
      : ''
  }

  private setSourceVisible = (visible: boolean) => {
    this.pre.hidden = !visible
  }

  private activateControls = () => {
    this.mountControls(false)
  }

  private activateSourceControls = () => {
    this.mountControls(true)
  }

  private mountControls(showSource: boolean) {
    if (this.destroyed || this.renderer || this.editor.isDestroyed) return
    this.observerCleanup?.()
    this.observerCleanup = null
    this.renderer = new ReactRenderer(CodeBlockView, {
      editor: this.editor,
      className: 'code-block-controls',
      props: {
        editor: this.editor,
        node: this.node,
        getPos: this.getPos,
        updateAttributes: (attributes: Record<string, unknown>) => this.updateAttributes(attributes),
        element: this.wrapper,
        initialShowSource: showSource,
        shouldRevealSource: this.hasSubsequentFocusedSelection,
        onSourceVisibilityChange: this.setSourceVisible,
      } satisfies CodeBlockViewProps,
    })
    this.renderer.element.contentEditable = 'false'
    this.wrapper.insertBefore(this.renderer.element, this.pre)
  }

  private hasSubsequentFocusedSelection = () => {
    if (this.destroyed || this.editor.isDestroyed || !this.editor.isFocused
      || this.selectionRevision.value === this.initialSelectionRevision) return false
    const pos = this.getPos()
    if (typeof pos !== 'number') return false
    const { from, to } = this.editor.state.selection
    // Check this block only. A full-document selection must not eagerly mount
    // every off-screen code block just to record the source-editing intent.
    return from < pos + this.node.nodeSize && to > pos
  }

  update(node: ProseMirrorNode) {
    if (this.destroyed || node.type !== this.node.type) return false
    if (node === this.node) return true

    const changed = !node.sameMarkup(this.node) || !node.content.eq(this.node.content)
    this.node = node
    if (changed) {
      this.updateLanguageClass()
      this.renderer?.updateProps({ node })
    }
    return true
  }

  selectNode() {
    this.wrapper.classList.add('ProseMirror-selectednode')
  }

  deselectNode() {
    this.wrapper.classList.remove('ProseMirror-selectednode')
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    if (this.activationFrame !== null) window.cancelAnimationFrame(this.activationFrame)
    this.observerCleanup?.()
    this.wrapper.removeEventListener('focusin', this.activateControls)
    this.wrapper.removeEventListener('beforeinput', this.activateSourceControls, true)
    this.wrapper.removeEventListener('paste', this.activateSourceControls, true)
    this.wrapper.removeEventListener('drop', this.activateSourceControls, true)
    releaseSelectionRevision(this.editor, this.selectionRevision)
    this.renderer?.destroy()
    this.renderer = null
  }
}

export function createCodeBlockNodeView(languageClassPrefix: string | null): NodeViewRenderer {
  return props => new CodeBlockNodeView(props, languageClassPrefix)
}
