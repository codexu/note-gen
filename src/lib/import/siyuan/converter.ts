import { renderAttributeViewMarkdown, buildAvTruncationIssues, type AvRenderTruncation } from './av-renderer.ts'
import { resolveBlockRefLink, resolveSiyuanBlockHref } from './block-index.ts'
import {
  extractBlockQueryEmbedScript,
  parseBlockQueryEmbedBlockId,
} from './embed-query.ts'
import { isKnownSiYuanNodeType } from './known-node-types.ts'
import type { SyConvertContext, SyDocument, SyImportIssue, SyNode } from './types.ts'
import { parseAndValidateSiYuanDocument } from './validation.ts'
import {
  decodeBase64,
  encodeMarkdownLinkDestination,
  encodeMarkdownPath,
  escapeMarkdownLinkText,
  escapeMarkdownText,
  getImportedAssetRelativePath,
  isSafeRelativeLinkReference,
  isSiYuanAssetReferenceCandidate,
  parseSiYuanAssetReference,
  resolveSafeBlockAnchor,
  stripSiYuanInvisibleChars,
  toRelativeWorkspacePath,
} from './utils.ts'

interface ConvertRuntimeContext extends SyConvertContext {
  assetPaths: Set<string>
  invalidAssetPaths: Set<string>
  avTruncations: AvRenderTruncation[]
}

function resolveSafeHref(path: string, context: ConvertRuntimeContext): string | null {
  const normalized = path.trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }

  if (isSiYuanAssetReferenceCandidate(normalized)) {
    const assetReference = parseSiYuanAssetReference(normalized)
    if (!assetReference) {
      context.invalidAssetPaths.add(normalized)
      return null
    }

    context.assetPaths.add(assetReference.sourcePath)
    const targetPath = getImportedAssetRelativePath(
      assetReference.sourcePath,
      context.assetOutputDir,
    )
    const relativePath = toRelativeWorkspacePath(context.currentMdPath, targetPath)
    const encodedPath = encodeMarkdownPath(relativePath)
    if (encodedPath === null) {
      context.invalidAssetPaths.add(normalized)
      return null
    }
    return `${encodedPath}`
  }

  const protocol = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase()
  if (protocol && !['http', 'https', 'mailto', 'tel'].includes(protocol)) {
    return null
  }
  if (!protocol && !isSafeRelativeLinkReference(normalized)) {
    return null
  }

  return encodeMarkdownLinkDestination(normalized) ?? null
}

function isSiYuanInvisibleTextNode(node: SyNode): boolean {
  return node.Type === 'NodeText' && stripSiYuanInvisibleChars(node.Data ?? '').length === 0
}

function renderParagraph(node: SyNode, context: ConvertRuntimeContext): string {
  const children = node.Children ?? []
  const meaningfulChildren = children.filter(child => !isSiYuanInvisibleTextNode(child))

  if (
    meaningfulChildren.length === 1
    && meaningfulChildren[0].Type === 'NodeImage'
  ) {
    return withBlockAnchor(node, renderImage(meaningfulChildren[0], context))
  }

  return withBlockAnchor(node, renderInlineNodes(children, context))
}

function renderInlineNodes(nodes: SyNode[] | undefined, context: ConvertRuntimeContext): string {
  if (!nodes?.length) {
    return ''
  }

  return nodes.map(node => renderInlineNode(node, context)).join('')
}

function renderInlineNode(node: SyNode, context: ConvertRuntimeContext): string {
  switch (node.Type) {
    case 'NodeText':
      return escapeMarkdownText(node.Data ?? '')
    case 'NodeTextMark':
      return renderTextMark(node, context)
    case 'NodeImage':
      return renderImage(node, context)
    case 'NodeHardBreak':
    case 'NodeBr':
      return '\\\n'
    case 'NodeBackslash':
      return '\\\\'
    default:
      if (node.Children?.length) {
        return renderInlineNodes(node.Children, context)
      }
      return escapeMarkdownText(node.Data ?? '')
  }
}

