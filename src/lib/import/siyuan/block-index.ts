import type { BlockRefTarget, SyDocument, SyNode } from './types.ts'
import {
  encodeMarkdownPath,
  escapeMarkdownLinkText,
  isSafeSiYuanBlockId,
  resolveSafeBlockAnchor,
  toRelativeWorkspacePath,
} from './utils.ts'

const BLOCK_TYPES_WITH_ANCHOR = new Set([
  'NodeParagraph',
  'NodeHeading',
  'NodeThematicBreak',
  'NodeCodeBlock',
  'NodeMathBlock',
])

function extractInlineText(nodes: SyNode[] | undefined): string {
  if (!nodes?.length) {
    return ''
  }

  return nodes.map(node => {
    if (node.Type === 'NodeText') {
      return node.Data ?? ''
    }
    if (node.Type === 'NodeTextMark') {
      return node.TextMarkTextContent ?? node.TextMarkInlineMathContent ?? ''
    }
    if (node.Children?.length) {
      return extractInlineText(node.Children)
    }
    return node.Data ?? ''
  }).join('')
}

function extractBlockPreview(node: SyNode): string {
  switch (node.Type) {
    case 'NodeHeading':
    case 'NodeParagraph':
      return extractInlineText(node.Children).trim()
    case 'NodeCodeBlock': {
      for (const child of node.Children ?? []) {
        if (child.Type === 'NodeCodeBlockCode') {
          return (child.Data ?? '').split('\n')[0]?.trim() ?? ''
        }
      }
      return ''
    }
    case 'NodeList':
      return extractInlineText(node.Children?.[0]?.Children?.find(child => child.Type === 'NodeParagraph')?.Children).trim()
    default:
      return extractInlineText(node.Children).trim() || node.Data?.trim() || ''
  }
}

function registerBlock(
  blockId: string | undefined,
  target: BlockRefTarget,
  index: Map<string, BlockRefTarget>,
) {
  if (!isSafeSiYuanBlockId(blockId)) {
    return
  }

  index.set(blockId, target)
}

function indexNodeBlocks(
  node: SyNode,
  mdRelativePath: string,
  index: Map<string, BlockRefTarget>,
) {
  const anchor = BLOCK_TYPES_WITH_ANCHOR.has(node.Type)
    ? resolveSafeBlockAnchor(node) ?? undefined
    : undefined

  if (anchor) {
    const target: BlockRefTarget = {
      mdPath: mdRelativePath,
      preview: extractBlockPreview(node),
      anchor,
    }

    registerBlock(node.ID, target, index)
    registerBlock(node.Properties?.id, target, index)
  }

  for (const child of node.Children ?? []) {
    indexNodeBlocks(child, mdRelativePath, index)
  }
}

export function buildBlockIndex(plans: Array<{ document: SyDocument; mdRelativePath: string }>): Map<string, BlockRefTarget> {
  const index = new Map<string, BlockRefTarget>()

  for (const plan of plans) {
    const documentTarget: BlockRefTarget = {
      mdPath: plan.mdRelativePath,
      preview: plan.document.Properties?.title ?? plan.document.ID,
    }

    registerBlock(plan.document.ID, documentTarget, index)
    registerBlock(plan.document.Properties?.id, documentTarget, index)

    for (const child of plan.document.Children ?? []) {
      indexNodeBlocks(child, plan.mdRelativePath, index)
    }
  }

  return index
}

function buildBlockRefDestination(
  target: BlockRefTarget,
  currentMdPath: string,
): string | null {
  const fragment = target.anchor ? `#${encodeURIComponent(target.anchor)}` : null
  if (currentMdPath === target.mdPath) {
    return fragment
  }

  const encodedPath = encodeMarkdownPath(toRelativeWorkspacePath(currentMdPath, target.mdPath))
  if (encodedPath === null) {
    return null
  }

  return fragment ? `${encodedPath}${fragment}` : encodedPath
}

export function resolveBlockRefLink(
  refId: string,
  displayText: string,
  currentMdPath: string,
  blockIndex: Map<string, BlockRefTarget>,
): string {
  const target = blockIndex.get(refId)
  const text = displayText.trim() || target?.preview || refId
  const escapedText = escapeMarkdownLinkText(text)

  if (!target) {
    return escapedText
  }

  const destination = buildBlockRefDestination(target, currentMdPath)
  if (destination === null) {
    return escapedText
  }

  return `[${escapedText}](${destination})`
}

export function resolveSiyuanBlockHref(
  href: string,
  displayText: string,
  currentMdPath: string,
  blockIndex: Map<string, BlockRefTarget>,
): string {
  if (!href.startsWith('siyuan://blocks/')) {
    return href
  }

  const refId = href.slice('siyuan://blocks/'.length)
  return resolveBlockRefLink(refId, displayText, currentMdPath, blockIndex)
}
