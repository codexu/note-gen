import { getExtensionField, type AnyExtension, type MarkdownTokenizer } from '@tiptap/core'
import { ColorHighlight, TextColor } from './color-marks'
import { MarkdownOrderedList } from './markdown-ordered-list'
import { MarkdownTaskList } from './markdown-task-list'
import Underline from '@tiptap/extension-underline'
import { wikiMetadataTokenizer } from './wiki-metadata-tokenizer'
import { Lexer, Tokenizer, type Marked, type MarkedOptions, type Token, type TokenizerExtension } from 'marked'
import { createCjkMarkdownLexer } from '@/lib/markdown/cjk-emphasis'

export const inlineMathTokenizer: MarkdownTokenizer = {
  name: 'inline_math',
  level: 'inline',
  start: src => {
    const dollarIndex = src.indexOf('$')
    const bracketIndex = src.indexOf('\\(')
    if (dollarIndex === -1) return bracketIndex
    if (bracketIndex === -1) return dollarIndex
    return Math.min(dollarIndex, bracketIndex)
  },
  tokenize: src => {
    const match = /^(?:\$([^\$\n]+?)\$|\\\(([^\n]+?)\\\))/.exec(src)
    if (!match) return undefined
    return {
      type: 'inline_math',
      raw: match[0],
      content: match[1] ?? match[2] ?? '',
      // Formula source is opaque to Markdown, including LaTeX's own brackets.
      tokens: [],
    }
  },
}

