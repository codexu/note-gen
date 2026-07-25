import type {
  BlockRefTarget,
  SyAttributeView,
  SyDocument,
  SyImportIssue,
  SyImportIssueCode,
  SyNode,
} from './types.ts'
import {
  extractBlockQueryEmbedScript,
  parseBlockQueryEmbedBlockId,
} from './embed-query.ts'
import {
  MAX_SUPPORTED_SIYuan_SPEC,
  parseSiYuanSpecVersion,
  shouldReportUnknownNodeType,
} from './known-node-types.ts'

interface ScanContext {
  blockIndex: Map<string, BlockRefTarget>
  attributeViews: Map<string, SyAttributeView>
}

function addIssue(issues: Map<SyImportIssueCode, SyImportIssue>, code: SyImportIssueCode, level: SyImportIssue['level']) {
  const existing = issues.get(code)
  if (existing) {
    existing.count += 1
    return
  }
  issues.set(code, { level, code, count: 1 })
}

function scanTextMark(
  node: SyNode,
  issues: Map<SyImportIssueCode, SyImportIssue>,
  context: ScanContext,
) {
  const markTypes = (node.TextMarkType ?? '').split(/\s+/).filter(Boolean)
  if (markTypes.includes('block-ref')) {
    const refId = node.TextMarkBlockRefID ?? ''
    if (refId && !context.blockIndex.has(refId)) {
      addIssue(issues, 'unresolved_block_ref', 'degraded')
    }
  }
  if (markTypes.includes('a') && node.TextMarkAHref?.startsWith('siyuan://blocks/')) {
    const refId = node.TextMarkAHref.slice('siyuan://blocks/'.length)
    if (refId && !context.blockIndex.has(refId)) {
      addIssue(issues, 'unresolved_block_ref', 'degraded')
    }
  }
  if (markTypes.includes('inline-memo')) {
    addIssue(issues, 'inline_memo', 'degraded')
  }
  if (markTypes.includes('file-annotation-ref')) {
    addIssue(issues, 'file_annotation_ref', 'degraded')
  }
}

function scanBlockNode(node: SyNode, issues: Map<SyImportIssueCode, SyImportIssue>, context: ScanContext) {
  if (node.Spec !== undefined) {
    const specVersion = parseSiYuanSpecVersion(node.Spec)
    if (specVersion !== null && specVersion > MAX_SUPPORTED_SIYuan_SPEC) {
      addIssue(issues, 'unsupported_spec', 'degraded')
    }
  }

  if (shouldReportUnknownNodeType(node.Type)) {
    addIssue(issues, 'unknown_node_type', 'degraded')
  }

  if (node.Type === 'NodeTextMark') {
    scanTextMark(node, issues, context)
  }

  switch (node.Type) {
    case 'NodeWidget':
      addIssue(issues, 'widget', 'degraded')
      break
    case 'NodeCustomBlock':
      addIssue(issues, 'custom_block', 'degraded')
      break
    case 'NodeBlockQueryEmbed': {
      const script = extractBlockQueryEmbedScript(node)
      const refId = script ? parseBlockQueryEmbedBlockId(script) : null
      if (!refId || !context.blockIndex.has(refId)) {
        addIssue(issues, 'embed_block', 'degraded')
      }
      break
    }
    case 'NodeGitConflict':
      addIssue(issues, 'git_conflict', 'degraded')
      break
    case 'NodeAttributeView': {
      const avId = node.AttributeViewID
      if (!avId || !context.attributeViews.has(avId)) {
        addIssue(issues, 'missing_attribute_view', 'degraded')
      } else {
        const view = context.attributeViews.get(avId)
        const activeView = view?.views?.find(item => item.id === view.viewID) ?? view?.views?.[0]
        if (activeView?.type && activeView.type !== 'table') {
          addIssue(issues, 'non_table_attribute_view', 'degraded')
        }
      }
      break
    }
    case 'NodeSuperBlock':
      addIssue(issues, 'super_block', 'degraded')
      break
    case 'NodeIFrame':
    case 'NodeVideo':
    case 'NodeAudio':
      addIssue(issues, 'media_html_block', 'degraded')
      break
    case 'NodeHTMLBlock':
      addIssue(issues, 'html_block', 'degraded')
      break
  }

  for (const child of node.Children ?? []) {
    scanBlockNode(child, issues, context)
  }
}

