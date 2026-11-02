import { Node } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin } from '@tiptap/pm/state'
import {
  WIKI_METADATA_NODE_NAME,
  WIKI_METADATA_REPLACE_DOCUMENT,
  wikiMetadataTokenizer,
} from './wiki-metadata-tokenizer'

interface MetadataPosition { node: ProseMirrorNode; position: number; raw: string }

function metadataPositions(doc: ProseMirrorNode): MetadataPosition[] {
  const nodes: MetadataPosition[] = []
  doc.forEach((node, position) => {
    if (node.type.name === WIKI_METADATA_NODE_NAME && typeof node.attrs.raw === 'string') {
      nodes.push({ node, position, raw: node.attrs.raw })
    }
  })
  return nodes
}

/** Keep identity and section boundaries in the document while the normal
 * Markdown nodes between them remain fully editable. Source mode still exposes
 * the actual Markdown, including these fields, without an editor-only format.
 */
export const WikiMetadata = Node.create({
  name: WIKI_METADATA_NODE_NAME,
  group: 'block',
  atom: true,
  selectable: false,
  draggable: false,
  isolating: true,

  addAttributes() {
    return { raw: { default: '', rendered: false } }
  },

  parseHTML() {
    return [{
      tag: 'div[data-notegen-wiki-raw]',
      getAttrs: element => {
        const raw = element.getAttribute('data-notegen-wiki-raw') || ''
        const token = wikiMetadataTokenizer.tokenize(raw, [], {
          inlineTokens: () => [], blockTokens: () => [],
        })
        return token && token.raw === raw ? { raw } : false
      },
    }]
  },

  renderHTML({ node }) {
    return ['div', {
      'data-notegen-wiki-raw': node.attrs.raw,
      hidden: '', 'aria-hidden': 'true', contenteditable: 'false', style: 'display: none',
    }]
  },

  renderText() { return '' },

  addNodeView() {
    return () => {
      const dom = document.createElement('div')
      dom.hidden = true
      dom.style.display = 'none'
      dom.contentEditable = 'false'
      dom.setAttribute('aria-hidden', 'true')
      return { dom, ignoreMutation: () => true, stopEvent: () => true }
    }
  },

  markdownTokenName: WIKI_METADATA_NODE_NAME,
  markdownTokenizer: wikiMetadataTokenizer,
  parseMarkdown: token => ({ type: WIKI_METADATA_NODE_NAME, attrs: { raw: token.raw || '' } }),
  renderMarkdown: node => typeof node.attrs?.raw === 'string' ? node.attrs.raw : '',

  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, oldState, newState) => {
        if (!transactions.some(transaction => transaction.docChanged)
          || transactions.some(transaction => transaction.getMeta(WIKI_METADATA_REPLACE_DOCUMENT))
          || oldState.doc.firstChild?.type.name !== WIKI_METADATA_NODE_NAME) return null
        const oldNodes = metadataPositions(oldState.doc)
        const present = new Set(metadataPositions(newState.doc).map(item => item.raw))
        const missing = oldNodes.filter(item => !present.has(item.raw))
        if (!missing.length) return null

        // Backspace next to an invisible atom, or a selection spanning several
        // sections, must edit prose without silently deleting Wiki identity.
        const transaction = newState.tr
        for (const item of missing) {
          const header = /^(?:\uFEFF)?---\r?\n/.test(item.raw)
          const mapped = transactions.reduce((position, change) => change.mapping.map(position, 1), item.position)
          const resolved = newState.doc.resolve(Math.max(0, Math.min(mapped, newState.doc.content.size)))
          const boundary = header ? 0 : resolved.depth > 0 ? resolved.after(1) : resolved.pos
          // Use the same side for both edges so a range deletion cannot reorder
          // start/end markers. Collapsed sections remain structurally readable.
          transaction.insert(transaction.mapping.map(boundary, 1), item.node)
        }
        return transaction
      },
    })]
  },
})
