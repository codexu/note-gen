import type { BlockRefTarget, SyAttributeView, SyAvKey, SyAvKeyValue, SyAvValue, SyAvView, SyImportIssue } from './types.ts'
import {
  MAX_AV_MARKDOWN_BYTES,
  MAX_AV_TABLE_COLUMNS,
  MAX_AV_TABLE_ROWS,
} from './budgets.ts'
import { escapeMarkdownTableCell, escapeMarkdownText } from './utils.ts'

interface RenderAttributeViewOptions {
  renderAsset?: (path: string, label: string) => string | null
}

export interface AvRenderTruncation {
  omittedRows: number
  omittedColumns: number
  markdownBytesTruncated: boolean
}

export interface AvRenderResult {
  markdown: string
  truncation: AvRenderTruncation
}

function getActiveView(attributeView: SyAttributeView): SyAvView | undefined {
  if (!attributeView.views?.length) {
    return undefined
  }

  return attributeView.views.find(view => view.id === attributeView.viewID) ?? attributeView.views[0]
}

function getColumnKeys(attributeView: SyAttributeView, view?: SyAvView): {
  columns: SyAvKey[]
  totalColumns: number
} {
  const keyMap = new Map((attributeView.keyValues ?? []).map(item => [item.key.id, item.key]))
  const columnIds = view?.table?.columns
    ?.filter(column => !column.hidden)
    .map(column => column.id)

  let columns: SyAvKey[] = []
  if (columnIds?.length) {
    columns = columnIds
      .map(id => keyMap.get(id))
      .filter((key): key is SyAvKey => Boolean(key))
  } else if (attributeView.keyIDs?.length) {
    columns = attributeView.keyIDs
      .map(id => keyMap.get(id))
      .filter((key): key is SyAvKey => Boolean(key))
  } else {
    columns = (attributeView.keyValues ?? [])
      .map(item => item.key)
      .filter(key => key.type !== 'template' && key.type !== 'rollup')
  }

  const totalColumns = columns.length
  return {
    columns: columns.slice(0, MAX_AV_TABLE_COLUMNS),
    totalColumns,
  }
}

function getRowIds(attributeView: SyAttributeView, view?: SyAvView): {
  rowIds: string[]
  totalRows: number
} {
  let rowIds: string[] = []

  if (view?.table?.rowIds?.length) {
    rowIds = view.table.rowIds
  } else if (view?.itemIds?.length) {
    rowIds = view.itemIds
  } else {
    const collected = new Set<string>()
    for (const keyValue of attributeView.keyValues ?? []) {
      for (const value of keyValue.values ?? []) {
        if (value.blockID) {
          collected.add(value.blockID)
        }
      }
    }
    rowIds = [...collected]
  }

  const totalRows = rowIds.length
  return {
    rowIds: rowIds.slice(0, MAX_AV_TABLE_ROWS),
    totalRows,
  }
}

function buildCellIndex(keyValues: SyAvKeyValue[] | undefined): Map<string, SyAvValue> {
  const index = new Map<string, SyAvValue>()

  for (const keyValue of keyValues ?? []) {
    for (const value of keyValue.values ?? []) {
      if (value.blockID) {
        index.set(`${keyValue.key.id}:${value.blockID}`, value)
      }
    }
  }

  return index
}

function findCellValue(
  cellIndex: Map<string, SyAvValue>,
  keyId: string,
  rowId: string,
): SyAvValue | undefined {
  return cellIndex.get(`${keyId}:${rowId}`)
}

function resolveRelationValue(
  value: SyAvValue | undefined,
  blockIndex: Map<string, BlockRefTarget>,
): string {
  if (!value?.relation) {
    return ''
  }

  if (value.relation.contents?.length) {
    return value.relation.contents
      .map(item => item.block?.content ?? item.text?.content ?? '')
      .filter(Boolean)
      .join(', ')
  }

  if (value.relation.blockIDs?.length) {
    return value.relation.blockIDs
      .map(blockId => blockIndex.get(blockId)?.preview ?? blockId)
      .join(', ')
  }

  return ''
}

function resolveRollupValue(value: SyAvValue | undefined): string {
  if (!value?.rollup?.contents?.length) {
    return ''
  }

  return value.rollup.contents
    .map(item => {
      if (item.block?.content) {
        return item.block.content
      }
      if (item.text?.content) {
        return item.text.content
      }
      if (item.number?.formattedContent) {
        return item.number.formattedContent
      }
      if (typeof item.number?.content === 'number') {
        return String(item.number.content)
      }
      return ''
    })
    .filter(Boolean)
    .join(', ')
}

