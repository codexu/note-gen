import { useEffect, useState } from 'react'
import { getCanvasProjects } from '@/db/canvases'
import useCanvasStore from '@/stores/canvas'
import type { CanvasProjectType } from '@/types/canvas'

interface SearchCanvas {
  id: string
  title: string
  canvasType: CanvasProjectType
  nodes: Array<{ id: string; fields: string[] }>
  content: string
}

export function useCanvasSearchProjects(enabled: boolean) {
  const summaries = useCanvasStore(state => state.projects)
  const [projects, setProjects] = useState<SearchCanvas[]>([])
  useEffect(() => {
    if (!enabled) {
      setProjects([])
      return
    }
    let cancelled = false
    void getCanvasProjects({ includeHistory: false }).then(rows => {
      if (cancelled) return
      setProjects(rows.map(({ id, title, canvasType, document }) => {
        const nodes = document.nodes.map(node => ({
          id: node.id,
          fields: [node.data.label, node.data.description, node.data.filePath, node.data.url]
            .filter((field): field is string => typeof field === 'string'),
        }))
        const content = [
          ...nodes.flatMap(node => node.fields),
          ...document.edges.map(edge => edge.label).filter((label): label is string => typeof label === 'string'),
        ].join(' ')
        return { id, title, canvasType, nodes, content }
      }))
    }).catch(error => console.error('Failed to load searchable canvas text:', error))
    return () => { cancelled = true }
  }, [enabled, summaries])
  return projects
}
