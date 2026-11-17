import { markdown } from '@codemirror/lang-markdown'
import { Lexer, type Token } from 'marked'
import { createCjkMarkdownLexer } from '@/lib/markdown/cjk-emphasis'

interface EmphasisSpan {
  from: number
  to: number
  type: 'Emphasis' | 'StrongEmphasis'
  markerSize: number
  inLink: boolean
}

function collectEmphasis(
  tokens: readonly Token[],
  offset = 0,
  inLink = false,
  spans: EmphasisSpan[] = [],
): EmphasisSpan[] {
  for (const token of tokens) {
    const from = offset
    offset += token.raw.length
    if (!('text' in token) || typeof token.text !== 'string') continue

    let contentOffset: number
    let childInLink = inLink
    if (token.type === 'strong' || token.type === 'em') {
      const markerSize = token.type === 'strong' ? 2 : 1
      if (token.raw.slice(markerSize, -markerSize) !== token.text) continue
      spans.push({
        from,
        to: offset,
        type: token.type === 'strong' ? 'StrongEmphasis' : 'Emphasis',
        markerSize,
        inLink,
      })
      contentOffset = markerSize
    } else if (token.type === 'link' || token.type === 'image') {
      contentOffset = token.type === 'image' ? 2 : 1
      if (!token.raw.startsWith(token.type === 'image' ? '![' : '[')
        || token.raw.slice(contentOffset, contentOffset + token.text.length) !== token.text
        || token.raw[contentOffset + token.text.length] !== ']') continue
      childInLink = true
    } else {
      continue
    }

    // Escaped or normalized labels can change offsets. Only descend when the
    // lexer retained the exact source, so emphasis cannot cross a link label.
    const children = token.tokens ?? []
    if (children.map(child => child.raw).join('') === token.text) {
      collectEmphasis(children, from + contentOffset, childInLink, spans)
    }
  }
  return spans
}

function spanKey(span: EmphasisSpan) {
  return `${span.from}:${span.to}:${span.type}`
}

const emphasisCache = new WeakMap<object, Map<number, EmphasisSpan>>()

const cjkEmphasis: NonNullable<Parameters<typeof markdown>[0]>['extensions'] = {
  parseInline: [{
    name: 'CjkEmphasis',
    before: 'Emphasis',
    parse(context, next, position) {
      if (next !== 42 && next !== 95) return -1

      let spans = emphasisCache.get(context)
      if (!spans) {
        // ASCII-only sections cannot need CJK corrections. Cache that result
        // as well so ordinary Markdown does not pay for two extra parses.
        if (!/\P{ASCII}/u.test(context.text)) {
          emphasisCache.set(context, new Map())
          return -1
        }

        // Source mode uses CommonMark. Keep its native delimiter handling for
        // every range that is already recognized, including nested emphasis.
        const native = collectEmphasis(new Lexer({ gfm: false }).inlineTokens(context.text))
        const nativeRanges = new Set(native.map(spanKey))
        const lexer = createCjkMarkdownLexer()
        const extended = collectEmphasis(new Lexer({ ...lexer.defaults, gfm: false }).inlineTokens(context.text))
        spans = new Map(extended
          .filter(span => !nativeRanges.has(spanKey(span)))
          .map(span => [span.from, span]))
        emphasisCache.set(context, spans)
      }

      const span = spans.get(position - context.offset)
      if (!span || (context.hasOpenLink && !span.inLink)) return -1

      const end = context.offset + span.to
      const innerFrom = position + span.markerSize
      const innerTo = end - span.markerSize
      return context.addElement(context.elt(span.type, position, end, [
        context.elt('EmphasisMark', position, innerFrom),
        ...context.parser.parseInline(context.slice(innerFrom, innerTo), innerFrom),
        context.elt('EmphasisMark', innerTo, end),
      ]))
    },
  }],
}

export function sourceMarkdownLanguage() {
  return markdown({ extensions: cjkEmphasis })
}
