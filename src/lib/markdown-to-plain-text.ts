import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'

const parser = new MarkdownIt({ html: true, linkify: false, typographer: false })
const HTML_BLOCK_TAG = /^(?:address|article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/i

// Only raw HTML tokens enter this scanner. Escaped tags and code remain text
// tokens, so their punctuation is never interpreted as markup. No DOM or HTML
// renderer is used; quoted > characters in attributes do not end a tag early.
function htmlTokenToText(html: string): string {
  let result = ''
  let cursor = 0
  while (cursor < html.length) {
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4)
      cursor = end < 0 ? html.length : end + 3
      continue
    }
    if (html.startsWith('<![CDATA[', cursor)) {
      const end = html.indexOf(']]>', cursor + 9)
      result += html.slice(cursor + 9, end < 0 ? html.length : end)
      cursor = end < 0 ? html.length : end + 3
      continue
    }
    if (html[cursor] !== '<' || !/[!/?A-Za-z]/.test(html[cursor + 1] ?? '')) {
      result += html[cursor++]
      continue
    }
    let quote: string | null = null
    let end = cursor + 1
    for (; end < html.length; end += 1) {
      const character = html[end]
      if (quote) {
        if (character === quote) quote = null
      } else if (character === '"' || character === "'") {
        quote = character
      } else if (character === '>') {
        break
      }
    }
    if (end === html.length) {
      result += html.slice(cursor)
      break
    }
    const markup = html.slice(cursor, end + 1)
    const tag = markup.match(/^<\/?([A-Za-z][A-Za-z0-9:-]*)/)?.[1]
    if (tag?.toLowerCase() === 'img') {
      const attributes = /\s+([A-Za-z_:][A-Za-z0-9:._-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
      for (const attribute of markup.matchAll(attributes)) {
        if (attribute[1].toLowerCase() === 'alt') {
          result += attribute[2] ?? attribute[3] ?? attribute[4] ?? ''
          break
        }
      }
    }
    if (tag && HTML_BLOCK_TAG.test(tag) && !result.endsWith('\n')) result += '\n'
    cursor = end + 1
  }
  // Decode entities without unescaping literal backslashes inside HTML text.
  return result.replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/gi, (entity) => parser.utils.unescapeAll(entity))
}

function inlineText(tokens: readonly Token[]): string {
  return tokens.map((token) => {
    if (token.type === 'text' || token.type === 'code_inline') return token.content
    if (token.type === 'softbreak' || token.type === 'hardbreak') return '\n'
    if (token.type === 'html_inline') return htmlTokenToText(token.content)
    if (token.children) return inlineText(token.children)
    if (token.type === 'image') return token.content
    return ''
  }).join('')
}

export function markdownToPlainText(markdown: string): string {
  let result = ''
  let pendingCellSeparators = 0
  let generatedTrailingBreak = false
  const append = (text: string) => {
    if (!text) return
    result += '\t'.repeat(pendingCellSeparators)
    pendingCellSeparators = 0
    result += text
    generatedTrailingBreak = false
  }
  const lineBreak = () => {
    pendingCellSeparators = 0
    if (result && !result.endsWith('\n')) {
      result += '\n'
      generatedTrailingBreak = true
    }
  }

  for (const token of parser.parse(markdown, {})) {
    if (token.type === 'inline') {
      append(inlineText(token.children ?? []))
    } else if (token.type === 'fence' || token.type === 'code_block') {
      lineBreak()
      append(token.content)
      lineBreak()
    } else if (token.type === 'html_block') {
      lineBreak()
      const text = htmlTokenToText(token.content)
      append(result ? text : text.replace(/^\n+/, ''))
      lineBreak()
    } else if (token.type === 'td_close' || token.type === 'th_close') {
      pendingCellSeparators += 1
    } else if (token.type === 'hr' || (token.block && token.nesting === -1)) {
      lineBreak()
    }
  }
  // Remove only a separator added by this extractor, not a code block's own
  // final newline or any whitespace contained in literal code.
  return generatedTrailingBreak ? result.slice(0, -1) : result
}
