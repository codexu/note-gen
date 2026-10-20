import { z } from 'zod'
import type {
  CanvasChartDatum,
  CanvasChartRecommendation,
  CanvasChartSeries,
  CanvasChartSourceFormat,
  CanvasChartSpec,
  CanvasChartType,
} from '@/types/canvas'

export type CanvasChartSelection = CanvasChartType | 'auto'

export interface ParsedChartInput {
  categoryLabel: string
  series: CanvasChartSeries[]
  data: CanvasChartDatum[]
  sourceFormat: CanvasChartSourceFormat
}

const CHART_TYPES = new Set<CanvasChartType>(['area', 'bar', 'line', 'pie', 'radar', 'radial'])
const DATE_PATTERN = /^(?:\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\d{1,2}[-/.月]\d{1,2}日?|Q[1-4]|第?[一二三四1234]季度)$/i
const PROPORTION_PATTERN = /占比|比例|份额|构成|分布|share|ratio|percentage|percent|composition/i
const PROGRESS_PATTERN = /进度|完成率|达成率|完成度|利用率|progress|completion|achievement|utilization/i
const CONTINUOUS_PATTERN = /累计|累积|总量|存量|趋势|流量|cumulative|total|volume|trend/i

const aiChartSchema = z.object({
  title: z.string().optional().default(''),
  categoryLabel: z.string().optional().default('Category'),
  recommendedType: z.enum(['area', 'bar', 'line', 'pie', 'radar', 'radial']),
  series: z.array(z.object({
    name: z.string().min(1),
  })).min(1).max(5),
  data: z.array(z.object({
    label: z.string().min(1),
    values: z.array(z.number().finite()),
  })).min(1).max(100),
})

const aiChartCollectionSchema = z.object({
  charts: z.array(aiChartSchema).min(1).max(8),
})

export type AiChartPayload = z.infer<typeof aiChartSchema>

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  let source = value.trim()
  if (!source) return null
  const negative = /^\(.*\)$/.test(source)
  source = source.replace(/[(),，\s]/g, '')
  const suffix = source.match(/(万|亿|k|m|b|%)$/i)?.[1]?.toLowerCase()
  if (suffix) source = source.slice(0, -suffix.length)
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(source)) return null
  let number = Number(source)
  if (!Number.isFinite(number)) return null
  if (negative) number *= -1
  if (suffix === '万') number *= 10_000
  if (suffix === '亿') number *= 100_000_000
  if (suffix === 'k') number *= 1_000
  if (suffix === 'm') number *= 1_000_000
  if (suffix === 'b') number *= 1_000_000_000
  return number
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === delimiter && !quoted) {
      cells.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }
  cells.push(value.trim())
  return cells
}

function parseDelimited(source: string, delimiter: string) {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('CHART_NEEDS_HEADER_AND_ROW')
  const headers = splitDelimitedLine(lines[0], delimiter)
  if (headers.length < 2) throw new Error('CHART_NEEDS_TWO_COLUMNS')
  return lines.slice(1).map(line => {
    const cells = splitDelimitedLine(line, delimiter)
    return Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, cells[index] || '']))
  })
}

function parseMarkdownTable(source: string) {
  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length < 3 || !lines[1].replace(/\|/g, '').trim().match(/^:?-{3,}:?(?:\s+:?-{3,}:?)*$/)) {
    throw new Error('CHART_INVALID_MARKDOWN_TABLE')
  }
  const parseRow = (line: string) => line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
  const headers = parseRow(lines[0])
  return lines.slice(2).map(line => {
    const cells = parseRow(line)
    return Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, cells[index] || '']))
  })
}

function parseJsonRows(source: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(source)
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : null
  if (!rows || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
    throw new Error('CHART_JSON_ARRAY_REQUIRED')
  }
  return rows as Array<Record<string, unknown>>
}

