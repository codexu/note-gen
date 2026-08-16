// Markdown round-trip handlers for fenced code blocks.
//
// The upstream @tiptap/extension-code-block handlers are lossy:
// - parseMarkdown drops every fence whose raw source does not start with
//   three backticks, silently deleting `~~~` fenced blocks (see note-gen #1195).
// - renderMarkdown always emits a three-backtick fence, so a code block whose
//   content contains ``` gets terminated early and the document corrupts on
//   the next round-trip.
// These handlers accept both fence markers and size the fence per CommonMark
// so serialized output re-parses to the same node.
// Type-only imports on purpose: no Tiptap runtime dependency, so the
// round-trip fixture script (scripts/round-trip-fixture.mjs) can execute
// this exact code under Node's TS type stripping.

import type {
  JSONContent,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownRendererHelpers,
  MarkdownToken,
} from '@tiptap/core'

export function longestBacktickRun(content: string) {
  let max = 0
  let current = 0
  for (const character of content) {
    current = character === '`' ? current + 1 : 0
    if (current > max) max = current
  }
  return max
}

export function fenceLengthForContent(content: string) {
  return Math.max(3, longestBacktickRun(content) + 1)
}

export function parseFencedCodeBlockToken(
  token: MarkdownToken,
  helpers: MarkdownParseHelpers
): MarkdownParseResult {
  const raw = (token as { raw?: string }).raw ?? ''
  const codeBlockStyle = (token as { codeBlockStyle?: string }).codeBlockStyle
  const isFence = raw.startsWith('`') || raw.startsWith('~')
  if (!isFence && codeBlockStyle !== 'indented') {
    return []
  }

  const lang = (token as { lang?: string }).lang
  const text = (token as { text?: string }).text

  return helpers.createNode(
    'codeBlock',
    { language: lang || null },
    text ? [helpers.createTextNode(text)] : []
  )
}

export function renderFencedCodeBlockNode(
  node: JSONContent,
  helpers: MarkdownRendererHelpers
) {
  const language = (node.attrs?.language as string | undefined) || ''
  const content = node.content ? helpers.renderChildren(node.content) : ''

  const fence = '`'.repeat(fenceLengthForContent(content))
  return content
    ? `${fence}${language}\n${content}\n${fence}`
    : `${fence}${language}\n\n${fence}`
}
