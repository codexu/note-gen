import type { MarkdownLexerConfiguration, MarkdownToken, MarkdownTokenizer } from '@tiptap/core'
import { OrderedList } from '@tiptap/extension-list'

interface OrderedItem {
  indent: number
  number: number
  content: string
  raw: string
}

function collectItems(lines: string[]): { items: OrderedItem[]; consumed: number } {
  const items: OrderedItem[] = []
  let cursor = 0
  while (cursor < lines.length) {
    const match = /^( *)(\d+)\.(\s+)(.*)$/.exec(lines[cursor])
    if (!match) break
    const [, indentation, number, spacing, firstLine] = match
    const continuationIndent = indentation.length + number.length + 1 + spacing.length
    const itemLines = [lines[cursor]]
    const contentLines = [firstLine]
    cursor += 1
    while (cursor < lines.length) {
      const line = lines[cursor]
      if (/^ *\d+\.\s+/.test(line)) break
      if (!line.trim()) {
        itemLines.push(line)
        contentLines.push('')
      } else if (/^\s/.test(line)) {
        itemLines.push(line)
        contentLines.push(line.slice(Math.min(continuationIndent, line.match(/^ */)?.[0].length ?? 0)))
      } else {
        break
      }
      cursor += 1
    }
    items.push({
      indent: indentation.length,
      number: Number(number),
      content: contentLines.join('\n').trim(),
      raw: itemLines.join('\n'),
    })
  }
  return { items, consumed: cursor }
}

function buildItems(items: OrderedItem[], baseIndent: number, lexer: MarkdownLexerConfiguration): MarkdownToken[] {
  const result: MarkdownToken[] = []
  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (item.indent !== baseIndent) {
      index += 1
      continue
    }
    const contentLines = item.content.split('\n')
    const firstLine = contentLines[0]?.trim() || ''
    const tokens: MarkdownToken[] = []
    if (firstLine) tokens.push({ type: 'paragraph', raw: firstLine, tokens: lexer.inlineTokens(firstLine) })
    const remaining = contentLines.slice(1).join('\n').trim()
    if (remaining) tokens.push(...lexer.blockTokens(remaining))

    let next = index + 1
    while (next < items.length && items[next].indent > baseIndent) next += 1
    const nested = items.slice(index + 1, next)
    if (nested.length) {
      const childIndent = Math.min(...nested.map(child => child.indent))
      tokens.push({
        type: 'list',
        ordered: true,
        start: nested[0].number,
        items: buildItems(nested, childIndent, lexer),
        raw: nested.map(child => child.raw).join('\n'),
      })
    }
    result.push({ type: 'list_item', raw: item.raw, tokens })
    index = next
  }
  return result
}

const orderedListTokenizer: MarkdownTokenizer = {
  name: 'orderedList',
  level: 'block',
  start: source => source.match(/^( *)(\d+)\.\s+/)?.index ?? -1,
  tokenize: (source, _tokens, lexer) => {
    const lines = source.split('\n')
    const { items, consumed } = collectItems(lines)
    if (!items.length) return undefined
    const nestedItems = buildItems(items, 0, lexer)
    if (!nestedItems.length) return undefined
    return {
      type: 'list',
      ordered: true,
      start: items[0].number || 1,
      items: nestedItems,
      raw: lines.slice(0, consumed).join('\n'),
    }
  },
}

export const MarkdownOrderedList = OrderedList.extend({
  markdownTokenizer: orderedListTokenizer,
})
