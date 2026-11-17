// Fork (F1): keep YAML frontmatter byte-for-byte through the visual editor.
//
// Tiptap's markdown parser cannot tell frontmatter from a thematic break, so the
// leading `---` block used to come back as `---` + a setext `## heading`.
// Before parsing, encodeFrontmatterForEditor() replaces the block with an opaque
// marker that only this node's tokenizer understands; the node keeps the original
// YAML text and renderMarkdown() writes it back unchanged.
import { mergeAttributes, Node } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { splitFrontmatter } from '@/lib/markdown/frontmatter-split'
import { FrontmatterCardView } from './frontmatter-card-view'

const MARKER_PREFIX = '<!--notegen:frontmatter:'
const MARKER_SUFFIX = '-->'
const MARKER_RE = /^<!--notegen:frontmatter:([^>]*)-->(?:\r?\n)*/

/** Replace a leading frontmatter block with the marker understood by the Frontmatter node. */
export function encodeFrontmatterForEditor(markdown: string): string {
  const { block, body } = splitFrontmatter(markdown)
  if (!block) return markdown
  // 上游 LLM Wiki 的 frontmatter 由 WikiMetadata 節點保管（唯讀、Agent 不可改），不包成屬性卡片。
  if (/^notegen-wiki-origin:/m.test(block)) return markdown
  // 本文前原有的空行跟著 marker 走（marker 的 token raw 會帶著它們），
  // 區塊間距由 BlockRoundtrip 還原；沒有它的編輯器仍是一個空行。
  return `${MARKER_PREFIX}${encodeURIComponent(block)}${MARKER_SUFFIX}\n${body}`
}

export const Frontmatter = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  selectable: false, // 點選後打字會整塊取代 frontmatter（2-3b 驗收誤觸過一次）；改值走卡片、屬性面板或原始碼
  draggable: false,

  addAttributes() {
    return {
      raw: { default: '' },
    }
  },

  // 卡片取代唯讀 <pre>；renderHTML／parseHTML 不動，複製與匯出路徑照舊。
  addNodeView() {
    return ReactNodeViewRenderer(FrontmatterCardView)
  },

  addKeyboardShortcuts() {
    return {
      // 游標在卡片後面的第一個字元前按 Backspace，不要把整塊 frontmatter 刪掉。
      Backspace: ({ editor }) => {
        const { selection, doc } = editor.state
        if (!selection.empty || selection.$from.parentOffset !== 0) return false
        return doc.resolve(selection.$from.before()).nodeBefore?.type.name === this.name
      },
    }
  },

  parseHTML() {
    return [{
      tag: 'pre[data-type="frontmatter"]',
      getAttrs: element => ({ raw: (element as HTMLElement).dataset.raw ?? '' }),
    }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const raw = String(node.attrs.raw ?? '')
    return [
      'pre',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'frontmatter',
        'data-raw': raw,
        class: 'notegen-frontmatter',
        contenteditable: 'false',
      }),
      raw.replace(/(?:\r?\n)+$/, ''),
    ]
  },

  markdownTokenName: 'notegen_frontmatter',

  markdownTokenizer: {
    name: 'notegen_frontmatter',
    level: 'block',
    start: (src: string) => src.indexOf(MARKER_PREFIX),
    tokenize: (src: string) => {
      const match = MARKER_RE.exec(src)
      if (!match) return undefined
      let raw: string
      try {
        raw = decodeURIComponent(match[1])
      } catch {
        return undefined
      }
      return {
        type: 'notegen_frontmatter',
        raw: match[0],
        content: raw,
        tokens: [],
      }
    },
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  parseMarkdown(token, _helpers) {
    return {
      type: 'frontmatter',
      attrs: { raw: token.content ?? '' },
    }
  },

  // The serializer joins top-level blocks with a blank line, so the block is
  // emitted without its trailing line break: the YAML text stays byte-for-byte,
  // and exactly one blank line separates it from the body (Obsidian's default).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  renderMarkdown(node, _helpers) {
    return String(node.attrs?.raw ?? '').replace(/(?:\r?\n)+$/, '')
  },
})

export default Frontmatter