function renderTextMark(node: SyNode, context: ConvertRuntimeContext): string {
  const markTypes = (node.TextMarkType ?? 'text').split(/\s+/).filter(Boolean)
  const rawContent = node.TextMarkTextContent ?? ''
  let content: string

  if (markTypes.includes('inline-math')) {
    content = `$${sanitizeMathContent(node.TextMarkInlineMathContent ?? rawContent)}$`
  } else if (markTypes.includes('a')) {
    const href = node.TextMarkAHref ?? ''
    const text = rawContent || href
    if (href.startsWith('siyuan://blocks/')) {
      content = resolveSiyuanBlockHref(href, text, context.currentMdPath, context.blockIndex)
    } else {
      const safeHref = resolveSafeHref(href, context)
      content = safeHref === null
        ? escapeMarkdownLinkText(text)
        : `[${escapeMarkdownLinkText(text)}](${safeHref})`
    }
  } else if (markTypes.includes('block-ref')) {
    const refId = node.TextMarkBlockRefID ?? ''
    const isDynamic = node.TextMarkBlockRefSubtype === 'd'
    const target = context.blockIndex.get(refId)
    const text = isDynamic
      ? target?.preview ?? rawContent ?? refId
      : rawContent || target?.preview || refId
    content = resolveBlockRefLink(refId, text, context.currentMdPath, context.blockIndex)
  } else if (markTypes.includes('tag')) {
    content = `#${escapeMarkdownText(rawContent)}#`
  } else if (markTypes.includes('code')) {
    content = renderInlineCode(rawContent)
  } else if (markTypes.includes('inline-memo')) {
    const memo = escapeMarkdownText(node.TextMarkInlineMemoContent ?? '')
    const text = escapeMarkdownText(rawContent)
    content = memo ? `${text} (${memo})` : text
  } else if (markTypes.includes('file-annotation-ref')) {
    content = escapeMarkdownText(rawContent)
      || escapeMarkdownText(node.TextMarkFileAnnotationRefID ?? '')
  } else {
    content = escapeMarkdownText(rawContent)
  }

  return applyTextMarkStyles(content, markTypes)
}

function applyTextMarkStyles(content: string, markTypes: string[]): string {
  if (markTypes.includes('strong')) {
    content = `**${content}**`
  }
  if (markTypes.includes('em')) {
    content = `*${content}*`
  }
  if (markTypes.includes('s')) {
    content = `~~${content}~~`
  }
  if (markTypes.includes('mark')) {
    content = `==${content}==`
  }
  if (markTypes.includes('u')) {
    content = `<u>${content}</u>`
  }
  if (markTypes.includes('sup')) {
    content = `<sup>${content}</sup>`
  }
  if (markTypes.includes('sub')) {
    content = `<sub>${content}</sub>`
  }
  if (markTypes.includes('kbd')) {
    content = `<kbd>${content}</kbd>`
  }

  return content
}

function renderImage(node: SyNode, context: ConvertRuntimeContext): string {
  let alt = ''
  let src = ''

  for (const child of node.Children ?? []) {
    if (child.Type === 'NodeLinkText') {
      alt = child.Data ?? ''
    }
    if (child.Type === 'NodeLinkDest') {
      src = child.Data ?? ''
    }
  }

  const safeSrc = resolveSafeHref(src, context)
  if (safeSrc === null || !safeSrc) {
    return escapeMarkdownLinkText(alt || 'Unsupported image')
  }

  const label = alt.trim() || 'image'
  return `![${escapeMarkdownLinkText(label)}](${safeSrc})`
}

function renderBlockNodes(nodes: SyNode[] | undefined, context: ConvertRuntimeContext, depth = 0): string {
  if (!nodes?.length) {
    return ''
  }

  const parts: string[] = []

  for (const node of nodes) {
    const rendered = renderBlockNode(node, context, depth)
    if (rendered) {
      parts.push(rendered)
    }
  }

  return parts.join('\n\n')
}

function withBlockAnchor(node: SyNode, content: string): string {
  const blockId = resolveSafeBlockAnchor(node)
  if (!blockId || !content) {
    return content
  }

  return `<span id="${blockId}"></span>\n${content}`
}

