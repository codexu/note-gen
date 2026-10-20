import { DEFAULT_CANVAS_DOCUMENT, type CanvasDocument, type CanvasProjectType } from '@/types/canvas'

const FLOWCHART_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'start', type: 'terminator', position: { x: 180, y: 0 }, data: { label: '开始' } },
    { id: 'process', type: 'process', position: { x: 160, y: 140 }, data: { label: '处理步骤' } },
    { id: 'decision', type: 'decision', position: { x: 180, y: 280 }, data: { label: '判断条件' } },
    { id: 'end', type: 'terminator', position: { x: 180, y: 480 }, data: { label: '结束' } },
  ],
  edges: [
    { id: 'start-process', source: 'start', target: 'process', type: 'smoothstep' },
    { id: 'process-decision', source: 'process', target: 'decision', type: 'smoothstep' },
    { id: 'decision-end', source: 'decision', target: 'end', label: '是', type: 'smoothstep' },
  ],
  viewport: { x: 200, y: 40, zoom: 0.9 },
}

const MINDMAP_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  settings: { ...DEFAULT_CANVAS_DOCUMENT.settings, layoutDirection: 'LR' },
  nodes: [
    { id: 'topic', type: 'process', position: { x: 0, y: 160 }, data: { label: '中心主题' } },
    { id: 'branch-1', type: 'process', position: { x: 280, y: 40 }, data: { label: '分支一' } },
    { id: 'branch-2', type: 'process', position: { x: 280, y: 160 }, data: { label: '分支二' } },
    { id: 'branch-3', type: 'process', position: { x: 280, y: 280 }, data: { label: '分支三' } },
  ],
  edges: [
    { id: 'topic-branch-1', source: 'topic', target: 'branch-1', type: 'smoothstep' },
    { id: 'topic-branch-2', source: 'topic', target: 'branch-2', type: 'smoothstep' },
    { id: 'topic-branch-3', source: 'topic', target: 'branch-3', type: 'smoothstep' },
  ],
  viewport: { x: 120, y: 80, zoom: 0.9 },
}

const TIMELINE_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  settings: { ...DEFAULT_CANVAS_DOCUMENT.settings, layoutDirection: 'LR' },
  nodes: [
    { id: 'time-1', type: 'terminator', position: { x: 0, y: 160 }, data: { label: '阶段一', description: '目标与准备' } },
    { id: 'time-2', type: 'terminator', position: { x: 260, y: 160 }, data: { label: '阶段二', description: '执行与验证' } },
    { id: 'time-3', type: 'terminator', position: { x: 520, y: 160 }, data: { label: '阶段三', description: '复盘与交付' } },
  ],
  edges: [
    { id: 'time-1-2', source: 'time-1', target: 'time-2', type: 'smoothstep' },
    { id: 'time-2-3', source: 'time-2', target: 'time-3', type: 'smoothstep' },
  ],
  viewport: { x: 80, y: 80, zoom: 0.9 },
}

const QUADRANT_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'q1', type: 'group', position: { x: 0, y: 0 }, width: 300, height: 220, zIndex: -1, data: { label: '重要且紧急', color: '#ef4444', childIds: [] } },
    { id: 'q2', type: 'group', position: { x: 330, y: 0 }, width: 300, height: 220, zIndex: -1, data: { label: '重要不紧急', color: '#3b82f6', childIds: [] } },
    { id: 'q3', type: 'group', position: { x: 0, y: 250 }, width: 300, height: 220, zIndex: -1, data: { label: '紧急不重要', color: '#f59e0b', childIds: [] } },
    { id: 'q4', type: 'group', position: { x: 330, y: 250 }, width: 300, height: 220, zIndex: -1, data: { label: '不重要不紧急', color: '#64748b', childIds: [] } },
  ],
  edges: [],
  viewport: { x: 120, y: 60, zoom: 0.9 },
}

const KANBAN_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'todo-column', type: 'group', position: { x: 0, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: '待处理', color: '#64748b', childIds: ['todo-card'] } },
    { id: 'doing-column', type: 'group', position: { x: 280, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: '进行中', color: '#3b82f6', childIds: ['doing-card'] } },
    { id: 'done-column', type: 'group', position: { x: 560, y: 0 }, width: 250, height: 480, zIndex: -1, data: { label: '已完成', color: '#22c55e', childIds: ['done-card'] } },
    { id: 'todo-card', type: 'todo', position: { x: 30, y: 80 }, data: { label: '梳理任务', checked: false } },
    { id: 'doing-card', type: 'todo', position: { x: 310, y: 80 }, data: { label: '推进工作', checked: false } },
    { id: 'done-card', type: 'todo', position: { x: 590, y: 80 }, data: { label: '完成事项', checked: true } },
  ],
  edges: [],
  viewport: { x: 80, y: 40, zoom: 0.82 },
}

const SWOT_TEMPLATE: CanvasDocument = {
  ...structuredClone(DEFAULT_CANVAS_DOCUMENT),
  nodes: [
    { id: 'strengths', type: 'note', position: { x: 0, y: 0 }, width: 280, height: 190, data: { label: '优势 Strengths', description: '我们擅长什么？', color: '#22c55e' } },
    { id: 'weaknesses', type: 'note', position: { x: 320, y: 0 }, width: 280, height: 190, data: { label: '劣势 Weaknesses', description: '需要改善什么？', color: '#f59e0b' } },
    { id: 'opportunities', type: 'note', position: { x: 0, y: 230 }, width: 280, height: 190, data: { label: '机会 Opportunities', description: '外部有哪些机会？', color: '#3b82f6' } },
    { id: 'threats', type: 'note', position: { x: 320, y: 230 }, width: 280, height: 190, data: { label: '威胁 Threats', description: '外部有哪些风险？', color: '#ef4444' } },
  ],
  edges: [],
  viewport: { x: 160, y: 80, zoom: 0.9 },
}

export function createCanvasDocument(canvasType: CanvasProjectType): CanvasDocument {
  if (canvasType === 'flowchart') return structuredClone(FLOWCHART_TEMPLATE)
  if (canvasType === 'mindmap') return structuredClone(MINDMAP_TEMPLATE)
  if (canvasType === 'timeline') return structuredClone(TIMELINE_TEMPLATE)
  if (canvasType === 'quadrant') return structuredClone(QUADRANT_TEMPLATE)
  if (canvasType === 'kanban') return structuredClone(KANBAN_TEMPLATE)
  if (canvasType === 'swot') return structuredClone(SWOT_TEMPLATE)
  return structuredClone(DEFAULT_CANVAS_DOCUMENT)
}
