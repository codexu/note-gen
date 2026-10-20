import emitter from '@/lib/emitter'
import { applyCanvasOperations } from '@/lib/canvas/operations'
import type { CanvasDocument } from '@/types/canvas'
import type { AgentTool, AgentToolExecutionContext, AgentToolResult } from '../types'
import { FLOWCHART_NODE_TYPES } from '@/lib/canvas/shapes'

const CANVAS_NODE_TYPES = [
  ...FLOWCHART_NODE_TYPES,
  'text',
] as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asNonEmptyString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function validateCanvasOperations(document: CanvasDocument, rawOperations: unknown[]) {
  const nodeIds = new Set(document.nodes.map(node => node.id))
  const edgeIds = new Set(document.edges.map(edge => edge.id))

  for (const [index, rawOperation] of rawOperations.entries()) {
    const operation = asRecord(rawOperation)
    const type = asNonEmptyString(operation.type)
    const item = `operations[${index}]`

    if (type === 'clear') {
      nodeIds.clear()
      edgeIds.clear()
      continue
    }

    if (type === 'add_node') {
      const id = asNonEmptyString(operation.id)
      const nodeType = asNonEmptyString(operation.nodeType)
      const label = asNonEmptyString(operation.label)
      if (!id || !nodeType || !label || !isFiniteNumber(operation.x) || !isFiniteNumber(operation.y)) {
        return `${item} 添加节点时必须提供非空 id、nodeType、label，以及有限数值 x、y。`
      }
      if (!CANVAS_NODE_TYPES.includes(nodeType as typeof CANVAS_NODE_TYPES[number])) {
        return `${item}.nodeType 必须是 ${CANVAS_NODE_TYPES.join('、')} 之一。`
      }
      if (nodeIds.has(id)) {
        return `${item}.id="${id}" 已存在；新节点必须使用唯一且稳定的 ID。`
      }
      nodeIds.add(id)
      continue
    }

    if (type === 'update_node') {
      const id = asNonEmptyString(operation.id)
      if (!id || !nodeIds.has(id)) {
        return `${item} 必须提供当前画布中真实存在的节点 id。`
      }
      const hasUpdate = typeof operation.label === 'string'
        || typeof operation.description === 'string'
        || isFiniteNumber(operation.x)
        || isFiniteNumber(operation.y)
      if (!hasUpdate) {
        return `${item} 至少需要提供 label、description、x、y 中的一项修改。`
      }
      continue
    }

    if (type === 'delete_node') {
      const id = asNonEmptyString(operation.id)
      if (!id || !nodeIds.has(id)) {
        return `${item} 必须提供当前画布中真实存在的节点 id。`
      }
      nodeIds.delete(id)
      continue
    }

    if (type === 'add_edge') {
      const id = asNonEmptyString(operation.id)
      const source = asNonEmptyString(operation.source)
      const target = asNonEmptyString(operation.target)
      if (!id || !source || !target) {
        return `${item} 添加连线时必须提供非空 id、source 和 target。`
      }
      if (!nodeIds.has(source) || !nodeIds.has(target)) {
        return `${item} 的 source 和 target 必须引用当前画布中存在或本批次先前已添加的节点 ID。`
      }
      if (source === target) {
        return `${item} 不能把节点连接到自身。`
      }
      if (edgeIds.has(id)) {
        return `${item}.id="${id}" 已存在；新连线必须使用唯一且稳定的 ID。`
      }
      edgeIds.add(id)
      continue
    }

    if (type === 'delete_edge') {
      const id = asNonEmptyString(operation.id)
      if (!id || !edgeIds.has(id)) {
        return `${item} 必须提供当前画布中真实存在的连线 id。`
      }
      edgeIds.delete(id)
      continue
    }

    return `${item}.type 不是支持的画布操作。`
  }

  return null
}

async function getActiveCanvas(contextCanvasId?: string) {
  const { default: useCanvasStore } = await import('@/stores/canvas')
  const store = useCanvasStore.getState()
  const canvasId = contextCanvasId || store.activeCanvasId || ''
  const document = canvasId ? store.documents[canvasId] : undefined
  const project = store.projects.find(item => item.id === canvasId)
  return { store, canvasId, document, project }
}

function summarizeDocument(document: CanvasDocument) {
  return {
    settings: document.settings,
    viewport: document.viewport,
    nodes: document.nodes.map(node => ({
      id: node.id,
      type: node.type,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      label: node.data.label || '',
      description: node.data.description || '',
    })),
    edges: document.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label || '',
    })),
  }
}

async function executeCanvasOperations(
  operations: unknown[],
  context: AgentToolExecutionContext
): Promise<AgentToolResult> {
  const { store, canvasId, document, project } = await getActiveCanvas(context.context.activeCanvasId)
  if (!canvasId || !document) {
    return { ok: false, message: '当前没有打开的画布。', error: 'NO_ACTIVE_CANVAS' }
  }
  if (operations.length === 0) {
    return { ok: false, message: '没有提供可执行的画布操作。', error: 'EMPTY_OPERATIONS' }
  }
  const validationError = validateCanvasOperations(document, operations)
  if (validationError) {
    return {
      ok: false,
      message: `画布操作参数无效，整批未执行：${validationError}`,
      error: 'INVALID_CANVAS_OPERATIONS',
    }
  }

  const before = JSON.stringify(summarizeDocument(document))
  const result = applyCanvasOperations(document, operations)
  if (result.applied !== operations.length) {
    return {
      ok: false,
      message: '画布操作未能完整应用，整批未写入。',
      error: 'INCOMPLETE_CANVAS_OPERATIONS',
    }
  }
  store.updateDocument(canvasId, result.document)
  emitter.emit('canvas-document-replace', { canvasId, document: result.document })
  requestAnimationFrame(() => {
    emitter.emit('canvas-auto-layout', { recordHistory: false })
  })

  return {
    ok: true,
    message: `已在画布“${project?.title || canvasId}”应用 ${result.applied} 项修改。`,
    data: summarizeDocument(result.document),
    changes: [{
      id: crypto.randomUUID(),
      type: 'canvas',
      target: canvasId,
      before,
      after: JSON.stringify(summarizeDocument(result.document)),
      reversible: true,
      summary: `修改画布“${project?.title || canvasId}”`,
    }],
  }
}

