import { DEFAULT_CANVAS_DOCUMENT, type CanvasDocument, type CanvasNode, type CanvasNodeType } from '@/types/canvas'
import { isCanvasFlowchartNodeType } from '@/lib/canvas/shapes'

const NODE_START = /\s*([A-Za-z_](?:\w|-(?!-))*)\s*(\(\[|\[\(|\[\/|\[|\{|\()?/y
const NODE_SHAPES = new Map<string, { type: CanvasNodeType; labelPattern: RegExp }>([
  ['([', { type: 'terminator', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\]\)/y }],
  ['{', { type: 'decision', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\}/y }],
  ['[(', { type: 'database', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\)\]/y }],
  ['[/', { type: 'input-output', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\/\]/y }],
  ['[', { type: 'process', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\]/y }],
  ['(', { type: 'terminator', labelPattern: /(\s*"[^"]*"\s*|[^()[\]{}"]*)\)/y }],
])
const EDGE_PATTERN = /\s*(?:-->|---|==>|--(\s*"[^"]*"\s*|(?:#\w+;|(?!%%)[^>";])+?)-->)\s*(?:\|(\s*"[^"]*"\s*|[^|"]*)\|)?/y
const STATEMENT_END = /\s*(?:;|%%[\s\S]*|$)/y

const LABEL_ENTITIES: Record<string, string> = { '#quot;': '"', '#34;': '"', '#35;': '#', '#60;': '<', '#13;': '\r' }

const PARSE_ERROR_MESSAGES = {
  header: 'Only Mermaid flowchart/graph syntax is supported',
  empty: 'No Mermaid nodes found',
}

export class MermaidCanvasParseError extends Error {
  constructor(readonly reason: 'syntax' | 'header' | 'empty', readonly lineNumber?: number) {
    super(reason === 'syntax'
      ? `Unsupported or invalid Mermaid syntax on line ${lineNumber}`
      : PARSE_ERROR_MESSAGES[reason])
  }
}

function matchAt(pattern: RegExp, line: string, offset: number) {
  pattern.lastIndex = offset
  return pattern.exec(line)
}