function renderBlockNode(node: SyNode, context: ConvertRuntimeContext, depth: number): string {
  switch (node.Type) {
    case 'NodeParagraph':
      return renderParagraph(node, context)
    case 'NodeHeading': {
      const level = Math.min(Math.max(node.HeadingLevel ?? 2, 1), 6)
      const prefix = '#'.repeat(level)
      return withBlockAnchor(
        node,
        `${prefix} ${renderInlineNodes(node.Children, context)}`.trim(),
      )
    }
    case 'NodeThematicBreak':
      return withBlockAnchor(node, '---')
    case 'NodeCodeBlock':
      return withBlockAnchor(node, renderCodeBlock(node))
    case 'NodeMathBlock':
      return withBlockAnchor(node, renderMathBlock(node))
    case 'NodeHTMLBlock':
    case 'NodeIFrame':
    case 'NodeVideo':
    case 'NodeAudio':
      return renderFencedCode(node.Data ?? '', 'html')
    case 'NodeTable':
      return renderTable(node, context)
    case 'NodeList':
      return renderList(node, context, depth)
    case 'NodeBlockquote':
      return renderBlockquote(node, context)
    case 'NodeCallout':
      return renderCallout(node, context)
    case 'NodeSuperBlock':
      return renderSuperBlock(node, context, depth)
    case 'NodeBlockQueryEmbed':
      return renderEmbedBlock(node, context)
    case 'NodeAttributeView':
      return renderAttributeView(node, context)
    case 'NodeWidget':
      return renderDegradedSiYuanBlock(
        'SiYuan widget (imported with reduced fidelity):',
        node,
        context,
        depth,
        'json',
      )
    case 'NodeCustomBlock':
      return renderDegradedSiYuanBlock(
        'SiYuan custom block (imported with reduced fidelity):',
        node,
        context,
        depth,
      )
    case 'NodeGitConflict':
      return renderDegradedSiYuanBlock(
        'SiYuan merge conflict (imported with reduced fidelity):',
        node,
        context,
        depth,
        'diff',
      )
    default:
      if (!isKnownSiYuanNodeType(node.Type)) {
        return renderDegradedSiYuanBlock(
          `SiYuan ${node.Type} (imported with reduced fidelity):`,
          node,
          context,
          depth,
        )
      }
      if (node.Children?.length) {
        return renderBlockNodes(node.Children, context, depth)
      }
      return escapeMarkdownText(node.Data ?? '')
  }
}

function renderCodeBlock(node: SyNode): string {
  const language = decodeBase64(node.CodeBlockInfo)
  let code = ''

  for (const child of node.Children ?? []) {
    if (child.Type === 'NodeCodeBlockCode') {
      code = child.Data ?? ''
      break
    }
  }

  return renderFencedCode(code, language)
}