function rowsToChartData(
  rows: Array<Record<string, unknown>>,
  sourceFormat: CanvasChartSourceFormat
): ParsedChartInput {
  if (rows.length === 0) return createEmptyChartInput(sourceFormat)
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))]
  const numericHeaders = headers.filter(header => rows.some(row => parseNumericValue(row[header]) !== null))
  const categoryHeader = headers.find(header => !numericHeaders.includes(header))
  const seriesHeaders = (
    numericHeaders.length > 0
      ? numericHeaders.filter(header => header !== categoryHeader)
      : headers.filter(header => header !== categoryHeader)
  ).slice(0, 5)
  if (seriesHeaders.length === 0 && headers[0]) seriesHeaders.push(headers[0])
  if (seriesHeaders.length === 0) return createEmptyChartInput(sourceFormat)
  const series = seriesHeaders.map((name, index) => ({
    id: `series-${index + 1}`,
    name,
    colorIndex: index % 5,
  }))
  const data = rows.map((row, rowIndex) => {
    const values = Object.fromEntries(series.map((item, index) => {
      const value = parseNumericValue(row[seriesHeaders[index]])
      return [item.id, value ?? 0]
    }))
    return {
      label: String(categoryHeader ? row[categoryHeader] ?? '' : '').trim() || String(rowIndex + 1),
      values,
    }
  })
  return { categoryLabel: categoryHeader || 'Category', series, data, sourceFormat }
}

export function createEmptyChartInput(
  sourceFormat: CanvasChartSourceFormat = 'natural-language'
): ParsedChartInput {
  return {
    categoryLabel: 'Category',
    series: [{ id: 'series-1', name: 'Value', colorIndex: 0 }],
    data: [{ label: '—', values: { 'series-1': 0 } }],
    sourceFormat,
  }
}

export function createGeneratedChartTitle(input: ParsedChartInput) {
  const seriesNames = input.series
    .map(series => series.name.trim())
    .filter(name => name && name !== 'Value')
    .join(' / ')
  const categoryLabel = input.categoryLabel.trim()
  if (!seriesNames) return categoryLabel === 'Category' ? '' : categoryLabel
  return categoryLabel === 'Category' ? seriesNames : `${categoryLabel} · ${seriesNames}`
}

export function serializeCanvasChartData(
  chart: Pick<CanvasChartSpec, 'categoryLabel' | 'series' | 'data'>
) {
  const usedKeys = new Set<string>()
  const createUniqueKey = (value: string, fallback: string) => {
    const base = value.trim() || fallback
    let key = base
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${base} ${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    return key
  }
  const categoryKey = createUniqueKey(chart.categoryLabel, 'Category')
  const seriesKeys = new Map(chart.series.map((series, index) => [
    series.id,
    createUniqueKey(series.name, `Series ${index + 1}`),
  ]))
  const rows = chart.data.map(datum => Object.fromEntries([
    [categoryKey, datum.label],
    ...chart.series.map(series => [
      seriesKeys.get(series.id) || series.name,
      Number.isFinite(datum.values[series.id]) ? datum.values[series.id] : 0,
    ]),
  ]))
  return JSON.stringify(rows, null, 2)
}

export function parseChartInput(source: string): ParsedChartInput {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('CHART_EMPTY_INPUT')
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return rowsToChartData(parseJsonRows(trimmed), 'json')
  }
  const lines = trimmed.split(/\r?\n/)
  if (lines.length >= 3 && lines[0].includes('|') && lines[1].includes('-')) {
    return rowsToChartData(parseMarkdownTable(trimmed), 'markdown')
  }
  if (lines.length >= 2 && lines[0].includes('\t')) {
    return rowsToChartData(parseDelimited(trimmed, '\t'), 'tsv')
  }
  if (lines.length >= 2 && lines[0].includes(',')) {
    return rowsToChartData(parseDelimited(trimmed, ','), 'csv')
  }
  throw new Error('CHART_AI_REQUIRED')
}

