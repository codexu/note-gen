import type { CanvasDocument, CanvasEdge, CanvasNodeType } from '@/types/canvas'
import { FLOWCHART_NODE_TYPES } from '@/lib/canvas/shapes'

type CanvasOperationType =
  | 'add_node'
  | 'update_node'
  | 'delete_node'
  | 'add_edge'
  | 'delete_edge'
  | 'clear'

const DEFAULT_NODE_LABELS: Partial<Record<CanvasNodeType, string>> = {
  decision: '判断条件',
  terminator: '开始 / 结束',
  'input-output': '输入 / 输出',
  document: '文档',
  'multi-document': '多文档',
  database: '数据库',
  'predefined-process': '子流程',
  'manual-input': '手动输入',
  preparation: '准备',
  delay: '延迟',
  display: '显示',
  connector: '连接符',
  'off-page-connector': '跨页连接符',
  'internal-storage': '内部存储',
  'stored-data': '存储数据',
  text: '文本',
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function applyCanvasOperations(document: CanvasDocument, rawOperations: unknown[]) {
  let nodes = structuredClone(document.nodes)
  let edges = structuredClone(document.edges)
  let applied = 0

  for (const rawOperation of rawOperations) {
    const operation = asRecord(rawOperation)
    const type = asString(operation.type) as CanvasOperationType

    if (type === 'clear') {
      nodes = []
      edges = []
      applied += 1
      continue
    }

    if (type === 'add_node') {
      const requestedType = asString(operation.nodeType)
      const nodeType: CanvasNodeType = [...FLOWCHART_NODE_TYPES, 'text'].includes(requestedType as CanvasNodeType)
        ? requestedType as CanvasNodeType
        : 'process'
      const id = asString(operation.id) || crypto.randomUUID()
      if (nodes.some(node => node.id === id)) continue
      const index = nodes.length
      nodes.push({
        id,
        type: nodeType,
        position: {
          x: asFiniteNumber(operation.x, (index % 4) * 240),
          y: asFiniteNumber(operation.y, Math.floor(index / 4) * 140),
        },
        data: {
          label: asString(operation.label) || DEFAULT_NODE_LABELS[nodeType] || '处理步骤',
          description: asString(operation.description) || undefined,
        },
      })
      applied += 1
      continue
    }

    if (type === 'update_node') {
      const id = asString(operation.id)
      const index = nodes.findIndex(node => node.id === id)
      if (index < 0) continue
      const current = nodes[index]
      nodes[index] = {
        ...current,
        position: {
          x: asFiniteNumber(operation.x, current.position.x),
          y: asFiniteNumber(operation.y, current.position.y),
        },
        data: {
          ...current.data,
          ...(typeof operation.label === 'string' ? { label: operation.label.trim() } : {}),
          ...(typeof operation.description === 'string' ? { description: operation.description.trim() } : {}),
        },
      }
      applied += 1
      continue
    }

    if (type === 'delete_node') {
      const id = asString(operation.id)
      if (!nodes.some(node => node.id === id)) continue
      nodes = nodes.filter(node => node.id !== id)
      edges = edges.filter(edge => edge.source !== id && edge.target !== id)
      applied += 1
      continue
    }

    if (type === 'add_edge') {
      const source = asString(operation.source)
      const target = asString(operation.target)
      if (!nodes.some(node => node.id === source) || !nodes.some(node => node.id === target)) continue
      const id = asString(operation.id) || crypto.randomUUID()
      if (edges.some(edge => edge.id === id)) continue
      const edge: CanvasEdge = {
        id,
        source,
        target,
        type: 'smoothstep',
        label: asString(operation.label) || undefined,
      }
      edges.push(edge)
      applied += 1
      continue
    }

    if (type === 'delete_edge') {
      const id = asString(operation.id)
      if (!edges.some(edge => edge.id === id)) continue
      edges = edges.filter(edge => edge.id !== id)
      applied += 1
    }
  }

  return {
    document: { ...document, nodes, edges },
    applied,
  }
}