function renderInlineCode(content: string): string {
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map(match => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  const needsPadding = content.startsWith('`') || content.endsWith('`')
  return needsPadding
    ? `${fence} ${content} ${fence}`
    : `${fence}${content}${fence}`
}

function renderFencedCode(content: string, language: string): string {
  const longestFence = Math.max(0, ...[...content.matchAll(/`+/g)].map(match => match[0].length))
  const fence = '`'.repeat(Math.max(3, longestFence + 1))
  const safeLanguage = language.trim().split(/\s+/)[0]?.replace(/[^\w+.-]/g, '') ?? ''
  return `${fence}${safeLanguage}\n${content}\n${fence}`.trimEnd()
}

function renderDegradedSiYuanBlock(
  label: string,
  node: SyNode,
  context: ConvertRuntimeContext,
  depth: number,
  language = 'text',
): string {
  const parts: string[] = [`> ${label}`]
  const rawData = node.Data?.trim()

  if (rawData) {
    parts.push(renderFencedCode(rawData, language))
  }

  const childContent = renderBlockNodes(node.Children, context, depth)
  if (childContent.trim()) {
    parts.push(childContent)
  }

  if (parts.length === 1) {
    parts.push(`> Block type: ${node.Type}`)
  }

  return withBlockAnchor(node, parts.join('\n\n'))
}

function renderMathBlock(node: SyNode): string {
  for (const child of node.Children ?? []) {
    if (child.Type === 'NodeMathBlockContent') {
      return `$$\n${sanitizeMathContent(child.Data ?? '')}\n$$`
    }
  }

  return '$$'
}

function sanitizeMathContent(content: string): string {
  return content
    .replace(/\$/g, '\\$')
    .replace(/</g, '\\lt ')
    .replace(/>/g, '\\gt ')
}

function renderTable(node: SyNode, context: ConvertRuntimeContext): string {
  const rows: string[][] = []

  function walkTableNodes(nodes: SyNode[] | undefined) {
    for (const child of nodes ?? []) {
      if (child.Type === 'NodeTableRow') {
        const cells = (child.Children ?? [])
          .filter(item => item.Type === 'NodeTableCell')
          .map(cell => renderInlineNodes(cell.Children, context).replace(/\|/g, '\\|').replace(/\n/g, ' '))
        if (cells.length) {
          rows.push(cells)
        }
      } else if (child.Children?.length) {
        walkTableNodes(child.Children)
      }
    }
  }

  walkTableNodes(node.Children)

  if (!rows.length) {
    return ''
  }

  const columnCount = Math.max(...rows.map(row => row.length))
  const normalizedRows = rows.map(row => {
    const next = [...row]
    while (next.length < columnCount) {
      next.push('')
    }
    return next
  })

  const header = normalizedRows[0]
  const separator = new Array(columnCount).fill('---')
  const body = normalizedRows.slice(1)

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function renderList(
  node: SyNode,
  context: ConvertRuntimeContext,
  depth: number,
  indent = '    '.repeat(depth),
): string {
  const items = (node.Children ?? []).filter(child => child.Type === 'NodeListItem')
  const renderedItems: string[] = []

  items.forEach((item, index) => {
    const listType = item.ListData?.Typ ?? node.ListData?.Typ
    const marker = getListMarker(listType, item, index)
    const leadContinuationIndent = `${indent}${' '.repeat(marker.length + 1)}`
    const continuationIndent = `${indent}${' '.repeat(Math.max(4, marker.length + 1))}`
    let renderedItem = `${indent}${marker}`
    let hasContent = false

    for (const child of item.Children ?? []) {
      if (child.Type === 'NodeTaskListItemMarker') {
        continue
      }

      if (child.Type === 'NodeParagraph') {
        const paragraph = renderInlineNodes(child.Children, context)
        if (!hasContent) {
          renderedItem = appendLeadListContent(
            renderedItem,
            paragraph,
            leadContinuationIndent,
          )
        } else {
          renderedItem += `\n${continuationIndent}\n${indentBlock(
            paragraph,
            continuationIndent,
          )}`
        }
        hasContent = true
      } else if (child.Type === 'NodeList') {
        renderedItem += `\n${renderList(child, context, depth + 1, continuationIndent)}`
        hasContent = true
      } else {
        const block = renderBlockNode(child, context, depth + 1)
        if (block) {
          renderedItem = hasContent
            ? `${renderedItem}\n${continuationIndent}\n${indentBlock(
              block,
              continuationIndent,
            )}`
            : appendLeadListContent(renderedItem, block, leadContinuationIndent)
          hasContent = true
        }
      }
    }

    renderedItems.push(renderedItem)
  })

  return renderedItems.join('\n')
}

function appendLeadListContent(
  markerLine: string,
  content: string,
  continuationIndent: string,
): string {
  const [firstLine = '', ...remainingLines] = content.split('\n')
  let result = `${markerLine}${firstLine ? ` ${firstLine}` : ''}`
  if (remainingLines.length > 0) {
    result += `\n${remainingLines
      .map(line => `${continuationIndent}${line}`)
      .join('\n')}`
  }
  return result
}

function indentBlock(content: string, indent: string): string {
  return content
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n')
}

function getTaskListItemChecked(item: SyNode): boolean {
  const marker = item.Children?.find(child => child.Type === 'NodeTaskListItemMarker')
  if (marker?.TaskListItemChecked !== undefined) {
    return marker.TaskListItemChecked
  }
  if (marker?.ListData?.Checked !== undefined) {
    return marker.ListData.Checked
  }
  return item.ListData?.Checked ?? item.TaskListItemChecked ?? false
}

function getListMarker(listType: number | undefined, item: SyNode, index: number): string {
  if (listType === 3) {
    const checked = getTaskListItemChecked(item)
    return checked ? '- [x]' : '- [ ]'
  }

  if (listType === 1) {
    const start = item.ListData?.Start ?? 1
    const number = item.ListData?.Num && item.ListData.Num > 0 ? item.ListData.Num : start + index
    const delimiter = item.ListData?.Delimiter === 41 ? ')' : '.'
    return `${number}${delimiter}`
  }

  return '-'
}

function renderBlockquote(node: SyNode, context: ConvertRuntimeContext): string {
  const content = renderBlockNodes(
    (node.Children ?? []).filter(child => child.Type !== 'NodeBlockquoteMarker'),
    context,
  )

  return content
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')
}

function renderCallout(node: SyNode, context: ConvertRuntimeContext): string {
  const type = (node.CalloutType ?? 'NOTE')
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '') || 'NOTE'
  const title = escapeMarkdownText(node.CalloutTitle ?? type)
  const body = renderBlockNodes(node.Children, context)
  return `> [!${type}]\n> **${title}**\n>\n${body
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')}`
}

function renderSuperBlock(node: SyNode, context: ConvertRuntimeContext, depth: number): string {
  const blocks = (node.Children ?? []).filter(child =>
    !child.Type.endsWith('Marker') && child.Type !== 'NodeSuperBlockLayoutMarker',
  )

  return blocks
    .map(block => renderBlockNode(block, context, depth))
    .filter(Boolean)
    .join('\n\n')
}

function renderEmbedBlock(node: SyNode, context: ConvertRuntimeContext): string {
  const script = extractBlockQueryEmbedScript(node)
  const refId = script ? parseBlockQueryEmbedBlockId(script) : null
  const target = refId ? context.blockIndex.get(refId) : undefined

  if (refId && target) {
    const link = resolveBlockRefLink(
      refId,
      target.preview || refId,
      context.currentMdPath,
      context.blockIndex,
    )
    return `> Embedded block:\n\n${link}`
  }

  if (script) {
    return `> Embedded block query (content not in export):\n\n${renderFencedCode(script, 'sql')}`
  }

  return '> Embedded block (content not in export)'
}

function renderAttributeView(node: SyNode, context: ConvertRuntimeContext): string {
  const avId = node.AttributeViewID
  if (!avId) {
    return '> SiYuan database block'
  }

  const attributeView = context.attributeViews.get(avId)
  if (!attributeView) {
    const viewType = escapeMarkdownText(node.AttributeViewType ?? 'table')
    return `> SiYuan database (${viewType}, definition not in export): ${escapeMarkdownText(avId)}`
  }

  const rendered = renderAttributeViewMarkdown(attributeView, context.blockIndex, {
    renderAsset: (path, label) => {
      const href = resolveSafeHref(path, context)
      if (!href) {
        return null
      }
      return `[${escapeMarkdownLinkText(label || path)}](${href})`
    },
  })
  context.avTruncations.push(rendered.truncation)
  return rendered.markdown
}

export function convertSyDocumentToMarkdown(
  document: SyDocument,
  context: SyConvertContext,
): {
  markdown: string
  assetPaths: string[]
  invalidAssetPaths: string[]
  importIssues: SyImportIssue[]
} {
  const runtimeContext: ConvertRuntimeContext = {
    ...context,
    assetPaths: new Set<string>(),
    invalidAssetPaths: new Set<string>(),
    avTruncations: [],
  }
  const body = stripSiYuanInvisibleChars(renderBlockNodes(document.Children, runtimeContext).trim())
  const markdown = body ? `${body}\n` : ''

  return {
    markdown,
    assetPaths: [...runtimeContext.assetPaths],
    invalidAssetPaths: [...runtimeContext.invalidAssetPaths],
    importIssues: buildAvTruncationIssues(runtimeContext.avTruncations),
  }
}

export function convertSyJsonToMarkdown(
  content: string,
  context: SyConvertContext,
): {
  markdown: string
  assetPaths: string[]
  invalidAssetPaths: string[]
  title: string
  id: string
} {
  const document = parseAndValidateSiYuanDocument(content)

  const { markdown, assetPaths, invalidAssetPaths } = convertSyDocumentToMarkdown(document, context)

  return {
    markdown,
    assetPaths,
    invalidAssetPaths,
    title: document.Properties?.title ?? document.ID,
    id: document.ID,
  }
}
