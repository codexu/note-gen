'use client'

import { useState } from 'react'
import Image from 'next/image'
import { convertFileSrc } from '@tauri-apps/api/core'

import { canvasDocumentToSvg } from '@/lib/canvas/static-export'
import { cn } from '@/lib/utils'
import useCanvasStore from '@/stores/canvas'
import type { CanvasProject } from '@/types/canvas'

export function CanvasThumbnail({ project, compact = false }: { project: CanvasProject; compact?: boolean }) {
  const fallback = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(canvasDocumentToSvg(project.document))}`
  const repairThumbnail = useCanvasStore(state => state.repairThumbnail)
  const [failedSourceKey, setFailedSourceKey] = useState<string | null>(null)
  const thumbnailSourceKey = `${project.thumbnailPath || 'missing'}:${project.thumbnailRevision || project.updatedAt}`
  const fallbackActive = failedSourceKey === thumbnailSourceKey
  const source = project.thumbnailPath && !fallbackActive
    ? `${convertFileSrc(project.thumbnailPath)}?v=${project.thumbnailRevision || project.updatedAt}`
    : fallback

  return (
    <span className={cn(
      'relative block shrink-0 overflow-hidden border bg-muted/20',
      compact ? 'h-10 w-14 rounded-md' : 'aspect-[4/3] w-full rounded-t-lg border-x-0 border-t-0'
    )}>
      <Image
        src={source}
        alt=""
        fill
        unoptimized
        sizes={compact ? '56px' : '140px'}
        className={cn('object-contain', compact ? 'p-1' : 'p-2')}
        onError={() => {
          if (fallbackActive || !project.thumbnailPath) return
          setFailedSourceKey(thumbnailSourceKey)
          void repairThumbnail(project.id)
        }}
      />
    </span>
  )
}