export function scanDocumentIssues(document: SyDocument, context: ScanContext): SyImportIssue[] {
  const issues = new Map<SyImportIssueCode, SyImportIssue>()

  for (const child of document.Children ?? []) {
    scanBlockNode(child, issues, context)
  }

  return [...issues.values()]
}

export function scanMarkdownIssues(
  markdown: string,
  missingAssets: string[],
  invalidAssetPaths: string[] = [],
): SyImportIssue[] {
  const issues: SyImportIssue[] = []

  if (/\]\(siyuan:\/\/blocks\//.test(markdown)) {
    issues.push({ level: 'degraded', code: 'siyuan_protocol_link', count: 1 })
  }

  if (missingAssets.length > 0) {
    issues.push({ level: 'degraded', code: 'missing_asset', count: missingAssets.length })
  }

  if (invalidAssetPaths.length > 0) {
    issues.push({
      level: 'degraded',
      code: 'unsafe_asset_path',
      count: invalidAssetPaths.length,
    })
  }

  return issues
}

export function mergeImportIssues(...groups: SyImportIssue[][]): SyImportIssue[] {
  const merged = new Map<SyImportIssueCode, SyImportIssue>()

  for (const group of groups) {
    for (const issue of group) {
      const existing = merged.get(issue.code)
      if (existing) {
        existing.count += issue.count
        if (issue.code === 'av_truncated') {
          existing.omittedRows = (existing.omittedRows ?? 0) + (issue.omittedRows ?? 0)
          existing.omittedColumns = (existing.omittedColumns ?? 0) + (issue.omittedColumns ?? 0)
          existing.markdownBytesTruncated = existing.markdownBytesTruncated || issue.markdownBytesTruncated
        }
      } else {
        merged.set(issue.code, { ...issue })
      }
    }
  }

  return [...merged.values()]
}

export function classifyDocumentStatus(
  issues: SyImportIssue[],
  failed: boolean,
): 'success' | 'failed' | 'degraded' | 'unsupported' {
  if (failed) {
    return 'failed'
  }
  if (issues.some(issue => issue.level === 'unsupported')) {
    return 'unsupported'
  }
  if (issues.some(issue => issue.level === 'degraded')) {
    return 'degraded'
  }
  return 'success'
}

export function summarizeImportReports(reports: Array<{ status: string; issues: SyImportIssue[] }>) {
  let successCount = 0
  let failedCount = 0
  let degradedCount = 0
  let unsupportedCount = 0
  let degradedIssueCount = 0
  let unsupportedIssueCount = 0

  for (const report of reports) {
    switch (report.status) {
      case 'success':
        successCount += 1
        break
      case 'failed':
        failedCount += 1
        break
      case 'degraded':
        degradedCount += 1
        break
      case 'unsupported':
        unsupportedCount += 1
        break
    }

    for (const issue of report.issues) {
      if (issue.level === 'degraded') {
        degradedIssueCount += issue.count
      } else {
        unsupportedIssueCount += issue.count
      }
    }
  }

  return {
    successCount,
    failedCount,
    degradedCount,
    unsupportedCount,
    degradedIssueCount,
    unsupportedIssueCount,
  }
}

export function summarizeDegradedIssuesByCode(
  reports: Array<{ issues: SyImportIssue[] }>,
): Array<{
  code: SyImportIssueCode
  count: number
  omittedRows?: number
  omittedColumns?: number
}> {
  const merged = new Map<SyImportIssueCode, {
    count: number
    omittedRows?: number
    omittedColumns?: number
  }>()

  for (const report of reports) {
    for (const issue of report.issues) {
      if (issue.level !== 'degraded') {
        continue
      }
      const existing = merged.get(issue.code)
      if (existing) {
        existing.count += issue.count
        if (issue.code === 'av_truncated') {
          existing.omittedRows = (existing.omittedRows ?? 0) + (issue.omittedRows ?? 0)
          existing.omittedColumns = (existing.omittedColumns ?? 0) + (issue.omittedColumns ?? 0)
        }
      } else {
        merged.set(issue.code, {
          count: issue.count,
          omittedRows: issue.omittedRows,
          omittedColumns: issue.omittedColumns,
        })
      }
    }
  }

  return [...merged.entries()]
    .map(([code, summary]) => ({ code, ...summary }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
}

export type { ScanContext }