const getCanvasStateTool: AgentTool = {
  name: 'canvas_get_state',
  title: '读取当前画布',
  description: '读取 NoteGen 当前打开的原生可视化画布，包括节点、连线、位置和设置。仅在用户要检查或操作当前画布时使用；一般性的图表、节点或连线问题不需要读取画布。',
  category: 'canvas',
  risk: 'read',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  execute: async (_input, context): Promise<AgentToolResult> => {
    const { canvasId, document, project } = await getActiveCanvas(context.context.activeCanvasId)
    if (!canvasId || !document) {
      return { ok: false, message: '当前没有打开的画布。', error: 'NO_ACTIVE_CANVAS' }
    }
    return {
      ok: true,
      message: `已读取画布“${project?.title || canvasId}”，共 ${document.nodes.length} 个节点、${document.edges.length} 条连线。`,
      data: { canvasId, title: project?.title || '', ...summarizeDocument(document) },
    }
  },
}

const createCanvasDiagramTool: AgentTool = {
  name: 'canvas_create_diagram',
  title: '创建完整画布图表',
  description: '在当前原生画布中一次创建由多个命名节点和连线组成的完整图表。新建流程图、思维导图或关系图时优先使用；不要拆成缺少名称或端点的操作。每个节点需要唯一 ID、类型、可见名称和坐标，每条连线用 source、target 精确引用这些节点 ID。',
  category: 'canvas',
  risk: 'editor-write',
  inputSchema: {
    type: 'object',
    properties: {
      replaceExisting: {
        type: 'boolean',
        description: '为 true 时先清空当前画布；为 false 时保留现有内容并追加图表。',
      },
      nodes: {
        type: 'array',
        description: '图表的全部节点。ID 在本次调用中必须唯一，并供 edges 原样引用。',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '唯一且稳定的节点 ID。' },
            nodeType: {
              type: 'string',
              enum: [...CANVAS_NODE_TYPES],
              description: '节点形状。根据语义选择标准流程图图形，例如 process 步骤、decision 判断、terminator 开始结束、input-output 输入输出、document/multi-document 文档、predefined-process 子流程、manual-input 手动输入、preparation 准备、delay 延迟、display 显示、connector/off-page-connector 连接符、internal-storage/database/stored-data 数据存储、text 纯文本。',
            },
            label: { type: 'string', description: '显示在节点上的非空名称。' },
            description: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['id', 'nodeType', 'label', 'x', 'y'],
          additionalProperties: false,
        },
      },
      edges: {
        type: 'array',
        description: '图表的全部连线。source 和 target 必须原样引用 nodes 中的 ID。',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '唯一且稳定的连线 ID。' },
            source: { type: 'string', description: '起点节点 ID。' },
            target: { type: 'string', description: '终点节点 ID。' },
            label: { type: 'string', description: '分支条件等可见连线名称。' },
          },
          required: ['id', 'source', 'target'],
          additionalProperties: false,
        },
      },
    },
    required: ['replaceExisting', 'nodes', 'edges'],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const nodes = Array.isArray(input.nodes) ? input.nodes : []
    const edges = Array.isArray(input.edges) ? input.edges : []
    const operations: unknown[] = [
      ...(input.replaceExisting === true ? [{ type: 'clear' }] : []),
      ...nodes.map(node => ({ type: 'add_node', ...asRecord(node) })),
      ...edges.map(edge => ({ type: 'add_edge', ...asRecord(edge) })),
    ]
    return executeCanvasOperations(operations, context)
  },
}

const applyCanvasOperationsTool: AgentTool = {
  name: 'canvas_apply_operations',
  title: '编辑当前画布',
  description: '增量编辑 NoteGen 当前打开的原生可视化画布，例如更新、移动或删除已有节点和连线。创建包含多个新节点和连线的完整图表时改用 canvas_create_diagram。所有操作会先整批校验，任何参数缺失时均不写入。',
  category: 'canvas',
  risk: 'editor-write',
  inputSchema: {
    type: 'object',
    properties: {
      operations: {
        type: 'array',
        description: '按顺序执行的原子画布编辑。先添加节点，再用相同的稳定节点 ID 添加连线；任意一项无效时整批不执行。',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['add_node', 'update_node', 'delete_node', 'add_edge', 'delete_edge', 'clear'],
              description: '操作类型。不同类型所需字段由工具描述和运行时校验决定。',
            },
            id: { type: 'string', description: '节点或连线的稳定 ID。除 clear 外均需要。' },
            nodeType: {
              type: 'string',
              enum: [...CANVAS_NODE_TYPES],
              description: 'add_node 的节点形状。',
            },
            label: { type: 'string' },
            description: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            source: { type: 'string', description: 'add_edge 的起点节点 ID。' },
            target: { type: 'string', description: 'add_edge 的终点节点 ID。' },
          },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['operations'],
    additionalProperties: false,
  },
  execute: async (input, context): Promise<AgentToolResult> => {
    const operations = Array.isArray(input.operations) ? input.operations : []
    return executeCanvasOperations(operations, context)
  },
}

export const canvasTools: AgentTool[] = [
  getCanvasStateTool,
  createCanvasDiagramTool,
  applyCanvasOperationsTool,
]