export const blockMathTokenizer: MarkdownTokenizer = {
  name: 'block_math',
  level: 'block',
  start: src => {
    const dollarIndex = src.indexOf('$$')
    const bracketIndex = src.indexOf('\\[')
    if (dollarIndex === -1) return bracketIndex
    if (bracketIndex === -1) return dollarIndex
    return Math.min(dollarIndex, bracketIndex)
  },
  tokenize: src => {
    const match = /^(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/.exec(src)
    if (!match) return undefined
    return {
      type: 'block_math',
      raw: match[0],
      content: (match[1] ?? match[2] ?? '').trim(),
      tokens: [],
    }
  },
}

const mermaidDiagramAliases = [
  ['flowchart', ['flowchart', 'flowchart-v2', 'graph', 'td', 'graph TD', 'graph BT', 'graph LR', 'graph RL']],
  ['sequence', ['sequence', 'sequenceDiagram']],
  ['classDiagram', ['class', 'classDiagram']],
  ['stateDiagram', ['state', 'stateDiagram', 'stateDiagram-v2']],
  ['er', ['er', 'erDiagram']],
  ['gantt', ['gantt']],
  ['pie', ['pie']],
  ['journey', ['journey', 'gitGraph']],
] as const

export function detectMermaidDiagramType(code: string): string {
  const trimmed = code.trimStart()
  const newlineIndex = trimmed.indexOf('\n')
  const firstLine = (newlineIndex === -1 ? trimmed : trimmed.slice(0, newlineIndex))
    .trimEnd()
    .toLowerCase()
  for (const [type, aliases] of mermaidDiagramAliases) {
    if (aliases.some(alias => firstLine.startsWith(alias) || firstLine === alias)) {
      return type
    }
  }
  return 'flowchart'
}

export const mermaidTokenizer: MarkdownTokenizer = {
  name: 'mermaid',
  level: 'block',
  start: src => {
    const match = src.match(/^```mermaid\r?\n/)
    return match ? (match.index ?? -1) : -1
  },
  tokenize: src => {
    const match = /^```mermaid\r?\n([\s\S]*?)\r?\n```/.exec(src)
    if (!match) return undefined
    const code = match[1]
    return {
      type: 'mermaid',
      raw: match[0],
      content: code,
      attrs: { type: detectMermaidDiagramType(code) },
      tokens: [],
    }
  },
}

function requireTokenizer(extension: AnyExtension): MarkdownTokenizer {
  const tokenizer = getExtensionField<MarkdownTokenizer | undefined>(extension, 'markdownTokenizer')
  if (!tokenizer) throw new Error(`Markdown tokenizer is unavailable: ${extension.name}`)
  return tokenizer
}

// MarkdownManager registers flatten(baseExtensions) in declaration order, rather
// than the priority-sorted schema order. Marked tries later registrations first.
const markdownTokenizers: readonly MarkdownTokenizer[] = [
  requireTokenizer(MarkdownOrderedList),
  requireTokenizer(MarkdownTaskList),
  requireTokenizer(ColorHighlight),
  requireTokenizer(TextColor),
  requireTokenizer(Underline),
  inlineMathTokenizer,
  blockMathTokenizer,
  mermaidTokenizer,
  wikiMetadataTokenizer,
]

export const MARKDOWN_TOKENIZER_NAMES = markdownTokenizers.map(tokenizer => tokenizer.name)

const BARE_TASK_MARKER_AT_END = /(?:^|\n)[ \t]*[-+*][ \t]+\[[ xX]\]$/
const TASK_ITEM_PREFIX = /^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]+/
const PADDED_NESTED_TASK_AT_END = /\n[ \t]+[-+*][ \t]+\[[ xX]\][ \t]+(?:\n[ \t]*)*$/

// In a Marked tokenizer override, false delegates to the existing rule and
// undefined reports no match. Leave token creation and extension precedence to Marked.
function blockMarkerCandidate(source: string): false | undefined {
  if (/^[\s<>*_-]/.test(source)) return false
}

function continuationLineCandidate(source: string): false | undefined {
  const newline = source.indexOf('\n')
  if (newline >= 0 && newline + 1 < source.length && source[newline + 1] !== '\n') return false
}

export function createIsolatedMarkdownLexer(): Marked {
  const isolated = createCjkMarkdownLexer()
  isolated.use({
    tokenizer: {
      // These three blocks need a marker before prose. Tables and Setext
      // headings need a following nonempty line. Avoid running their full
      // regexes over the remaining document when that prerequisite is absent.
      blockquote: blockMarkerCandidate,
      hr: blockMarkerCandidate,
      html: blockMarkerCandidate,
      table: continuationLineCandidate,
      lheading: continuationLineCandidate,
      list(source) {
        const list = Tokenizer.prototype.list.call(this, source)
        if (!list) return undefined

        // Marked strips the separator from the last line of a regular list.
        // Restore it before Tiptap classifies an empty task at that boundary.
        const separator = BARE_TASK_MARKER_AT_END.test(list.raw)
          ? /^[ \t]+/.exec(source.slice(list.raw.length))?.[0]
          : undefined
        const lastItem = list.items.at(-1)
        if (lastItem && separator) {
          list.raw += separator
          lastItem.raw += separator
        }

        const hasNestedEmptyTask = !list.ordered && list.items.some(item =>
          TASK_ITEM_PREFIX.test(item.raw) && PADDED_NESTED_TASK_AT_END.test(item.raw)
        )
        const firstTask = hasNestedEmptyTask ? list.items.findIndex(item => TASK_ITEM_PREFIX.test(item.raw)) : -1
        if (firstTask > 0) {
          // Let the task tokenizer consume the task run directly. Tiptap's
          // fallback splitting trims the nested source, losing empty tasks.
          list.items.splice(firstTask)
          list.raw = list.items.map(item => item.raw).join('')
        } else if (lastItem && separator) {
          const nestedList = lastItem.tokens.at(-1)
          if (nestedList?.type === 'list' && BARE_TASK_MARKER_AT_END.test(nestedList.raw)) {
            const previous = lastItem.tokens.at(-2)
            const hasPreviousTaskList = previous?.type === 'taskList'
            const nestedSource = hasPreviousTaskList ? previous.raw + nestedList.raw : nestedList.raw
            const trailingTokens = this.lexer.blockTokens(nestedSource + separator)
            const tokenCount = hasPreviousTaskList ? 2 : 1
            lastItem.tokens.splice(-tokenCount, tokenCount, ...trailingTokens)
          }
        }

        for (const item of list.items) {
          // Tiptap checks raw text when splitting mixed lists. Escape just its
          // view of a bare marker so the following newline is not a separator.
          item.raw = item.raw.replace(/^[ \t]*[-+*][ \t]+\[[ xX]\](?=\n)/, marker => marker.replace('[', '\\['))
        }
        return list
      },
    },
  })
  // Tiptap constructs helper lexers without options. They must inherit this
  // isolated instance's extensions, including for nested lists and inline marks.
  isolated.Lexer = class EditorLexer<ParserOutput = string, RendererOutput = string>
    extends Lexer<ParserOutput, RendererOutput> {
    constructor(options?: MarkedOptions<ParserOutput, RendererOutput>) {
      // Marked exposes a generic Lexer constructor for this string-output instance.
      super(options ?? (isolated.defaults as unknown as MarkedOptions<ParserOutput, RendererOutput>))
    }
  }
  return isolated
}

export function createMarkdownLexer(): Marked {
  const isolated = createIsolatedMarkdownLexer()
  const helper = {
    inlineTokens: (source: string) => helperLexer.inlineTokens(source),
    blockTokens: (source: string) => helperLexer.blockTokens(source),
  }

  for (const { name, start, level = 'inline', tokenize } of markdownTokenizers) {
    const extension: TokenizerExtension = {
      name,
      level,
      start: typeof start === 'function'
        ? start
        : typeof start === 'string'
          ? source => source.indexOf(start)
          : source => {
            const result = tokenize(source, [], helper)
            return result && result.raw ? source.indexOf(result.raw) : -1
          },
      tokenizer: (source, tokens) => {
        const result = tokenize(source, tokens, helper)
        if (!result || !result.type) return undefined
        return {
          ...result,
          type: result.type || name,
          raw: result.raw || '',
          tokens: (result.tokens || []) as Token[],
        }
      },
      childTokens: [],
    }
    isolated.use({ extensions: [extension] })
  }
  const helperLexer = new isolated.Lexer()
  return isolated
}
