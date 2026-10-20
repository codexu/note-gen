export type CanvasProjectType =
  | 'blank'
  | 'flowchart'
  | 'mindmap'
  | 'timeline'
  | 'quadrant'
  | 'kanban'
  | 'swot'

export type CanvasTool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'rectangle'
  | 'text'
  | 'connector'

export type CanvasNodeType =
  | 'process'
  | 'decision'
  | 'terminator'
  | 'input-output'
  | 'document'
  | 'multi-document'
  | 'database'
  | 'predefined-process'
  | 'manual-input'
  | 'preparation'
  | 'delay'
  | 'display'
  | 'connector'
  | 'off-page-connector'
  | 'internal-storage'
  | 'stored-data'
  | 'text'
  | 'note'
  | 'record'
  | 'image'
  | 'link'
  | 'todo'
  | 'group'
  | 'freehand'
  | 'chart'

export type CanvasChartType =
  | 'area'
  | 'bar'
  | 'line'
  | 'pie'
  | 'radar'
  | 'radial'

export type CanvasChartSourceFormat =
  | 'csv'
  | 'tsv'
  | 'markdown'
  | 'json'
  | 'natural-language'

export type CanvasChartRecommendation =
  | 'time-series'
  | 'continuous'
  | 'proportion'
  | 'progress'
  | 'multidimensional'
  | 'categorical'
  | 'ai'

export interface CanvasChartSeries {
  id: string
  name: string
  colorIndex: number
}

export interface CanvasChartDatum {
  label: string
  values: Record<string, number>
}

export interface CanvasChartRequest {
  title: string
  titleMode?: 'auto' | 'manual'
  source: string
  notePaths?: string[]
  requestedType: CanvasChartType | 'auto'
}

export type CanvasChartVariant = 'card' | 'minimal' | 'transparent'

export type CanvasChartPalette = 'system' | 'cool' | 'warm' | 'monochrome'

export interface CanvasChartAppearance {
  variant: CanvasChartVariant
  palette: CanvasChartPalette
  showTitle: boolean
  showLegend: boolean
  showGrid: boolean
  showXAxis: boolean
  showYAxis: boolean
}

export interface CanvasChartSpec {
  version: 1
  type: CanvasChartType
  requestedType: CanvasChartType | 'auto'
  recommendedType: CanvasChartType
  title: string
  categoryLabel: string
  series: CanvasChartSeries[]
  data: CanvasChartDatum[]
  primarySeriesId: string
  source: string
  sourceFormat: CanvasChartSourceFormat
  recommendation: CanvasChartRecommendation
}

export interface CanvasPoint {
  x: number
  y: number
  pressure: number
}

export interface CanvasNodeData extends Record<string, unknown> {
  label?: string
  description?: string
  color?: string
  borderStyle?: 'solid' | 'dashed' | 'dotted'
  borderWidth?: number
  fillColor?: string
  fillStyle?: 'default' | 'tint'
  strokeWidth?: number
  pathStrokeWidth?: number
  opacity?: number
  points?: CanvasPoint[]
  path?: string
  width?: number
  height?: number
  drawingTool?: 'pen' | 'highlighter'
  filePath?: string
  recordId?: number
  recordType?: 'scan' | 'text' | 'image' | 'link' | 'file' | 'recording' | 'todo'
  imagePath?: string
  url?: string
  checked?: boolean
  childIds?: string[]
  chart?: CanvasChartSpec
  chartRequest?: CanvasChartRequest
  chartRequestId?: string
  chartBatchId?: string
  chartBatchIndex?: number
  chartStatus?: 'loading' | 'ready' | 'error'
  chartError?: string
  chartAppearance?: CanvasChartAppearance
  locked?: boolean
  previewState?: 'add' | 'update' | 'delete'
}

export interface CanvasNode {
  id: string
  type: CanvasNodeType
  position: { x: number; y: number }
  data: CanvasNodeData
  width?: number
  height?: number
  selected?: boolean
  draggable?: boolean
  connectable?: boolean
  zIndex?: number
}

export interface CanvasEdge {
  id: string
  source: string
  target: string
  label?: string
  type?: string
}

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

export interface CanvasDocument {
  schemaVersion: 1
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
  settings: {
    layoutDirection: 'TB' | 'LR'
    showGrid: boolean
    snapToGrid: boolean
  }
}

export interface CanvasHistorySnapshot {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
}

export interface CanvasHistoryState {
  undo: CanvasHistorySnapshot[]
  redo: CanvasHistorySnapshot[]
}

export interface CanvasCustomComponent {
  id: string
  name: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  createdAt: number
}

export interface CanvasSelectionContext {
  canvasId: string
  canvasTitle: string
  scope: 'canvas' | 'selection'
  nodes: Array<{
    id: string
    type: CanvasNodeType
    label: string
    description?: string
    filePath?: string
    recordId?: number
    url?: string
    checked?: boolean
    chart?: CanvasChartSpec
  }>
  edges: Array<{
    id: string
    source: string
    target: string
    label?: string
  }>
}

export interface CanvasProject {
  id: string
  title: string
  canvasType: CanvasProjectType
  schemaVersion: number
  document: CanvasDocument
  history?: CanvasHistoryState
  thumbnailPath?: string | null
  thumbnailRevision?: number
  createdAt: number
  updatedAt: number
  pinnedAt?: number | null
  deletedAt?: number | null
}

export interface CanvasProjectRow {
  id: string
  title: string
  canvasType: CanvasProjectType
  schemaVersion: number
  content: string
  undoStack?: string | null
  redoStack?: string | null
  thumbnailPath?: string | null
  createdAt: number
  updatedAt: number
  pinnedAt?: number | null
  deletedAt?: number | null
}

export const DEFAULT_CANVAS_DOCUMENT: CanvasDocument = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {
    layoutDirection: 'TB',
    showGrid: true,
    snapToGrid: false,
  },
}

export function normalizeCanvasDocument(value: unknown): CanvasDocument {
  if (!value || typeof value !== 'object') {
    return structuredClone(DEFAULT_CANVAS_DOCUMENT)
  }

  const candidate = value as Partial<CanvasDocument>
  return {
    schemaVersion: 1,
    nodes: Array.isArray(candidate.nodes) ? candidate.nodes : [],
    edges: Array.isArray(candidate.edges) ? candidate.edges : [],
    viewport: candidate.viewport || { x: 0, y: 0, zoom: 1 },
    settings: {
      ...DEFAULT_CANVAS_DOCUMENT.settings,
      ...(candidate.settings || {}),
    },
  }
}
