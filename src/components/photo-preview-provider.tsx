'use client'

import type * as React from "react"
import { Minus, Plus } from "lucide-react"
import { PhotoProvider } from "react-photo-view"
import { Button } from "@/components/ui/button"

type ToolbarProps = Parameters<NonNullable<React.ComponentProps<typeof PhotoProvider>["toolbarRender"]>>[0]

const MIN_SCALE = 1
const MAX_SCALE = 8
const SCALE_STEP = 0.5

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(2))))
}

function PhotoToolbar({ scale, onScale }: ToolbarProps) {
  const nextZoomOut = clampScale(scale - SCALE_STEP)
  const nextZoomIn = clampScale(scale + SCALE_STEP)

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-black/55 p-1.5 backdrop-blur-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
        onClick={() => onScale(nextZoomOut)}
        disabled={scale <= MIN_SCALE}
        aria-label="Zoom out"
      >
        <Minus className="h-4 w-4" />
      </Button>
      <span className="min-w-12 text-center text-xs tabular-nums text-white/80">
        {Math.round(scale * 100)}%
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-white hover:bg-white/10 hover:text-white disabled:opacity-40"
        onClick={() => onScale(nextZoomIn)}
        disabled={scale >= MAX_SCALE}
        aria-label="Zoom in"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}

export function PhotoPreviewProvider({ children }: { children: React.ReactNode }) {
  return (
    <PhotoProvider
      maskClosable
      photoClosable
      toolbarRender={(props) => <PhotoToolbar {...props} />}
    >
      {children}
    </PhotoProvider>
  )
}