function formatAvCellValue(
  key: SyAvKey,
  value: SyAvValue | undefined,
  blockIndex: Map<string, BlockRefTarget>,
): string {
  if (!value) {
    return ''
  }

  switch (key.type) {
    case 'block':
      return value.block?.content?.trim() ?? blockIndex.get(value.blockID ?? '')?.preview ?? ''
    case 'text':
      return value.text?.content?.trim() ?? ''
    case 'number':
      if (value.number?.formattedContent) {
        return value.number.formattedContent
      }
      return typeof value.number?.content === 'number' ? String(value.number.content) : ''
    case 'date':
      return value.date?.formattedContent ?? (value.date?.content ? String(value.date.content) : '')
    case 'select':
    case 'mSelect':
      return (value.mSelect ?? []).map(item => item.content ?? '').filter(Boolean).join(', ')
    case 'url':
      return value.url?.content?.trim() ?? ''
    case 'email':
      return value.email?.content?.trim() ?? ''
    case 'phone':
      return value.phone?.content?.trim() ?? ''
    case 'mAsset':
      return (value.mAsset ?? []).map(item => `${item.name ?? ''} ${item.content ?? ''}`.trim()).filter(Boolean).join(', ')
    case 'checkbox':
      return value.checkbox?.checked ? 'Yes' : 'No'
    case 'created':
      return value.created?.formattedContent ?? ''
    case 'updated':
      return value.updated?.formattedContent ?? ''
    case 'template':
      return value.template?.content?.trim() ?? ''
    case 'relation':
      return resolveRelationValue(value, blockIndex)
    case 'rollup':
      return resolveRollupValue(value)
    default:
      return value.block?.content?.trim() ?? value.text?.content?.trim() ?? ''
  }
}

function formatAvAssetCell(
  value: SyAvValue | undefined,
  options: RenderAttributeViewOptions,
): string {
  return (value?.mAsset ?? [])
    .map(item => {
      const path = item.content?.trim() ?? ''
      const label = item.name?.trim() || path
      if (!path) {
        return escapeMarkdownTableCell(label)
      }

      return options.renderAsset?.(path, label)
        ?? escapeMarkdownTableCell(label)
    })
    .filter(Boolean)
    .join(', ')
}

function truncateAvMarkdown(markdown: string): { markdown: string; truncated: boolean } {
  const bytes = new TextEncoder().encode(markdown)
  if (bytes.length <= MAX_AV_MARKDOWN_BYTES) {
    return { markdown, truncated: false }
  }

  const truncated = new TextDecoder().decode(bytes.slice(0, MAX_AV_MARKDOWN_BYTES))
  return {
    markdown: `${truncated.trimEnd()}\n\n> SiYuan database output truncated (${MAX_AV_MARKDOWN_BYTES} bytes).`,
    truncated: true,
  }
}

export function buildAvTruncationIssues(truncations: AvRenderTruncation[]): SyImportIssue[] {
  const issues: SyImportIssue[] = []

  for (const truncation of truncations) {
    const omittedRows = truncation.omittedRows
    const omittedColumns = truncation.omittedColumns
    if (omittedRows <= 0 && omittedColumns <= 0 && !truncation.markdownBytesTruncated) {
      continue
    }

    issues.push({
      level: 'degraded',
      code: 'av_truncated',
      count: 1,
      omittedRows: omittedRows > 0 ? omittedRows : undefined,
      omittedColumns: omittedColumns > 0 ? omittedColumns : undefined,
      markdownBytesTruncated: truncation.markdownBytesTruncated || undefined,
    })
  }

  return issues
}

export function renderAttributeViewMarkdown(
  attributeView: SyAttributeView,
  blockIndex: Map<string, BlockRefTarget>,
  options: RenderAttributeViewOptions = {},
): AvRenderResult {
  const view = getActiveView(attributeView)
  const { columns, totalColumns } = getColumnKeys(attributeView, view)
  const { rowIds, totalRows } = getRowIds(attributeView, view)
  const omittedRows = Math.max(0, totalRows - rowIds.length)
  const omittedColumns = Math.max(0, totalColumns - columns.length)

  if (!columns.length || !rowIds.length) {
    return {
      markdown: `> SiYuan database: ${attributeView.name ?? attributeView.id}`,
      truncation: {
        omittedRows,
        omittedColumns,
        markdownBytesTruncated: false,
      },
    }
  }

  const cellIndex = buildCellIndex(attributeView.keyValues)
  const header = columns.map(column => escapeMarkdownTableCell(column.name))
  const rows = rowIds.map(rowId =>
    columns.map(column => {
      const value = findCellValue(cellIndex, column.id, rowId)
      if (column.type === 'mAsset') {
        return formatAvAssetCell(value, options)
      }

      const cell = formatAvCellValue(
        column,
        value,
        blockIndex,
      )
      return escapeMarkdownTableCell(cell)
    }),
  )

  const title = escapeMarkdownText(attributeView.name?.trim() || 'Database')
  const table = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`),
  ].join('\n')

  const truncatedMarkdown = truncateAvMarkdown(`### ${title}\n\n${table}`)
  const truncationNote = omittedRows > 0 || omittedColumns > 0
    ? `\n\n> SiYuan database truncated: omitted ${omittedRows} row(s) and ${omittedColumns} column(s).`
    : ''

  return {
    markdown: `${truncatedMarkdown.markdown}${truncationNote}`,
    truncation: {
      omittedRows,
      omittedColumns,
      markdownBytesTruncated: truncatedMarkdown.truncated,
    },
  }
}
