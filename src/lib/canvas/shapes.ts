import type { CanvasNodeType } from '@/types/canvas'

export const FLOWCHART_NODE_TYPES = [
  'process',
  'decision',
  'terminator',
  'input-output',
  'document',
  'multi-document',
  'database',
  'predefined-process',
  'manual-input',
  'preparation',
  'delay',
  'display',
  'connector',
  'off-page-connector',
  'internal-storage',
  'stored-data',
] as const satisfies readonly CanvasNodeType[]

export type CanvasFlowchartNodeType = typeof FLOWCHART_NODE_TYPES[number]

export function isCanvasFlowchartNodeType(value: unknown): value is CanvasFlowchartNodeType {
  return typeof value === 'string'
    && FLOWCHART_NODE_TYPES.includes(value as CanvasFlowchartNodeType)
}

export function getCanvasNodeDefaultSize(type: CanvasNodeType) {
  if (type === 'chart') return { width: 520, height: 340 }
  if (type === 'decision') return { width: 144, height: 144 }
  if (type === 'connector') return { width: 80, height: 80 }
  if (type === 'off-page-connector') return { width: 120, height: 100 }
  if (type === 'text') return { width: 120, height: 40 }
  if (type === 'record') return { width: 280, height: 120 }
  if (type === 'group') return { width: 360, height: 240 }
  if (isCanvasFlowchartNodeType(type)) return { width: 192, height: 80 }
  return { width: 180, height: 56 }
}
