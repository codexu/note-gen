import {
  normalizeCanvasDocument,
  type CanvasDocument,
  type CanvasProject,
  type CanvasProjectType,
} from '@/types/canvas'

export interface CanvasPortableFile {
  format: 'notegen-canvas'
  version: 1
  title: string
  canvasType: CanvasProjectType
  document: CanvasDocument
  exportedAt: string
}

const PROJECT_TYPES = new Set<CanvasProjectType>([
  'blank', 'flowchart', 'mindmap', 'timeline', 'quadrant', 'kanban', 'swot',
])

export function serializeCanvasProject(project: Pick<CanvasProject, 'title' | 'canvasType' | 'document'>): string {
  const file: CanvasPortableFile = {
    format: 'notegen-canvas',
    version: 1,
    title: project.title,
    canvasType: project.canvasType,
    document: project.document,
    exportedAt: new Date().toISOString(),
  }
  return JSON.stringify(file, null, 2)
}

export function parseCanvasProjectFile(source: string): Pick<CanvasPortableFile, 'title' | 'canvasType' | 'document'> {
  const parsed: unknown = JSON.parse(source)
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid canvas file')
  const candidate = parsed as Partial<CanvasPortableFile> & Partial<CanvasDocument>
  const isPortable = candidate.format === 'notegen-canvas'
  if (isPortable && candidate.version !== 1) throw new Error('Unsupported canvas file version')
  const rawDocument = isPortable ? candidate.document : candidate
  const document = normalizeCanvasDocument(rawDocument)
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) throw new Error('Invalid canvas document')
  const canvasType = isPortable && PROJECT_TYPES.has(candidate.canvasType as CanvasProjectType)
    ? candidate.canvasType as CanvasProjectType
    : 'blank'
  return {
    title: isPortable && typeof candidate.title === 'string' ? candidate.title : '导入的画布',
    canvasType,
    document,
  }
}
