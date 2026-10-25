import { Mark, getExtensionField, type MarkdownTokenizer } from '@tiptap/core'
import Highlight from '@tiptap/extension-highlight'

import { normalizeTextColor } from '@/lib/text-colors'
export { TEXT_COLORS, HIGHLIGHT_COLORS, normalizeTextColor } from '@/lib/text-colors'

function colorTokenizer(name: string, tag: 'span' | 'mark'): MarkdownTokenizer {
  return {
    name,
    level: 'inline',
    start: source => source.indexOf(`<${tag} data-notegen-color=`),
    tokenize(source, _, helpers) {
      const opening = new RegExp(`^<${tag} data-notegen-color="(#[0-9a-fA-F]{6})"(?: style="[^"<>]*")?>`).exec(source)
      if (!opening) return undefined
      // Balanced matching keeps nested colors intact. Inline code remains opaque
      // when helpers parse the inner Markdown.
      const tags = new RegExp('`+|<\\/?' + tag + '\\b[^>]*>', 'g')
      tags.lastIndex = opening[0].length
      let depth = 1
      for (let match = tags.exec(source); match; match = tags.exec(source)) {
        if (match[0].startsWith('`')) {
          const closing = new RegExp('(?<!`)' + match[0] + '(?!`)', 'g')
          closing.lastIndex = tags.lastIndex
          const end = closing.exec(source)
          if (end) tags.lastIndex = closing.lastIndex
          continue
        }
        depth += match[0].startsWith('</') ? -1 : 1
        if (depth !== 0) continue
        return {
          type: name,
          raw: source.slice(0, tags.lastIndex),
          color: opening[1].toLowerCase(),
          tokens: helpers.inlineTokens(source.slice(opening[0].length, match.index)),
        }
      }
      return undefined
    },
  }
}

export const TextColor = Mark.create({
  name: 'textColor',
  addAttributes() {
    return { color: {
      default: null,
      parseHTML: element => normalizeTextColor(element.getAttribute('data-notegen-color') || element.style.color),
      renderHTML: attributes => {
        const color = normalizeTextColor(attributes.color)
        return color ? { 'data-notegen-color': color, style: `color: ${color}` } : {}
      },
    } }
  },
  parseHTML() { return [{ tag: 'span', getAttrs: element => normalizeTextColor(element.getAttribute('data-notegen-color') || element.style.color) ? {} : false }] },
  renderHTML({ HTMLAttributes }) { return ['span', HTMLAttributes, 0] },
  markdownTokenizer: colorTokenizer('textColor', 'span'),
  parseMarkdown: (token, helpers) => helpers.applyMark('textColor', helpers.parseInline(token.tokens || []), { color: normalizeTextColor(token.color) }),
  renderMarkdown(node, helpers) {
    const color = normalizeTextColor(node.attrs?.color)
    const content = helpers.renderChildren(node)
    return color ? `<span data-notegen-color="${color}" style="color: ${color}">${content}</span>` : content
  },
})

const defaultHighlightTokenizer = getExtensionField<MarkdownTokenizer>(Highlight, 'markdownTokenizer')
const coloredHighlightTokenizer = colorTokenizer('highlight', 'mark')
export const ColorHighlight = Highlight.extend({
  renderHTML({ mark, HTMLAttributes }) {
    const color = normalizeTextColor(mark.attrs.color)
    return ['mark', color ? {
      ...HTMLAttributes,
      'data-notegen-color': color,
      style: `background-color: ${color}; color: #1f2937`,
    } : HTMLAttributes, 0]
  },
  markdownTokenizer: {
    ...defaultHighlightTokenizer,
    start: source => {
      const positions = [source.indexOf('=='), source.indexOf('<mark data-notegen-color=')].filter(index => index >= 0)
      return positions.length ? Math.min(...positions) : -1
    },
    tokenize: (source, tokens, helpers) => coloredHighlightTokenizer.tokenize(source, tokens, helpers) || defaultHighlightTokenizer.tokenize(source, tokens, helpers),
  },
  parseMarkdown: (token, helpers) => helpers.applyMark('highlight', helpers.parseInline(token.tokens || []), { color: normalizeTextColor(token.color) }),
  renderMarkdown(node, helpers) {
    const color = normalizeTextColor(node.attrs?.color)
    const content = helpers.renderChildren(node)
    return color ? `<mark data-notegen-color="${color}" style="background-color: ${color}; color: #1f2937">${content}</mark>` : `==${content}==`
  },
})