function cleanLabel(value: string, allowSingleQuotes = false) {
  const trimmed = value.trim()
  const quote = trimmed[0]
  const isQuoted = (quote === '"' || (allowSingleQuotes && quote === "'")) && trimmed.endsWith(quote)
  const text = isQuoted ? trimmed.slice(1, -1) : trimmed
  return text.replace(/<br\s*\/?>|#(?:quot|34|35|60|13);/gi, token => LABEL_ENTITIES[token.toLowerCase()] ?? '\n')
}

function parseNode(line: string, offset: number, lineNumber: number) {
  const start = matchAt(NODE_START, line, offset)
  if (!start) throw new MermaidCanvasParseError('syntax', lineNumber)

  const [token, id, shapeName] = start
  const labelOffset = offset + token.length
  const shape = NODE_SHAPES.get(shapeName)
  if (!shape) return { id, type: 'process' as const, label: id, explicit: false, end: labelOffset }

  const label = matchAt(shape.labelPattern, line, labelOffset)
  if (!label) throw new MermaidCanvasParseError('syntax', lineNumber)
  return { id, type: shape.type, label: cleanLabel(label[1] || id, true), explicit: true, end: labelOffset + label[0].length }
}

export function mermaidToCanvasDocument(source: string): CanvasDocument {
  const lines = source.split(/\r\n?|\n/)
  const typeOverrides = new Map<string, CanvasNodeType>()
  for (const line of lines) {
    const match = line.trim().match(/^%%\s*notegen-type\s+([A-Za-z_][\w-]*)\s+([\w-]+)$/)
    if (match && isCanvasFlowchartNodeType(match[2])) {
      typeOverrides.set(match[1], match[2])
    }
  }
  const headerIndex = lines.findIndex(line => {
    const text = line.trim()
    return text.length > 0 && !text.startsWith('%%')
  })
  const header = lines[headerIndex]?.match(/^\s*(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)\s*(?=;|%%|$)/i)
  if (!header) throw new MermaidCanvasParseError('header')
  const direction = ['LR', 'RL'].includes(header[1].toUpperCase()) ? 'LR' : 'TB'
  const nodes = new Map<string, Omit<CanvasNode, 'position'>>()
  const edges: CanvasDocument['edges'] = []

  const register = ({ id, type, label, explicit }: ReturnType<typeof parseNode>) => {
    if (explicit || !nodes.has(id)) {
      nodes.set(id, { id, type: typeOverrides.get(id) ?? type, data: { label } })
    }
  }

  for (let index = headerIndex; index < lines.length; index++) {
    const line = lines[index]
    const lineNumber = index + 1
    let offset = index === headerIndex ? header[0].length : 0
    while (offset < line.length) {
      const separator = matchAt(STATEMENT_END, line, offset)
      if (separator) {
        offset += separator[0].length
        continue
      }

      let node = parseNode(line, offset, lineNumber)
      register(node)
      while (!matchAt(STATEMENT_END, line, node.end)) {
        const edge = matchAt(EDGE_PATTERN, line, node.end)
        if (!edge) throw new MermaidCanvasParseError('syntax', lineNumber)

        const target = parseNode(line, node.end + edge[0].length, lineNumber)
        register(target)
        const [, inlineLabel, pipeLabel] = edge
        const label = cleanLabel(pipeLabel ?? inlineLabel ?? '')
        edges.push({ id: crypto.randomUUID(), source: node.id, target: target.id, ...(label ? { label } : {}), type: 'smoothstep' })
        node = target
      }
      offset = node.end
    }
  }

  if (nodes.size === 0) throw new MermaidCanvasParseError('empty')
  const indegree = new Map([...nodes.keys()].map(id => [id, 0]))
  const outgoing = new Map([...nodes.keys()].map(id => [id, [] as string[]]))
  edges.forEach(edge => {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  })
  const level = new Map<string, number>()
  const queue = [...nodes.keys()].filter(id => (indegree.get(id) || 0) === 0)
  queue.forEach(id => level.set(id, 0))
  while (queue.length) {
    const id = queue.shift()!
    for (const target of outgoing.get(id) || []) {
      level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1))
      indegree.set(target, (indegree.get(target) || 1) - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  }
  let fallbackLevel = Math.max(-1, ...level.values()) + 1
  const columns = new Map<number, number>()
  const positioned = [...nodes.values()].map(node => {
    const nodeLevel = level.get(node.id) ?? fallbackLevel++
    const order = columns.get(nodeLevel) || 0
    columns.set(nodeLevel, order + 1)
    const primary = nodeLevel * 260
    const secondary = order * 150
    return { ...node, position: direction === 'LR' ? { x: primary, y: secondary } : { x: secondary, y: primary } }
  })

  return {
    ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
    nodes: positioned,
    edges,
    settings: { ...DEFAULT_CANVAS_DOCUMENT.settings, layoutDirection: direction },
  }
}

function escapeLabel(value: string) {
  return value.replace(/#/g, '#35;').replace(/"/g, '#quot;').replace(/</g, '#60;').replace(/\r/g, '#13;').replace(/\n/g, '<br/>')
}

export function canvasDocumentToMermaid(document: CanvasDocument): string {
  const direction = document.settings.layoutDirection
  const visibleNodes = document.nodes.filter(node => node.type !== 'freehand' && node.type !== 'group')
  const aliases = new Map(visibleNodes.map((node, index) => [node.id, `node_${index + 1}`]))
  const nodeLines = visibleNodes
    .flatMap(node => {
      const id = aliases.get(node.id)!
      const label = escapeLabel(String(node.data.label || node.id))
      const metadata = `  %% notegen-type ${id} ${node.type}`
      if (node.type === 'decision') return [metadata, `  ${id}{"${label}"}`]
      if (node.type === 'terminator') return [metadata, `  ${id}(["${label}"])`]
      if (node.type === 'input-output') return [metadata, `  ${id}[/"${label}"/]`]
      if (node.type === 'database' || node.type === 'stored-data') return [metadata, `  ${id}[("${label}")]`]
      return [metadata, `  ${id}["${label}"]`]
    })
  const edgeLines = document.edges
    .filter(edge => aliases.has(edge.source) && aliases.has(edge.target))
    .map(edge => {
      const label = edge.label ? `|"${escapeLabel(edge.label)}"|` : ''
      return `  ${aliases.get(edge.source)} -->${label} ${aliases.get(edge.target)}`
    })
  return [`flowchart ${direction}`, ...nodeLines, ...edgeLines].join('\n')
}
