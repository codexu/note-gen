'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { convertFileSrc } from '@tauri-apps/api/core'

import { getCanvasProject } from '@/db/canvases'
import { canvasDocumentToSvg } from '@/lib/canvas/static-export'
import { cn } from '@/lib/utils'
import useCanvasStore, { hasCurrentThumbnail } from '@/stores/canvas'
import type { CanvasProjectSummary } from '@/types/canvas'

export function CanvasThumbnail({ project, compact = false, mobile = false }: {
  project: CanvasProjectSummary
  compact?: boolean
  mobile?: boolean
}) {
  const container = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [failedKey, setFailedKey] = useState<string>()
  const [fallback, setFallback] = useState<{ key: string; src: string }>()
  const { id, thumbnailPath, updatedAt, thumbnailRevision } = project
  const key = `${id}:${thumbnailPath || ''}:${thumbnailRevision || updatedAt}`
  const current = hasCurrentThumbnail(project)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || (current && failedKey !== key)) {
      setFallback(undefined)
      return
    }
    let cancelled = false
    async function repair() {
      await useCanvasStore.getState().repairThumbnail(id)
      const store = useCanvasStore.getState()
      const latest = store.projects.find(item => item.id === id) || store.deletedProjects.find(item => item.id === id)
      if (cancelled || !latest) return
      if (hasCurrentThumbnail(latest) && (latest.thumbnailRevision !== thumbnailRevision || failedKey !== key)) return
      const document = store.documents[id] || (await getCanvasProject(id, { includeHistory: false }))?.document
      if (!cancelled && document) {
        const svg = canvasDocumentToSvg(document)
        setFallback({ key, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` })
      }
    }
    void repair().catch(error => console.error('Failed to load canvas thumbnail:', error))
    return () => { cancelled = true }
  }, [current, failedKey, id, key, thumbnailRevision, visible])

  const source = thumbnailPath && failedKey !== key
    ? `${convertFileSrc(thumbnailPath)}?v=${thumbnailRevision || updatedAt}`
    : fallback?.key === key ? fallback.src : undefined

  return (
    <span ref={container} className={cn(
      'relative block shrink-0 overflow-hidden bg-muted/20',
      mobile ? 'aspect-[4/3] w-full border-b'
        : compact ? 'h-10 w-14 rounded-md border' : 'aspect-[4/3] w-full rounded-t-lg border-b'
    )}>
      {visible && source && (
        <Image
          src={source}
          alt=""
          fill
          unoptimized
          sizes={mobile ? '(min-width: 700px) 30vw, 50vw' : compact ? '56px' : '140px'}
          className={cn('object-contain', compact ? 'p-1' : 'p-2')}
          onError={() => setFailedKey(key)}
        />
      )}
    </span>
  )
}
