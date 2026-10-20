import {
  getCanvasChartColors,
  resolveCanvasChartAppearance,
} from '@/lib/canvas/chart-appearance'
import type {
  CanvasChartAppearance,
  CanvasChartSpec,
  CanvasDocument,
  CanvasNode,
} from '@/types/canvas'
import { getCanvasNodeDefaultSize, isCanvasFlowchartNodeType } from '@/lib/canvas/shapes'

const PADDING = 64

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function getNodeSize(node: CanvasNode) {
  if (node.type === 'freehand') return { width: node.width || node.data.width || 4, height: node.height || node.data.height || 4 }
  if (node.type === 'note' || node.type === 'record' || node.type === 'image' || node.type === 'link' || node.type === 'todo') {
    return { width: node.width || 220, height: node.height || 76 }
  }
  const fallback = getCanvasNodeDefaultSize(node.type)
  return { width: node.width || fallback.width, height: node.height || fallback.height }
}

function renderCenteredText(label: string, x: number, y: number, options: { size?: number; fill?: string } = {}) {
  const lines = label.split('\n').slice(0, 5)
  const lineHeight = (options.size || 14) + 3
  const startY = y - ((lines.length - 1) * lineHeight) / 2
  return `<text x="${x}" y="${startY}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${options.size || 14}" fill="${options.fill || '#18181b'}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${line}</tspan>`).join('')}</text>`
}

function renderFlowchartShape(
  type: CanvasNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  fillOpacity: number,
  stroke: string,
  borderWidth: number,
  dashArray: string,
  label: string
) {
  const attributes = `fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${borderWidth}" vector-effect="non-scaling-stroke"${dashArray}`
  const outline = (() => {
    if (type === 'process') return `<rect x="1" y="1" width="198" height="98" rx="8" ${attributes}/>`
    if (type === 'decision') return `<polygon points="100,1 199,50 100,99 1,50" ${attributes}/>`
    if (type === 'terminator') return `<rect x="1" y="1" width="198" height="98" rx="49" ${attributes}/>`
    if (type === 'input-output') return `<polygon points="24,1 199,1 176,99 1,99" ${attributes}/>`
    if (type === 'document') return `<path d="M1 1H199V80C160 60 132 100 99 81C65 61 35 100 1 82Z" ${attributes}/>`
    if (type === 'multi-document') return `<path d="M15 1H199V73C163 57 137 90 106 75C76 60 49 90 15 75Z" ${attributes}/><path d="M8 9H192V81C156 65 130 98 99 83C69 68 42 98 8 83Z" ${attributes}/><path d="M1 17H185V89C149 73 123 106 92 91C62 76 35 106 1 91Z" ${attributes}/>`
    if (type === 'predefined-process') return `<rect x="1" y="1" width="198" height="98" rx="6" ${attributes}/><path d="M24 1V99M176 1V99" fill="none" stroke="${stroke}" stroke-width="${borderWidth}"${dashArray}/>`
    if (type === 'manual-input') return `<polygon points="1,25 199,1 199,99 1,99" ${attributes}/>`
    if (type === 'preparation') return `<polygon points="28,1 172,1 199,50 172,99 28,99 1,50" ${attributes}/>`
    if (type === 'delay') return `<path d="M1 1H126C167 1 199 23 199 50S167 99 126 99H1Z" ${attributes}/>`
    if (type === 'display') return `<path d="M25 1H132C174 1 199 23 199 50S174 99 132 99H25C43 75 43 25 25 1Z" ${attributes}/>`
    if (type === 'connector') return `<ellipse cx="100" cy="50" rx="49" ry="49" ${attributes}/>`
    if (type === 'off-page-connector') return `<polygon points="1,1 199,1 199,66 100,99 1,66" ${attributes}/>`
    if (type === 'internal-storage') return `<rect x="1" y="1" width="198" height="98" rx="4" ${attributes}/><path d="M28 1V99M1 24H199" fill="none" stroke="${stroke}" stroke-width="${borderWidth}"${dashArray}/>`
    if (type === 'database') return `<path d="M1 17C1 8 45 1 100 1S199 8 199 17V83C199 92 155 99 100 99S1 92 1 83Z" ${attributes}/><ellipse cx="100" cy="17" rx="99" ry="16" fill="none" stroke="${stroke}" stroke-width="${borderWidth}"${dashArray}/>`
    return `<path d="M24 1H176C207 20 207 80 176 99H24C-7 80-7 20 24 1Z" ${attributes}/>`
  })()
  return `<g><svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 200 100" preserveAspectRatio="none" overflow="visible">${outline}</svg>${renderCenteredText(label, x + width / 2, y + height / 2)}</g>`
}