export function recommendChartType(
  input: ParsedChartInput,
  source: string
): { type: CanvasChartType; recommendation: CanvasChartRecommendation } {
  const labelsAreDates = input.data.length > 1 && input.data.every(item => DATE_PATTERN.test(item.label))
  if (PROGRESS_PATTERN.test(source) && input.series.length === 1
    && input.data.every(item => item.values[input.series[0].id] >= 0 && item.values[input.series[0].id] <= 100)) {
    return { type: 'radial', recommendation: 'progress' }
  }
  if (PROPORTION_PATTERN.test(source) && input.series.length === 1 && input.data.length <= 10
    && input.data.every(item => item.values[input.series[0].id] >= 0)) {
    return { type: 'pie', recommendation: 'proportion' }
  }
  if (labelsAreDates) {
    return CONTINUOUS_PATTERN.test(source)
      ? { type: 'area', recommendation: 'continuous' }
      : { type: 'line', recommendation: 'time-series' }
  }
  if (input.series.length >= 3 && input.data.length >= 3 && input.data.length <= 10) {
    return { type: 'radar', recommendation: 'multidimensional' }
  }
  return { type: 'bar', recommendation: 'categorical' }
}

export function createChartSpec(
  source: string,
  input: ParsedChartInput,
  selection: CanvasChartSelection,
  title = '',
  aiRecommendation?: CanvasChartType
): CanvasChartSpec {
  const recommended = aiRecommendation
    ? { type: aiRecommendation, recommendation: 'ai' as const }
    : recommendChartType(input, source)
  return {
    version: 1,
    type: selection === 'auto' ? recommended.type : selection,
    requestedType: selection,
    recommendedType: recommended.type,
    title: title.trim(),
    categoryLabel: input.categoryLabel,
    series: input.series,
    data: input.data,
    primarySeriesId: input.series[0].id,
    source,
    sourceFormat: input.sourceFormat,
    recommendation: recommended.recommendation,
  }
}

export function parseAiChartPayload(value: unknown, source: string): {
  input: ParsedChartInput
  title: string
  recommendedType: CanvasChartType
} {
  const parsed = aiChartSchema.parse(value)
  const sourceNumbers = extractSourceNumbers(source)
  const outputNumbers = parsed.data.flatMap(item => item.values)
  if (sourceNumbers.length === 0 || outputNumbers.some(value => !sourceNumbers.some(sourceValue => (
    Math.abs(sourceValue - value) <= Math.max(1, Math.abs(value)) * 1e-9
  )))) {
    throw new Error('CHART_AI_ADDED_VALUE')
  }
  if (parsed.data.some(item => item.values.length !== parsed.series.length)) {
    throw new Error('CHART_AI_SERIES_MISMATCH')
  }
  const series = parsed.series.map((item, index) => ({
    id: `series-${index + 1}`,
    name: item.name,
    colorIndex: index % 5,
  }))
  return {
    title: parsed.title,
    recommendedType: parsed.recommendedType,
    input: {
      categoryLabel: parsed.categoryLabel,
      series,
      data: parsed.data.map(item => ({
        label: item.label,
        values: Object.fromEntries(series.map((seriesItem, index) => [seriesItem.id, item.values[index]])),
      })),
      sourceFormat: 'natural-language',
    },
  }
}

export function parseAiChartCollection(value: unknown, source: string) {
  return aiChartCollectionSchema.parse(value).charts.map(chart => (
    parseAiChartPayload(chart, source)
  ))
}

function extractSourceNumbers(source: string) {
  const matches = source.match(/[+-]?(?:\d[\d,，]*(?:\.\d+)?|\.\d+)\s*(?:万|亿|[kmb]|%)?/gi) || []
  return matches.map(value => parseNumericValue(value)).filter((value): value is number => value !== null)
}

export function parseJsonFromAiResponse(content: string): unknown {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('CHART_AI_INVALID_JSON')
  return JSON.parse(normalized.slice(start, end + 1))
}

export function isCanvasChartType(value: string): value is CanvasChartType {
  return CHART_TYPES.has(value as CanvasChartType)
}
