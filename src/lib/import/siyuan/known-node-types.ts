/** Highest SiYuan block Spec version this importer is validated against. */
export const MAX_SUPPORTED_SIYuan_SPEC = 1

/**
 * SiYuan/Lute kramdown AST node types the importer understands.
 * Structural inline tokens (link parens, fence markers, IAL, etc.) are expected
 * in exports and must not be reported as unknown block types.
 */
export const KNOWN_SIYuan_NODE_TYPES = new Set<string>([
  'NodeDocument',
  'NodeParagraph',
  'NodeHeading',
  'NodeThematicBreak',
  'NodeCodeBlock',
  'NodeCodeBlockCode',
  'NodeCodeBlockFenceOpenMarker',
  'NodeCodeBlockFenceInfoMarker',
  'NodeCodeBlockFenceCloseMarker',
  'NodeMathBlock',
  'NodeMathBlockContent',
  'NodeHTMLBlock',
  'NodeIFrame',
  'NodeVideo',
  'NodeAudio',
  'NodeTable',
  'NodeTableHead',
  'NodeTableRow',
  'NodeTableCell',
  'NodeList',
  'NodeListItem',
  'NodeTaskListItemMarker',
  'NodeBlockquote',
  'NodeBlockquoteMarker',
  'NodeCallout',
  'NodeSuperBlock',
  'NodeSuperBlockLayoutMarker',
  'NodeBlockQueryEmbed',
  'NodeBlockQueryEmbedScript',
  'NodeAttributeView',
  'NodeWidget',
  'NodeCustomBlock',
  'NodeGitConflict',
  'NodeText',
  'NodeTextMark',
  'NodeImage',
  'NodeLinkText',
  'NodeLinkDest',
  'NodeLinkTitle',
  'NodeLinkSpace',
  'NodeBang',
  'NodeOpenParen',
  'NodeCloseParen',
  'NodeOpenBracket',
  'NodeCloseBracket',
  'NodeOpenBrace',
  'NodeCloseBrace',
  'NodeHardBreak',
  'NodeBr',
  'NodeBackslash',
  'NodeKramdownSpanIAL',
  'NodeKramdownBlockIAL',
  'NodeFootnoteDef',
  'NodeFootnoteRef',
  'NodeFootnotesDefBlock',
  'NodeYamlFrontMatter',
  'NodeToC',
  'NodeTitle',
  'NodeTag',
  'NodeSpin',
  'NodeLottie',
  'NodeBreadcrumb',
  'NodeEmoji',
  'NodeEmojiAvatar',
])

const KNOWN_SIYuan_NODE_TYPE_PATTERNS: RegExp[] = [
  /^NodeHeadingC\d+hMarker$/,
]

export function isKnownSiYuanNodeType(type: string): boolean {
  if (KNOWN_SIYuan_NODE_TYPES.has(type)) {
    return true
  }
  return KNOWN_SIYuan_NODE_TYPE_PATTERNS.some(pattern => pattern.test(type))
}

/** Report only block-level unknown nodes, not missed inline AST tokens. */
export function shouldReportUnknownNodeType(type: string): boolean {
  if (isKnownSiYuanNodeType(type)) {
    return false
  }
  if (!type.startsWith('Node')) {
    return false
  }
  // Inline / kramdown token families should never surface as block degradation.
  if (/^Node(?:Open|Close)(?:Paren|Bracket|Brace)$/.test(type)) {
    return false
  }
  if (/^NodeLink(?:Text|Dest|Title|Space)$/.test(type)) {
    return false
  }
  if (/^NodeCodeBlockFence/.test(type)) {
    return false
  }
  if (/^NodeKramdown(?:Block|Span)IAL$/.test(type)) {
    return false
  }
  if (/^NodeHeadingC\d+hMarker$/.test(type)) {
    return false
  }
  if (type === 'NodeBang' || type === 'NodeBr' || type === 'NodeBackslash') {
    return false
  }
  return true
}

export function parseSiYuanSpecVersion(spec: string): number | null {
  const trimmed = spec.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }
  const version = Number.parseInt(trimmed, 10)
  return Number.isFinite(version) ? version : null
}