function chartValueRange(spec: CanvasChartSpec) {
  const values = spec.data.flatMap(item => spec.series.map(series => item.values[series.id]))
  const minimum = Math.min(0, ...values)
  const maximum = Math.max(0, ...values)
  return { minimum, maximum: maximum === minimum ? minimum + 1 : maximum }
}

function renderChartLegend(labels: string[], colors: string[], width: number, height: number) {
  if (labels.length === 0) return ''
  const entries = labels.slice(0, 5)
  const itemWidth = width / entries.length
  return entries.map((label, index) => {
    const x = itemWidth * index + itemWidth / 2
    return `<g transform="translate(${x - 32} ${height - 13})"><rect width="8" height="8" rx="2" fill="${colors[index % colors.length]}"/><text x="12" y="8" font-family="sans-serif" font-size="10" fill="#52525b">${escapeXml(label.slice(0, 10))}</text></g>`
  }).join('')
}

function renderCartesianChart(
  spec: CanvasChartSpec,
  appearance: CanvasChartAppearance,
  width: number,
  height: number
) {
  const colors = getCanvasChartColors(appearance.palette, true)
  const left = appearance.showYAxis ? 48 : 18
  const right = 18
  const top = appearance.showTitle && spec.title ? 42 : 22
  const legendHeight = appearance.showLegend ? 24 : 0
  const bottom = (appearance.showXAxis ? 34 : 16) + legendHeight
  const plotWidth = Math.max(1, width - left - right)
  const plotHeight = Math.max(1, height - top - bottom)
  const { minimum, maximum } = chartValueRange(spec)
  const scaleY = (value: number) => top + plotHeight - ((value - minimum) / (maximum - minimum)) * plotHeight
  const baseline = scaleY(0)
  const grid = [0, 0.25, 0.5, 0.75, 1].map(ratio => {
    const y = top + plotHeight * ratio
    const value = maximum - (maximum - minimum) * ratio
    const line = appearance.showGrid
      ? `<line x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}" stroke="#d4d4d8" stroke-opacity=".55"/>`
      : ''
    const label = appearance.showYAxis
      ? `<text x="${left - 6}" y="${y + 4}" text-anchor="end" font-family="sans-serif" font-size="10" fill="#71717a">${Number(value.toFixed(2))}</text>`
      : ''
    return `${line}${label}`
  }).join('')
  const labels = appearance.showXAxis ? spec.data.map((item, index) => {
    const x = left + plotWidth * ((index + 0.5) / spec.data.length)
    return `<text x="${x}" y="${height - legendHeight - 12}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#71717a">${escapeXml(item.label.slice(0, 12))}</text>`
  }).join('') : ''
  let marks = ''
  if (spec.type === 'bar') {
    const groupWidth = plotWidth / spec.data.length
    const barWidth = Math.max(2, Math.min(28, groupWidth * 0.72 / spec.series.length))
    marks = spec.data.flatMap((item, dataIndex) => spec.series.map((series, seriesIndex) => {
      const value = item.values[series.id]
      const y = scaleY(value)
      const x = left + dataIndex * groupWidth + (groupWidth - barWidth * spec.series.length) / 2 + seriesIndex * barWidth
      return `<rect x="${x}" y="${Math.min(y, baseline)}" width="${Math.max(1, barWidth - 2)}" height="${Math.max(1, Math.abs(baseline - y))}" rx="3" fill="${colors[series.colorIndex % colors.length]}"/>`
    })).join('')
  } else {
    marks = spec.series.map(series => {
      const points = spec.data.map((item, index) => {
        const x = left + plotWidth * ((index + 0.5) / spec.data.length)
        return `${x},${scaleY(item.values[series.id])}`
      })
      const color = colors[series.colorIndex % colors.length]
      const fill = spec.type === 'area'
        ? `<polygon points="${left + plotWidth * (0.5 / spec.data.length)},${baseline} ${points.join(' ')} ${left + plotWidth * ((spec.data.length - 0.5) / spec.data.length)},${baseline}" fill="${color}" fill-opacity=".18"/>`
        : ''
      return `${fill}<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
    }).join('')
  }
  const baselineLine = appearance.showXAxis
    ? `<line x1="${left}" y1="${baseline}" x2="${left + plotWidth}" y2="${baseline}" stroke="#a1a1aa"/>`
    : ''
  const legend = appearance.showLegend
    ? renderChartLegend(spec.series.map(series => series.name), colors, width, height)
    : ''
  return `${grid}${baselineLine}${marks}${labels}${legend}`
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + Math.cos(angle - Math.PI / 2) * radius,
    y: cy + Math.sin(angle - Math.PI / 2) * radius,
  }
}

function arcPath(cx: number, cy: number, innerRadius: number, outerRadius: number, start: number, end: number) {
  const outerStart = polarPoint(cx, cy, outerRadius, start)
  const outerEnd = polarPoint(cx, cy, outerRadius, end)
  const innerEnd = polarPoint(cx, cy, innerRadius, end)
  const innerStart = polarPoint(cx, cy, innerRadius, start)
  const largeArc = end - start > Math.PI ? 1 : 0
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`
}

function renderPolarChart(
  spec: CanvasChartSpec,
  appearance: CanvasChartAppearance,
  width: number,
  height: number
) {
  const colors = getCanvasChartColors(appearance.palette, true)
  const top = appearance.showTitle && spec.title ? 38 : 16
  const legendHeight = appearance.showLegend ? 24 : 0
  const availableHeight = height - top - 20 - legendHeight
  const cx = width / 2
  const cy = top + availableHeight / 2
  const radius = Math.max(20, Math.min(width * 0.32, availableHeight * 0.4))
  if (spec.type === 'radar') {
    const maximum = Math.max(1, ...spec.data.flatMap(item => spec.series.map(series => Math.abs(item.values[series.id]))))
    const grid = appearance.showGrid ? [0.25, 0.5, 0.75, 1].map(scale => {
      const points = spec.data.map((_item, index) => {
        const point = polarPoint(cx, cy, radius * scale, index / spec.data.length * Math.PI * 2)
        return `${point.x},${point.y}`
      }).join(' ')
      return `<polygon points="${points}" fill="none" stroke="#d4d4d8"/>`
    }).join('') : ''
    const axes = spec.data.map((item, index) => {
      const point = polarPoint(cx, cy, radius, index / spec.data.length * Math.PI * 2)
      const label = polarPoint(cx, cy, radius + 16, index / spec.data.length * Math.PI * 2)
      const line = appearance.showGrid
        ? `<line x1="${cx}" y1="${cy}" x2="${point.x}" y2="${point.y}" stroke="#d4d4d8"/>`
        : ''
      const text = appearance.showXAxis
        ? `<text x="${label.x}" y="${label.y + 3}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#71717a">${escapeXml(item.label.slice(0, 10))}</text>`
        : ''
      return `${line}${text}`
    }).join('')
    const series = spec.series.map(item => {
      const points = spec.data.map((datum, index) => {
        const valueRadius = radius * Math.abs(datum.values[item.id]) / maximum
        const point = polarPoint(cx, cy, valueRadius, index / spec.data.length * Math.PI * 2)
        return `${point.x},${point.y}`
      }).join(' ')
      const color = colors[item.colorIndex % colors.length]
      return `<polygon points="${points}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-width="2"/>`
    }).join('')
    const legend = appearance.showLegend
      ? renderChartLegend(spec.series.map(series => series.name), colors, width, height)
      : ''
    return `${grid}${axes}${series}${legend}`
  }
  const primary = spec.series.find(series => series.id === spec.primarySeriesId) || spec.series[0]
  const values = spec.data.map(item => Math.max(0, item.values[primary.id]))
  if (spec.type === 'pie') {
    const total = values.reduce((sum, value) => sum + value, 0) || 1
    let angle = 0
    const marks = values.map((value, index) => {
      const nextAngle = angle + value / total * Math.PI * 2
      const path = arcPath(cx, cy, radius * 0.42, radius, angle, Math.max(angle + 0.001, nextAngle - 0.02))
      angle = nextAngle
      return `<path d="${path}" fill="${colors[index % colors.length]}"/>`
    }).join('')
    const legend = appearance.showLegend
      ? renderChartLegend(spec.data.map(item => item.label), colors, width, height)
      : ''
    return `${marks}${legend}`
  }
  const maximum = Math.max(100, ...values)
  const ringWidth = Math.max(6, radius / Math.max(5, values.length + 1))
  const marks = values.map((value, index) => {
    const ringRadius = radius - index * ringWidth
    const end = Math.max(0.001, value / maximum * Math.PI * 2)
    const background = arcPath(cx, cy, ringRadius - ringWidth * 0.7, ringRadius, 0, Math.PI * 2 - 0.001)
    const foreground = arcPath(cx, cy, ringRadius - ringWidth * 0.7, ringRadius, 0, end)
    return `<path d="${background}" fill="#e4e4e7"/><path d="${foreground}" fill="${colors[index % colors.length]}"/>`
  }).join('')
  const legend = appearance.showLegend
    ? renderChartLegend(spec.data.map(item => item.label), colors, width, height)
    : ''
  return `${marks}${legend}`
}

function renderChartNode(
  spec: CanvasChartSpec,
  appearanceValue: CanvasNode['data']['chartAppearance'],
  x: number,
  y: number,
  width: number,
  height: number
) {
  const appearance = resolveCanvasChartAppearance(appearanceValue)
  const title = appearance.showTitle && spec.title
    ? `<text x="${width / 2}" y="24" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#18181b">${escapeXml(spec.title)}</text>`
    : ''
  const chart = ['bar', 'line', 'area'].includes(spec.type)
    ? renderCartesianChart(spec, appearance, width, height)
    : renderPolarChart(spec, appearance, width, height)
  const shell = appearance.variant === 'card'
    ? `<rect width="${width}" height="${height}" rx="12" fill="#ffffff" stroke="#d4d4d8"/>`
    : appearance.variant === 'minimal'
      ? `<rect width="${width}" height="${height}" rx="8" fill="#ffffff" fill-opacity=".92"/>`
      : ''
  return `<g transform="translate(${x} ${y})">${shell}${title}${chart}</g>`
}

function renderNode(node: CanvasNode, offsetX: number, offsetY: number) {
  const { width, height } = getNodeSize(node)
  const x = node.position.x + offsetX
  const y = node.position.y + offsetY
  const label = escapeXml(node.data.label || '')
  const accentColor = escapeXml(node.data.color || '#a1a1aa')
  const borderWidth = node.data.borderWidth || 1
  const dashArray = node.data.borderStyle === 'dashed'
    ? ' stroke-dasharray="8 6"'
    : node.data.borderStyle === 'dotted'
      ? ' stroke-dasharray="2 5"'
      : ''
  const explicitFillColor = node.data.fillColor
  const nodeFill = explicitFillColor && explicitFillColor !== 'transparent'
    ? escapeXml(explicitFillColor)
    : node.data.fillStyle === 'tint' && node.data.color
      ? accentColor
      : '#ffffff'
  const nodeFillOpacity = explicitFillColor
    ? explicitFillColor === 'transparent' ? 0 : 1
    : node.data.fillStyle === 'tint' ? 0.14 : 0.94
  if (node.type === 'freehand') {
    const pathStrokeWidth = node.data.pathStrokeWidth ?? node.data.strokeWidth
    const widthAdjustment = typeof pathStrokeWidth === 'number' && typeof node.data.strokeWidth === 'number'
      ? (node.data.strokeWidth - pathStrokeWidth) / 2
      : 0
    const filterRadius = Math.abs(widthAdjustment)
    const filterId = `freehand-width-${escapeXml(node.id)}`
    const color = escapeXml(node.data.color || '#18181b')
    const opacity = node.data.opacity ?? 1
    const filter = filterRadius > 0
      ? `<defs><filter id="${filterId}" x="${-filterRadius * 2}" y="${-filterRadius * 2}" width="${width + filterRadius * 4}" height="${height + filterRadius * 4}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feMorphology in="SourceAlpha" operator="${widthAdjustment > 0 ? 'dilate' : 'erode'}" radius="${filterRadius}" result="adjusted"/><feFlood flood-color="${color}" flood-opacity="${opacity}" result="paint"/><feComposite in="paint" in2="adjusted" operator="in"/></filter></defs>`
      : ''
    return `<g transform="translate(${x} ${y})">${filter}<path d="${escapeXml(node.data.path || '')}" fill="${color}" fill-opacity="${filterRadius > 0 ? 1 : opacity}"${filterRadius > 0 ? ` filter="url(#${filterId})"` : ''}/></g>`
  }
  if (node.type === 'group') {
    const groupDashArray = node.data.borderStyle ? dashArray : ' stroke-dasharray="8 6"'
    const groupFill = explicitFillColor && explicitFillColor !== 'transparent'
      ? escapeXml(explicitFillColor)
      : node.data.fillStyle === 'tint'
        ? accentColor
        : '#71717a'
    const groupFillOpacity = explicitFillColor
      ? explicitFillColor === 'transparent' ? 0 : 1
      : 0.1
    return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="16" fill="${groupFill}" fill-opacity="${groupFillOpacity}" stroke="${accentColor}" stroke-width="${borderWidth}"${groupDashArray}/><text x="${x + 16}" y="${y + 26}" font-family="sans-serif" font-size="14" font-weight="600" fill="#52525b">${label}</text></g>`
  }
  if (node.type === 'chart' && node.data.chart) {
    return renderChartNode(node.data.chart, node.data.chartAppearance, x, y, width, height)
  }
  if (isCanvasFlowchartNodeType(node.type)) {
    return renderFlowchartShape(
      node.type,
      x,
      y,
      width,
      height,
      nodeFill,
      nodeFillOpacity,
      accentColor,
      borderWidth,
      dashArray,
      label
    )
  }
  if (node.type === 'text') {
    return renderCenteredText(label, x + width / 2, y + height / 2, {
      fill: escapeXml(node.data.color || '#52525b'),
    })
  }
  const radius = 10
  const subtitle = node.type === 'note'
    ? node.data.filePath
    : node.type === 'record'
      ? node.data.recordType
      : node.type === 'link'
        ? node.data.url
        : node.type === 'todo'
          ? (node.data.checked ? '✓' : '○')
          : ''
  return `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${nodeFill}" fill-opacity="${nodeFillOpacity}" stroke="${accentColor}" stroke-width="${borderWidth}"${dashArray}/><text x="${x + width / 2}" y="${y + height / 2 - (subtitle ? 5 : -5)}" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#18181b">${label}</text>${subtitle ? `<text x="${x + width / 2}" y="${y + height / 2 + 15}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#71717a">${escapeXml(String(subtitle))}</text>` : ''}</g>`
}

export function canvasDocumentToSvg(document: CanvasDocument) {
  const allNodes = document.nodes
  if (allNodes.length === 0) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"></svg>'
  }
  const boxes = allNodes.map(node => ({ node, ...getNodeSize(node) }))
  const minX = Math.min(...boxes.map(item => item.node.position.x))
  const minY = Math.min(...boxes.map(item => item.node.position.y))
  const maxX = Math.max(...boxes.map(item => item.node.position.x + item.width))
  const maxY = Math.max(...boxes.map(item => item.node.position.y + item.height))
  const width = Math.max(800, Math.ceil(maxX - minX + PADDING * 2))
  const height = Math.max(500, Math.ceil(maxY - minY + PADDING * 2))
  const offsetX = PADDING - minX
  const offsetY = PADDING - minY
  const nodeMap = new Map(boxes.map(item => [item.node.id, item]))
  const edges = document.edges.map(edge => {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) return ''
    const x1 = source.node.position.x + source.width / 2 + offsetX
    const y1 = source.node.position.y + source.height / 2 + offsetY
    const x2 = target.node.position.x + target.width / 2 + offsetX
    const y2 = target.node.position.y + target.height / 2 + offsetY
    return `<g><path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="#71717a" stroke-width="1.5" marker-end="url(#arrow)"/>${edge.label ? `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#52525b">${escapeXml(edge.label)}</text>` : ''}</g>`
  }).join('')
  const originalIndex = new Map(allNodes.map((node, index) => [node.id, index]))
  const nodes = [...allNodes]
    .sort((left, right) => (
      (left.zIndex ?? 0) - (right.zIndex ?? 0)
      || (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0)
    ))
    .map(node => renderNode(node, offsetX, offsetY))
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#71717a"/></marker></defs>${edges}${nodes}</svg>`
}

export async function canvasDocumentToPngFile(
  document: CanvasDocument,
  fileName: string,
  options: { maxDimension?: number; scale?: number } = {}
) {
  const svg = canvasDocumentToSvg(document)
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const maxDimension = options.maxDimension || 4096
    const scale = Math.min(options.scale || 2, maxDimension / Math.max(image.width, image.height))
    const canvas = globalThis.document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to create canvas renderer')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Unable to encode PNG')), 'image/png')
    })
    return new File([pngBlob], fileName, { type: 'image/png' })
  } finally {
    URL.revokeObjectURL(url)
  }
}
