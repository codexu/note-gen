import { DEFAULT_CANVAS_DOCUMENT, type CanvasDocument, type CanvasNode, type CanvasNodeType } from '@/types/canvas'
import { isCanvasFlowchartNodeType } from '@/lib/canvas/shapes'

const NODE_PATTERN = /^([A-Za-z_][\w-]*)\s*(?:\(\[([\s\S]*?)\]\)|\{([\s\S]*?)\}|\[([\s\S]*?)\]|\(([\s\S]*?)\))?$/

function cleanLabel(value: string | undefined, fallback: string) {
  return (value || fallback).trim().replace(/^['"]|['"]$/g, '').replace(/<br\s*\/?>/gi, '\n')
}

function parseNodeToken(token: string): { id: string; type: CanvasNodeType; label: string } | null {
  const match = token.trim().match(NODE_PATTERN)
  if (!match) return null
  const [, id, terminator, decision, rectangle, rounded] = match
  const database = rectangle?.match(/^\(([\s\S]*)\)$/)?.[1]
  const inputOutput = rectangle?.match(/^\/([\s\S]*)\/$/)?.[1]
  return {
    id,
    type: terminator
      ? 'terminator'
      : decision
        ? 'decision'
        : rounded
          ? 'terminator'
          : database
            ? 'database'
            : inputOutput ? 'input-output' : 'process',
    label: cleanLabel(terminator || decision || database || inputOutput || rectangle || rounded, id),
  }
}

function stripComment(line: string) {
  return line.replace(/%%.*$/, '').trim()
}

export function mermaidToCanvasDocument(source: string): CanvasDocument {
  const typeOverrides = new Map<string, CanvasNodeType>()
  for (const line of source.split(/\r?\n/)) {
    const match = line.trim().match(/^%%\s*notegen-type\s+([A-Za-z_][\w-]*)\s+([\w-]+)$/)
    if (match && isCanvasFlowchartNodeType(match[2])) {
      typeOverrides.set(match[1], match[2])
    }
  }
  const lines = source.split(/\r?\n/).map(stripComment).filter(Boolean)
  const header = lines.shift()?.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i)
  if (!header) throw new Error('Only Mermaid flowchart/graph syntax is supported')
  const direction = ['LR', 'RL'].includes(header[1].toUpperCase()) ? 'LR' : 'TB'
  const nodes = new Map<string, Omit<CanvasNode, 'position'>>()
  const edges: CanvasDocument['edges'] = []

  const register = (token: string) => {
    const parsed = parseNodeToken(token)
    if (!parsed) return null
    const existing = nodes.get(parsed.id)
    nodes.set(parsed.id, {
      id: parsed.id,
      type: typeOverrides.get(parsed.id) || existing?.type || parsed.type,
      data: { label: existing?.data.label || parsed.label },
    })
    return parsed.id
  }

  for (const line of lines) {
    const edgeMatch = line.match(/^(.+?)\s*(?:--\s*([^>]+?)\s*-->|-->|---|==>)\s*(.+)$/)
    if (edgeMatch) {
      const sourceId = register(edgeMatch[1])
      let targetToken = edgeMatch[3].trim()
      let label = edgeMatch[2]?.trim()
      const pipeLabel = targetToken.match(/^\|([^|]+)\|\s*(.+)$/)
      if (pipeLabel) {
        label = pipeLabel[1].trim()
        targetToken = pipeLabel[2]
      }
      const targetId = register(targetToken)
      if (sourceId && targetId) {
        edges.push({ id: crypto.randomUUID(), source: sourceId, target: targetId, ...(label ? { label } : {}), type: 'smoothstep' })
      }
      continue
    }
    register(line)
  }

  if (nodes.size === 0) throw new Error('No Mermaid nodes found')
  const indegree = new Map([...nodes.keys()].map(id => [id, 0]))
  const outgoing = new Map([...nodes.keys()].map(id => [id, [] as string[]]))
  edges.forEach(edge => {
    indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  })
  const level = new Map<string, number>()
  const queue = [...nodes.keys()].filter(id => (indegree.get(id) || 0) === 0)
  if (queue.length === 0) queue.push([...nodes.keys()][0])
  queue.forEach(id => level.set(id, 0))
  while (queue.length) {
    const id = queue.shift()!
    for (const target of outgoing.get(id) || []) {
      level.set(target, Math.max(level.get(target) || 0, (level.get(id) || 0) + 1))
      indegree.set(target, (indegree.get(target) || 1) - 1)
      if (indegree.get(target) === 0) queue.push(target)
    }
  }
  let fallbackLevel = Math.max(0, ...level.values()) + 1
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
  return value.replace(/"/g, '#quot;').replace(/\n/g, '<br/>')
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
    .map(edge => `  ${aliases.get(edge.source)} -->${edge.label ? `|${String(edge.label).replace(/\|/g, '/')}|` : ''} ${aliases.get(edge.target)}`)
  return [`flowchart ${direction}`, ...nodeLines, ...edgeLines].join('\n')
}
