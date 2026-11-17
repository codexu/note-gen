import MarkdownIt from 'markdown-it'

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false })
type MarkdownToken = ReturnType<typeof parser.parse>[number]

interface CitationBlock {
  start: number
  end: number
  text: string
  substantive: boolean
  kind: 'paragraph' | 'row' | 'verbatim'
  fence?: string
  indentedCode?: boolean
  codeLine?: string
}

function isDisplayMath(content: string): boolean {
  return /^\s*\$\$[\s\S]*\$\$\s*$/.test(content)
    || /^\s*\\\[[\s\S]*\\\]\s*$/.test(content)
}

function citationText(token: MarkdownToken): string {
  if (isDisplayMath(token.content)) return ''
  let linkDepth = 0
  return (token.children ?? []).map(child => {
    if (child.type === 'link_open') { linkDepth++; return ' ' }
    if (child.type === 'link_close') { linkDepth--; return ' ' }
    if (linkDepth) return ''
    return child.type === 'text' ? child.content
      : child.type === 'softbreak' || child.type === 'hardbreak' ? '\n'
        : child.type === 'code_inline' || child.type === 'image' || child.type === 'html_inline' ? ' ' : ''
  }).join('')
}

export { citationText as wikiCitationText }

function references(text: string): number[] {
  return [...text.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]))
}

/** Plain source markers only: code literals and link labels are not citations. */
export function wikiCitationReferences(body: string): number[] {
  return parser.parse(body, {}).flatMap(token => token.type === 'inline' ? references(citationText(token)) : [])
}

function hasProse(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text.replace(/\[\d+\]/g, ''))
}

function citationBlocks(body: string): { blocks: CitationBlock[]; text: string } {
  const tokens = parser.parse(body, {})
  const blocks: CitationBlock[] = []
  const allText: string[] = []
  let tableHeader = false
  let row: CitationBlock | null = null
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token.type === 'thead_open') tableHeader = true
    if (token.type === 'thead_close') tableHeader = false
    if (token.type === 'tr_open' && !tableHeader && token.map) {
      row = { start: token.map[0], end: token.map[1], text: '', substantive: false, kind: 'row' }
    }
    if (token.type === 'inline') {
      const text = citationText(token)
      allText.push(text)
      if (row) {
        row.text += ` ${text}`
        row.substantive ||= hasProse(token.content)
      } else if (tokens[index - 1]?.type === 'paragraph_open' && token.map) {
        const math = isDisplayMath(token.content)
        blocks.push({ start: token.map[0], end: token.map[1], text,
          substantive: hasProse(token.content), kind: math ? 'verbatim' : 'paragraph' })
      }
    }
    if (token.type === 'tr_close' && row) {
      blocks.push(row)
      row = null
    }
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      blocks.push({ start: token.map[0], end: token.map[1], text: '',
        substantive: Boolean(token.content.trim()), kind: 'verbatim',
        ...(token.type === 'fence' ? { fence: token.markup }
          : { indentedCode: true, codeLine: token.content.split('\n', 1)[0] }) })
    }
  }
  return { blocks, text: allText.join('\n') }
}

/** Validate prose paragraphs, list paragraphs and data rows, excluding inline code. */
export function wikiCitationIssues(body: string, allowed: ReadonlySet<number>): string[] {
  const { blocks, text } = citationBlocks(body)
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const adjacent = (left: CitationBlock | undefined, right: CitationBlock | undefined) => left && right
    && lines.slice(left.end, right.start).every(line => /^\s*(?:>\s*)*$/.test(line))
  const cited = references(text)
  const issues: string[] = []
  if (!blocks.some(block => block.substantive)) issues.push('Write substantive source-grounded content.')
  if (!cited.length || cited.some(reference => !allowed.has(reference))) {
    issues.push('Use only the supplied reference numbers as plain [1], [2], etc.; citations inside code do not count.')
  }
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (!block.substantive) continue
    const previous = blocks[index - 1]
    const next = blocks[index + 1]
    const texts = block.kind === 'verbatim'
      ? [adjacent(previous, block) ? previous?.text ?? '' : '', adjacent(block, next) ? next?.text ?? '' : ''] : [block.text]
    if (!texts.some(value => references(value).some(reference => allowed.has(reference)))) {
      issues.push(`Add a supporting citation to the ${block.kind} at line ${block.start + 1}.`)
    }
  }
  return issues
}

/** A single-source topic needs no model merge, but each block still needs attribution. */
export function citeSingleWikiSource(body: string, reference = 1): string {
  const { blocks } = citationBlocks(body)
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  for (const block of [...blocks].sort((left, right) => right.end - left.end)) {
    if (!block.substantive) continue
    const suffix = `[${reference}]`
    if (block.kind === 'verbatim') {
      const lastLine = (lines[block.end - 1]?.trim() ?? '').replace(/^(?:>\s*)+/, '')
      const closing = /^(?:`{3,}|~{3,})\s*$/.test(lastLine)
        && (!block.fence || lastLine.startsWith(block.fence[0]) && lastLine.length >= block.fence.length)
      const opening = lines[block.start] ?? ''
      const marker = block.fence ? opening.indexOf(block.fence) : -1
      // Keep the caption in the list/quote that contains the verbatim block.
      // Indented code needs its surrounding indent, excluding the code indent.
      const leading = block.indentedCode && block.codeLine && opening.endsWith(block.codeLine)
        ? opening.slice(0, -block.codeLine.length)
        : opening.match(/^(?:\s|>\s*|[-+*]\s+|\d+[.)]\s+)*/)?.[0] ?? ''
      const prefix = (marker < 0 ? leading : opening.slice(0, marker))
        .replace(/(?:[-+*]|\d+[.)])\s+/g, value => ' '.repeat(value.length))
      const captionPrefix = block.indentedCode ? prefix.replace(/(?: {0,3}\t| {4})$/, '') : prefix
      lines.splice(block.end, 0, ...(block.fence && !closing ? [`${prefix}${block.fence}`] : []), captionPrefix, `${captionPrefix}${suffix}`, captionPrefix)
      continue
    }
    if (references(block.text).includes(reference)) continue
    const line = Math.max(block.start, block.end - 1)
    lines[line] = block.kind === 'row' && /\|\s*$/.test(lines[line])
      ? lines[line].replace(/\|(\s*)$/, ` ${suffix} |$1`) : `${lines[line]} ${suffix}`
  }
  return lines.join('\n')
}
