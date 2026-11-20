import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'
import { readWikiTopicCitationHeader } from '@/lib/wiki/file-format'
import type { WikiTopicCitation } from '@/types/wiki'
import { WIKI_METADATA_NODE_NAME } from './wiki-metadata-tokenizer'

type Header = ReturnType<typeof readWikiTopicCitationHeader>
const citationKey = new PluginKey<{ header: Header; decorations: DecorationSet }>('wikiTopicCitations')

function decorateCitations(doc: ProseMirrorNode, header: Header, label: (number: number) => string) {
  if (!header) return DecorationSet.empty
  const decorations: Decoration[] = []
  let inNavigation = false
  doc.forEach((block, offset, index) => {
    if (block.type.name === WIKI_METADATA_NODE_NAME) {
      if (block.attrs.raw === header.linksStart) inNavigation = true
      if (block.attrs.raw === header.linksEnd) inNavigation = false
      return
    }
    if (inNavigation || block.type.spec.code || (index === 1 && block.type.name === 'heading' && block.attrs.level === 1)) return
    block.descendants((node, position) => {
      if (node.type.spec.code || (node.isAtom && !node.isText)) return false
      if (!node.text || node.marks.some(mark => mark.type.spec.code || mark.type.name === 'link')) return
      for (const match of node.text.matchAll(/\[(\d+)\]/g)) {
        const number = Number(match[1])
        const source = header.sourceRefs[number - 1]
        if (!source) continue
        const start = offset + 1 + position + match.index
        const title = [label(number), source.title].filter(Boolean).join(' · ')
        decorations.push(Decoration.inline(start, start + match[0].length, {
          'data-wiki-citation': String(number), role: 'button', tabindex: '0',
          'aria-haspopup': 'dialog', 'aria-label': title, title,
          class: 'cursor-pointer text-primary underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring',
        }))
      }
    })
  })
  return DecorationSet.create(doc, decorations)
}

/** Decorations and event handlers are confined to the view. The Markdown remains plain [n]. */
export const WikiCitations = Extension.create<{
  label: (number: number) => string
  open: (citation: WikiTopicCitation, trigger: HTMLElement) => void
}>({
  name: 'wikiTopicCitations',
  addProseMirrorPlugins() {
    const { label, open } = this.options
    let previousFrontmatter: string | undefined
    let header: Header = null
    const build = (doc: ProseMirrorNode) => {
      const first = doc.firstChild
      const raw = first?.type.name === WIKI_METADATA_NODE_NAME ? first.attrs.raw : undefined
      if (raw !== previousFrontmatter) {
        previousFrontmatter = raw
        header = typeof raw === 'string' ? readWikiTopicCitationHeader(raw) : null
      }
      return { header, decorations: decorateCitations(doc, header, label) }
    }
    const activate = (view: EditorView, event: Event) => {
      const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-wiki-citation]') : null
      if (!trigger || !view.dom.contains(trigger)) return false
      const current = citationKey.getState(view.state)?.header
      const number = Number(trigger.dataset.wikiCitation)
      const source = current?.sourceRefs[number - 1]
      if (!current || !source) return false
      event.preventDefault()
      open({ pageId: current.pageId, number, source }, trigger)
      return true
    }
    return [new Plugin({
      key: citationKey,
      state: {
        init: (_, state) => build(state.doc),
        apply: (transaction, previous) => transaction.docChanged ? build(transaction.doc) : previous,
      },
      props: {
        decorations: state => citationKey.getState(state)?.decorations,
        handleDOMEvents: {
          click: (view, event) => event.button === 0 && !event.shiftKey
            && view.dom.ownerDocument.getSelection()?.isCollapsed !== false && activate(view, event),
          keydown: (view, event) => (event.key === 'Enter' || event.key === ' ') && activate(view, event),
        },
      },
    })]
  },
})
