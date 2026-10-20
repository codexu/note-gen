// Markdown round-trip handlers for fenced code blocks.
//
// The upstream @tiptap/extension-code-block handlers are lossy:
// - parseMarkdown drops every fence whose raw source does not start with
//   three backticks, silently deleting `~~~` fenced blocks (see note-gen #1195).
// - renderMarkdown always emits a three-backtick fence, so a code block whose
//   content contains ``` gets terminated early and the document corrupts on
//   the next round-trip.
// These handlers accept both fence markers (including up to three leading
// spaces) and size the fence per CommonMark so serialized output re-parses to
// the same node.
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

function longestMarkerRun(content: string, marker: '`' | '~') {
  let max = 0
  let current = 0
  for (const character of content) {
    current = character === marker ? current + 1 : 0
    if (current > max) max = current
  }
  return max
}

export function longestBacktickRun(content: string) {
  return longestMarkerRun(content, '`')
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
  const isFence = /^ {0,3}(?:`{3,}|~{3,})/.test(raw)
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

  // Backtick fence info strings cannot contain backticks. Tilde fences do not
  // have that restriction, so use one when preserving such an info string.
  const marker = language.includes('`') ? '~' : '`'
  const fenceLength = Math.max(3, longestMarkerRun(content, marker) + 1)
  const fence = marker.repeat(fenceLength)
  const openingFence = marker === '~' && language
    ? `${fence} ${language}`
    : `${fence}${language}`

  return content
    ? `${openingFence}\n${content}\n${fence}`
    : `${openingFence}\n\n${fence}`
}
