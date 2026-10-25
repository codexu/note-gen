import { getExtensionField, type AnyExtension, type MarkdownTokenizer } from '@tiptap/core'
import { ColorHighlight, TextColor } from './color-marks'
import { OrderedList, TaskList } from '@tiptap/extension-list'
import Underline from '@tiptap/extension-underline'
import { Lexer, Marked, type MarkedOptions, type Token, type TokenizerExtension } from 'marked'

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
  requireTokenizer(OrderedList),
  requireTokenizer(TaskList),
  requireTokenizer(ColorHighlight),
  requireTokenizer(TextColor),
  requireTokenizer(Underline),
  inlineMathTokenizer,
  blockMathTokenizer,
  mermaidTokenizer,
]

export const MARKDOWN_TOKENIZER_NAMES = markdownTokenizers.map(tokenizer => tokenizer.name)

export function createIsolatedMarkdownLexer(): Marked {
  const isolated = new Marked()
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
